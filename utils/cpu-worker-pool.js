import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { cpus } from 'os';
import { log } from './logger.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * CPU 집약적 작업을 위한 워커 풀 관리자
 * - JSON 파싱/직렬화 병렬 처리
 * - 대용량 텍스트 처리 분산
 * - 정규식 검색 병렬화
 * - CPU 코어 수 기반 자동 스케일링
 */
export class CPUWorkerPool {
  constructor(options = {}) {
    this.options = {
      maxWorkers: options.maxWorkers || cpus().length,
      minWorkers: options.minWorkers || Math.max(2, Math.floor(cpus().length / 2)),
      workerIdleTimeout: options.workerIdleTimeout || 30000, // 30초
      taskTimeout: options.taskTimeout || 60000, // 60초
      queueMaxSize: options.queueMaxSize || 1000,
      enableAutoScaling: options.enableAutoScaling !== false,
      ...options
    };

    // 워커 풀
    this.workers = new Map();
    this.availableWorkers = [];
    this.busyWorkers = new Set();
    
    // 작업 큐
    this.taskQueue = [];
    this.taskId = 0;
    this.pendingTasks = new Map();
    
    // 성능 통계
    this.stats = {
      tasksCompleted: 0,
      tasksQueued: 0,
      tasksFailed: 0,
      totalProcessingTime: 0,
      avgProcessingTime: 0,
      workerUtilization: 0,
      queueLength: 0,
      peakWorkers: 0,
      cpuCores: cpus().length,
      currentWorkers: 0
    };
    
    // 자동 스케일링
    this.lastScaleCheck = Date.now();
    this.scaleCheckInterval = 5000; // 5초마다 체크
    
    // 워커 스크립트 경로
    this.workerScript = path.join(__dirname, 'cpu-worker.js');
    
    this.init();
    
    log.info('CPU Worker Pool initialized', {
      maxWorkers: this.options.maxWorkers,
      minWorkers: this.options.minWorkers,
      cpuCores: this.stats.cpuCores,
      enableAutoScaling: this.options.enableAutoScaling
    });
  }

  /**
   * 워커 풀 초기화
   */
  async init() {
    // 최소 워커 수만큼 생성
    for (let i = 0; i < this.options.minWorkers; i++) {
      await this.createWorker();
    }
    
    // 자동 스케일링 활성화
    if (this.options.enableAutoScaling) {
      this.startAutoScaling();
    }
  }

  /**
   * 새 워커 생성
   */
  async createWorker() {
    return new Promise((resolve, reject) => {
      const workerId = Date.now() + Math.random();
      
      try {
        const worker = new Worker(this.workerScript, {
          workerData: { 
            workerId,
            options: this.options 
          }
        });
        
        worker.workerId = workerId;
        worker.taskCount = 0;
        worker.totalTime = 0;
        worker.isIdle = true;
        worker.lastUsed = Date.now();
        
        worker.on('message', (result) => {
          // ready 메시지는 무시
          if (result.type === 'ready') {
            log.debug('Worker ready', { workerId: result.workerId });
            return;
          }
          
          this.handleWorkerMessage(workerId, result);
        });
        
        worker.on('error', (error) => {
          this.handleWorkerError(workerId, error);
        });
        
        worker.on('exit', (code) => {
          this.handleWorkerExit(workerId, code);
        });
        
        this.workers.set(workerId, worker);
        this.availableWorkers.push(workerId);
        this.stats.currentWorkers++;
        this.stats.peakWorkers = Math.max(this.stats.peakWorkers, this.stats.currentWorkers);
        
        log.debug('Worker created', { 
          workerId: workerId.toString().slice(-8),
          totalWorkers: this.stats.currentWorkers 
        });
        
        resolve(workerId);
      } catch (error) {
        log.error('Failed to create worker', { error: error.message });
        reject(error);
      }
    });
  }

  /**
   * 워커에게 작업 할당
   */
  async executeTask(taskType, data, options = {}) {
    return new Promise((resolve, reject) => {
      const taskId = ++this.taskId;
      const task = {
        id: taskId,
        type: taskType,
        data,
        options,
        resolve,
        reject,
        createdAt: Date.now(),
        timeout: options.timeout || this.options.taskTimeout
      };
      
      this.stats.tasksQueued++;
      
      // 큐 크기 제한 확인
      if (this.taskQueue.length >= this.options.queueMaxSize) {
        this.stats.tasksFailed++;
        reject(new Error('Task queue is full'));
        return;
      }
      
      // 사용 가능한 워커가 있으면 즉시 실행
      if (this.availableWorkers.length > 0) {
        this.assignTaskToWorker(task);
      } else {
        // 큐에 추가
        this.taskQueue.push(task);
        this.stats.queueLength = this.taskQueue.length;
        
        // 워커 확장 고려
        this.considerScaling();
      }
      
          // 타임아웃 설정
    const timeoutId = setTimeout(() => {
      if (this.pendingTasks.has(taskId)) {
        this.pendingTasks.delete(taskId);
        this.stats.tasksFailed++;
        reject(new Error(`Task ${taskId} timed out`));
      }
    }, task.timeout);
    
    // 작업에 타임아웃 ID 저장
    task.timeoutId = timeoutId;
    });
  }

  /**
   * 워커에게 작업 할당
   */
  assignTaskToWorker(task) {
    const workerId = this.availableWorkers.shift();
    if (!workerId) {
      this.taskQueue.push(task);
      return;
    }
    
    const worker = this.workers.get(workerId);
    if (!worker) {
      this.taskQueue.push(task);
      return;
    }
    
    // 워커 상태 업데이트
    worker.isIdle = false;
    worker.lastUsed = Date.now();
    worker.taskCount++;
    this.busyWorkers.add(workerId);
    
    // 작업 전송
    this.pendingTasks.set(task.id, { task, workerId, startTime: Date.now() });
    
    worker.postMessage({
      taskId: task.id,
      type: task.type,
      data: task.data,
      options: task.options
    });
    
    log.debug('Task assigned to worker', {
      taskId: task.id,
      workerId: workerId.toString().slice(-8),
      type: task.type,
      queueLength: this.taskQueue.length
    });
  }

  /**
   * 워커 메시지 처리
   */
  handleWorkerMessage(workerId, result) {
    const { taskId, success, data, error, processingTime } = result;
    const pendingTask = this.pendingTasks.get(taskId);
    
    if (!pendingTask) {
      log.warn('Received result for unknown task', { taskId, workerId });
      return;
    }
    
    const { task } = pendingTask;
    this.pendingTasks.delete(taskId);
    
    // 타임아웃 정리
    if (task.timeoutId) {
      clearTimeout(task.timeoutId);
    }
    
    // 워커를 사용 가능한 상태로 변경
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.isIdle = true;
      worker.totalTime += processingTime || 0;
      this.busyWorkers.delete(workerId);
      this.availableWorkers.push(workerId);
    }
    
    // 통계 업데이트
    if (success) {
      this.stats.tasksCompleted++;
      this.stats.totalProcessingTime += processingTime || 0;
      this.stats.avgProcessingTime = this.stats.totalProcessingTime / this.stats.tasksCompleted;
      task.resolve(data);
    } else {
      this.stats.tasksFailed++;
      task.reject(new Error(error || 'Worker task failed'));
    }
    
    // 대기 중인 작업 처리
    if (this.taskQueue.length > 0) {
      const nextTask = this.taskQueue.shift();
      this.stats.queueLength = this.taskQueue.length;
      this.assignTaskToWorker(nextTask);
    }
    
    log.debug('Task completed', {
      taskId,
      workerId: workerId.toString().slice(-8),
      success,
      processingTime: processingTime ? `${processingTime}ms` : 'unknown',
      queueLength: this.taskQueue.length
    });
  }

  /**
   * 워커 에러 처리
   */
  handleWorkerError(workerId, error) {
    log.error('Worker error', { workerId: workerId.toString().slice(-8), error: error.message });
    
    // 워커 제거 및 재생성
    this.removeWorker(workerId);
    
    // 최소 워커 수 유지
    if (this.stats.currentWorkers < this.options.minWorkers) {
      this.createWorker().catch(err => {
        log.error('Failed to recreate worker after error', { error: err.message });
      });
    }
  }

  /**
   * 워커 종료 처리
   */
  handleWorkerExit(workerId, code) {
    log.debug('Worker exited', { workerId: workerId.toString().slice(-8), code });
    this.removeWorker(workerId);
  }

  /**
   * 워커 제거
   */
  removeWorker(workerId) {
    const worker = this.workers.get(workerId);
    if (!worker) return;
    
    // 워커 정리
    this.workers.delete(workerId);
    this.busyWorkers.delete(workerId);
    
    const availableIndex = this.availableWorkers.indexOf(workerId);
    if (availableIndex !== -1) {
      this.availableWorkers.splice(availableIndex, 1);
    }
    
    this.stats.currentWorkers--;
    
    // 진행 중인 작업들 실패 처리
    for (const [taskId, pendingTask] of this.pendingTasks.entries()) {
      if (pendingTask.workerId === workerId) {
        this.pendingTasks.delete(taskId);
        this.stats.tasksFailed++;
        pendingTask.task.reject(new Error('Worker terminated unexpectedly'));
      }
    }
  }

  /**
   * 자동 스케일링 시작
   */
  startAutoScaling() {
    setInterval(() => {
      this.checkAndScale();
    }, this.scaleCheckInterval);
  }

  /**
   * 스케일링 검토
   */
  considerScaling() {
    if (!this.options.enableAutoScaling) return;
    
    const now = Date.now();
    if (now - this.lastScaleCheck < this.scaleCheckInterval) return;
    
    this.checkAndScale();
  }

  /**
   * 스케일링 검사 및 실행
   */
  async checkAndScale() {
    this.lastScaleCheck = Date.now();
    
    const queueLength = this.taskQueue.length;
    const busyWorkers = this.busyWorkers.size;
    const totalWorkers = this.stats.currentWorkers;
    const utilization = totalWorkers > 0 ? busyWorkers / totalWorkers : 0;
    
    this.stats.workerUtilization = Math.round(utilization * 100);
    
    // 스케일 업 조건
    if (queueLength > 0 && 
        utilization > 0.8 && 
        totalWorkers < this.options.maxWorkers) {
      
      const workersToAdd = Math.min(
        Math.ceil(queueLength / 2),
        this.options.maxWorkers - totalWorkers
      );
      
      for (let i = 0; i < workersToAdd; i++) {
        try {
          await this.createWorker();
          log.info('Scaled up worker pool', {
            newWorkerCount: this.stats.currentWorkers,
            queueLength,
            utilization: `${this.stats.workerUtilization}%`
          });
        } catch (error) {
          log.error('Failed to scale up', { error: error.message });
          break;
        }
      }
    }
    
    // 스케일 다운 조건 (idle 워커가 많고 큐가 비어있을 때)
    else if (queueLength === 0 && 
             utilization < 0.3 && 
             totalWorkers > this.options.minWorkers) {
      
      // 가장 오래 사용되지 않은 워커 제거
      const idleWorkers = this.availableWorkers
        .map(id => ({ id, worker: this.workers.get(id) }))
        .filter(({ worker }) => worker && worker.isIdle)
        .sort((a, b) => a.worker.lastUsed - b.worker.lastUsed);
      
      const workersToRemove = Math.min(
        Math.floor((totalWorkers - this.options.minWorkers) / 2),
        idleWorkers.length
      );
      
      for (let i = 0; i < workersToRemove; i++) {
        const { id, worker } = idleWorkers[i];
        
        // 30초 이상 유휴 상태인 워커만 제거
        if (Date.now() - worker.lastUsed > this.options.workerIdleTimeout) {
          try {
            await worker.terminate();
            this.removeWorker(id);
            
            log.info('Scaled down worker pool', {
              newWorkerCount: this.stats.currentWorkers,
              utilization: `${this.stats.workerUtilization}%`
            });
          } catch (error) {
            log.error('Failed to terminate idle worker', { error: error.message });
          }
        }
      }
    }
  }

  /**
   * JSON 파싱 작업 (병렬)
   */
  async parseJSONParallel(jsonStrings) {
    if (!Array.isArray(jsonStrings)) {
      jsonStrings = [jsonStrings];
    }
    
    const tasks = jsonStrings.map(jsonString => 
      this.executeTask('parseJSON', { jsonString })
    );
    
    const results = await Promise.allSettled(tasks);
    
    return results.map(result => 
      result.status === 'fulfilled' ? result.value : null
    );
  }

  /**
   * JSON 직렬화 작업 (병렬)
   */
  async stringifyJSONParallel(objects) {
    if (!Array.isArray(objects)) {
      objects = [objects];
    }
    
    const tasks = objects.map(obj => 
      this.executeTask('stringifyJSON', { object: obj })
    );
    
    const results = await Promise.allSettled(tasks);
    
    return results.map(result => 
      result.status === 'fulfilled' ? result.value : null
    );
  }

  /**
   * 대용량 텍스트 처리 (병렬)
   */
  async processTextParallel(texts, operations) {
    if (!Array.isArray(texts)) {
      texts = [texts];
    }
    
    const tasks = texts.map(text => 
      this.executeTask('processText', { text, operations })
    );
    
    const results = await Promise.allSettled(tasks);
    
    return results.map(result => 
      result.status === 'fulfilled' ? result.value : null
    );
  }

  /**
   * 정규식 검색 (병렬)
   */
  async regexSearchParallel(texts, patterns) {
    if (!Array.isArray(texts)) {
      texts = [texts];
    }
    
    if (!Array.isArray(patterns)) {
      patterns = [patterns];
    }
    
    const tasks = texts.map(text => 
      this.executeTask('regexSearch', { text, patterns })
    );
    
    const results = await Promise.allSettled(tasks);
    
    return results.map(result => 
      result.status === 'fulfilled' ? result.value : []
    );
  }

  /**
   * 성능 통계 조회
   */
  getPerformanceStats() {
    return {
      ...this.stats,
      queueLength: this.taskQueue.length,
      pendingTasks: this.pendingTasks.size,
      availableWorkers: this.availableWorkers.length,
      busyWorkers: this.busyWorkers.size,
      workerUtilization: this.stats.workerUtilization,
      avgTasksPerWorker: this.stats.currentWorkers > 0 ? 
        this.stats.tasksCompleted / this.stats.currentWorkers : 0
    };
  }

  /**
   * 워커 풀 종료
   */
  async destroy() {
    log.info('Destroying CPU Worker Pool...');
    
    // 모든 워커 종료
    const terminationPromises = Array.from(this.workers.values()).map(async (worker) => {
      try {
        await worker.terminate();
      } catch (error) {
        log.error('Error terminating worker', { error: error.message });
      }
    });
    
    await Promise.allSettled(terminationPromises);
    
    // 정리
    this.workers.clear();
    this.availableWorkers.length = 0;
    this.busyWorkers.clear();
    this.taskQueue.length = 0;
    this.pendingTasks.clear();
    
    log.info('CPU Worker Pool destroyed');
  }
}

export default CPUWorkerPool;

import { log } from './logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 지능형 시작 시간 최적화 관리자
 * - 사용 패턴 기반 우선순위 로딩
 * - 지연 로딩 및 백그라운드 초기화
 * - 시작 캐시 시스템
 * - 성능 모니터링 및 자동 튜닝
 */
export class StartupOptimizer {
  constructor(options = {}) {
    this.options = {
      usageDataFile: options.usageDataFile || path.join(__dirname, '../.usage-analytics.json'),
      startupCacheFile: options.startupCacheFile || path.join(__dirname, '../.startup-cache.json'),
      enableUsageTracking: options.enableUsageTracking !== false,
      enableStartupCache: options.enableStartupCache !== false,
      enableBackgroundInit: options.enableBackgroundInit !== false,
      coreModuleTimeout: options.coreModuleTimeout || 5000, // 5초
      backgroundInitDelay: options.backgroundInitDelay || 100, // 100ms
      usageAnalysisWindow: options.usageAnalysisWindow || 7, // 7일
      ...options
    };

    // 모듈 우선순위 정의
    this.modulePriorities = {
      // 즉시 필요한 핵심 모듈들
      CRITICAL: [
        'McpServer',
        'logger',
        'error-handler',
        'validation'
      ],
      // 자주 사용되는 기본 모듈들  
      HIGH: [
        'cache',
        'input-sanitizer',
        'rate-limiter'
      ],
      // 검색/파일 처리 등 주요 기능들
      MEDIUM: [
        'fuzzy-search', 
        'optimized-search-engine',
        'optimized-file-io',
        'version-manager'
      ],
      // 고급 기능들 (필요시 로딩)
      LOW: [
        'cpu-worker-pool',
        'template-engine',
        'template-library',
        'import-export'
      ]
    };

    // 로딩 상태 관리
    this.loadingStates = {
      CRITICAL: { loaded: false, loading: false, startTime: null, loadTime: null },
      HIGH: { loaded: false, loading: false, startTime: null, loadTime: null },
      MEDIUM: { loaded: false, loading: false, startTime: null, loadTime: null },
      LOW: { loaded: false, loading: false, startTime: null, loadTime: null }
    };

    // 모듈 인스턴스 저장소
    this.moduleInstances = new Map();
    this.moduleLoadPromises = new Map();

    // 사용 통계
    this.usageStats = {
      moduleUsage: new Map(),
      toolUsage: new Map(),
      dailyPatterns: new Map(),
      loadingHistory: []
    };

    // 시작 시간 추적
    this.startupMetrics = {
      totalStartTime: Date.now(),
      criticalLoadTime: null,
      highLoadTime: null,
      mediumLoadTime: null,
      lowLoadTime: null,
      firstRequestTime: null,
      readyTime: null
    };

    // 백그라운드 작업 큐
    this.backgroundQueue = [];
    this.backgroundWorking = false;

    log.info('Startup optimizer initialized', {
      enableUsageTracking: this.options.enableUsageTracking,
      enableStartupCache: this.options.enableStartupCache,
      enableBackgroundInit: this.options.enableBackgroundInit
    });
  }

  /**
   * 서버 시작 최적화 실행
   */
  async optimizeStartup() {
    log.info('Starting optimized server initialization...');
    
    try {
      // 1. 사용 패턴 데이터 로드
      await this.loadUsageData();
      
      // 2. 시작 캐시 확인
      await this.loadStartupCache();
      
      // 3. 우선순위 재계산 (사용 패턴 기반)
      this.recalculatePriorities();
      
      // 4. CRITICAL 모듈 즉시 로딩
      await this.loadCriticalModules();
      
      // 5. HIGH 우선순위 모듈 로딩  
      await this.loadHighPriorityModules();
      
      // 6. 기본 서버 준비 완료
      this.startupMetrics.readyTime = Date.now();
      const readyTime = this.startupMetrics.readyTime - this.startupMetrics.totalStartTime;
      
      log.info('Server ready for requests', { 
        readyTime: `${readyTime}ms`,
        loadedModules: this.getLoadedModulesCount()
      });
      
      // 7. 백그라운드에서 나머지 모듈 초기화
      if (this.options.enableBackgroundInit) {
        setTimeout(() => {
          this.startBackgroundInitialization();
        }, this.options.backgroundInitDelay);
      }
      
      return {
        readyTime,
        loadedModules: this.getLoadedModulesCount(),
        backgroundPending: this.backgroundQueue.length
      };
      
    } catch (error) {
      log.error('Startup optimization failed', { error: error.message });
      // 실패 시 표준 로딩으로 폴백
      return this.fallbackToStandardLoading();
    }
  }

  /**
   * CRITICAL 모듈 즉시 로딩
   */
  async loadCriticalModules() {
    this.loadingStates.CRITICAL.loading = true;
    this.loadingStates.CRITICAL.startTime = Date.now();
    
    log.debug('Loading critical modules...', { 
      modules: this.modulePriorities.CRITICAL 
    });
    
    // 병렬 로딩으로 시간 단축
    const loadPromises = this.modulePriorities.CRITICAL.map(async (moduleName) => {
      try {
        const instance = await this.loadModuleWithTimeout(moduleName, this.options.coreModuleTimeout);
        this.moduleInstances.set(moduleName, instance);
        return { moduleName, success: true, instance };
      } catch (error) {
        log.error(`Failed to load critical module: ${moduleName}`, { error: error.message });
        return { moduleName, success: false, error: error.message };
      }
    });
    
    const results = await Promise.allSettled(loadPromises);
    
    this.loadingStates.CRITICAL.loadTime = Date.now() - this.loadingStates.CRITICAL.startTime;
    this.loadingStates.CRITICAL.loaded = true;
    this.loadingStates.CRITICAL.loading = false;
    
    this.startupMetrics.criticalLoadTime = this.loadingStates.CRITICAL.loadTime;
    
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    
    log.info('Critical modules loaded', {
      loadTime: `${this.loadingStates.CRITICAL.loadTime}ms`,
      successCount,
      totalCount: this.modulePriorities.CRITICAL.length
    });
    
    return results;
  }

  /**
   * HIGH 우선순위 모듈 로딩
   */
  async loadHighPriorityModules() {
    this.loadingStates.HIGH.loading = true;
    this.loadingStates.HIGH.startTime = Date.now();
    
    log.debug('Loading high priority modules...', { 
      modules: this.modulePriorities.HIGH 
    });
    
    const loadPromises = this.modulePriorities.HIGH.map(async (moduleName) => {
      try {
        const instance = await this.loadModuleWithCache(moduleName);
        this.moduleInstances.set(moduleName, instance);
        return { moduleName, success: true, instance };
      } catch (error) {
        log.warn(`Failed to load high priority module: ${moduleName}`, { error: error.message });
        // HIGH 우선순위는 실패해도 계속 진행
        return { moduleName, success: false, error: error.message };
      }
    });
    
    const results = await Promise.allSettled(loadPromises);
    
    this.loadingStates.HIGH.loadTime = Date.now() - this.loadingStates.HIGH.startTime;
    this.loadingStates.HIGH.loaded = true;
    this.loadingStates.HIGH.loading = false;
    
    this.startupMetrics.highLoadTime = this.loadingStates.HIGH.loadTime;
    
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    
    log.info('High priority modules loaded', {
      loadTime: `${this.loadingStates.HIGH.loadTime}ms`,
      successCount,
      totalCount: this.modulePriorities.HIGH.length
    });
    
    return results;
  }

  /**
   * 백그라운드 초기화 시작
   */
  async startBackgroundInitialization() {
    if (this.backgroundWorking) return;
    
    this.backgroundWorking = true;
    log.debug('Starting background initialization...');
    
    try {
      // MEDIUM 우선순위 모듈들 백그라운드 로딩
      this.backgroundQueue.push(...this.modulePriorities.MEDIUM.map(name => ({ 
        type: 'module', 
        name, 
        priority: 'MEDIUM' 
      })));
      
      // LOW 우선순위 모듈들 백그라운드 로딩  
      this.backgroundQueue.push(...this.modulePriorities.LOW.map(name => ({ 
        type: 'module', 
        name, 
        priority: 'LOW' 
      })));
      
      // 백그라운드 작업 처리
      await this.processBackgroundQueue();
      
    } catch (error) {
      log.error('Background initialization failed', { error: error.message });
    } finally {
      this.backgroundWorking = false;
    }
  }

  /**
   * 백그라운드 큐 처리
   */
  async processBackgroundQueue() {
    while (this.backgroundQueue.length > 0) {
      const task = this.backgroundQueue.shift();
      
      try {
        if (task.type === 'module') {
          await this.loadModuleInBackground(task.name, task.priority);
        }
        
        // CPU 부하 방지를 위한 양보
        await new Promise(resolve => setImmediate(resolve));
        
      } catch (error) {
        log.warn(`Background task failed: ${task.name}`, { error: error.message });
      }
    }
    
    log.info('Background initialization completed', {
      totalTime: Date.now() - this.startupMetrics.readyTime
    });
  }

  /**
   * 백그라운드 모듈 로딩
   */
  async loadModuleInBackground(moduleName, priority) {
    const priorityKey = priority.toUpperCase();
    
    if (!this.loadingStates[priorityKey].loading) {
      this.loadingStates[priorityKey].loading = true;
      this.loadingStates[priorityKey].startTime = Date.now();
    }
    
    try {
      const instance = await this.loadModuleWithCache(moduleName);
      this.moduleInstances.set(moduleName, instance);
      
      log.debug(`Background module loaded: ${moduleName}`, { priority });
      
      return instance;
    } catch (error) {
      log.warn(`Background module loading failed: ${moduleName}`, { 
        error: error.message, 
        priority 
      });
      throw error;
    } finally {
      // 해당 우선순위 그룹의 모든 모듈이 로딩 완료되었는지 확인
      const priorityModules = this.modulePriorities[priorityKey] || [];
      const loadedCount = priorityModules.filter(name => this.moduleInstances.has(name)).length;
      
      if (loadedCount === priorityModules.length) {
        this.loadingStates[priorityKey].loadTime = Date.now() - this.loadingStates[priorityKey].startTime;
        this.loadingStates[priorityKey].loaded = true;
        this.loadingStates[priorityKey].loading = false;
        
        this.startupMetrics[`${priority.toLowerCase()}LoadTime`] = this.loadingStates[priorityKey].loadTime;
        
        log.info(`${priority} priority modules completed`, {
          loadTime: `${this.loadingStates[priorityKey].loadTime}ms`,
          moduleCount: priorityModules.length
        });
      }
    }
  }

  /**
   * 타임아웃을 가진 모듈 로딩
   */
  async loadModuleWithTimeout(moduleName, timeout) {
    return Promise.race([
      this.loadModule(moduleName),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Module ${moduleName} loading timeout`)), timeout)
      )
    ]);
  }

  /**
   * 캐시를 활용한 모듈 로딩
   */
  async loadModuleWithCache(moduleName) {
    // 이미 로딩된 모듈 확인
    if (this.moduleInstances.has(moduleName)) {
      return this.moduleInstances.get(moduleName);
    }
    
    // 진행 중인 로딩 확인
    if (this.moduleLoadPromises.has(moduleName)) {
      return await this.moduleLoadPromises.get(moduleName);
    }
    
    // 새 로딩 시작
    const loadPromise = this.loadModule(moduleName);
    this.moduleLoadPromises.set(moduleName, loadPromise);
    
    try {
      const instance = await loadPromise;
      this.moduleLoadPromises.delete(moduleName);
      return instance;
    } catch (error) {
      this.moduleLoadPromises.delete(moduleName);
      throw error;
    }
  }

  /**
   * 실제 모듈 로딩 (팩토리 함수)
   */
  async loadModule(moduleName) {
    const startTime = Date.now();
    
    try {
      let instance;
      
      // 모듈별 로딩 로직
      switch (moduleName) {
        case 'cache':
          const { createFileCache, createMetadataCache, createSearchCache, createTemplateCache } = 
            await import('./cache.js');
          instance = {
            files: createFileCache(),
            metadata: createMetadataCache(),
            search: createSearchCache(),
            templates: createTemplateCache()
          };
          break;
          
        case 'rate-limiter':
          const { RateLimiter, rateLimitPresets } = await import('./rate-limiter.js');
          instance = {
            standard: new RateLimiter(rateLimitPresets.standard),
            strict: new RateLimiter(rateLimitPresets.strict),
            upload: new RateLimiter(rateLimitPresets.upload)
          };
          break;
          
        case 'optimized-search-engine':
          const { OptimizedSearchEngine } = await import('./optimized-search-engine.js');
          instance = new OptimizedSearchEngine({
            threshold: parseFloat(process.env.SEARCH_THRESHOLD) || 0.3,
            parallelWorkers: parseInt(process.env.SEARCH_PARALLEL_WORKERS) || 4,
            enableIndexing: process.env.SEARCH_ENABLE_INDEXING !== 'false',
            enableMemoryPool: process.env.SEARCH_ENABLE_MEMORY_POOL !== 'false',
            maxResults: 50
          });
          break;
          
        case 'optimized-file-io':
          const { OptimizedFileIO } = await import('./optimized-file-io.js');
          instance = new OptimizedFileIO({
            maxConcurrentFiles: parseInt(process.env.FILE_IO_CONCURRENT) || 10,
            streamThreshold: parseInt(process.env.FILE_IO_STREAM_THRESHOLD) || 1024 * 1024,
            compressionThreshold: parseInt(process.env.FILE_IO_COMPRESSION_THRESHOLD) || 10 * 1024,
            enableCompression: process.env.FILE_IO_ENABLE_COMPRESSION !== 'false',
            enableStreaming: process.env.FILE_IO_ENABLE_STREAMING !== 'false',
            enableCaching: process.env.FILE_IO_ENABLE_CACHING !== 'false',
            watchFiles: process.env.FILE_IO_WATCH_FILES !== 'false'
          });
          break;
          
        case 'cpu-worker-pool':
          const { CPUWorkerPool } = await import('./cpu-worker-pool.js');
          instance = new CPUWorkerPool({
            maxWorkers: parseInt(process.env.CPU_MAX_WORKERS) || require('os').cpus().length,
            minWorkers: parseInt(process.env.CPU_MIN_WORKERS) || Math.max(2, Math.floor(require('os').cpus().length / 2)),
            enableAutoScaling: process.env.CPU_AUTO_SCALING !== 'false',
            workerIdleTimeout: parseInt(process.env.CPU_WORKER_IDLE_TIMEOUT) || 30000,
            taskTimeout: parseInt(process.env.CPU_TASK_TIMEOUT) || 60000
          });
          break;
          
        case 'version-manager':
          const { VersionManager } = await import('./version-manager.js');
          const PROMPTS_DIR = process.env.PROMPTS_DIR || path.join(__dirname, "../prompts");
          instance = new VersionManager(PROMPTS_DIR);
          break;
          
        case 'template-engine':
          const { templateEngine } = await import('./template-engine.js');
          instance = templateEngine;
          break;
          
        case 'template-library':
          const { templateLibrary } = await import('./template-library.js');
          instance = templateLibrary;
          break;
          
        case 'import-export':
          const { createImportExportManager } = await import('./import-export.js');
          const promptsDir = process.env.PROMPTS_DIR || path.join(__dirname, "../prompts");
          instance = createImportExportManager(promptsDir);
          break;
          
        case 'input-sanitizer':
          const { inputSanitizer } = await import('./input-sanitizer.js');
          instance = inputSanitizer;
          break;
          
        case 'fuzzy-search':
          const fuzzyModule = await import('./fuzzy-search.js');
          instance = {
            fuzzySearch: fuzzyModule.fuzzySearch,
            FuzzySearch: fuzzyModule.FuzzySearch
          };
          break;
          
        default:
          throw new Error(`Unknown module: ${moduleName}`);
      }
      
      const loadTime = Date.now() - startTime;
      
      log.debug(`Module loaded: ${moduleName}`, { loadTime: `${loadTime}ms` });
      
      // 사용 통계 업데이트
      if (this.options.enableUsageTracking) {
        this.recordModuleLoad(moduleName, loadTime);
      }
      
      return instance;
      
    } catch (error) {
      const loadTime = Date.now() - startTime;
      log.error(`Module loading failed: ${moduleName}`, { 
        error: error.message, 
        loadTime: `${loadTime}ms` 
      });
      throw error;
    }
  }

  /**
   * 모듈 인스턴스 조회 (지연 로딩 지원)
   */
  async getModule(moduleName) {
    // 이미 로딩된 경우
    if (this.moduleInstances.has(moduleName)) {
      this.recordModuleUsage(moduleName);
      return this.moduleInstances.get(moduleName);
    }
    
    // 진행 중인 로딩이 있는 경우 대기
    if (this.moduleLoadPromises.has(moduleName)) {
      const instance = await this.moduleLoadPromises.get(moduleName);
      this.recordModuleUsage(moduleName);
      return instance;
    }
    
    // 지연 로딩 시작
    log.debug(`Lazy loading module: ${moduleName}`);
    const instance = await this.loadModuleWithCache(moduleName);
    this.moduleInstances.set(moduleName, instance);
    this.recordModuleUsage(moduleName);
    
    return instance;
  }

  /**
   * 사용 패턴 기반 우선순위 재계산
   */
  recalculatePriorities() {
    if (!this.options.enableUsageTracking || !this.usageStats.moduleUsage.size) {
      return; // 사용 데이터가 없으면 기본 우선순위 유지
    }
    
    // 최근 사용 빈도 기반으로 우선순위 조정
    const usageScores = new Map();
    
    for (const [moduleName, usage] of this.usageStats.moduleUsage.entries()) {
      const recentUsage = usage.recentUsage || 0;
      const totalUsage = usage.totalUsage || 0;
      const lastUsed = usage.lastUsed || 0;
      
      // 점수 계산: 최근 사용(50%) + 총 사용(30%) + 최근성(20%)
      const recencyScore = Math.max(0, 1 - (Date.now() - lastUsed) / (7 * 24 * 60 * 60 * 1000)); // 7일 기준
      const score = (recentUsage * 0.5) + (Math.min(totalUsage / 100, 1) * 0.3) + (recencyScore * 0.2);
      
      usageScores.set(moduleName, score);
    }
    
    // 높은 점수의 모듈들을 상위 우선순위로 이동
    const sortedModules = Array.from(usageScores.entries())
      .sort(([,a], [,b]) => b - a)
      .map(([moduleName]) => moduleName);
    
    // 상위 25%는 HIGH, 나머지는 기본 우선순위 유지
    const topQuarter = Math.ceil(sortedModules.length * 0.25);
    const frequentModules = sortedModules.slice(0, topQuarter);
    
    // 기존 우선순위에서 자주 사용되는 모듈을 HIGH로 승격
    for (const moduleName of frequentModules) {
      for (const [priority, modules] of Object.entries(this.modulePriorities)) {
        const index = modules.indexOf(moduleName);
        if (index !== -1 && priority !== 'CRITICAL' && priority !== 'HIGH') {
          // 기존 위치에서 제거
          modules.splice(index, 1);
          // HIGH 우선순위에 추가 (중복 방지)
          if (!this.modulePriorities.HIGH.includes(moduleName)) {
            this.modulePriorities.HIGH.unshift(moduleName);
          }
          break;
        }
      }
    }
    
    log.info('Module priorities recalculated', {
      frequentModules: frequentModules.slice(0, 5), // 상위 5개만 로깅
      totalAnalyzed: sortedModules.length
    });
  }

  /**
   * 사용 데이터 로드
   */
  async loadUsageData() {
    if (!this.options.enableUsageTracking) return;
    
    try {
      const data = await fs.readFile(this.options.usageDataFile, 'utf-8');
      const parsed = JSON.parse(data);
      
      this.usageStats.moduleUsage = new Map(parsed.moduleUsage || []);
      this.usageStats.toolUsage = new Map(parsed.toolUsage || []);
      this.usageStats.dailyPatterns = new Map(parsed.dailyPatterns || []);
      
      log.debug('Usage data loaded', {
        moduleCount: this.usageStats.moduleUsage.size,
        toolCount: this.usageStats.toolUsage.size
      });
      
    } catch (error) {
      log.debug('No existing usage data found, starting fresh');
    }
  }

  /**
   * 시작 캐시 로드  
   */
  async loadStartupCache() {
    if (!this.options.enableStartupCache) return;
    
    try {
      const data = await fs.readFile(this.options.startupCacheFile, 'utf-8');
      const cache = JSON.parse(data);
      
      // 캐시된 모듈 우선순위 적용 (유효한 경우)
      if (cache.modulePriorities && cache.timestamp > Date.now() - 24 * 60 * 60 * 1000) {
        this.modulePriorities = { ...this.modulePriorities, ...cache.modulePriorities };
        log.debug('Startup cache applied', { age: Date.now() - cache.timestamp });
      }
      
    } catch (error) {
      log.debug('No startup cache found');
    }
  }

  /**
   * 모듈 사용 기록
   */
  recordModuleUsage(moduleName) {
    if (!this.options.enableUsageTracking) return;
    
    const usage = this.usageStats.moduleUsage.get(moduleName) || {
      totalUsage: 0,
      recentUsage: 0,
      lastUsed: 0,
      dailyUsage: []
    };
    
    const now = Date.now();
    const today = new Date(now).toDateString();
    
    usage.totalUsage++;
    usage.recentUsage++;
    usage.lastUsed = now;
    
    // 일일 사용량 업데이트
    const todayIndex = usage.dailyUsage.findIndex(d => d.date === today);
    if (todayIndex >= 0) {
      usage.dailyUsage[todayIndex].count++;
    } else {
      usage.dailyUsage.push({ date: today, count: 1 });
      // 오래된 데이터 정리 (7일 이상)
      usage.dailyUsage = usage.dailyUsage.slice(-7);
    }
    
    this.usageStats.moduleUsage.set(moduleName, usage);
  }

  /**
   * 모듈 로딩 기록
   */
  recordModuleLoad(moduleName, loadTime) {
    this.usageStats.loadingHistory.push({
      moduleName,
      loadTime,
      timestamp: Date.now()
    });
    
    // 히스토리 크기 제한 (최근 1000개)
    if (this.usageStats.loadingHistory.length > 1000) {
      this.usageStats.loadingHistory = this.usageStats.loadingHistory.slice(-1000);
    }
  }

  /**
   * 로딩된 모듈 수 조회
   */
  getLoadedModulesCount() {
    return {
      critical: this.modulePriorities.CRITICAL.filter(name => this.moduleInstances.has(name)).length,
      high: this.modulePriorities.HIGH.filter(name => this.moduleInstances.has(name)).length,
      medium: this.modulePriorities.MEDIUM.filter(name => this.moduleInstances.has(name)).length,
      low: this.modulePriorities.LOW.filter(name => this.moduleInstances.has(name)).length,
      total: this.moduleInstances.size
    };
  }

  /**
   * 시작 시간 통계 조회
   */
  getStartupStats() {
    const totalTime = this.startupMetrics.readyTime - this.startupMetrics.totalStartTime;
    
    return {
      totalStartupTime: totalTime,
      readyTime: this.startupMetrics.readyTime - this.startupMetrics.totalStartTime,
      criticalLoadTime: this.startupMetrics.criticalLoadTime,
      highLoadTime: this.startupMetrics.highLoadTime,
      mediumLoadTime: this.startupMetrics.mediumLoadTime,
      lowLoadTime: this.startupMetrics.lowLoadTime,
      loadingStates: this.loadingStates,
      loadedModules: this.getLoadedModulesCount(),
      backgroundPending: this.backgroundQueue.length
    };
  }

  /**
   * 표준 로딩으로 폴백
   */
  async fallbackToStandardLoading() {
    log.warn('Falling back to standard loading...');
    
    const startTime = Date.now();
    
    // 모든 모듈을 순차적으로 로딩
    const allModules = [
      ...this.modulePriorities.CRITICAL,
      ...this.modulePriorities.HIGH,
      ...this.modulePriorities.MEDIUM,
      ...this.modulePriorities.LOW
    ];
    
    for (const moduleName of allModules) {
      try {
        if (!this.moduleInstances.has(moduleName)) {
          const instance = await this.loadModule(moduleName);
          this.moduleInstances.set(moduleName, instance);
        }
      } catch (error) {
        log.error(`Fallback loading failed for ${moduleName}`, { error: error.message });
      }
    }
    
    const totalTime = Date.now() - startTime;
    
    log.info('Standard loading completed', {
      totalTime: `${totalTime}ms`,
      loadedModules: this.moduleInstances.size
    });
    
    return {
      readyTime: totalTime,
      loadedModules: this.getLoadedModulesCount(),
      fallback: true
    };
  }

  /**
   * 사용 데이터 저장
   */
  async saveUsageData() {
    if (!this.options.enableUsageTracking) return;
    
    try {
      const data = {
        moduleUsage: Array.from(this.usageStats.moduleUsage.entries()),
        toolUsage: Array.from(this.usageStats.toolUsage.entries()),
        dailyPatterns: Array.from(this.usageStats.dailyPatterns.entries()),
        timestamp: Date.now()
      };
      
      await fs.writeFile(this.options.usageDataFile, JSON.stringify(data, null, 2));
      log.debug('Usage data saved');
      
    } catch (error) {
      log.error('Failed to save usage data', { error: error.message });
    }
  }

  /**
   * 시작 캐시 저장
   */
  async saveStartupCache() {
    if (!this.options.enableStartupCache) return;
    
    try {
      const cache = {
        modulePriorities: this.modulePriorities,
        startupStats: this.getStartupStats(),
        timestamp: Date.now()
      };
      
      await fs.writeFile(this.options.startupCacheFile, JSON.stringify(cache, null, 2));
      log.debug('Startup cache saved');
      
    } catch (error) {
      log.error('Failed to save startup cache', { error: error.message });
    }
  }

  /**
   * 정리 작업
   */
  async cleanup() {
    log.info('Cleaning up startup optimizer...');
    
    // 사용 데이터 저장
    await this.saveUsageData();
    await this.saveStartupCache();
    
    // 백그라운드 작업 중단
    this.backgroundQueue.length = 0;
    this.backgroundWorking = false;
    
    // 모듈 인스턴스 정리
    for (const [name, instance] of this.moduleInstances.entries()) {
      if (instance && typeof instance.destroy === 'function') {
        try {
          await instance.destroy();
        } catch (error) {
          log.error(`Failed to cleanup module ${name}`, { error: error.message });
        }
      }
    }
    
    log.info('Startup optimizer cleanup completed');
  }
}

export default StartupOptimizer;

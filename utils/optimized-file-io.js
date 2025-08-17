import { log } from './logger.js';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Worker } from 'worker_threads';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';
import { createGzip, createGunzip } from 'zlib';
import { promisify } from 'util';

/**
 * 고성능 파일 I/O 최적화 시스템
 * - 병렬 파일 읽기/쓰기
 * - 스트리밍 I/O 대용량 파일 처리
 * - 압축/해제 자동화
 * - 파일 변경 감지 및 캐시 무효화
 * - 메모리 효율적 배치 처리
 */
export class OptimizedFileIO {
  constructor(options = {}) {
    this.options = {
      maxConcurrentFiles: options.maxConcurrentFiles || 10,
      streamThreshold: options.streamThreshold || 1024 * 1024, // 1MB
      compressionThreshold: options.compressionThreshold || 10 * 1024, // 10KB
      enableCompression: options.enableCompression !== false,
      enableStreaming: options.enableStreaming !== false,
      enableCaching: options.enableCaching !== false,
      cacheDir: options.cacheDir || '.file-cache',
      watchFiles: options.watchFiles !== false,
      workerPoolSize: options.workerPoolSize || 4,
      ...options
    };
    
    // 파일 캐시
    this.fileCache = new Map();
    this.checksumCache = new Map();
    this.lastModifiedCache = new Map();
    
    // 성능 통계
    this.stats = {
      reads: 0,
      writes: 0,
      parallelReads: 0,
      parallelWrites: 0,
      streamingReads: 0,
      streamingWrites: 0,
      compressions: 0,
      decompressions: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalReadTime: 0,
      totalWriteTime: 0,
      avgReadTime: 0,
      avgWriteTime: 0,
      totalBytes: 0,
      compressedBytes: 0
    };
    
    // 파일 와처
    this.watchers = new Map();
    
    // 작업 큐
    this.readQueue = [];
    this.writeQueue = [];
    this.processingReads = 0;
    this.processingWrites = 0;
    
    // 워커 풀 (CPU 집약적 작업용)
    this.workerPool = [];
    this.initWorkerPool();
    
    log.info('Optimized File I/O system initialized', {
      maxConcurrentFiles: this.options.maxConcurrentFiles,
      streamThreshold: this.options.streamThreshold,
      compressionThreshold: this.options.compressionThreshold,
      enableCompression: this.options.enableCompression,
      enableStreaming: this.options.enableStreaming
    });
  }

  /**
   * 워커 풀 초기화
   */
  initWorkerPool() {
    // 실제 구현에서는 별도 워커 파일이 필요하지만, 여기서는 기본 구조만 제공
    for (let i = 0; i < this.options.workerPoolSize; i++) {
      // this.workerPool.push(new Worker('./file-worker.js'));
    }
  }

  /**
   * 병렬 파일 읽기 (배치 처리)
   */
  async readFilesBatch(filePaths, options = {}) {
    const startTime = Date.now();
    this.stats.parallelReads++;
    
    // 파일 경로를 청크로 나누기
    const chunks = this.chunkArray(filePaths, this.options.maxConcurrentFiles);
    const results = [];
    
    for (const chunk of chunks) {
      const chunkPromises = chunk.map(async (filePath) => {
        return this.readFileOptimized(filePath, options);
      });
      
      const chunkResults = await Promise.allSettled(chunkPromises);
      results.push(...chunkResults);
    }
    
    const readTime = Date.now() - startTime;
    this.stats.totalReadTime += readTime;
    this.stats.avgReadTime = this.stats.totalReadTime / this.stats.parallelReads;
    
    log.debug('Batch file read completed', {
      fileCount: filePaths.length,
      readTime: `${readTime}ms`,
      avgTimePerFile: `${(readTime / filePaths.length).toFixed(2)}ms`,
      successful: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length
    });
    
    return results;
  }

  /**
   * 최적화된 개별 파일 읽기
   */
  async readFileOptimized(filePath, options = {}) {
    const startTime = Date.now();
    this.stats.reads++;
    
    try {
      // 캐시 확인
      if (this.options.enableCaching) {
        const cached = await this.getCachedFile(filePath);
        if (cached) {
          this.stats.cacheHits++;
          log.debug('Cache hit', { filePath });
          return {
            content: cached.content,
            size: cached.size,
            modified: cached.modified,
            compressed: false,
            readTime: 0,
            fromCache: true
          };
        }
      }
      
      this.stats.cacheMisses++;
      log.debug('Cache miss', { filePath });
      
      // 파일 정보 확인
      const stats = await fs.stat(filePath);
      const fileSize = stats.size;
      this.stats.totalBytes += fileSize;
      
      let content;
      
      // 크기에 따른 읽기 방식 선택
      if (this.options.enableStreaming && fileSize > this.options.streamThreshold) {
        content = await this.readFileStreaming(filePath, options);
        this.stats.streamingReads++;
      } else {
        content = await this.readFileStandard(filePath, options);
      }
      
      // 캐시에 저장
      if (this.options.enableCaching && typeof content === 'string') {
        await this.cacheFile(filePath, content, stats.mtime);
      }
      
      const readTime = Date.now() - startTime;
      this.stats.totalReadTime += readTime;
      
      log.debug('File read completed', {
        filePath,
        fileSize,
        readTime: `${readTime}ms`,
        method: fileSize > this.options.streamThreshold ? 'streaming' : 'standard'
      });
      
      const result = {
        content,
        size: fileSize,
        modified: stats.mtime,
        compressed: false,
        readTime
      };
      
      return result;
      
    } catch (error) {
      log.error('File read failed', { filePath, error: error.message });
      throw error;
    }
  }

  /**
   * 스트리밍 파일 읽기 (대용량 파일용)
   */
  async readFileStreaming(filePath, options = {}) {
    const chunks = [];
    
    return new Promise((resolve, reject) => {
      let stream = createReadStream(filePath, { encoding: options.encoding || 'utf8' });
      
      // 압축 파일 감지 및 해제
      if (this.isCompressedFile(filePath)) {
        stream = stream.pipe(createGunzip());
        this.stats.decompressions++;
      }
      
      stream.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      stream.on('end', () => {
        const content = chunks.join('');
        resolve(content);
      });
      
      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * 표준 파일 읽기
   */
  async readFileStandard(filePath, options = {}) {
    const encoding = options.encoding || 'utf8';
    
    if (this.isCompressedFile(filePath)) {
      // 압축된 파일 읽기
      const compressed = await fs.readFile(filePath);
      const content = await this.decompressData(compressed);
      this.stats.decompressions++;
      return content;
    } else {
      return await fs.readFile(filePath, encoding);
    }
  }

  /**
   * 병렬 파일 쓰기 (배치 처리)
   */
  async writeFilesBatch(fileOperations, options = {}) {
    const startTime = Date.now();
    this.stats.parallelWrites++;
    
    // 파일 작업을 청크로 나누기
    const chunks = this.chunkArray(fileOperations, this.options.maxConcurrentFiles);
    const results = [];
    
    for (const chunk of chunks) {
      const chunkPromises = chunk.map(async (operation) => {
        return this.writeFileOptimized(operation.filePath, operation.content, {
          ...options,
          ...operation.options
        });
      });
      
      const chunkResults = await Promise.allSettled(chunkPromises);
      results.push(...chunkResults);
    }
    
    const writeTime = Date.now() - startTime;
    this.stats.totalWriteTime += writeTime;
    this.stats.avgWriteTime = this.stats.totalWriteTime / this.stats.parallelWrites;
    
    log.debug('Batch file write completed', {
      operationCount: fileOperations.length,
      writeTime: `${writeTime}ms`,
      avgTimePerFile: `${(writeTime / fileOperations.length).toFixed(2)}ms`,
      successful: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length
    });
    
    return results;
  }

  /**
   * 최적화된 개별 파일 쓰기
   */
  async writeFileOptimized(filePath, content, options = {}) {
    const startTime = Date.now();
    this.stats.writes++;
    
    try {
      // 디렉토리 확인 및 생성
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      
      const contentSize = Buffer.byteLength(content, 'utf8');
      this.stats.totalBytes += contentSize;
      
      let finalContent = content;
      let actualFilePath = filePath;
      let compressed = false;
      
      // 압축 여부 결정
      if (this.options.enableCompression && 
          contentSize > this.options.compressionThreshold &&
          !options.disableCompression) {
        
        if (this.options.enableStreaming && contentSize > this.options.streamThreshold) {
          // 스트리밍 + 압축
          await this.writeFileStreamingCompressed(filePath, content);
          compressed = true;
          actualFilePath = filePath + '.gz';
          this.stats.streamingWrites++;
          this.stats.compressions++;
        } else {
          // 표준 압축
          finalContent = await this.compressData(content);
          actualFilePath = filePath + '.gz';
          compressed = true;
          this.stats.compressions++;
        }
      } else if (this.options.enableStreaming && contentSize > this.options.streamThreshold) {
        // 압축 없는 스트리밍
        await this.writeFileStreaming(filePath, content);
        this.stats.streamingWrites++;
      }
      
      // 표준 파일 쓰기
      if (!compressed || (compressed && contentSize <= this.options.streamThreshold)) {
        await fs.writeFile(actualFilePath, finalContent, options.encoding || 'utf8');
      }
      
      // 체크섬 계산 및 캐시
      const checksum = this.calculateChecksum(content);
      this.checksumCache.set(filePath, checksum);
      this.lastModifiedCache.set(filePath, Date.now());
      
      // 파일 와처 설정
      if (this.options.watchFiles) {
        this.watchFile(filePath);
      }
      
      // 압축 통계 업데이트
      if (compressed) {
        const compressedSize = finalContent.length || (await fs.stat(actualFilePath)).size;
        this.stats.compressedBytes += compressedSize;
      }
      
      const writeTime = Date.now() - startTime;
      this.stats.totalWriteTime += writeTime;
      
      log.debug('File write completed', {
        filePath: actualFilePath,
        originalSize: contentSize,
        finalSize: compressed ? 'compressed' : contentSize,
        writeTime: `${writeTime}ms`,
        compressed,
        method: contentSize > this.options.streamThreshold ? 'streaming' : 'standard'
      });
      
      return {
        filePath: actualFilePath,
        size: contentSize,
        compressed,
        checksum,
        writeTime
      };
      
    } catch (error) {
      log.error('File write failed', { filePath, error: error.message });
      throw error;
    }
  }

  /**
   * 스트리밍 파일 쓰기
   */
  async writeFileStreaming(filePath, content) {
    return new Promise((resolve, reject) => {
      const writeStream = createWriteStream(filePath);
      
      writeStream.write(content);
      writeStream.end();
      
      writeStream.on('finish', () => {
        resolve();
      });
      
      writeStream.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * 스트리밍 + 압축 파일 쓰기
   */
  async writeFileStreamingCompressed(filePath, content) {
    const compressedPath = filePath + '.gz';
    
    return new Promise((resolve, reject) => {
      const readStream = require('stream').Readable.from([content]);
      const gzipStream = createGzip();
      const writeStream = createWriteStream(compressedPath);
      
      pipeline(readStream, gzipStream, writeStream)
        .then(resolve)
        .catch(reject);
    });
  }

  /**
   * 데이터 압축
   */
  async compressData(data) {
    return new Promise((resolve, reject) => {
      const gzip = createGzip();
      const chunks = [];
      
      gzip.on('data', chunk => chunks.push(chunk));
      gzip.on('end', () => resolve(Buffer.concat(chunks)));
      gzip.on('error', reject);
      
      gzip.write(data);
      gzip.end();
    });
  }

  /**
   * 데이터 해제
   */
  async decompressData(compressedData) {
    return new Promise((resolve, reject) => {
      const gunzip = createGunzip();
      const chunks = [];
      
      gunzip.on('data', chunk => chunks.push(chunk));
      gunzip.on('end', () => resolve(Buffer.concat(chunks).toString()));
      gunzip.on('error', reject);
      
      gunzip.write(compressedData);
      gunzip.end();
    });
  }

  /**
   * 파일 캐시 관리
   */
  async getCachedFile(filePath) {
    if (!this.fileCache.has(filePath)) {
      return null;
    }
    
    try {
      const stats = await fs.stat(filePath);
      const cachedMtime = this.lastModifiedCache.get(filePath);
      
      if (cachedMtime && stats.mtime.getTime() === cachedMtime) {
        return this.fileCache.get(filePath);
      } else {
        // 캐시 무효화
        this.invalidateCache(filePath);
        return null;
      }
    } catch (error) {
      this.invalidateCache(filePath);
      return null;
    }
  }

  async cacheFile(filePath, content, mtime) {
    const cacheEntry = {
      content,
      size: Buffer.byteLength(content, 'utf8'),
      modified: mtime,
      cached: Date.now()
    };
    
    this.fileCache.set(filePath, cacheEntry);
    this.lastModifiedCache.set(filePath, mtime.getTime());
    
    log.debug('File cached', {
      filePath,
      size: cacheEntry.size,
      cacheSize: this.fileCache.size
    });
  }

  invalidateCache(filePath) {
    this.fileCache.delete(filePath);
    this.lastModifiedCache.delete(filePath);
    this.checksumCache.delete(filePath);
  }

  /**
   * 파일 변경 감지
   */
  watchFile(filePath) {
    if (this.watchers.has(filePath)) {
      return; // 이미 감시 중
    }
    
    try {
      const watcher = fsSync.watch(filePath, (eventType) => {
        if (eventType === 'change') {
          log.debug('File changed, invalidating cache', { filePath });
          this.invalidateCache(filePath);
        }
      });
      
      this.watchers.set(filePath, watcher);
    } catch (error) {
      log.warn('Failed to watch file', { filePath, error: error.message });
    }
  }

  /**
   * 디렉토리 변경 감지
   */
  watchDirectory(dirPath, callback) {
    try {
      const watcher = fsSync.watch(dirPath, { recursive: true }, (eventType, filename) => {
        if (filename) {
          const fullPath = path.join(dirPath, filename);
          
          if (eventType === 'change' || eventType === 'rename') {
            this.invalidateCache(fullPath);
            
            if (callback) {
              callback(eventType, fullPath);
            }
          }
        }
      });
      
      this.watchers.set(dirPath, watcher);
      
      log.info('Directory watch started', { dirPath });
      
      return watcher;
    } catch (error) {
      log.error('Failed to watch directory', { dirPath, error: error.message });
      throw error;
    }
  }

  /**
   * 유틸리티 메서드들
   */
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  isCompressedFile(filePath) {
    return filePath.endsWith('.gz') || filePath.endsWith('.bz2') || filePath.endsWith('.zip');
  }

  calculateChecksum(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * 성능 통계 조회
   */
  getPerformanceStats() {
    const compressionRatio = this.stats.totalBytes > 0 ? 
      (this.stats.compressedBytes / this.stats.totalBytes) : 0;
    
    const cacheHitRate = this.stats.reads > 0 ? 
      (this.stats.cacheHits / this.stats.reads * 100) : 0;
    
    return {
      reads: this.stats.reads,
      writes: this.stats.writes,
      parallelReads: this.stats.parallelReads,
      parallelWrites: this.stats.parallelWrites,
      streamingReads: this.stats.streamingReads,
      streamingWrites: this.stats.streamingWrites,
      compressions: this.stats.compressions,
      decompressions: this.stats.decompressions,
      cacheHits: this.stats.cacheHits || 0,
      cacheMisses: this.stats.cacheMisses || 0,
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      avgReadTime: Math.round(this.stats.avgReadTime * 100) / 100,
      avgWriteTime: Math.round(this.stats.avgWriteTime * 100) / 100,
      totalBytes: this.stats.totalBytes,
      compressedBytes: this.stats.compressedBytes,
      compressionRatio: Math.round(compressionRatio * 100),
      cacheSize: this.fileCache.size,
      watchedFiles: this.watchers.size
    };
  }

  /**
   * 캐시 정리
   */
  clearCache() {
    this.fileCache.clear();
    this.lastModifiedCache.clear();
    this.checksumCache.clear();
    
    log.info('File cache cleared');
  }

  /**
   * 리소스 정리
   */
  destroy() {
    // 파일 와처 정리
    for (const [path, watcher] of this.watchers) {
      try {
        watcher.close();
      } catch (error) {
        log.warn('Failed to close file watcher', { path, error: error.message });
      }
    }
    this.watchers.clear();
    
    // 워커 풀 정리
    this.workerPool.forEach(worker => {
      try {
        worker.terminate();
      } catch (error) {
        log.warn('Failed to terminate worker', { error: error.message });
      }
    });
    this.workerPool.length = 0;
    
    // 캐시 정리
    this.clearCache();
    
    log.info('Optimized File I/O system destroyed');
  }
}

/**
 * 파일 I/O 성능 벤치마킹 도구
 */
export class FileIOBenchmark {
  constructor(optimizedIO, standardIO) {
    this.optimizedIO = optimizedIO;
    this.standardIO = standardIO;
  }

  /**
   * 읽기 성능 비교
   */
  async benchmarkReads(filePaths, iterations = 3) {
    const results = {
      optimized: { times: [], totalTime: 0, avgTime: 0 },
      standard: { times: [], totalTime: 0, avgTime: 0 }
    };

    log.info('Starting file read benchmark', {
      fileCount: filePaths.length,
      iterations
    });

    // 최적화된 I/O 테스트
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await this.optimizedIO.readFilesBatch(filePaths);
      const time = Date.now() - start;
      results.optimized.times.push(time);
      results.optimized.totalTime += time;
    }

    // 표준 I/O 테스트 (비교용)
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      
      await Promise.all(filePaths.map(async (filePath) => {
        try {
          return await fs.readFile(filePath, 'utf8');
        } catch (error) {
          return null;
        }
      }));
      
      const time = Date.now() - start;
      results.standard.times.push(time);
      results.standard.totalTime += time;
    }

    // 통계 계산
    results.optimized.avgTime = results.optimized.totalTime / iterations;
    results.standard.avgTime = results.standard.totalTime / iterations;

    const improvement = results.standard.avgTime > 0 ? 
      ((results.standard.avgTime - results.optimized.avgTime) / results.standard.avgTime * 100) : 0;

    return {
      ...results,
      improvement: Math.round(improvement * 100) / 100,
      optimizedStats: this.optimizedIO.getPerformanceStats()
    };
  }

  /**
   * 쓰기 성능 비교
   */
  async benchmarkWrites(operations, iterations = 3) {
    const results = {
      optimized: { times: [], totalTime: 0, avgTime: 0 },
      standard: { times: [], totalTime: 0, avgTime: 0 }
    };

    log.info('Starting file write benchmark', {
      operationCount: operations.length,
      iterations
    });

    // 최적화된 I/O 테스트
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await this.optimizedIO.writeFilesBatch(operations.map(op => ({
        filePath: `${op.filePath}.optimized.${i}`,
        content: op.content
      })));
      const time = Date.now() - start;
      results.optimized.times.push(time);
      results.optimized.totalTime += time;
    }

    // 표준 I/O 테스트
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      
      await Promise.all(operations.map(async (op) => {
        try {
          const dir = path.dirname(`${op.filePath}.standard.${i}`);
          await fs.mkdir(dir, { recursive: true });
          return await fs.writeFile(`${op.filePath}.standard.${i}`, op.content, 'utf8');
        } catch (error) {
          return null;
        }
      }));
      
      const time = Date.now() - start;
      results.standard.times.push(time);
      results.standard.totalTime += time;
    }

    // 통계 계산
    results.optimized.avgTime = results.optimized.totalTime / iterations;
    results.standard.avgTime = results.standard.totalTime / iterations;

    const improvement = results.standard.avgTime > 0 ? 
      ((results.standard.avgTime - results.optimized.avgTime) / results.standard.avgTime * 100) : 0;

    return {
      ...results,
      improvement: Math.round(improvement * 100) / 100,
      optimizedStats: this.optimizedIO.getPerformanceStats()
    };
  }
}

export default OptimizedFileIO;

import { log } from './logger.js';
import { OptimizedMemoryCache } from './cache.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';

/**
 * 멀티티어 캐시 시스템
 * L1: Hot Cache (메모리, 매우 빠름, 작은 용량)
 * L2: Warm Cache (메모리, 빠름, 중간 용량) 
 * L3: Cold Cache (디스크, 느림, 큰 용량)
 */
export class MultiTierCache {
  constructor(options = {}) {
    this.name = options.name || 'multitier-cache';
    this.baseDir = options.baseDir || path.join(process.cwd(), '.cache');
    
    // L1 Cache: 핫 데이터 (빈번한 액세스)
    this.l1Cache = new OptimizedMemoryCache({
      maxSize: options.l1MaxSize || 50,
      defaultTTL: options.l1TTL || 3600000, // 1시간
      enableStats: true
    });
    
    // L2 Cache: 웜 데이터 (일반적인 액세스)
    this.l2Cache = new OptimizedMemoryCache({
      maxSize: options.l2MaxSize || 200,
      defaultTTL: options.l2TTL || 1800000, // 30분
      enableStats: true
    });
    
    // L3 Cache: 콜드 데이터 (디스크 기반)
    this.l3MaxSize = options.l3MaxSize || 1000;
    this.l3TTL = options.l3TTL || 86400000; // 24시간
    this.l3Dir = path.join(this.baseDir, this.name);
    
    // 액세스 패턴 추적
    this.accessTracker = new Map(); // key -> { count, lastAccess, temperature }
    this.temperatureThresholds = {
      hot: options.hotThreshold || 5,    // 1시간 내 5회 이상 액세스
      warm: options.warmThreshold || 2,  // 1시간 내 2회 이상 액세스
      cold: options.coldThreshold || 1   // 그 외
    };
    
    // 압축 설정
    this.compressionEnabled = options.compression !== false;
    this.compressionThreshold = options.compressionThreshold || 1024; // 1KB 이상만 압축
    
    // 통계
    this.stats = {
      l1Hits: 0, l1Misses: 0,
      l2Hits: 0, l2Misses: 0, 
      l3Hits: 0, l3Misses: 0,
      promotions: 0, demotions: 0,
      compressions: 0, decompressions: 0
    };
    
    this.initializeL3Cache();
    this.startMaintenanceTasks();
    
    log.info('MultiTier cache initialized', {
      name: this.name,
      l1MaxSize: this.l1Cache.maxSize,
      l2MaxSize: this.l2Cache.maxSize,
      l3MaxSize: this.l3MaxSize,
      compressionEnabled: this.compressionEnabled
    });
  }

  /**
   * 데이터 조회 (L1 -> L2 -> L3 순서)
   */
  async get(key) {
    const accessTime = Date.now();
    this.trackAccess(key, accessTime);
    
    // L1 Cache 확인
    let value = this.l1Cache.get(key);
    if (value !== undefined) {
      this.stats.l1Hits++;
      log.debug('L1 cache hit', { key });
      return value;
    }
    this.stats.l1Misses++;
    
    // L2 Cache 확인
    value = this.l2Cache.get(key);
    if (value !== undefined) {
      this.stats.l2Hits++;
      
      // 핫 데이터로 승격 고려
      if (this.shouldPromoteToL1(key)) {
        this.promoteToL1(key, value);
      }
      
      log.debug('L2 cache hit', { key });
      return value;
    }
    this.stats.l2Misses++;
    
    // L3 Cache 확인 (디스크)
    value = await this.getFromL3(key);
    if (value !== undefined) {
      this.stats.l3Hits++;
      
      // L2로 승격
      this.l2Cache.set(key, value);
      
      log.debug('L3 cache hit', { key });
      return value;
    }
    this.stats.l3Misses++;
    
    log.debug('Cache miss (all tiers)', { key });
    return undefined;
  }

  /**
   * 데이터 저장 (온도에 따라 적절한 티어에 저장)
   */
  async set(key, value, ttl = null) {
    const temperature = this.calculateTemperature(key);
    
    switch (temperature) {
      case 'hot':
        this.l1Cache.set(key, value, ttl);
        log.debug('Data stored in L1 (hot)', { key });
        break;
        
      case 'warm':
        this.l2Cache.set(key, value, ttl);
        log.debug('Data stored in L2 (warm)', { key });
        break;
        
      case 'cold':
      default:
        await this.setToL3(key, value, ttl);
        log.debug('Data stored in L3 (cold)', { key });
        break;
    }
    
    this.trackAccess(key, Date.now());
  }

  /**
   * 데이터 삭제 (모든 티어에서)
   */
  async delete(key) {
    const results = await Promise.allSettled([
      Promise.resolve(this.l1Cache.delete(key)),
      Promise.resolve(this.l2Cache.delete(key)),
      this.deleteFromL3(key)
    ]);
    
    this.accessTracker.delete(key);
    
    const deletedCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
    log.debug('Key deleted from all tiers', { key, deletedCount });
    
    return deletedCount > 0;
  }

  /**
   * 키 존재 확인
   */
  async has(key) {
    return this.l1Cache.has(key) || 
           this.l2Cache.has(key) || 
           await this.hasInL3(key);
  }

  /**
   * 액세스 패턴 추적
   */
  trackAccess(key, timestamp) {
    const existing = this.accessTracker.get(key);
    
    if (existing) {
      existing.count++;
      existing.lastAccess = timestamp;
      
      // 1시간 이내 액세스만 카운트
      if (timestamp - existing.firstAccess > 3600000) {
        existing.count = 1;
        existing.firstAccess = timestamp;
      }
    } else {
      this.accessTracker.set(key, {
        count: 1,
        firstAccess: timestamp,
        lastAccess: timestamp
      });
    }
  }

  /**
   * 데이터 온도 계산
   */
  calculateTemperature(key) {
    const access = this.accessTracker.get(key);
    if (!access) return 'cold';
    
    const now = Date.now();
    const hoursSinceFirst = (now - access.firstAccess) / 3600000;
    
    // 1시간 이내의 액세스 빈도로 온도 결정
    if (hoursSinceFirst <= 1) {
      if (access.count >= this.temperatureThresholds.hot) return 'hot';
      if (access.count >= this.temperatureThresholds.warm) return 'warm';
    }
    
    return 'cold';
  }

  /**
   * L1으로 승격 여부 결정
   */
  shouldPromoteToL1(key) {
    return this.calculateTemperature(key) === 'hot';
  }

  /**
   * L1으로 승격
   */
  promoteToL1(key, value) {
    this.l1Cache.set(key, value);
    this.l2Cache.delete(key);
    this.stats.promotions++;
    
    log.debug('Data promoted to L1', { key });
  }

  /**
   * L3 캐시 초기화
   */
  async initializeL3Cache() {
    try {
      await fs.mkdir(this.l3Dir, { recursive: true });
      log.debug('L3 cache directory initialized', { dir: this.l3Dir });
    } catch (error) {
      log.error('Failed to initialize L3 cache directory', { 
        dir: this.l3Dir, 
        error: error.message 
      });
    }
  }

  /**
   * L3 캐시에서 데이터 조회
   */
  async getFromL3(key) {
    try {
      const filePath = this.getL3FilePath(key);
      const data = await fs.readFile(filePath);
      const parsed = JSON.parse(data.toString());
      
      // TTL 확인
      if (Date.now() > parsed.expiresAt) {
        await this.deleteFromL3(key);
        return undefined;
      }
      
      // 압축 해제
      let value = parsed.value;
      if (parsed.compressed) {
        value = gunzipSync(Buffer.from(value, 'base64')).toString();
        this.stats.decompressions++;
      }
      
      return value;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        log.warn('L3 cache read error', { key, error: error.message });
      }
      return undefined;
    }
  }

  /**
   * L3 캐시에 데이터 저장
   */
  async setToL3(key, value, ttl = null) {
    try {
      const expiresAt = Date.now() + (ttl || this.l3TTL);
      let processedValue = value;
      let compressed = false;
      
      // 압축 처리
      if (this.compressionEnabled && 
          typeof value === 'string' && 
          value.length > this.compressionThreshold) {
        processedValue = gzipSync(value).toString('base64');
        compressed = true;
        this.stats.compressions++;
      }
      
      const data = JSON.stringify({
        value: processedValue,
        expiresAt,
        compressed,
        createdAt: Date.now()
      });
      
      const filePath = this.getL3FilePath(key);
      
      // 서브디렉토리 생성
      await this.ensureL3Subdir(filePath);
      
      await fs.writeFile(filePath, data);
      
      log.debug('Data stored in L3', { 
        key, 
        compressed, 
        originalSize: typeof value === 'string' ? value.length : 0,
        compressedSize: data.length 
      });
    } catch (error) {
      log.error('L3 cache write error', { key, error: error.message });
    }
  }

  /**
   * L3 캐시에서 데이터 삭제
   */
  async deleteFromL3(key) {
    try {
      const filePath = this.getL3FilePath(key);
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        log.warn('L3 cache delete error', { key, error: error.message });
      }
      return false;
    }
  }

  /**
   * L3 캐시 키 존재 확인
   */
  async hasInL3(key) {
    try {
      const filePath = this.getL3FilePath(key);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * L3 캐시 파일 경로 생성
   */
  getL3FilePath(key) {
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    const subdir = hash.substring(0, 2);
    return path.join(this.l3Dir, subdir, `${hash}.json`);
  }

  /**
   * L3 캐시 서브디렉토리 생성
   */
  async ensureL3Subdir(filePath) {
    const dir = path.dirname(filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      // 이미 존재하거나 다른 프로세스가 생성한 경우 무시
    }
  }

  /**
   * 유지보수 작업 시작
   */
  startMaintenanceTasks() {
    // 주기적으로 만료된 L3 데이터 정리
    this.maintenanceTimer = setInterval(async () => {
      await this.cleanupL3();
      this.rebalanceTiers();
    }, 300000); // 5분마다
    
    // 액세스 추적 데이터 정리
    this.trackingCleanupTimer = setInterval(() => {
      this.cleanupAccessTracking();
    }, 600000); // 10분마다
  }

  /**
   * L3 캐시 정리
   */
  async cleanupL3() {
    try {
      const files = await this.getAllL3Files();
      let cleanedCount = 0;
      
      for (const filePath of files) {
        try {
          const data = await fs.readFile(filePath);
          const parsed = JSON.parse(data.toString());
          
          if (Date.now() > parsed.expiresAt) {
            await fs.unlink(filePath);
            cleanedCount++;
          }
        } catch (error) {
          // 손상된 파일 제거
          await fs.unlink(filePath);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        log.info('L3 cache cleanup completed', { cleanedCount });
      }
    } catch (error) {
      log.error('L3 cache cleanup error', { error: error.message });
    }
  }

  /**
   * 모든 L3 파일 목록 조회
   */
  async getAllL3Files() {
    const files = [];
    try {
      const subdirs = await fs.readdir(this.l3Dir);
      
      for (const subdir of subdirs) {
        const subdirPath = path.join(this.l3Dir, subdir);
        const stat = await fs.stat(subdirPath);
        
        if (stat.isDirectory()) {
          const subFiles = await fs.readdir(subdirPath);
          for (const file of subFiles) {
            if (file.endsWith('.json')) {
              files.push(path.join(subdirPath, file));
            }
          }
        }
      }
    } catch (error) {
      log.warn('Failed to list L3 files', { error: error.message });
    }
    
    return files;
  }

  /**
   * 티어 간 데이터 재조정
   */
  rebalanceTiers() {
    // L2에서 콜드 데이터를 L3로 이동
    const l2Keys = this.l2Cache.keys();
    for (const key of l2Keys) {
      if (this.calculateTemperature(key) === 'cold') {
        const value = this.l2Cache.get(key);
        if (value !== undefined) {
          this.setToL3(key, value);
          this.l2Cache.delete(key);
          this.stats.demotions++;
        }
      }
    }
    
    log.debug('Tier rebalancing completed', {
      l1Size: this.l1Cache.getStats().size,
      l2Size: this.l2Cache.getStats().size
    });
  }

  /**
   * 액세스 추적 데이터 정리
   */
  cleanupAccessTracking() {
    const now = Date.now();
    const cutoff = now - 7200000; // 2시간 이전 데이터 제거
    
    let cleanedCount = 0;
    for (const [key, access] of this.accessTracker.entries()) {
      if (access.lastAccess < cutoff) {
        this.accessTracker.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      log.debug('Access tracking cleanup', { cleanedCount });
    }
  }

  /**
   * 캐시 전체 삭제
   */
  async clear() {
    this.l1Cache.clear();
    this.l2Cache.clear();
    this.accessTracker.clear();
    
    // L3 캐시 디렉토리 삭제
    try {
      await fs.rm(this.l3Dir, { recursive: true, force: true });
      await this.initializeL3Cache();
    } catch (error) {
      log.error('Failed to clear L3 cache', { error: error.message });
    }
    
    // 통계 초기화
    Object.keys(this.stats).forEach(key => {
      this.stats[key] = 0;
    });
    
    log.info('MultiTier cache cleared');
  }

  /**
   * 상세 통계 정보
   */
  getDetailedStats() {
    const l1Stats = this.l1Cache.getStats();
    const l2Stats = this.l2Cache.getStats();
    
    const totalHits = this.stats.l1Hits + this.stats.l2Hits + this.stats.l3Hits;
    const totalMisses = this.stats.l1Misses + this.stats.l2Misses + this.stats.l3Misses;
    const totalRequests = totalHits + totalMisses;
    
    return {
      overview: {
        totalRequests,
        totalHits,
        totalMisses,
        overallHitRate: totalRequests > 0 ? (totalHits / totalRequests * 100).toFixed(2) + '%' : '0%'
      },
      l1: {
        hits: this.stats.l1Hits,
        misses: this.stats.l1Misses,
        hitRate: l1Stats.hitRate,
        size: l1Stats.size,
        maxSize: l1Stats.maxSize
      },
      l2: {
        hits: this.stats.l2Hits,
        misses: this.stats.l2Misses,
        hitRate: l2Stats.hitRate,
        size: l2Stats.size,
        maxSize: l2Stats.maxSize
      },
      l3: {
        hits: this.stats.l3Hits,
        misses: this.stats.l3Misses,
        directory: this.l3Dir
      },
      operations: {
        promotions: this.stats.promotions,
        demotions: this.stats.demotions,
        compressions: this.stats.compressions,
        decompressions: this.stats.decompressions
      },
      tracking: {
        activeKeys: this.accessTracker.size,
        hotKeys: Array.from(this.accessTracker.entries())
          .filter(([key]) => this.calculateTemperature(key) === 'hot')
          .length,
        warmKeys: Array.from(this.accessTracker.entries())
          .filter(([key]) => this.calculateTemperature(key) === 'warm')
          .length
      }
    };
  }

  /**
   * 리소스 정리
   */
  destroy() {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
    
    if (this.trackingCleanupTimer) {
      clearInterval(this.trackingCleanupTimer);
      this.trackingCleanupTimer = null;
    }
    
    this.l1Cache.destroy();
    this.l2Cache.destroy();
    this.accessTracker.clear();
    
    log.info('MultiTier cache destroyed');
  }
}

/**
 * 데이터 특성별 캐시 파티션 관리자
 */
export class CachePartitionManager {
  constructor(baseDir = path.join(process.cwd(), '.cache')) {
    this.baseDir = baseDir;
    this.partitions = new Map();
    
    // 기본 파티션 설정
    this.defaultConfigs = {
      // 핫 프롬프트: 자주 사용되는 프롬프트
      hotPrompts: {
        l1MaxSize: 50,
        l2MaxSize: 100,
        l3MaxSize: 200,
        l1TTL: 7200000,  // 2시간
        l2TTL: 3600000,  // 1시간
        l3TTL: 86400000, // 24시간
        hotThreshold: 3,
        warmThreshold: 2,
        compression: true
      },
      
      // 템플릿: 상대적으로 안정적인 데이터
      templates: {
        l1MaxSize: 20,
        l2MaxSize: 50,
        l3MaxSize: 100,
        l1TTL: 14400000, // 4시간
        l2TTL: 7200000,  // 2시간
        l3TTL: 172800000, // 48시간
        hotThreshold: 2,
        warmThreshold: 1,
        compression: true
      },
      
      // 메타데이터: 작지만 자주 액세스
      metadata: {
        l1MaxSize: 100,
        l2MaxSize: 300,
        l3MaxSize: 500,
        l1TTL: 3600000,  // 1시간
        l2TTL: 1800000,  // 30분
        l3TTL: 43200000, // 12시간
        hotThreshold: 5,
        warmThreshold: 3,
        compression: false // 작은 데이터는 압축 비효율
      },
      
      // 검색 결과: 빠르게 변하는 데이터
      searchResults: {
        l1MaxSize: 30,
        l2MaxSize: 100,
        l3MaxSize: 200,
        l1TTL: 600000,   // 10분
        l2TTL: 300000,   // 5분
        l3TTL: 1800000,  // 30분
        hotThreshold: 2,
        warmThreshold: 1,
        compression: true
      },
      
      // 사용자 설정: 개인화 데이터
      userPreferences: {
        l1MaxSize: 50,
        l2MaxSize: 200,
        l3MaxSize: 1000,
        l1TTL: 86400000,  // 24시간
        l2TTL: 43200000,  // 12시간
        l3TTL: 604800000, // 7일
        hotThreshold: 3,
        warmThreshold: 2,
        compression: false
      }
    };
    
    log.info('Cache partition manager initialized', {
      baseDir: this.baseDir,
      partitions: Object.keys(this.defaultConfigs)
    });
  }

  /**
   * 파티션 생성 또는 조회
   */
  getPartition(name, config = null) {
    if (this.partitions.has(name)) {
      return this.partitions.get(name);
    }
    
    const partitionConfig = config || this.defaultConfigs[name] || this.defaultConfigs.hotPrompts;
    const partition = new MultiTierCache({
      name,
      baseDir: this.baseDir,
      ...partitionConfig
    });
    
    this.partitions.set(name, partition);
    
    log.info('Cache partition created', { name, config: partitionConfig });
    return partition;
  }

  /**
   * 모든 파티션 통계
   */
  getAllStats() {
    const stats = {};
    
    for (const [name, partition] of this.partitions.entries()) {
      stats[name] = partition.getDetailedStats();
    }
    
    return {
      partitions: stats,
      summary: this.getSummaryStats(stats)
    };
  }

  /**
   * 요약 통계
   */
  getSummaryStats(partitionStats) {
    let totalRequests = 0;
    let totalHits = 0;
    let totalL1Size = 0;
    let totalL2Size = 0;
    let totalPromotions = 0;
    let totalCompressions = 0;
    
    Object.values(partitionStats).forEach(stats => {
      totalRequests += stats.overview.totalRequests;
      totalHits += stats.overview.totalHits;
      totalL1Size += stats.l1.size;
      totalL2Size += stats.l2.size;
      totalPromotions += stats.operations.promotions;
      totalCompressions += stats.operations.compressions;
    });
    
    return {
      totalPartitions: this.partitions.size,
      totalRequests,
      totalHits,
      overallHitRate: totalRequests > 0 ? (totalHits / totalRequests * 100).toFixed(2) + '%' : '0%',
      totalL1Size,
      totalL2Size,
      totalPromotions,
      totalCompressions
    };
  }

  /**
   * 모든 파티션 정리
   */
  async clearAll() {
    const promises = Array.from(this.partitions.values()).map(partition => 
      partition.clear()
    );
    
    await Promise.all(promises);
    log.info('All cache partitions cleared');
  }

  /**
   * 리소스 정리
   */
  destroy() {
    for (const partition of this.partitions.values()) {
      partition.destroy();
    }
    
    this.partitions.clear();
    log.info('Cache partition manager destroyed');
  }
}

/**
 * 환경변수에서 정수값 추출
 */
function envInt(key, defaultValue) {
  const value = process.env[key];
  return value ? parseInt(value, 10) : defaultValue;
}

// 글로벌 파티션 관리자 인스턴스
export const globalPartitionManager = new CachePartitionManager();

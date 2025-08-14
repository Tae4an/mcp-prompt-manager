import { log } from './logger.js';
import { MultiTierCache, globalPartitionManager } from './multitier-cache.js';
import { AdaptiveMultiAlgorithmCache } from './adaptive-cache.js';
import { IntelligentCacheWarming } from './cache-warming.js';
import { OptimizedMemoryCache } from './cache.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 향상된 캐시 시스템
 * 멀티티어, 적응형 알고리즘, 지능형 워밍을 통합한 종합 캐시 솔루션
 */
export class EnhancedCacheSystem {
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
    
    // 캐시 전략 선택
    this.strategy = options.strategy || 'multitier'; // 'multitier', 'adaptive', 'simple'
    
    // 적절한 캐시 인스턴스 생성
    this.cache = this.createCacheInstance();
    
    // 지능형 워밍 시스템 (선택사항)
    this.warming = null;
    if (options.enableWarming && options.dataLoader) {
      this.warming = new IntelligentCacheWarming(this.cache, {
        dataLoader: options.dataLoader,
        warmingInterval: options.warmingInterval,
        maxWarmItems: options.maxWarmItems,
        minConfidence: options.minConfidence
      });
    }
    
    // 통계 및 모니터링
    this.stats = {
      requests: 0,
      hits: 0,
      misses: 0,
      errors: 0,
      startTime: Date.now()
    };
    
    // 자동 최적화 설정
    this.autoOptimize = options.autoOptimize !== false;
    this.optimizationInterval = options.optimizationInterval || 3600000; // 1시간
    
    if (this.autoOptimize) {
      this.startAutoOptimization();
    }
    
    log.info('Enhanced cache system initialized', {
      name: this.name,
      strategy: this.strategy,
      warming: !!this.warming,
      autoOptimize: this.autoOptimize
    });
  }

  /**
   * 캐시 인스턴스 생성
   */
  createCacheInstance() {
    switch (this.strategy) {
      case 'multitier':
        return new MultiTierCache({
          name: this.name,
          ...this.options
        });
        
      case 'adaptive':
        return new AdaptiveMultiAlgorithmCache(this.options);
        
      case 'simple':
      default:
        return new OptimizedMemoryCache(this.options);
    }
  }

  /**
   * 데이터 조회
   */
  async get(key, context = {}) {
    const startTime = Date.now();
    this.stats.requests++;
    
    try {
      // 캐시에서 조회
      const value = await this.cache.get(key);
      const responseTime = Date.now() - startTime;
      
      if (value !== undefined) {
        this.stats.hits++;
        
        // 워밍 시스템에 성공적인 액세스 기록
        if (this.warming) {
          this.warming.recordAccess(key, { 
            ...context, 
            hit: true,
            responseTime
          });
        }
        
        log.debug('Cache hit', { 
          key, 
          strategy: this.strategy,
          responseTime: `${responseTime}ms`
        });
        
        return value;
      } else {
        this.stats.misses++;
        
        // 워밍 시스템에 미스 기록
        if (this.warming) {
          this.warming.recordAccess(key, { 
            ...context, 
            hit: false,
            responseTime
          });
          
          // 즉시 워밍 고려 (높은 우선순위 컨텍스트인 경우)
          if (context.priority === 'high') {
            setImmediate(() => {
              this.warming.warmForContext({ ...context, lastAccessedKey: key });
            });
          }
        }
        
        log.debug('Cache miss', { 
          key, 
          strategy: this.strategy,
          responseTime: `${responseTime}ms`
        });
        
        return undefined;
      }
    } catch (error) {
      this.stats.errors++;
      log.error('Cache get error', { 
        key, 
        error: error.message,
        strategy: this.strategy
      });
      return undefined;
    }
  }

  /**
   * 데이터 저장
   */
  async set(key, value, ttl = null, context = {}) {
    try {
      await this.cache.set(key, value, ttl);
      
      // 워밍 시스템에 새 데이터 등록
      if (this.warming) {
        this.warming.recordAccess(key, { 
          ...context, 
          operation: 'set',
          dataSize: typeof value === 'string' ? value.length : JSON.stringify(value).length
        });
      }
      
      log.debug('Cache set', { 
        key, 
        strategy: this.strategy,
        ttl: ttl || 'default'
      });
      
      return true;
    } catch (error) {
      this.stats.errors++;
      log.error('Cache set error', { 
        key, 
        error: error.message,
        strategy: this.strategy
      });
      return false;
    }
  }

  /**
   * 데이터 삭제
   */
  async delete(key) {
    try {
      const result = await this.cache.delete(key);
      
      log.debug('Cache delete', { 
        key, 
        strategy: this.strategy,
        found: result
      });
      
      return result;
    } catch (error) {
      this.stats.errors++;
      log.error('Cache delete error', { 
        key, 
        error: error.message,
        strategy: this.strategy
      });
      return false;
    }
  }

  /**
   * 키 존재 확인
   */
  async has(key) {
    try {
      return await this.cache.has(key);
    } catch (error) {
      log.error('Cache has error', { 
        key, 
        error: error.message,
        strategy: this.strategy
      });
      return false;
    }
  }

  /**
   * 캐시 정리
   */
  async clear() {
    try {
      const result = await this.cache.clear();
      
      // 통계 초기화
      this.stats.hits = 0;
      this.stats.misses = 0;
      this.stats.requests = 0;
      this.stats.errors = 0;
      
      log.info('Cache cleared', { 
        strategy: this.strategy,
        clearedItems: result
      });
      
      return result;
    } catch (error) {
      log.error('Cache clear error', { 
        error: error.message,
        strategy: this.strategy
      });
      return 0;
    }
  }

  /**
   * 종합 통계 정보
   */
  getComprehensiveStats() {
    const uptime = Date.now() - this.stats.startTime;
    const hitRate = this.stats.requests > 0 ? 
      (this.stats.hits / this.stats.requests * 100).toFixed(2) + '%' : '0%';
    
    const baseStats = {
      name: this.name,
      strategy: this.strategy,
      uptime: Math.floor(uptime / 1000) + 's',
      requests: this.stats.requests,
      hits: this.stats.hits,
      misses: this.stats.misses,
      errors: this.stats.errors,
      hitRate,
      requestsPerSecond: this.stats.requests / (uptime / 1000)
    };

    // 캐시별 상세 통계
    let cacheStats = {};
    if (this.cache.getStats) {
      cacheStats = this.cache.getStats();
    } else if (this.cache.getDetailedStats) {
      cacheStats = this.cache.getDetailedStats();
    }

    // 워밍 통계
    let warmingStats = {};
    if (this.warming) {
      warmingStats = this.warming.getWarmingStats();
    }

    return {
      overview: baseStats,
      cache: cacheStats,
      warming: warmingStats
    };
  }

  /**
   * 자동 최적화 시작
   */
  startAutoOptimization() {
    this.optimizationTimer = setInterval(() => {
      this.performOptimization();
    }, this.optimizationInterval);
    
    log.info('Auto optimization started', {
      interval: this.optimizationInterval,
      strategy: this.strategy
    });
  }

  /**
   * 최적화 수행
   */
  async performOptimization() {
    try {
      const stats = this.getComprehensiveStats();
      
      log.info('Starting cache optimization', {
        strategy: this.strategy,
        hitRate: stats.overview.hitRate,
        requests: stats.overview.requests
      });
      
      // 전략별 최적화
      switch (this.strategy) {
        case 'multitier':
          await this.optimizeMultiTier(stats);
          break;
          
        case 'adaptive':
          await this.optimizeAdaptive(stats);
          break;
          
        case 'simple':
          await this.optimizeSimple(stats);
          break;
      }
      
      // 워밍 시스템 최적화
      if (this.warming) {
        await this.optimizeWarming(stats);
      }
      
    } catch (error) {
      log.error('Optimization failed', { 
        error: error.message,
        strategy: this.strategy
      });
    }
  }

  /**
   * 멀티티어 캐시 최적화
   */
  async optimizeMultiTier(stats) {
    if (!this.cache.getDetailedStats) return;
    
    const detailed = this.cache.getDetailedStats();
    
    // L1 히트율이 낮으면 온도 임계값 조정
    if (detailed.l1 && detailed.l1.hitRate < '50.00%') {
      // 더 많은 데이터를 핫으로 분류
      if (this.cache.temperatureThresholds) {
        this.cache.temperatureThresholds.hot = Math.max(2, this.cache.temperatureThresholds.hot - 1);
        log.info('Adjusted hot threshold for better L1 performance', {
          newThreshold: this.cache.temperatureThresholds.hot
        });
      }
    }
    
    // 압축 효과 분석
    if (detailed.operations && detailed.operations.compressions > 0) {
      const compressionRatio = detailed.operations.compressions / stats.overview.requests;
      if (compressionRatio < 0.1) {
        // 압축 임계값 낮추기
        if (this.cache.compressionThreshold > 512) {
          this.cache.compressionThreshold = 512;
          log.info('Lowered compression threshold for better efficiency');
        }
      }
    }
  }

  /**
   * 적응형 캐시 최적화
   */
  async optimizeAdaptive(stats) {
    if (!this.cache.getStats) return;
    
    const adaptiveStats = this.cache.getStats();
    
    // 알고리즘 전환 빈도 분석
    if (adaptiveStats.adaptive) {
      const switchingTooOften = Object.keys(adaptiveStats.adaptive.algorithmStats).length > 2;
      
      if (switchingTooOften) {
        // 전환 임계값 높이기
        if (this.cache.selector) {
          this.cache.selector.switchThreshold = Math.min(0.15, this.cache.selector.switchThreshold + 0.02);
          log.info('Increased algorithm switch threshold to reduce oscillation');
        }
      }
    }
  }

  /**
   * 단순 캐시 최적화
   */
  async optimizeSimple(stats) {
    // 메모리 사용량 기반 최적화
    if (this.cache.optimizeMemory) {
      await this.cache.optimizeMemory();
    }
    
    // 히트율이 낮으면 캐시 크기 조정 고려
    const hitRate = parseFloat(stats.overview.hitRate);
    if (hitRate < 60 && this.cache.maxSize < 2000) {
      this.cache.maxSize = Math.min(2000, Math.floor(this.cache.maxSize * 1.2));
      log.info('Increased cache size for better hit rate', {
        newSize: this.cache.maxSize
      });
    }
  }

  /**
   * 워밍 시스템 최적화
   */
  async optimizeWarming(stats) {
    if (!stats.warming || !stats.warming.warming) return;
    
    const warmingStats = stats.warming.warming;
    const successRate = parseFloat(warmingStats.successRate);
    
    // 성공률이 낮으면 신뢰도 임계값 조정
    if (successRate < 30) {
      this.warming.updateConfig({
        minConfidence: Math.max(0.1, this.warming.minConfidence - 0.1)
      });
      log.info('Lowered warming confidence threshold to improve success rate');
    }
    
    // 성공률이 너무 높으면 더 도전적으로
    if (successRate > 80) {
      this.warming.updateConfig({
        minConfidence: Math.min(0.8, this.warming.minConfidence + 0.1)
      });
      log.info('Raised warming confidence threshold for better precision');
    }
  }

  /**
   * 리소스 정리
   */
  destroy() {
    if (this.optimizationTimer) {
      clearInterval(this.optimizationTimer);
      this.optimizationTimer = null;
    }
    
    if (this.warming) {
      this.warming.destroy();
    }
    
    if (this.cache.destroy) {
      this.cache.destroy();
    }
    
    log.info('Enhanced cache system destroyed', { 
      name: this.name,
      strategy: this.strategy
    });
  }
}

/**
 * 향상된 캐시 팩토리
 */
export class EnhancedCacheFactory {
  static createCache(name, type, options = {}) {
    const defaultConfigs = {
      // 핫 프롬프트: 자주 액세스되는 프롬프트
      hotPrompts: {
        strategy: 'multitier',
        l1MaxSize: 50,
        l2MaxSize: 150,
        l3MaxSize: 300,
        l1TTL: 7200000,  // 2시간
        l2TTL: 3600000,  // 1시간
        l3TTL: 86400000, // 24시간
        hotThreshold: 3,
        warmThreshold: 2,
        compression: true,
        enableWarming: true,
        warmingInterval: 300000, // 5분
        maxWarmItems: 20
      },
      
      // 템플릿: 안정적이고 재사용성 높은 데이터
      templates: {
        strategy: 'adaptive',
        maxSize: 100,
        defaultTTL: 14400000, // 4시간
        defaultAlgorithm: 'LFU', // 빈도 기반이 적합
        enableWarming: true,
        warmingInterval: 600000, // 10분
        maxWarmItems: 15
      },
      
      // 메타데이터: 작고 빈번한 액세스
      metadata: {
        strategy: 'simple',
        maxSize: 500,
        defaultTTL: 3600000, // 1시간
        memoryThreshold: 0.7,
        enableWarming: false // 크기가 작아서 워밍 불필요
      },
      
      // 검색 결과: 빠르게 변하는 데이터
      searchResults: {
        strategy: 'multitier',
        l1MaxSize: 30,
        l2MaxSize: 100,
        l3MaxSize: 200,
        l1TTL: 600000,   // 10분
        l2TTL: 300000,   // 5분
        l3TTL: 1800000,  // 30분
        hotThreshold: 2,
        warmThreshold: 1,
        compression: true,
        enableWarming: true,
        warmingInterval: 180000, // 3분
        maxWarmItems: 10
      }
    };
    
    const config = { ...defaultConfigs[type] || defaultConfigs.hotPrompts, ...options };
    
    // 데이터 로더 설정
    if (config.enableWarming && !config.dataLoader) {
      config.dataLoader = EnhancedCacheFactory.createDefaultDataLoader(type);
    }
    
    return new EnhancedCacheSystem(name, config);
  }

  /**
   * 기본 데이터 로더 생성
   */
  static createDefaultDataLoader(type) {
    return async (key) => {
      // 타입별 기본 로더 (실제 구현에서는 적절한 로더로 교체)
      switch (type) {
        case 'hotPrompts':
          return await EnhancedCacheFactory.loadPromptData(key);
          
        case 'templates':
          return await EnhancedCacheFactory.loadTemplateData(key);
          
        case 'metadata':
          return await EnhancedCacheFactory.loadMetadataData(key);
          
        case 'searchResults':
          return await EnhancedCacheFactory.loadSearchData(key);
          
        default:
          return undefined;
      }
    };
  }

  /**
   * 프롬프트 데이터 로더
   */
  static async loadPromptData(key) {
    try {
      const PROMPTS_DIR = process.env.PROMPTS_DIR || path.join(process.cwd(), 'prompts');
      const filePath = path.join(PROMPTS_DIR, key);
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      log.debug('Failed to load prompt data', { key, error: error.message });
      return undefined;
    }
  }

  /**
   * 템플릿 데이터 로더
   */
  static async loadTemplateData(key) {
    // 템플릿 라이브러리에서 로드하는 로직
    // 실제 구현에서는 templateLibrary 연동
    return undefined;
  }

  /**
   * 메타데이터 로더
   */
  static async loadMetadataData(key) {
    try {
      const PROMPTS_DIR = process.env.PROMPTS_DIR || path.join(process.cwd(), 'prompts');
      const metaPath = path.join(PROMPTS_DIR, `.${key}.meta`);
      const content = await fs.readFile(metaPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return undefined;
    }
  }

  /**
   * 검색 데이터 로더
   */
  static async loadSearchData(key) {
    // 검색 결과는 동적으로 생성되므로 미리 로드할 수 없음
    return undefined;
  }
}

/**
 * 글로벌 향상된 캐시 관리자
 */
export class GlobalEnhancedCacheManager {
  constructor() {
    this.caches = new Map();
    this.monitoringInterval = 60000; // 1분
    this.startMonitoring();
    
    log.info('Global enhanced cache manager initialized');
  }

  /**
   * 캐시 등록
   */
  registerCache(name, cache) {
    this.caches.set(name, cache);
    log.info('Cache registered with global manager', { name });
  }

  /**
   * 캐시 조회
   */
  getCache(name) {
    return this.caches.get(name);
  }

  /**
   * 모든 캐시 통계
   */
  getAllStats() {
    const stats = {};
    
    for (const [name, cache] of this.caches.entries()) {
      if (cache.getComprehensiveStats) {
        stats[name] = cache.getComprehensiveStats();
      } else if (cache.getStats) {
        stats[name] = { overview: cache.getStats() };
      }
    }
    
    return {
      caches: stats,
      summary: this.getSummaryStats(stats)
    };
  }

  /**
   * 요약 통계
   */
  getSummaryStats(cacheStats) {
    let totalRequests = 0;
    let totalHits = 0;
    let totalErrors = 0;
    let totalCaches = 0;
    
    Object.values(cacheStats).forEach(stats => {
      if (stats.overview) {
        totalRequests += stats.overview.requests || 0;
        totalHits += stats.overview.hits || 0;
        totalErrors += stats.overview.errors || 0;
        totalCaches++;
      }
    });
    
    return {
      totalCaches,
      totalRequests,
      totalHits,
      totalErrors,
      overallHitRate: totalRequests > 0 ? 
        (totalHits / totalRequests * 100).toFixed(2) + '%' : '0%',
      errorRate: totalRequests > 0 ? 
        (totalErrors / totalRequests * 100).toFixed(2) + '%' : '0%'
    };
  }

  /**
   * 모니터링 시작
   */
  startMonitoring() {
    this.monitoringTimer = setInterval(() => {
      const stats = this.getAllStats();
      
      // 성능 이슈 감지
      this.detectPerformanceIssues(stats);
      
      // 주기적 로깅
      if (stats.summary.totalRequests > 0) {
        log.info('Global cache performance', stats.summary);
      }
    }, this.monitoringInterval);
  }

  /**
   * 성능 이슈 감지
   */
  detectPerformanceIssues(stats) {
    const summary = stats.summary;
    
    // 전체 히트율이 낮은 경우
    const hitRate = parseFloat(summary.overallHitRate);
    if (hitRate < 50 && summary.totalRequests > 100) {
      log.warn('Low overall cache hit rate detected', {
        hitRate: summary.overallHitRate,
        totalRequests: summary.totalRequests
      });
    }
    
    // 에러율이 높은 경우
    const errorRate = parseFloat(summary.errorRate);
    if (errorRate > 5) {
      log.error('High cache error rate detected', {
        errorRate: summary.errorRate,
        totalErrors: summary.totalErrors
      });
    }
    
    // 개별 캐시 이슈 확인
    Object.entries(stats.caches).forEach(([name, cacheStats]) => {
      if (cacheStats.overview) {
        const cacheHitRate = parseFloat(cacheStats.overview.hitRate);
        if (cacheHitRate < 30 && cacheStats.overview.requests > 50) {
          log.warn('Individual cache performance issue', {
            cache: name,
            hitRate: cacheStats.overview.hitRate,
            requests: cacheStats.overview.requests
          });
        }
      }
    });
  }

  /**
   * 모든 캐시 정리
   */
  async clearAll() {
    const promises = [];
    
    for (const [name, cache] of this.caches.entries()) {
      if (cache.clear) {
        promises.push(cache.clear().then(result => ({ name, result })));
      }
    }
    
    const results = await Promise.allSettled(promises);
    
    log.info('All caches cleared', {
      results: results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason.message })
    });
  }

  /**
   * 리소스 정리
   */
  destroy() {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    
    for (const cache of this.caches.values()) {
      if (cache.destroy) {
        cache.destroy();
      }
    }
    
    this.caches.clear();
    log.info('Global enhanced cache manager destroyed');
  }
}

// 글로벌 인스턴스
export const globalEnhancedCacheManager = new GlobalEnhancedCacheManager();

export default EnhancedCacheSystem;

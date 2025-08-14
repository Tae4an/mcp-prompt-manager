import { log } from './logger.js';
import { OptimizedMemoryCache } from './cache.js';

/**
 * 적응형 캐시 알고리즘 선택기
 * 실시간 성능 분석을 통해 최적의 캐시 알고리즘을 자동 선택
 */
export class AdaptiveCacheSelector {
  constructor(options = {}) {
    this.algorithms = ['LRU', 'LFU', 'ARC', 'TinyLFU'];
    this.currentAlgorithm = options.defaultAlgorithm || 'LRU';
    this.evaluationWindow = options.evaluationWindow || 1000; // 1000 요청 단위로 평가
    this.performanceHistory = new Map();
    this.requestCount = 0;
    this.lastEvaluation = Date.now();
    this.switchThreshold = options.switchThreshold || 0.05; // 5% 성능 차이 시 전환
    
    // 각 알고리즘별 성능 메트릭
    this.metrics = {
      LRU: { hits: 0, misses: 0, totalTime: 0, requests: 0 },
      LFU: { hits: 0, misses: 0, totalTime: 0, requests: 0 },
      ARC: { hits: 0, misses: 0, totalTime: 0, requests: 0 },
      TinyLFU: { hits: 0, misses: 0, totalTime: 0, requests: 0 }
    };
    
    log.info('Adaptive cache selector initialized', {
      defaultAlgorithm: this.currentAlgorithm,
      evaluationWindow: this.evaluationWindow,
      availableAlgorithms: this.algorithms
    });
  }

  /**
   * 현재 성능 기록
   */
  recordPerformance(algorithm, hit, responseTime) {
    const metric = this.metrics[algorithm];
    if (!metric) return;
    
    if (hit) {
      metric.hits++;
    } else {
      metric.misses++;
    }
    
    metric.totalTime += responseTime;
    metric.requests++;
    this.requestCount++;
    
    // 평가 윈도우 도달 시 알고리즘 재평가
    if (this.requestCount >= this.evaluationWindow) {
      this.evaluateAndSwitch();
    }
  }

  /**
   * 알고리즘 성능 평가 및 전환
   */
  evaluateAndSwitch() {
    const performances = {};
    
    // 각 알고리즘의 성능 점수 계산
    for (const [algorithm, metric] of Object.entries(this.metrics)) {
      if (metric.requests === 0) continue;
      
      const hitRate = metric.hits / (metric.hits + metric.misses);
      const avgResponseTime = metric.totalTime / metric.requests;
      
      // 성능 점수 = (히트율 * 0.7) + (응답속도 점수 * 0.3)
      const responseScore = Math.max(0, 1 - (avgResponseTime / 100)); // 100ms 기준
      performances[algorithm] = (hitRate * 0.7) + (responseScore * 0.3);
    }
    
    // 최고 성능 알고리즘 찾기
    const bestAlgorithm = Object.entries(performances)
      .sort(([,a], [,b]) => b - a)[0];
    
    if (bestAlgorithm) {
      const [algorithm, score] = bestAlgorithm;
      const currentScore = performances[this.currentAlgorithm] || 0;
      
      // 성능 차이가 임계값 이상이면 전환
      if (algorithm !== this.currentAlgorithm && 
          score - currentScore > this.switchThreshold) {
        
        const oldAlgorithm = this.currentAlgorithm;
        this.currentAlgorithm = algorithm;
        
        log.info('Cache algorithm switched', {
          from: oldAlgorithm,
          to: algorithm,
          oldScore: currentScore.toFixed(3),
          newScore: score.toFixed(3),
          improvement: ((score - currentScore) * 100).toFixed(1) + '%'
        });
      }
    }
    
    // 메트릭 초기화
    this.resetMetrics();
    this.requestCount = 0;
    this.lastEvaluation = Date.now();
  }

  /**
   * 메트릭 초기화
   */
  resetMetrics() {
    for (const metric of Object.values(this.metrics)) {
      metric.hits = 0;
      metric.misses = 0;
      metric.totalTime = 0;
      metric.requests = 0;
    }
  }

  /**
   * 현재 추천 알고리즘
   */
  getRecommendedAlgorithm() {
    return this.currentAlgorithm;
  }

  /**
   * 성능 통계
   */
  getPerformanceStats() {
    const stats = {};
    
    for (const [algorithm, metric] of Object.entries(this.metrics)) {
      if (metric.requests > 0) {
        stats[algorithm] = {
          hitRate: (metric.hits / (metric.hits + metric.misses) * 100).toFixed(2) + '%',
          avgResponseTime: (metric.totalTime / metric.requests).toFixed(2) + 'ms',
          requests: metric.requests
        };
      }
    }
    
    return {
      currentAlgorithm: this.currentAlgorithm,
      requestCount: this.requestCount,
      evaluationWindow: this.evaluationWindow,
      algorithmStats: stats,
      lastEvaluation: new Date(this.lastEvaluation).toISOString()
    };
  }
}

/**
 * LFU (Least Frequently Used) 캐시
 */
export class LFUCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000;
    this.defaultTTL = options.defaultTTL || 300000;
    this.cache = new Map();
    this.frequencies = new Map();
    this.stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
    
    log.debug('LFU cache initialized', { maxSize: this.maxSize });
  }

  get(key) {
    const item = this.cache.get(key);
    
    if (!item) {
      this.stats.misses++;
      return undefined;
    }
    
    // TTL 확인
    if (Date.now() > item.expiresAt) {
      this.delete(key);
      this.stats.misses++;
      return undefined;
    }
    
    // 빈도 증가
    this.frequencies.set(key, (this.frequencies.get(key) || 0) + 1);
    item.lastAccessed = Date.now();
    
    this.stats.hits++;
    return item.value;
  }

  set(key, value, ttl = null) {
    const now = Date.now();
    const expiresAt = now + (ttl || this.defaultTTL);
    
    if (this.cache.has(key)) {
      // 기존 항목 업데이트
      const item = this.cache.get(key);
      item.value = value;
      item.expiresAt = expiresAt;
      item.lastAccessed = now;
    } else {
      // 새 항목 추가
      if (this.cache.size >= this.maxSize) {
        this.evictLFU();
      }
      
      this.cache.set(key, {
        value,
        expiresAt,
        createdAt: now,
        lastAccessed: now
      });
      
      this.frequencies.set(key, 1);
    }
    
    this.stats.sets++;
  }

  delete(key) {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.frequencies.delete(key);
    }
    return deleted;
  }

  evictLFU() {
    let minFreq = Infinity;
    let leastFreqKey = null;
    let oldestTime = Infinity;
    
    // 최소 빈도 찾기
    for (const [key, freq] of this.frequencies.entries()) {
      const item = this.cache.get(key);
      if (freq < minFreq || (freq === minFreq && item.lastAccessed < oldestTime)) {
        minFreq = freq;
        leastFreqKey = key;
        oldestTime = item.lastAccessed;
      }
    }
    
    if (leastFreqKey) {
      this.delete(leastFreqKey);
      this.stats.evictions++;
    }
  }

  has(key) {
    const item = this.cache.get(key);
    if (!item) return false;
    
    if (Date.now() > item.expiresAt) {
      this.delete(key);
      return false;
    }
    
    return true;
  }

  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.frequencies.clear();
    return size;
  }

  getStats() {
    const hitRate = this.stats.hits / (this.stats.hits + this.stats.misses) || 0;
    return {
      ...this.stats,
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: (hitRate * 100).toFixed(2) + '%'
    };
  }
}

/**
 * ARC (Adaptive Replacement Cache) 구현
 */
export class ARCCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000;
    this.defaultTTL = options.defaultTTL || 300000;
    
    // ARC의 4개 리스트
    this.t1 = new Map(); // 최근 접근된 항목 (한 번만)
    this.t2 = new Map(); // 최근 접근된 항목 (두 번 이상)
    this.b1 = new Map(); // T1에서 제거된 항목의 메타데이터
    this.b2 = new Map(); // T2에서 제거된 항목의 메타데이터
    
    this.p = 0; // T1의 목표 크기
    this.stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
    
    log.debug('ARC cache initialized', { maxSize: this.maxSize });
  }

  get(key) {
    const now = Date.now();
    
    // T1에서 확인
    if (this.t1.has(key)) {
      const item = this.t1.get(key);
      if (now <= item.expiresAt) {
        // T1에서 T2로 이동
        this.t1.delete(key);
        this.t2.set(key, item);
        item.lastAccessed = now;
        this.stats.hits++;
        return item.value;
      } else {
        this.t1.delete(key);
      }
    }
    
    // T2에서 확인
    if (this.t2.has(key)) {
      const item = this.t2.get(key);
      if (now <= item.expiresAt) {
        // T2 내에서 MRU로 이동
        this.t2.delete(key);
        this.t2.set(key, item);
        item.lastAccessed = now;
        this.stats.hits++;
        return item.value;
      } else {
        this.t2.delete(key);
      }
    }
    
    this.stats.misses++;
    return undefined;
  }

  set(key, value, ttl = null) {
    const now = Date.now();
    const expiresAt = now + (ttl || this.defaultTTL);
    const item = {
      value,
      expiresAt,
      createdAt: now,
      lastAccessed: now
    };
    
    // 이미 캐시에 있는 경우
    if (this.t1.has(key) || this.t2.has(key)) {
      if (this.t1.has(key)) {
        this.t1.set(key, item);
      } else {
        this.t2.set(key, item);
      }
      this.stats.sets++;
      return;
    }
    
    // B1에 있는 경우 (최근에 T1에서 제거됨)
    if (this.b1.has(key)) {
      this.p = Math.min(this.maxSize, this.p + Math.max(1, this.b2.size / this.b1.size));
      this.replace(key);
      this.b1.delete(key);
      this.t2.set(key, item);
      this.stats.sets++;
      return;
    }
    
    // B2에 있는 경우 (최근에 T2에서 제거됨)
    if (this.b2.has(key)) {
      this.p = Math.max(0, this.p - Math.max(1, this.b1.size / this.b2.size));
      this.replace(key);
      this.b2.delete(key);
      this.t2.set(key, item);
      this.stats.sets++;
      return;
    }
    
    // 새로운 항목
    if (this.t1.size + this.b1.size >= this.maxSize) {
      if (this.t1.size < this.maxSize) {
        this.b1.delete(this.b1.keys().next().value);
        this.replace(key);
      } else {
        this.t1.delete(this.t1.keys().next().value);
      }
    } else if (this.t1.size + this.t2.size + this.b1.size + this.b2.size >= this.maxSize) {
      if (this.t1.size + this.t2.size + this.b1.size + this.b2.size >= 2 * this.maxSize) {
        this.b2.delete(this.b2.keys().next().value);
      }
      this.replace(key);
    }
    
    this.t1.set(key, item);
    this.stats.sets++;
  }

  replace(key) {
    if (this.t1.size > 0 && 
        (this.t1.size > this.p || (this.b2.has(key) && this.t1.size === this.p))) {
      const oldKey = this.t1.keys().next().value;
      this.t1.delete(oldKey);
      this.b1.set(oldKey, Date.now());
      this.stats.evictions++;
    } else if (this.t2.size > 0) {
      const oldKey = this.t2.keys().next().value;
      this.t2.delete(oldKey);
      this.b2.set(oldKey, Date.now());
      this.stats.evictions++;
    }
  }

  delete(key) {
    return this.t1.delete(key) || this.t2.delete(key) || 
           this.b1.delete(key) || this.b2.delete(key);
  }

  has(key) {
    const now = Date.now();
    
    const t1Item = this.t1.get(key);
    if (t1Item && now <= t1Item.expiresAt) return true;
    
    const t2Item = this.t2.get(key);
    if (t2Item && now <= t2Item.expiresAt) return true;
    
    return false;
  }

  clear() {
    const size = this.t1.size + this.t2.size;
    this.t1.clear();
    this.t2.clear();
    this.b1.clear();
    this.b2.clear();
    this.p = 0;
    return size;
  }

  getStats() {
    const hitRate = this.stats.hits / (this.stats.hits + this.stats.misses) || 0;
    return {
      ...this.stats,
      size: this.t1.size + this.t2.size,
      maxSize: this.maxSize,
      hitRate: (hitRate * 100).toFixed(2) + '%',
      t1Size: this.t1.size,
      t2Size: this.t2.size,
      b1Size: this.b1.size,
      b2Size: this.b2.size,
      targetP: this.p
    };
  }
}

/**
 * 적응형 멀티 알고리즘 캐시
 */
export class AdaptiveMultiAlgorithmCache {
  constructor(options = {}) {
    this.selector = new AdaptiveCacheSelector(options);
    this.caches = {
      LRU: new OptimizedMemoryCache(options),
      LFU: new LFUCache(options),
      ARC: new ARCCache(options)
    };
    
    this.currentCache = this.caches[this.selector.currentAlgorithm];
    this.evaluationInterval = options.evaluationInterval || 10000; // 10초
    
    this.startEvaluation();
    
    log.info('Adaptive multi-algorithm cache initialized', {
      algorithms: Object.keys(this.caches),
      currentAlgorithm: this.selector.currentAlgorithm
    });
  }

  get(key) {
    const startTime = Date.now();
    const value = this.currentCache.get(key);
    const responseTime = Date.now() - startTime;
    
    // 성능 기록
    this.selector.recordPerformance(
      this.selector.currentAlgorithm,
      value !== undefined,
      responseTime
    );
    
    return value;
  }

  set(key, value, ttl = null) {
    return this.currentCache.set(key, value, ttl);
  }

  delete(key) {
    return this.currentCache.delete(key);
  }

  has(key) {
    return this.currentCache.has(key);
  }

  clear() {
    return this.currentCache.clear();
  }

  getStats() {
    const currentStats = this.currentCache.getStats();
    const selectorStats = this.selector.getPerformanceStats();
    
    return {
      current: {
        algorithm: this.selector.currentAlgorithm,
        ...currentStats
      },
      adaptive: selectorStats,
      allAlgorithms: Object.fromEntries(
        Object.entries(this.caches).map(([name, cache]) => [
          name, 
          cache.getStats ? cache.getStats() : { size: 0 }
        ])
      )
    };
  }

  startEvaluation() {
    this.evaluationTimer = setInterval(() => {
      const recommended = this.selector.getRecommendedAlgorithm();
      
      if (recommended !== this.selector.currentAlgorithm) {
        this.switchAlgorithm(recommended);
      }
    }, this.evaluationInterval);
  }

  switchAlgorithm(newAlgorithm) {
    if (!this.caches[newAlgorithm]) return;
    
    const oldAlgorithm = this.selector.currentAlgorithm;
    
    // 데이터 마이그레이션 (선택사항)
    if (this.currentCache.keys && typeof this.currentCache.keys === 'function') {
      const keys = this.currentCache.keys();
      for (const key of keys.slice(0, 50)) { // 최대 50개만 마이그레이션
        const value = this.currentCache.get(key);
        if (value !== undefined) {
          this.caches[newAlgorithm].set(key, value);
        }
      }
    }
    
    this.currentCache = this.caches[newAlgorithm];
    
    log.info('Cache algorithm switched in runtime', {
      from: oldAlgorithm,
      to: newAlgorithm
    });
  }

  destroy() {
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
      this.evaluationTimer = null;
    }
    
    for (const cache of Object.values(this.caches)) {
      if (cache.destroy) {
        cache.destroy();
      }
    }
    
    log.info('Adaptive multi-algorithm cache destroyed');
  }
}

export default AdaptiveMultiAlgorithmCache;

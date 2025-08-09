import { log } from './logger.js';

/**
 * 메모리 기반 캐시 시스템
 * LRU (Least Recently Used) 정책과 TTL (Time To Live) 지원
 */
export class MemoryCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000; // 최대 항목 수
    this.defaultTTL = options.defaultTTL || 300000; // 기본 TTL: 5분
    this.cleanupInterval = options.cleanupInterval || 60000; // 정리 주기: 1분
    this.enableStats = options.enableStats !== false;
    
    // 캐시 저장소
    this.cache = new Map();
    
    // 통계 정보
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      cleanups: 0
    };
    
    // 자동 정리 타이머
    this.startCleanupTimer();
    
    log.info('Memory cache initialized', {
      maxSize: this.maxSize,
      defaultTTL: this.defaultTTL,
      cleanupInterval: this.cleanupInterval
    });
  }

  /**
   * 값 저장
   */
  set(key, value, ttl = null) {
    if (typeof key !== 'string') {
      throw new Error('Cache key must be a string');
    }

    const now = Date.now();
    const expiresAt = now + (ttl || this.defaultTTL);
    
    // 기존 항목이 있으면 삭제 (LRU 순서 갱신을 위해)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    
    // 캐시 크기 확인 및 LRU 정리
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }
    
    // 새 항목 추가
    this.cache.set(key, {
      value,
      expiresAt,
      accessCount: 0,
      createdAt: now,
      lastAccessed: now
    });
    
    if (this.enableStats) {
      this.stats.sets++;
    }
    
    log.debug('Cache set', { key, ttl: ttl || this.defaultTTL, size: this.cache.size });
  }

  /**
   * 값 조회
   */
  get(key) {
    const item = this.cache.get(key);
    
    if (!item) {
      if (this.enableStats) {
        this.stats.misses++;
      }
      log.debug('Cache miss', { key });
      return undefined;
    }
    
    const now = Date.now();
    
    // 만료 확인
    if (now > item.expiresAt) {
      this.cache.delete(key);
      if (this.enableStats) {
        this.stats.misses++;
      }
      log.debug('Cache expired', { key, expiresAt: new Date(item.expiresAt) });
      return undefined;
    }
    
    // 접근 정보 갱신 (LRU)
    item.lastAccessed = now;
    item.accessCount++;
    
    // Map에서 삭제 후 다시 추가하여 LRU 순서 갱신
    this.cache.delete(key);
    this.cache.set(key, item);
    
    if (this.enableStats) {
      this.stats.hits++;
    }
    
    log.debug('Cache hit', { key, accessCount: item.accessCount });
    return item.value;
  }

  /**
   * 값 존재 여부 확인 (만료 시간 고려)
   */
  has(key) {
    const item = this.cache.get(key);
    if (!item) return false;
    
    const now = Date.now();
    if (now > item.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * 값 삭제
   */
  delete(key) {
    const existed = this.cache.delete(key);
    
    if (existed && this.enableStats) {
      this.stats.deletes++;
    }
    
    log.debug('Cache delete', { key, existed });
    return existed;
  }

  /**
   * 특정 패턴과 일치하는 키들 삭제
   */
  deletePattern(pattern) {
    const regex = new RegExp(pattern);
    const keysToDelete = [];
    
    for (const [key] of this.cache) {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.delete(key));
    
    log.debug('Cache pattern delete', { pattern, deletedCount: keysToDelete.length });
    return keysToDelete.length;
  }

  /**
   * 캐시 전체 삭제
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    
    log.info('Cache cleared', { clearedItems: size });
    return size;
  }

  /**
   * TTL 갱신
   */
  touch(key, ttl = null) {
    const item = this.cache.get(key);
    if (!item) return false;
    
    const now = Date.now();
    item.expiresAt = now + (ttl || this.defaultTTL);
    item.lastAccessed = now;
    
    log.debug('Cache touch', { key, newTTL: ttl || this.defaultTTL });
    return true;
  }

  /**
   * LRU 정책에 따른 항목 제거
   */
  evictLRU() {
    // Map의 첫 번째 항목이 가장 오래된 항목 (LRU)
    const [firstKey] = this.cache.keys();
    if (firstKey) {
      this.cache.delete(firstKey);
      if (this.enableStats) {
        this.stats.evictions++;
      }
      log.debug('Cache LRU eviction', { evictedKey: firstKey });
    }
  }

  /**
   * 만료된 항목들 정리
   */
  cleanup() {
    const now = Date.now();
    const expiredKeys = [];
    
    for (const [key, item] of this.cache) {
      if (now > item.expiresAt) {
        expiredKeys.push(key);
      }
    }
    
    expiredKeys.forEach(key => this.cache.delete(key));
    
    if (this.enableStats) {
      this.stats.cleanups++;
    }
    
    if (expiredKeys.length > 0) {
      log.debug('Cache cleanup', { 
        expiredCount: expiredKeys.length, 
        remainingSize: this.cache.size 
      });
    }
    
    return expiredKeys.length;
  }

  /**
   * 정기적 정리 타이머 시작
   */
  startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }

  /**
   * 정리 타이머 중지
   */
  stopCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 캐시 통계 조회
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0 
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0;
    
    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      size: this.cache.size,
      maxSize: this.maxSize,
      memoryUsage: this.getMemoryUsage()
    };
  }

  /**
   * 메모리 사용량 추정 (대략적)
   */
  getMemoryUsage() {
    let totalSize = 0;
    
    for (const [key, item] of this.cache) {
      // 키 크기 + 값 크기 추정
      totalSize += key.length * 2; // UTF-16
      totalSize += this.estimateValueSize(item.value);
      totalSize += 64; // 메타데이터 오버헤드 추정
    }
    
    return {
      bytes: totalSize,
      mb: (totalSize / 1024 / 1024).toFixed(2)
    };
  }

  /**
   * 값 크기 추정
   */
  estimateValueSize(value) {
    if (value == null) return 8;
    if (typeof value === 'string') return value.length * 2;
    if (typeof value === 'number') return 8;
    if (typeof value === 'boolean') return 4;
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value).length * 2;
      } catch {
        return 1024; // 기본값
      }
    }
    return 64; // 기본값
  }

  /**
   * 캐시 정보 조회
   */
  getInfo() {
    return {
      type: 'MemoryCache',
      size: this.cache.size,
      maxSize: this.maxSize,
      defaultTTL: this.defaultTTL,
      cleanupInterval: this.cleanupInterval,
      enableStats: this.enableStats
    };
  }

  /**
   * 모든 키 조회
   */
  keys() {
    return Array.from(this.cache.keys());
  }

  /**
   * 특정 키의 메타데이터 조회
   */
  getMetadata(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    return {
      expiresAt: new Date(item.expiresAt),
      createdAt: new Date(item.createdAt),
      lastAccessed: new Date(item.lastAccessed),
      accessCount: item.accessCount,
      ttl: item.expiresAt - Date.now()
    };
  }

  /**
   * 캐시 인스턴스 정리 (메모리 누수 방지)
   */
  destroy() {
    this.stopCleanupTimer();
    this.clear();
    
    log.info('Memory cache destroyed');
  }
}

/**
 * 캐시 팩터리 함수들
 */
export function createFileCache(options = {}) {
  return new MemoryCache({
    maxSize: envInt('FILE_CACHE_MAX_SIZE', 500),
    defaultTTL: envInt('FILE_CACHE_TTL', 600000), // 10분
    ...options
  });
}

export function createMetadataCache(options = {}) {
  return new MemoryCache({
    maxSize: envInt('METADATA_CACHE_MAX_SIZE', 1000),
    defaultTTL: envInt('METADATA_CACHE_TTL', 300000), // 5분
    ...options
  });
}

export function createSearchCache(options = {}) {
  return new MemoryCache({
    maxSize: envInt('SEARCH_CACHE_MAX_SIZE', 200),
    defaultTTL: envInt('SEARCH_CACHE_TTL', 180000), // 3분
    ...options
  });
}

export function createTemplateCache(options = {}) {
  return new MemoryCache({
    maxSize: envInt('TEMPLATE_CACHE_MAX_SIZE', 100),
    defaultTTL: envInt('TEMPLATE_CACHE_TTL', 900000), // 15분
    ...options
  });
}

/**
 * 캐시 키 생성 헬퍼
 */
export class CacheKeyGenerator {
  static file(filename) {
    return `file:${filename}`;
  }
  
  static metadata(filename) {
    return `meta:${filename}`;
  }
  
  static search(query, options = {}) {
    const optionsStr = JSON.stringify(options);
    return `search:${query}:${optionsStr}`;
  }
  
  static template(filename, variables) {
    const varsHash = JSON.stringify(variables);
    return `template:${filename}:${varsHash}`;
  }
  
  static version(filename, version) {
    return `version:${filename}:${version}`;
  }
  
  static list(directory = '') {
    return `list:${directory}`;
  }
}

/**
 * 환경변수 정수 파서 (안전 기본값)
 */
function envInt(key, defaultValue) {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return defaultValue;
  return parsed;
}

export default MemoryCache;
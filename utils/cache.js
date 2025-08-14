import { log } from './logger.js';

/**
 * 이중 연결 리스트 노드
 */
class DoublyLinkedNode {
  constructor(key, value, expiresAt) {
    this.key = key;
    this.value = value;
    this.expiresAt = expiresAt;
    this.accessCount = 0;
    this.createdAt = Date.now();
    this.lastAccessed = Date.now();
    this.prev = null;
    this.next = null;
  }
}

/**
 * 최적화된 메모리 캐시 시스템
 * - O(1) LRU 구현 (이중 연결 리스트 사용)
 * - 메모리 효율적인 만료 처리
 * - 스마트 메모리 관리
 */
export class OptimizedMemoryCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000;
    this.defaultTTL = options.defaultTTL || 300000; // 5분
    this.cleanupInterval = options.cleanupInterval || 60000; // 1분
    this.enableStats = options.enableStats !== false;
    this.memoryThreshold = options.memoryThreshold || 0.8; // 80%
    
    // HashMap for O(1) key lookup
    this.keyMap = new Map();
    
    // 이중 연결 리스트 (더미 헤드/테일)
    this.head = new DoublyLinkedNode('__head__', null, Infinity);
    this.tail = new DoublyLinkedNode('__tail__', null, Infinity);
    this.head.next = this.tail;
    this.tail.prev = this.head;
    
    // 통계 정보
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      cleanups: 0,
      memoryOptimizations: 0
    };
    
    // 자동 정리 타이머
    this.cleanupTimer = null;
    this.startCleanupTimer();
    
    // 메모리 모니터링
    this.startMemoryMonitoring();
    
    log.info('Optimized memory cache initialized', {
      maxSize: this.maxSize,
      defaultTTL: this.defaultTTL,
      cleanupInterval: this.cleanupInterval,
      memoryThreshold: this.memoryThreshold
    });
  }

  /**
   * O(1) 값 저장
   */
  set(key, value, ttl = null) {
    if (typeof key !== 'string') {
      throw new Error('Cache key must be a string');
    }

    const now = Date.now();
    const expiresAt = now + (ttl || this.defaultTTL);
    
    // 기존 노드가 있으면 업데이트
    if (this.keyMap.has(key)) {
      const existingNode = this.keyMap.get(key);
      existingNode.value = value;
      existingNode.expiresAt = expiresAt;
      existingNode.lastAccessed = now;
      
      // 최신 위치로 이동 (O(1))
      this.moveToHead(existingNode);
    } else {
      // 새 노드 생성
      const newNode = new DoublyLinkedNode(key, value, expiresAt);
      
      // 캐시 크기 확인 및 LRU 제거
      if (this.keyMap.size >= this.maxSize) {
        this.evictLRU();
      }
      
      // 헤드에 추가 (O(1))
      this.addToHead(newNode);
      this.keyMap.set(key, newNode);
    }
    
    if (this.enableStats) {
      this.stats.sets++;
    }
    
    log.debug('Optimized cache set', { 
      key, 
      ttl: ttl || this.defaultTTL, 
      size: this.keyMap.size 
    });
  }

  /**
   * O(1) 값 조회
   */
  get(key) {
    const node = this.keyMap.get(key);
    
    if (!node) {
      if (this.enableStats) {
        this.stats.misses++;
      }
      log.debug('Optimized cache miss', { key });
      return undefined;
    }
    
    const now = Date.now();
    
    // 만료 확인
    if (now > node.expiresAt) {
      this.removeNode(node);
      this.keyMap.delete(key);
      
      if (this.enableStats) {
        this.stats.misses++;
      }
      log.debug('Optimized cache expired', { 
        key, 
        expiresAt: new Date(node.expiresAt) 
      });
      return undefined;
    }
    
    // 접근 정보 갱신
    node.lastAccessed = now;
    node.accessCount++;
    
    // 최신 위치로 이동 (O(1))
    this.moveToHead(node);
    
    if (this.enableStats) {
      this.stats.hits++;
    }
    
    log.debug('Optimized cache hit', { 
      key, 
      accessCount: node.accessCount 
    });
    return node.value;
  }

  /**
   * O(1) 값 존재 확인
   */
  has(key) {
    const node = this.keyMap.get(key);
    if (!node) return false;
    
    const now = Date.now();
    if (now > node.expiresAt) {
      this.removeNode(node);
      this.keyMap.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * O(1) 값 삭제
   */
  delete(key) {
    const node = this.keyMap.get(key);
    if (!node) return false;
    
    this.removeNode(node);
    this.keyMap.delete(key);
    
    if (this.enableStats) {
      this.stats.deletes++;
    }
    
    log.debug('Optimized cache delete', { key });
    return true;
  }

  /**
   * 노드를 헤드로 이동 (O(1))
   */
  moveToHead(node) {
    this.removeNode(node);
    this.addToHead(node);
  }

  /**
   * 노드를 헤드에 추가 (O(1))
   */
  addToHead(node) {
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next.prev = node;
    this.head.next = node;
  }

  /**
   * 노드 제거 (O(1))
   */
  removeNode(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
  }

  /**
   * LRU 노드 제거 (O(1))
   */
  evictLRU() {
    const lastNode = this.tail.prev;
    if (lastNode === this.head) return; // 캐시가 비어있음
    
    this.removeNode(lastNode);
    this.keyMap.delete(lastNode.key);
    
    if (this.enableStats) {
      this.stats.evictions++;
    }
    
    log.debug('LRU eviction', { 
      key: lastNode.key, 
      age: Date.now() - lastNode.createdAt 
    });
  }

  /**
   * 만료된 항목들 일괄 정리
   */
  cleanupExpired() {
    const now = Date.now();
    let cleanedCount = 0;
    
    // 테일부터 순회하여 만료된 노드들 제거
    let currentNode = this.tail.prev;
    
    while (currentNode !== this.head) {
      const prevNode = currentNode.prev;
      
      if (now > currentNode.expiresAt) {
        this.removeNode(currentNode);
        this.keyMap.delete(currentNode.key);
        cleanedCount++;
      }
      
      currentNode = prevNode;
    }
    
    if (this.enableStats && cleanedCount > 0) {
      this.stats.cleanups++;
    }
    
    if (cleanedCount > 0) {
      log.debug('Expired items cleanup', { 
        cleanedCount, 
        remainingSize: this.keyMap.size 
      });
    }
    
    return cleanedCount;
  }

  /**
   * 스마트 메모리 최적화
   */
  async optimizeMemory() {
    const usage = process.memoryUsage();
    const heapUsedRatio = usage.heapUsed / usage.heapTotal;
    
    if (heapUsedRatio > this.memoryThreshold) {
      log.info('Memory threshold exceeded, starting optimization', {
        heapUsedRatio: (heapUsedRatio * 100).toFixed(2) + '%',
        threshold: (this.memoryThreshold * 100).toFixed(2) + '%'
      });
      
      // 1. 만료된 항목 정리
      const expiredCleaned = this.cleanupExpired();
      
      // 2. 오래된 항목들 제거 (LFU 기반)
      const oldItemsCleaned = this.evictOldItems();
      
      // 3. 강제 GC (Node.js에서 사용 가능한 경우)
      if (global.gc) {
        global.gc();
      }
      
      if (this.enableStats) {
        this.stats.memoryOptimizations++;
      }
      
      const newUsage = process.memoryUsage();
      const newRatio = newUsage.heapUsed / newUsage.heapTotal;
      
      log.info('Memory optimization completed', {
        expiredCleaned,
        oldItemsCleaned,
        oldHeapRatio: (heapUsedRatio * 100).toFixed(2) + '%',
        newHeapRatio: (newRatio * 100).toFixed(2) + '%',
        savedMemory: ((usage.heapUsed - newUsage.heapUsed) / 1024 / 1024).toFixed(2) + ' MB'
      });
    }
  }

  /**
   * 오래되고 적게 사용된 항목들 제거
   */
  evictOldItems() {
    const targetSize = Math.floor(this.maxSize * 0.8); // 80%로 줄임
    let evictedCount = 0;
    
    while (this.keyMap.size > targetSize) {
      this.evictLRU();
      evictedCount++;
    }
    
    return evictedCount;
  }

  /**
   * 캐시 전체 삭제
   */
  clear() {
    const size = this.keyMap.size;
    this.keyMap.clear();
    
    // 연결 리스트 초기화
    this.head.next = this.tail;
    this.tail.prev = this.head;
    
    log.debug('Optimized cache cleared', { clearedItems: size });
    return size;
  }

  /**
   * 캐시 통계 정보
   */
  getStats() {
    const hitRate = this.stats.hits / (this.stats.hits + this.stats.misses) || 0;
    const memoryUsage = process.memoryUsage();
    
    return {
      size: this.keyMap.size,
      maxSize: this.maxSize,
      hitRate: (hitRate * 100).toFixed(2) + '%', // 기존 테스트 호환성
      hits: this.stats.hits,
      misses: this.stats.misses,
      sets: this.stats.sets,
      deletes: this.stats.deletes,
      evictions: this.stats.evictions,
      cleanups: this.stats.cleanups,
      memoryOptimizations: this.stats.memoryOptimizations,
      memoryUsage: {
        bytes: memoryUsage.heapUsed,
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        mb: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB'
      }
    };
  }

  /**
   * 캐시 정보 반환
   */
  getInfo() {
    return {
      type: 'MemoryCache', // 기존 테스트 호환성
      size: this.keyMap.size,
      maxSize: this.maxSize,
      defaultTTL: this.defaultTTL
    };
  }

  /**
   * 패턴과 일치하는 키들 삭제 (호환성을 위해 추가)
   */
  deletePattern(pattern) {
    const regex = new RegExp(pattern);
    let deletedCount = 0;
    
    const keysToDelete = [];
    for (const key of this.keyMap.keys()) {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    }
    
    for (const key of keysToDelete) {
      if (this.delete(key)) {
        deletedCount++;
      }
    }
    
    log.debug('Pattern delete completed', { pattern, deletedCount });
    return deletedCount;
  }

  /**
   * TTL 갱신 (호환성을 위해 추가)
   */
  touch(key, newTTL) {
    const node = this.keyMap.get(key);
    if (!node) return false;
    
    const now = Date.now();
    if (now > node.expiresAt) {
      this.removeNode(node);
      this.keyMap.delete(key);
      return false;
    }
    
    // TTL 갱신
    node.expiresAt = now + newTTL;
    node.lastAccessed = now;
    
    // 최신 위치로 이동
    this.moveToHead(node);
    
    log.debug('TTL updated', { key, newTTL });
    return true;
  }

  /**
   * 만료된 항목 정리 (호환성을 위해 추가)
   */
  cleanup() {
    return this.cleanupExpired();
  }

  /**
   * 모든 키 목록 반환 (호환성을 위해 추가)
   */
  keys() {
    return Array.from(this.keyMap.keys());
  }

  /**
   * 캐시 항목의 메타데이터 반환 (호환성을 위해 추가)
   */
  getMetadata(key) {
    const node = this.keyMap.get(key);
    if (!node) return null;
    
    const now = Date.now();
    if (now > node.expiresAt) {
      this.removeNode(node);
      this.keyMap.delete(key);
      return null;
    }
    
    return {
      key: node.key,
      createdAt: new Date(node.createdAt),
      lastAccessed: new Date(node.lastAccessed),
      accessCount: node.accessCount,
      expiresAt: new Date(node.expiresAt),
      ttl: node.expiresAt - now
    };
  }

  /**
   * 자동 정리 타이머 시작
   */
  startCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, this.cleanupInterval);
  }

  /**
   * 메모리 모니터링 시작
   */
  startMemoryMonitoring() {
    // 주기적으로 메모리 최적화 실행
    this.memoryTimer = setInterval(() => {
      this.optimizeMemory();
    }, this.cleanupInterval * 2); // 정리 주기의 2배
  }

  /**
   * 캐시 인스턴스 정리
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    if (this.memoryTimer) {
      clearInterval(this.memoryTimer);
      this.memoryTimer = null;
    }
    
    this.clear();
    log.info('Optimized memory cache destroyed');
  }
}

/**
 * 스마트 메모리 관리자
 */
export class SmartMemoryManager {
  constructor() {
    this.caches = new Set();
    this.globalMemoryThreshold = 0.85; // 85%
    this.monitoringInterval = 30000; // 30초
    this.startGlobalMonitoring();
  }

  /**
   * 캐시 등록
   */
  registerCache(cache) {
    this.caches.add(cache);
    log.debug('Cache registered with memory manager', { 
      totalCaches: this.caches.size 
    });
  }

  /**
   * 캐시 등록 해제
   */
  unregisterCache(cache) {
    this.caches.delete(cache);
    log.debug('Cache unregistered from memory manager', { 
      totalCaches: this.caches.size 
    });
  }

  /**
   * 글로벌 메모리 최적화
   */
  async globalMemoryOptimization() {
    const usage = process.memoryUsage();
    const heapUsedRatio = usage.heapUsed / usage.heapTotal;
    
    if (heapUsedRatio > this.globalMemoryThreshold) {
      log.warn('Global memory threshold exceeded, optimizing all caches', {
        heapUsedRatio: (heapUsedRatio * 100).toFixed(2) + '%',
        threshold: (this.globalMemoryThreshold * 100).toFixed(2) + '%',
        totalCaches: this.caches.size
      });
      
      for (const cache of this.caches) {
        if (cache.optimizeMemory) {
          await cache.optimizeMemory();
        }
      }
      
      // 강제 GC
      if (global.gc) {
        global.gc();
      }
    }
  }

  /**
   * 글로벌 메모리 모니터링 시작
   */
  startGlobalMonitoring() {
    this.globalTimer = setInterval(() => {
      this.globalMemoryOptimization();
    }, this.monitoringInterval);
  }

  /**
   * 글로벌 메모리 관리자 정리
   */
  destroy() {
    if (this.globalTimer) {
      clearInterval(this.globalTimer);
      this.globalTimer = null;
    }
    this.caches.clear();
  }

  /**
   * 전체 캐시 통계
   */
  getGlobalStats() {
    const stats = {
      totalCaches: this.caches.size,
      totalItems: 0,
      totalHits: 0,
      totalMisses: 0,
      averageHitRate: 0,
      memoryUsage: process.memoryUsage()
    };
    
    for (const cache of this.caches) {
      if (cache.getStats) {
        const cacheStats = cache.getStats();
        stats.totalItems += cacheStats.size || 0;
        stats.totalHits += cacheStats.hits || 0;
        stats.totalMisses += cacheStats.misses || 0;
      }
    }
    
    stats.averageHitRate = stats.totalHits / (stats.totalHits + stats.totalMisses) || 0;
    
    return stats;
  }
}

// 글로벌 메모리 관리자 싱글톤
export const globalMemoryManager = new SmartMemoryManager();

/**
 * 환경변수에서 정수값 추출
 */
function envInt(key, defaultValue) {
  const value = process.env[key];
  return value ? parseInt(value, 10) : defaultValue;
}

/**
 * 최적화된 캐시 팩터리 함수들
 */
export function createOptimizedFileCache(options = {}) {
  const cache = new OptimizedMemoryCache({
    maxSize: envInt('FILE_CACHE_MAX_SIZE', 500),
    defaultTTL: envInt('FILE_CACHE_TTL', 600000), // 10분
    ...options
  });
  
  globalMemoryManager.registerCache(cache);
  return cache;
}

export function createOptimizedMetadataCache(options = {}) {
  const cache = new OptimizedMemoryCache({
    maxSize: envInt('METADATA_CACHE_MAX_SIZE', 1000),
    defaultTTL: envInt('METADATA_CACHE_TTL', 300000), // 5분
    ...options
  });
  
  globalMemoryManager.registerCache(cache);
  return cache;
}

export function createOptimizedSearchCache(options = {}) {
  const cache = new OptimizedMemoryCache({
    maxSize: envInt('SEARCH_CACHE_MAX_SIZE', 200),
    defaultTTL: envInt('SEARCH_CACHE_TTL', 180000), // 3분
    ...options
  });
  
  globalMemoryManager.registerCache(cache);
  return cache;
}

export function createOptimizedTemplateCache(options = {}) {
  const cache = new OptimizedMemoryCache({
    maxSize: envInt('TEMPLATE_CACHE_MAX_SIZE', 100),
    defaultTTL: envInt('TEMPLATE_CACHE_TTL', 900000), // 15분
    ...options
  });
  
  globalMemoryManager.registerCache(cache);
  return cache;
}

/**
 * 향상된 캐시 시스템 팩터리 (새로운 기능)
 * 환경변수 ENABLE_ENHANCED_CACHE=true 설정 시 활성화
 */
export async function createEnhancedFileCache(options = {}) {
  if (process.env.ENABLE_ENHANCED_CACHE === 'true') {
    try {
      const { EnhancedCacheFactory } = await import('./enhanced-cache-system.js');
      return EnhancedCacheFactory.createCache('files', 'hotPrompts', {
        maxSize: envInt('FILE_CACHE_MAX_SIZE', 500),
        defaultTTL: envInt('FILE_CACHE_TTL', 600000),
        ...options
      });
    } catch (error) {
      log.warn('Enhanced cache system not available, falling back to optimized cache', { error: error.message });
    }
  }
  
  // 폴백: 기존 최적화된 캐시 사용
  return createOptimizedFileCache(options);
}

export async function createEnhancedMetadataCache(options = {}) {
  if (process.env.ENABLE_ENHANCED_CACHE === 'true') {
    try {
      const { EnhancedCacheFactory } = await import('./enhanced-cache-system.js');
      return EnhancedCacheFactory.createCache('metadata', 'metadata', {
        maxSize: envInt('METADATA_CACHE_MAX_SIZE', 1000),
        defaultTTL: envInt('METADATA_CACHE_TTL', 300000),
        ...options
      });
    } catch (error) {
      log.warn('Enhanced cache system not available, falling back to optimized cache', { error: error.message });
    }
  }
  
  return createOptimizedMetadataCache(options);
}

export async function createEnhancedSearchCache(options = {}) {
  if (process.env.ENABLE_ENHANCED_CACHE === 'true') {
    try {
      const { EnhancedCacheFactory } = await import('./enhanced-cache-system.js');
      return EnhancedCacheFactory.createCache('search', 'searchResults', {
        maxSize: envInt('SEARCH_CACHE_MAX_SIZE', 200),
        defaultTTL: envInt('SEARCH_CACHE_TTL', 180000),
        ...options
      });
    } catch (error) {
      log.warn('Enhanced cache system not available, falling back to optimized cache', { error: error.message });
    }
  }
  
  return createOptimizedSearchCache(options);
}

export async function createEnhancedTemplateCache(options = {}) {
  if (process.env.ENABLE_ENHANCED_CACHE === 'true') {
    try {
      const { EnhancedCacheFactory } = await import('./enhanced-cache-system.js');
      return EnhancedCacheFactory.createCache('templates', 'templates', {
        maxSize: envInt('TEMPLATE_CACHE_MAX_SIZE', 100),
        defaultTTL: envInt('TEMPLATE_CACHE_TTL', 900000),
        ...options
      });
    } catch (error) {
      log.warn('Enhanced cache system not available, falling back to optimized cache', { error: error.message });
    }
  }
  
  return createOptimizedTemplateCache(options);
}

/**
 * 기존 캐시 API와의 호환성을 위한 래퍼 함수들
 */
export function createFileCache(options = {}) {
  return createOptimizedFileCache(options);
}

export function createMetadataCache(options = {}) {
  return createOptimizedMetadataCache(options);
}

export function createSearchCache(options = {}) {
  return createOptimizedSearchCache(options);
}

export function createTemplateCache(options = {}) {
  return createOptimizedTemplateCache(options);
}

// 기존 MemoryCache 클래스는 호환성을 위해 유지하되, 내부적으로 OptimizedMemoryCache 사용
export const MemoryCache = OptimizedMemoryCache;

/**
 * 캐시 키 생성기 (기존 코드와 호환성 유지)
 */
export const CacheKeyGenerator = {
  // 테스트 호환성을 위한 키 생성
  list: (subdir = '') => subdir ? `list:${subdir}` : 'list:',
  file: (filename) => `file:${filename}`,
  metadata: (filename) => `meta:${filename}`,
  search: (query, options = {}) => {
    const optionsStr = Object.keys(options)
      .sort()
      .map(key => `${key}:${options[key]}`)
      .join(',');
    return `search:${query}:${optionsStr}`;
  },
  template: (filename, variables = {}) => {
    const varsStr = Object.keys(variables)
      .sort()
      .map(key => `${key}`)
      .join(',');
    return `template:${filename}:${varsStr}`;
  },
  version: (filename, version) => `version:${filename}:${version}`
};

/**
 * 서버용 캐시 키 생성기 (기존 서버 코드와 호환성 유지)
 */
export const ServerCacheKeyGenerator = {
  list: () => 'prompts:list',
  file: (filename) => `prompt:${filename}`,
  metadata: (filename) => `metadata:${filename}`,
  search: (query, options = {}) => {
    const optionsStr = Object.keys(options)
      .sort()
      .map(key => `${key}:${options[key]}`)
      .join(',');
    return `search:${query}:${optionsStr}`;
  }
};

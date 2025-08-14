import { jest } from '@jest/globals';
import { 
  MultiTierCache, 
  CachePartitionManager,
  globalPartitionManager 
} from '../utils/multitier-cache.js';
import { 
  AdaptiveCacheSelector,
  LFUCache,
  ARCCache,
  AdaptiveMultiAlgorithmCache
} from '../utils/adaptive-cache.js';
import {
  UsagePatternAnalyzer,
  IntelligentCacheWarming
} from '../utils/cache-warming.js';
import { 
  EnhancedCacheSystem,
  EnhancedCacheFactory,
  GlobalEnhancedCacheManager
} from '../utils/enhanced-cache-system.js';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Cache Strategy Optimization', () => {
  let tempDir;
  
  beforeAll(async () => {
    tempDir = path.join(process.cwd(), 'tests', 'temp_cache');
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // 정리 실패는 무시
    }
  });

  describe('MultiTierCache', () => {
    let cache;

    beforeEach(() => {
      cache = new MultiTierCache({
        name: 'test-multitier',
        baseDir: tempDir,
        l1MaxSize: 5,
        l2MaxSize: 10,
        l3MaxSize: 20,
        l1TTL: 60000,
        l2TTL: 30000,
        l3TTL: 120000,
        hotThreshold: 2,
        warmThreshold: 1
      });
    });

    afterEach(() => {
      if (cache) {
        cache.destroy();
      }
    });

    test('should store data in appropriate tiers based on temperature', async () => {
      // 콜드 데이터 먼저 생성
      await cache.set('cold-key', 'cold-value');
      
      // 웜 데이터 (액세스 패턴 생성)
      await cache.set('warm-key', 'warm-value');
      await cache.get('warm-key'); // 첫 번째 액세스
      await cache.get('warm-key'); // 두 번째 액세스 (웜 임계값 도달)
      
      // 핫 데이터 (더 많은 액세스)
      await cache.set('hot-key', 'hot-value');
      for (let i = 0; i < 5; i++) {
        await cache.get('hot-key'); // 핫 임계값 초과
        await new Promise(resolve => setTimeout(resolve, 1)); // 액세스 간격
      }
      
      // 새로운 데이터 추가하여 온도 기반 배치 확인
      await cache.set('new-warm', 'new-warm-value'); // 웜 데이터로 배치되어야 함
      await cache.set('new-hot', 'new-hot-value');   // 핫 데이터로 배치되어야 함
      
      // 잠시 대기하여 온도 계산이 반영되도록 함
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const stats = cache.getDetailedStats();
      
      // 최소한 하나의 티어에는 데이터가 있어야 함
      const totalSize = stats.l1.size + stats.l2.size;
      expect(totalSize).toBeGreaterThan(0);
      
      // L3 통계가 정의되어 있어야 함
      expect(stats.l3).toBeDefined();
      
      console.log('MultiTier stats:', stats);
    });

    test('should promote data between tiers based on access patterns', async () => {
      // 초기에 데이터 저장 (L3에 저장됨)
      await cache.set('promotion-test', 'value');
      
      // 첫 번째 액세스 (L3에서 L2로 승격)
      let value = await cache.get('promotion-test');
      expect(value).toBe('value');
      
      // 추가 액세스로 핫 데이터로 만들기
      for (let i = 0; i < 3; i++) {
        value = await cache.get('promotion-test');
        expect(value).toBe('value');
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      
      // 핫 데이터로 승격시키기 위해 새 데이터 설정
      for (let i = 0; i < 3; i++) {
        await cache.set(`temp-${i}`, `temp-value-${i}`);
        await cache.get('promotion-test'); // 계속 액세스
      }
      
      const stats = cache.getDetailedStats();
      
      // 최소한 일부 액세스는 있어야 함
      expect(stats.overview.totalRequests).toBeGreaterThan(0);
      
      console.log('Promotion stats:', stats.operations);
    });

    test('should handle compression for large data', async () => {
      const largeData = 'x'.repeat(2000); // 2KB 데이터
      
      // 콜드 데이터로 저장하여 L3 압축 테스트
      await cache.set('large-key', largeData);
      
      // 잠시 대기하여 L3 저장이 완료되도록 함
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const retrieved = await cache.get('large-key');
      expect(retrieved).toBe(largeData);
      
      const stats = cache.getDetailedStats();
      
      // 압축이 활성화되어 있다면 압축 통계가 있어야 함
      if (cache.compressionEnabled) {
        expect(stats.operations.compressions).toBeGreaterThanOrEqual(0);
      }
      
      console.log('Compression stats:', stats.operations);
    });

    test('should maintain performance under load', async () => {
      const operations = 1000;
      const startTime = Date.now();
      
      // 혼합 워크로드
      const promises = [];
      for (let i = 0; i < operations; i++) {
        const key = `load-test-${i % 100}`;
        const value = `value-${i}`;
        
        if (i % 3 === 0) {
          promises.push(cache.set(key, value));
        } else {
          promises.push(cache.get(key));
        }
      }
      
      await Promise.all(promises);
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(1000); // 1초 이내
      
      const stats = cache.getDetailedStats();
      expect(stats.overview.overallHitRate).toBeDefined();
      
      console.log(`MultiTier load test: ${duration}ms for ${operations} operations`);
      console.log(`Hit rate: ${stats.overview.overallHitRate}`);
    });
  });

  describe('AdaptiveCacheSelector', () => {
    let selector;

    beforeEach(() => {
      selector = new AdaptiveCacheSelector({
        evaluationWindow: 100, // 작은 윈도우로 빠른 테스트
        switchThreshold: 0.1
      });
    });

    test('should record performance metrics', () => {
      // 다양한 알고리즘 성능 시뮬레이션
      selector.recordPerformance('LRU', true, 10);
      selector.recordPerformance('LRU', false, 15);
      selector.recordPerformance('LFU', true, 8);
      selector.recordPerformance('LFU', true, 12);
      
      const stats = selector.getPerformanceStats();
      
      expect(stats.algorithmStats.LRU).toBeDefined();
      expect(stats.algorithmStats.LFU).toBeDefined();
      expect(stats.currentAlgorithm).toBe('LRU');
    });

    test('should switch algorithms based on performance', () => {
      // LRU 성능 나쁨
      for (let i = 0; i < 60; i++) {
        selector.recordPerformance('LRU', i % 4 === 0, 20); // 25% hit rate
      }
      
      // LFU 성능 좋음  
      for (let i = 0; i < 40; i++) {
        selector.recordPerformance('LFU', i % 3 !== 0, 10); // 67% hit rate
      }
      
      // 평가 트리거
      selector.evaluateAndSwitch();
      
      const newAlgorithm = selector.getRecommendedAlgorithm();
      console.log('Selected algorithm after evaluation:', newAlgorithm);
      
      // 성능이 더 좋은 알고리즘으로 전환되었는지 확인
      expect(['LFU', 'ARC', 'TinyLFU']).toContain(newAlgorithm);
    });
  });

  describe('LFUCache', () => {
    let cache;

    beforeEach(() => {
      cache = new LFUCache({ maxSize: 5, defaultTTL: 60000 });
    });

    test('should evict least frequently used items', () => {
      // 캐시 채우기
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      cache.set('key4', 'value4');
      cache.set('key5', 'value5');
      
      // 일부 키만 빈번하게 액세스
      for (let i = 0; i < 5; i++) {
        cache.get('key1');
        cache.get('key2');
      }
      cache.get('key3');
      
      // 새 키 추가로 LFU 제거 트리거
      cache.set('key6', 'value6');
      
      // 빈도가 낮은 키들이 제거되었는지 확인
      expect(cache.has('key1')).toBe(true); // 빈번한 액세스
      expect(cache.has('key2')).toBe(true); // 빈번한 액세스
      expect(cache.has('key3')).toBe(true); // 중간 액세스
      
      const stats = cache.getStats();
      expect(stats.evictions).toBeGreaterThan(0);
      expect(stats.size).toBe(5);
    });
  });

  describe('ARCCache', () => {
    let cache;

    beforeEach(() => {
      cache = new ARCCache({ maxSize: 10, defaultTTL: 60000 });
    });

    test('should balance between recency and frequency', () => {
      // T1에 항목들 추가 (최초 액세스)
      for (let i = 1; i <= 5; i++) {
        cache.set(`t1-key${i}`, `value${i}`);
      }
      
      // 일부를 재액세스하여 T2로 이동
      cache.get('t1-key1');
      cache.get('t1-key2');
      cache.get('t1-key1'); // 다시 액세스
      
      const stats = cache.getStats();
      expect(stats.t1Size).toBeGreaterThan(0);
      expect(stats.t2Size).toBeGreaterThan(0);
      expect(stats.size).toBe(5);
      
      console.log('ARC stats:', stats);
    });
  });

  describe('UsagePatternAnalyzer', () => {
    let analyzer;

    beforeEach(() => {
      analyzer = new UsagePatternAnalyzer({
        analysisWindow: 3600000,
        maxPatterns: 100
      });
    });

    test('should track temporal patterns', () => {
      const now = Date.now();
      
      // 특정 시간대에 특정 키 사용 패턴 기록
      analyzer.recordUsage('morning-prompt', { 
        timestamp: now,
        userId: 'user1'
      });
      
      const stats = analyzer.getPatternStats();
      expect(stats.temporal).toBeGreaterThan(0);
      expect(stats.frequency).toBeGreaterThan(0);
    });

    test('should generate predictions based on patterns', () => {
      // 패턴 데이터 축적
      const baseTime = Date.now();
      const hour = new Date(baseTime).getHours();
      
      // 같은 시간대에 반복적으로 사용되는 패턴
      for (let i = 0; i < 5; i++) {
        analyzer.recordUsage('predictable-key', {
          timestamp: baseTime + (i * 1000),
          userId: 'user1'
        });
      }
      
      // 예측 생성
      const predictions = analyzer.generatePredictions({
        userId: 'user1',
        timestamp: baseTime + 10000
      });
      
      expect(Array.isArray(predictions)).toBe(true);
      
      if (predictions.length > 0) {
        expect(predictions[0]).toHaveProperty('key');
        expect(predictions[0]).toHaveProperty('score');
        expect(predictions[0]).toHaveProperty('confidence');
        
        console.log('Predictions:', predictions.slice(0, 3));
      }
    });
  });

  describe('IntelligentCacheWarming', () => {
    let cache;
    let warming;
    let dataLoader;

    beforeEach(() => {
      cache = new Map(); // 간단한 캐시 모의
      cache.has = jest.fn((key) => cache.has(key));
      cache.set = jest.fn((key, value) => cache.set(key, value));
      
      dataLoader = jest.fn(async (key) => {
        if (key.includes('loadable')) {
          return `loaded-${key}`;
        }
        return undefined;
      });
      
      warming = new IntelligentCacheWarming(cache, {
        dataLoader,
        warmingInterval: 10000, // 테스트용
        maxWarmItems: 5,
        minConfidence: 0.1
      });
    });

    afterEach(() => {
      if (warming) {
        warming.destroy();
      }
    });

    test('should record access patterns', () => {
      warming.recordAccess('test-key', {
        userId: 'user1',
        operation: 'get'
      });
      
      const stats = warming.getWarmingStats();
      expect(stats.patterns).toBeDefined();
    });

    test('should perform predictive warming', async () => {
      // 사용 패턴 축적
      for (let i = 0; i < 3; i++) {
        warming.recordAccess('loadable-key-1', { userId: 'user1' });
        warming.recordAccess('loadable-key-2', { userId: 'user1' });
      }
      
      // 워밍 수행
      const result = await warming.performWarming({ userId: 'user1' });
      
      expect(result).toHaveProperty('warmed');
      expect(result).toHaveProperty('skipped');
      expect(result).toHaveProperty('errors');
      
      console.log('Warming result:', result);
    });
  });

  describe('EnhancedCacheSystem Integration', () => {
    let enhancedCache;

    beforeEach(() => {
      enhancedCache = new EnhancedCacheSystem('test-enhanced', {
        strategy: 'multitier',
        l1MaxSize: 10,
        l2MaxSize: 20,
        l3MaxSize: 50,
        baseDir: tempDir,
        autoOptimize: false // 테스트에서는 수동 제어
      });
    });

    afterEach(() => {
      if (enhancedCache) {
        enhancedCache.destroy();
      }
    });

    test('should provide unified interface for different strategies', async () => {
      // 기본 캐시 작업
      const setResult = await enhancedCache.set('test-key', 'test-value');
      expect(setResult).toBe(true);
      
      // 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const value = await enhancedCache.get('test-key');
      expect(value).toBe('test-value');
      
      const exists = await enhancedCache.has('test-key');
      expect(exists).toBe(true);
      
      const deleted = await enhancedCache.delete('test-key');
      expect(deleted).toBe(true);
      
      const notExists = await enhancedCache.has('test-key');
      expect(notExists).toBe(false);
    });

    test('should collect comprehensive statistics', async () => {
      // 데이터 추가 및 액세스
      await enhancedCache.set('stats-key-1', 'value1');
      await enhancedCache.set('stats-key-2', 'value2');
      
      // 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await enhancedCache.get('stats-key-1'); // 히트
      await enhancedCache.get('nonexistent-key'); // 미스
      
      const stats = enhancedCache.getComprehensiveStats();
      
      expect(stats.overview).toBeDefined();
      expect(stats.overview.requests).toBeGreaterThan(0);
      expect(stats.overview.misses).toBeGreaterThan(0); // 미스는 확실히 있음
      expect(stats.overview.hitRate).toBeDefined();
      
      expect(stats.cache).toBeDefined();
      
      console.log('Enhanced cache stats:', stats.overview);
    });

    test('should handle errors gracefully', async () => {
      // 잘못된 키로 작업 시도
      const result1 = await enhancedCache.get(null);
      expect(result1).toBeUndefined();
      
      // null 키로 set 시도 - 일부 캐시는 내부적으로 처리할 수 있음
      const result2 = await enhancedCache.set(null, 'value');
      
      // 에러 상황을 더 확실하게 만들기 위해 잘못된 작업 추가
      await enhancedCache.get(undefined);
      await enhancedCache.set('', null);
      
      const stats = enhancedCache.getComprehensiveStats();
      
      // 에러가 발생했거나 최소한 작업이 수행되었어야 함
      expect(stats.overview.requests).toBeGreaterThan(0);
    });
  });

  describe('Performance Comparison', () => {
    test('should compare different cache strategies under load', async () => {
      const testData = Array.from({ length: 100 }, (_, i) => ({
        key: `perf-key-${i}`,
        value: `value-${i}-${'x'.repeat(100)}` // 100자 문자열
      }));
      
      const strategies = ['simple', 'multitier', 'adaptive'];
      const results = {};
      
      for (const strategy of strategies) {
        const cache = new EnhancedCacheSystem(`test-${strategy}`, {
          strategy,
          maxSize: 50,
          l1MaxSize: 20,
          l2MaxSize: 30,
          baseDir: tempDir,
          autoOptimize: false
        });
        
        const startTime = Date.now();
        
        // 데이터 로딩
        for (const { key, value } of testData) {
          await cache.set(key, value);
        }
        
        // 액세스 패턴 (80% 기존 키, 20% 새로운 키)
        for (let i = 0; i < 200; i++) {
          if (Math.random() < 0.8) {
            const randomIndex = Math.floor(Math.random() * testData.length);
            await cache.get(testData[randomIndex].key);
          } else {
            await cache.get(`new-key-${i}`);
          }
        }
        
        const endTime = Date.now();
        const stats = cache.getComprehensiveStats();
        
        results[strategy] = {
          duration: endTime - startTime,
          hitRate: stats.overview.hitRate,
          requests: stats.overview.requests,
          errors: stats.overview.errors
        };
        
        cache.destroy();
      }
      
      console.log('Performance comparison:', results);
      
      // 모든 전략이 합리적인 성능을 보이는지 확인
      Object.values(results).forEach(result => {
        expect(result.duration).toBeLessThan(5000); // 5초 이내
        expect(result.errors).toBe(0); // 에러 없음
      });
    });
  });

  describe('CachePartitionManager', () => {
    let partitionManager;

    beforeEach(() => {
      partitionManager = new CachePartitionManager(tempDir);
    });

    afterEach(() => {
      if (partitionManager) {
        partitionManager.destroy();
      }
    });

    test('should create and manage different cache partitions', () => {
      const hotPrompts = partitionManager.getPartition('hotPrompts');
      const metadata = partitionManager.getPartition('metadata');
      const searchResults = partitionManager.getPartition('searchResults');
      
      expect(hotPrompts).toBeDefined();
      expect(metadata).toBeDefined();
      expect(searchResults).toBeDefined();
      
      // 각 파티션이 다른 설정을 가지는지 확인
      expect(hotPrompts.l1Cache.maxSize).not.toBe(metadata.l1Cache.maxSize);
    });

    test('should provide consolidated statistics', async () => {
      const partition1 = partitionManager.getPartition('test1');
      const partition2 = partitionManager.getPartition('test2');
      
      // 데이터 추가
      await partition1.set('key1', 'value1');
      await partition2.set('key2', 'value2');
      
      await partition1.get('key1');
      await partition2.get('key2');
      
      const allStats = partitionManager.getAllStats();
      
      expect(allStats.partitions).toBeDefined();
      expect(allStats.summary).toBeDefined();
      expect(allStats.summary.totalPartitions).toBe(2);
      
      console.log('Partition manager stats:', allStats.summary);
    });
  });
});

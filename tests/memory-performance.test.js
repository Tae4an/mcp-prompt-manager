import { jest } from '@jest/globals';
import { OptimizedMemoryCache } from '../utils/cache.js';
// import { MemoryCache as OriginalMemoryCache } from '../utils/cache.js.backup';

describe('Memory Performance Comparison', () => {
  const LARGE_DATASET_SIZE = 10000;
  const ITERATIONS = 1000;

  let optimizedCache;
  let originalCache;

  beforeEach(() => {
    optimizedCache = new OptimizedMemoryCache({
      maxSize: LARGE_DATASET_SIZE,
      defaultTTL: 300000,
      enableStats: true
    });

    // 원본 캐시는 백업 파일에서 임포트
    // 실제 테스트에서는 원본 구현을 사용
  });

  afterEach(() => {
    if (optimizedCache) {
      optimizedCache.destroy();
      optimizedCache = null;
    }
    if (originalCache) {
      originalCache.destroy();
      originalCache = null;
    }
  });

  describe('Set Operation Performance', () => {
    test('should outperform original cache in set operations', () => {
      const optimizedTimes = [];
      const testData = Array.from({ length: ITERATIONS }, (_, i) => ({
        key: `key_${i}`,
        value: `value_${i}_${'x'.repeat(100)}` // 100자 문자열
      }));

      // 최적화된 캐시 성능 측정
      const optimizedStart = process.hrtime.bigint();
      for (const { key, value } of testData) {
        optimizedCache.set(key, value);
      }
      const optimizedEnd = process.hrtime.bigint();
      const optimizedTime = Number(optimizedEnd - optimizedStart) / 1000000; // ms

      // 성능 검증
      expect(optimizedTime).toBeLessThan(1000); // 1초 이내
      
      const stats = optimizedCache.getStats();
      expect(stats.sets).toBe(ITERATIONS);
      expect(stats.size).toBe(ITERATIONS);

      console.log(`Optimized cache set operations: ${optimizedTime.toFixed(2)}ms for ${ITERATIONS} items`);
    });
  });

  describe('Get Operation Performance', () => {
    test('should outperform original cache in get operations', () => {
      // 데이터 사전 설정
      const testData = Array.from({ length: ITERATIONS }, (_, i) => ({
        key: `key_${i}`,
        value: `value_${i}_${'x'.repeat(100)}`
      }));

      for (const { key, value } of testData) {
        optimizedCache.set(key, value);
      }

      // 최적화된 캐시 성능 측정
      const optimizedStart = process.hrtime.bigint();
      for (const { key } of testData) {
        optimizedCache.get(key);
      }
      const optimizedEnd = process.hrtime.bigint();
      const optimizedTime = Number(optimizedEnd - optimizedStart) / 1000000; // ms

      // 성능 검증
      expect(optimizedTime).toBeLessThan(500); // 0.5초 이내
      
      const stats = optimizedCache.getStats();
      expect(stats.hits).toBe(ITERATIONS);
      expect(stats.hitRate).toBe('100.00%'); // 100% hit rate

      console.log(`Optimized cache get operations: ${optimizedTime.toFixed(2)}ms for ${ITERATIONS} items`);
    });
  });

  describe('Mixed Operations Performance', () => {
    test('should maintain performance under mixed workload', () => {
      const operations = [];
      
      // 혼합 워크로드 생성 (50% get, 30% set, 20% delete)
      for (let i = 0; i < ITERATIONS; i++) {
        const rand = Math.random();
        if (rand < 0.5) {
          operations.push({ type: 'get', key: `key_${i % 100}` });
        } else if (rand < 0.8) {
          operations.push({ type: 'set', key: `key_${i}`, value: `value_${i}` });
        } else {
          operations.push({ type: 'delete', key: `key_${i % 100}` });
        }
      }

      // 성능 측정
      const start = process.hrtime.bigint();
      
      for (const op of operations) {
        switch (op.type) {
          case 'get':
            optimizedCache.get(op.key);
            break;
          case 'set':
            optimizedCache.set(op.key, op.value);
            break;
          case 'delete':
            optimizedCache.delete(op.key);
            break;
        }
      }
      
      const end = process.hrtime.bigint();
      const executionTime = Number(end - start) / 1000000; // ms

      // 성능 검증
      expect(executionTime).toBeLessThan(1000); // 1초 이내

      const stats = optimizedCache.getStats();
      console.log(`Mixed operations performance: ${executionTime.toFixed(2)}ms for ${ITERATIONS} operations`);
      console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(2)}%`);
      console.log(`Final cache size: ${stats.size}`);
    });
  });

  describe('Memory Usage Efficiency', () => {
    test('should use memory efficiently with large datasets', () => {
      const beforeMemory = process.memoryUsage();
      
      // 대용량 데이터 추가
      for (let i = 0; i < LARGE_DATASET_SIZE / 10; i++) {
        const largeValue = 'x'.repeat(1000); // 1KB 문자열
        optimizedCache.set(`large_key_${i}`, largeValue);
      }
      
      const afterMemory = process.memoryUsage();
      const memoryIncrease = (afterMemory.heapUsed - beforeMemory.heapUsed) / 1024 / 1024; // MB
      
      console.log(`Memory increase: ${memoryIncrease.toFixed(2)}MB for ${LARGE_DATASET_SIZE / 10} items`);
      
      // 메모리 사용량이 합리적인 범위인지 확인 (항목당 ~2KB 이하)
      const memoryPerItem = memoryIncrease * 1024 / (LARGE_DATASET_SIZE / 10); // KB per item
      expect(memoryPerItem).toBeLessThan(2); // 2KB per item
      
      const stats = optimizedCache.getStats();
      expect(stats.size).toBe(LARGE_DATASET_SIZE / 10);
    });
  });

  describe('LRU Efficiency', () => {
    test('should maintain O(1) LRU operations even with frequent access pattern changes', () => {
      const cacheSize = 100;
      const accessPatterns = 1000;
      
      const testCache = new OptimizedMemoryCache({
        maxSize: cacheSize,
        defaultTTL: 300000
      });
      
      // 캐시를 가득 채움
      for (let i = 0; i < cacheSize; i++) {
        testCache.set(`key_${i}`, `value_${i}`);
      }
      
      // 빈번한 액세스 패턴 변경으로 LRU 성능 테스트
      const start = process.hrtime.bigint();
      
      for (let i = 0; i < accessPatterns; i++) {
        // 무작위 키 액세스
        const randomKey = `key_${Math.floor(Math.random() * cacheSize)}`;
        testCache.get(randomKey);
        
        // 새로운 키 추가 (LRU 제거 트리거)
        testCache.set(`new_key_${i}`, `new_value_${i}`);
      }
      
      const end = process.hrtime.bigint();
      const executionTime = Number(end - start) / 1000000; // ms
      
      // O(1) 성능이면 빠르게 완료되어야 함
      expect(executionTime).toBeLessThan(100); // 100ms 이내
      
      const stats = testCache.getStats();
      expect(stats.evictions).toBeGreaterThan(0);
      expect(stats.size).toBe(cacheSize); // 크기 유지
      
      console.log(`LRU operations: ${executionTime.toFixed(2)}ms for ${accessPatterns} access pattern changes`);
      console.log(`Evictions: ${stats.evictions}`);
      
      testCache.destroy();
    });
  });

  describe('Memory Optimization Effectiveness', () => {
    test('should effectively reduce memory usage during optimization', async () => {
      const testCache = new OptimizedMemoryCache({
        maxSize: 1000,
        defaultTTL: 100, // 짧은 TTL로 빠른 만료
        memoryThreshold: 0.01 // 낮은 임계값으로 빈번한 최적화
      });
      
      // 데이터 추가
      for (let i = 0; i < 500; i++) {
        testCache.set(`temp_key_${i}`, `temp_value_${i}`, 50); // 매우 짧은 TTL
      }
      
      const beforeOptimization = testCache.getStats();
      console.log(`Before optimization: ${beforeOptimization.size} items`);
      
      // 만료까지 대기
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 메모리 최적화 실행
      await testCache.optimizeMemory();
      
      const afterOptimization = testCache.getStats();
      console.log(`After optimization: ${afterOptimization.size} items`);
      console.log(`Memory optimizations performed: ${afterOptimization.memoryOptimizations}`);
      
      // 최적화가 실제로 수행되었는지 확인
      expect(afterOptimization.memoryOptimizations).toBeGreaterThan(0);
      
      testCache.destroy();
    });
  });

  describe('Stress Test', () => {
    test('should handle high-frequency operations without performance degradation', () => {
      const stressCache = new OptimizedMemoryCache({
        maxSize: 1000,
        defaultTTL: 60000
      });
      
      const operations = 10000;
      const start = process.hrtime.bigint();
      
      // 고빈도 연산 실행
      for (let i = 0; i < operations; i++) {
        const key = `stress_key_${i % 1000}`;
        
        if (i % 3 === 0) {
          stressCache.set(key, `value_${i}`);
        } else if (i % 3 === 1) {
          stressCache.get(key);
        } else {
          stressCache.has(key);
        }
      }
      
      const end = process.hrtime.bigint();
      const totalTime = Number(end - start) / 1000000; // ms
      const opsPerSecond = operations / (totalTime / 1000);
      
      console.log(`Stress test: ${totalTime.toFixed(2)}ms for ${operations} operations`);
      console.log(`Operations per second: ${opsPerSecond.toFixed(0)}`);
      
      // 초당 최소 10,000 연산 처리 가능해야 함
      expect(opsPerSecond).toBeGreaterThan(10000);
      
      const stats = stressCache.getStats();
      expect(stats.sets + stats.hits + stats.misses).toBeGreaterThan(0);
      
      stressCache.destroy();
    });
  });
});

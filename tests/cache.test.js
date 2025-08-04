import { jest } from '@jest/globals';
import { MemoryCache, CacheKeyGenerator } from '../utils/cache.js';

describe('MemoryCache', () => {
  let cache;

  beforeEach(() => {
    cache = new MemoryCache({
      maxSize: 5,
      defaultTTL: 1000, // 1초 (테스트용)
      cleanupInterval: 500 // 0.5초 (테스트용)
    });
  });

  afterEach(() => {
    if (cache) {
      cache.destroy();
    }
  });

  describe('Basic Operations', () => {
    test('should set and get values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    test('should return undefined for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    test('should check if key exists', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });

    test('should delete keys', () => {
      cache.set('key1', 'value1');
      expect(cache.delete('key1')).toBe(true);
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.delete('nonexistent')).toBe(false);
    });

    test('should clear all keys', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      
      const cleared = cache.clear();
      expect(cleared).toBe(2);
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
    });
  });

  describe('TTL (Time To Live)', () => {
    test('should expire keys after TTL', async () => {
      cache.set('key1', 'value1', 500); // 0.5초 TTL
      
      expect(cache.get('key1')).toBe('value1');
      
      // TTL 후 대기
      await new Promise(resolve => setTimeout(resolve, 600));
      
      expect(cache.get('key1')).toBeUndefined();
    });

    test('should use default TTL when not specified', async () => {
      cache.set('key1', 'value1'); // 기본 TTL 사용
      
      expect(cache.get('key1')).toBe('value1');
      
      // 기본 TTL 후 대기
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      expect(cache.get('key1')).toBeUndefined();
    });

    test('should update TTL with touch', async () => {
      cache.set('key1', 'value1', 500);
      
      // TTL 갱신
      const touched = cache.touch('key1', 2000);
      expect(touched).toBe(true);
      
      // 기존 TTL 시간 후에도 존재해야 함
      await new Promise(resolve => setTimeout(resolve, 600));
      expect(cache.get('key1')).toBe('value1');
    });
  });

  describe('LRU (Least Recently Used)', () => {
    test('should evict least recently used items when full', () => {
      // 캐시를 가득 채움
      for (let i = 1; i <= 5; i++) {
        cache.set(`key${i}`, `value${i}`);
      }
      
      // 새 항목 추가 (가장 오래된 항목이 제거되어야 함)
      cache.set('key6', 'value6');
      
      expect(cache.get('key1')).toBeUndefined(); // 제거됨
      expect(cache.get('key6')).toBe('value6'); // 새로 추가됨
    });

    test('should update LRU order on access', () => {
      // 캐시를 가득 채움
      for (let i = 1; i <= 5; i++) {
        cache.set(`key${i}`, `value${i}`);
      }
      
      // key1 접근하여 LRU 순서 변경
      cache.get('key1');
      
      // 새 항목 추가 (key2가 제거되어야 함)
      cache.set('key6', 'value6');
      
      expect(cache.get('key1')).toBe('value1'); // 접근했으므로 유지
      expect(cache.get('key2')).toBeUndefined(); // 제거됨
    });
  });

  describe('Pattern Operations', () => {
    test('should delete keys matching pattern', () => {
      cache.set('user:1', 'data1');
      cache.set('user:2', 'data2');
      cache.set('post:1', 'data3');
      
      const deleted = cache.deletePattern('^user:');
      expect(deleted).toBe(2);
      
      expect(cache.get('user:1')).toBeUndefined();
      expect(cache.get('user:2')).toBeUndefined();
      expect(cache.get('post:1')).toBe('data3');
    });
  });

  describe('Cleanup', () => {
    test('should clean up expired items', async () => {
      cache.set('key1', 'value1', 300);  // 0.3초 TTL
      cache.set('key2', 'value2', 2000); // 2초 TTL
      
      // 0.4초 대기 (key1만 만료)
      await new Promise(resolve => setTimeout(resolve, 400));
      
      const cleaned = cache.cleanup();
      expect(cleaned).toBeGreaterThanOrEqual(1);
      
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBe('value2');
    });

    test('should automatically cleanup expired items', async () => {
      cache.set('key1', 'value1', 300); // 0.3초 TTL
      
      // 자동 정리 주기 대기 (0.5초)
      await new Promise(resolve => setTimeout(resolve, 800));
      
      expect(cache.get('key1')).toBeUndefined();
    });
  });

  describe('Statistics', () => {
    test('should track cache statistics', () => {
      cache.set('key1', 'value1');
      cache.get('key1'); // hit
      cache.get('nonexistent'); // miss
      
      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.sets).toBe(1);
      expect(stats.size).toBe(1);
      expect(stats.hitRate).toBe('50.00%');
    });

    test('should estimate memory usage', () => {
      cache.set('key1', 'value1');
      cache.set('key2', { data: 'complex object' });
      
      const stats = cache.getStats();
      expect(stats.memoryUsage.bytes).toBeGreaterThan(0);
      expect(stats.memoryUsage.mb).toBeTruthy();
    });
  });

  describe('Metadata', () => {
    test('should provide metadata for cached items', () => {
      cache.set('key1', 'value1');
      
      const metadata = cache.getMetadata('key1');
      expect(metadata).toBeTruthy();
      expect(metadata.createdAt).toBeInstanceOf(Date);
      expect(metadata.lastAccessed).toBeInstanceOf(Date);
      expect(metadata.accessCount).toBe(0);
      expect(metadata.ttl).toBeGreaterThan(0);
    });

    test('should update access count', () => {
      cache.set('key1', 'value1');
      
      cache.get('key1');
      cache.get('key1');
      
      const metadata = cache.getMetadata('key1');
      expect(metadata.accessCount).toBe(2);
    });
  });

  describe('Key Management', () => {
    test('should list all keys', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      
      const keys = cache.keys();
      expect(keys).toEqual(['key1', 'key2']);
    });

    test('should provide cache info', () => {
      const info = cache.getInfo();
      expect(info.type).toBe('MemoryCache');
      expect(info.maxSize).toBe(5);
      expect(info.defaultTTL).toBe(1000);
    });
  });
});

describe('CacheKeyGenerator', () => {
  test('should generate correct file keys', () => {
    expect(CacheKeyGenerator.file('test.txt')).toBe('file:test.txt');
  });

  test('should generate correct metadata keys', () => {
    expect(CacheKeyGenerator.metadata('test.txt')).toBe('meta:test.txt');
  });

  test('should generate correct search keys', () => {
    const key = CacheKeyGenerator.search('query', { option: 'value' });
    expect(key).toContain('search:query:');
    expect(key).toContain('option');
  });

  test('should generate correct template keys', () => {
    const key = CacheKeyGenerator.template('template.txt', { var: 'value' });
    expect(key).toContain('template:template.txt:');
    expect(key).toContain('var');
  });

  test('should generate correct version keys', () => {
    expect(CacheKeyGenerator.version('test.txt', 1)).toBe('version:test.txt:1');
  });

  test('should generate correct list keys', () => {
    expect(CacheKeyGenerator.list()).toBe('list:');
    expect(CacheKeyGenerator.list('subdir')).toBe('list:subdir');
  });
});
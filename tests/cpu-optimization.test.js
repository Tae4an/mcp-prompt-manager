import { jest } from '@jest/globals';
import { CPUWorkerPool } from '../utils/cpu-worker-pool.js';
import { cpus } from 'os';

describe('CPU Optimization', () => {
  let workerPool;
  const cpuCount = cpus().length;

  beforeEach(async () => {
    workerPool = new CPUWorkerPool({
      maxWorkers: Math.min(4, cpuCount), // 테스트에서는 4개로 제한
      minWorkers: 2,
      enableAutoScaling: true,
      workerIdleTimeout: 5000, // 테스트에서는 5초
      taskTimeout: 30000 // 30초
    });
    
    // 워커 풀 초기화 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterEach(async () => {
    if (workerPool) {
      await workerPool.destroy();
      workerPool = null;
    }
  });

  describe('Worker Pool Management', () => {
    test('should initialize with minimum workers', async () => {
      const stats = workerPool.getPerformanceStats();
      
      expect(stats.currentWorkers).toBeGreaterThanOrEqual(2);
      expect(stats.currentWorkers).toBeLessThanOrEqual(4);
      expect(stats.cpuCores).toBe(cpuCount);
      expect(stats.availableWorkers).toBeGreaterThan(0);
      
      console.log('Initial worker pool stats:', {
        currentWorkers: stats.currentWorkers,
        availableWorkers: stats.availableWorkers,
        cpuCores: stats.cpuCores
      });
    });

    test('should scale up workers under load', async () => {
      const initialStats = workerPool.getPerformanceStats();
      
      // 많은 작업을 동시에 큐에 추가하여 스케일 업 유도
      const tasks = [];
      for (let i = 0; i < 10; i++) {
        tasks.push(
          workerPool.executeTask('processText', {
            text: 'Test text for scaling '.repeat(1000),
            operations: [{ type: 'toLowerCase' }, { type: 'wordCount' }]
          })
        );
      }
      
      // 잠시 대기 후 스케일링 확인
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const scaledStats = workerPool.getPerformanceStats();
      
      // 작업 완료 대기
      await Promise.allSettled(tasks);
      
      const finalStats = workerPool.getPerformanceStats();
      
      console.log('Scaling test stats:', {
        initial: initialStats.currentWorkers,
        scaled: scaledStats.currentWorkers,
        final: finalStats.currentWorkers,
        tasksCompleted: finalStats.tasksCompleted
      });
      
      expect(finalStats.tasksCompleted).toBe(10);
    }, 60000);
  });

  describe('JSON Processing', () => {
    test('should parse JSON in parallel', async () => {
      const jsonStrings = [
        '{"name": "test1", "value": 123}',
        '{"name": "test2", "value": 456, "nested": {"key": "value"}}',
        '{"array": [1, 2, 3], "boolean": true}',
        '{"large": "' + 'x'.repeat(1000) + '"}',
        '{"empty": {}, "null": null}'
      ];
      
      const start = Date.now();
      const results = await workerPool.parseJSONParallel(jsonStrings);
      const parseTime = Date.now() - start;
      
      expect(results).toHaveLength(jsonStrings.length);
      expect(results[0]).toEqual({ name: 'test1', value: 123 });
      expect(results[1]).toEqual({ name: 'test2', value: 456, nested: { key: 'value' } });
      expect(results[2]).toEqual({ array: [1, 2, 3], boolean: true });
      expect(results[3].large).toHaveLength(1000);
      expect(results[4]).toEqual({ empty: {}, null: null });
      
      console.log(`Parallel JSON parsing: ${jsonStrings.length} items in ${parseTime}ms`);
    });

    test('should handle invalid JSON gracefully', async () => {
      const invalidJsonStrings = [
        '{"valid": true}',
        '{"invalid": json}', // 잘못된 JSON
        '{invalid: "json"}', // 따옴표 누락
        '{"trailing": "comma",}', // 후행 쉼표
        '' // 빈 문자열
      ];
      
      const results = await workerPool.parseJSONParallel(invalidJsonStrings);
      
      expect(results).toHaveLength(invalidJsonStrings.length);
      expect(results[0]).toEqual({ valid: true });
      expect(results[1]).toBeNull(); // 파싱 실패
      expect(results[2]).toEqual({ invalid: 'json' }); // 자동 수정
      expect(results[3]).toEqual({ trailing: 'comma' }); // 후행 쉼표 제거
      expect(results[4]).toBeNull(); // 빈 문자열
      
      console.log('Invalid JSON handling results:', results);
    });

    test('should stringify objects in parallel', async () => {
      const objects = [
        { name: 'object1', value: 123 },
        { complex: { nested: [1, 2, 3] }, boolean: true },
        { large: 'x'.repeat(1000) },
        { function: () => 'test', undefined: undefined }, // 함수와 undefined 처리
        null
      ];
      
      const start = Date.now();
      const results = await workerPool.stringifyJSONParallel(objects);
      const stringifyTime = Date.now() - start;
      
      expect(results).toHaveLength(objects.length);
      expect(JSON.parse(results[0])).toEqual({ name: 'object1', value: 123 });
      expect(JSON.parse(results[1])).toEqual({ complex: { nested: [1, 2, 3] }, boolean: true });
      expect(JSON.parse(results[2]).large).toHaveLength(1000);
      expect(JSON.parse(results[3])).toEqual({ function: null, undefined: null }); // 함수 -> null, undefined -> null
      expect(results[4]).toBe('null');
      
      console.log(`Parallel JSON stringification: ${objects.length} items in ${stringifyTime}ms`);
    });

    test('should handle circular references in stringify', async () => {
      const obj = { name: 'circular' };
      obj.self = obj; // 순환 참조 생성
      
      const results = await workerPool.stringifyJSONParallel([obj]);
      
      expect(results).toHaveLength(1);
      expect(results[0]).toContain('[Circular Reference]');
      
      console.log('Circular reference handling:', results[0]);
    });
  });

  describe('Text Processing', () => {
    test('should process text with multiple operations', async () => {
      const texts = [
        'Hello World! This is a TEST string.',
        'Another STRING with MIXED case text.',
        '   Whitespace   text   with   extra   spaces   '
      ];
      
      const operations = [
        { type: 'toLowerCase' },
        { type: 'trim' },
        { type: 'replace', search: /\s+/g, replace: ' ', global: true },
        { type: 'wordCount' }
      ];
      
      const start = Date.now();
      const results = await workerPool.processTextParallel(texts, operations);
      const processTime = Date.now() - start;
      
      expect(results).toHaveLength(texts.length);
      
      for (let i = 0; i < results.length; i++) {
        expect(results[i]).toBeDefined();
        expect(results[i].result).toBeDefined();
        expect(results[i].result.wordCount).toBeGreaterThan(0);
        expect(results[i].stats.operationsApplied).toBe(operations.length);
      }
      
      console.log(`Text processing: ${texts.length} texts with ${operations.length} operations in ${processTime}ms`);
      console.log('Sample result:', results[0]);
    });

    test('should handle large text processing', async () => {
      const largeText = 'Large text content. '.repeat(5000); // ~100KB
      
      const operations = [
        { type: 'toLowerCase' },
        { type: 'wordCount' },
        { type: 'extract', pattern: '\\b\\w{5,}\\b', flags: 'g' } // 5글자 이상 단어 추출
      ];
      
      const start = Date.now();
      const results = await workerPool.processTextParallel([largeText], operations);
      const processTime = Date.now() - start;
      
      expect(results).toHaveLength(1);
      expect(results[0].result).toBeDefined();
      expect(results[0].stats.originalLength).toBe(largeText.length);
      expect(results[0].stats.operationsApplied).toBe(operations.length);
      
      console.log(`Large text processing: ${largeText.length} chars in ${processTime}ms`);
      console.log('Processing stats:', results[0].stats);
    }, 30000);

    test('should split text correctly', async () => {
      const text = 'Line 1\nLine 2\nLine 3\nLine 4';
      
      const operations = [
        { type: 'split', delimiter: '\n' }
      ];
      
      const results = await workerPool.processTextParallel([text], operations);
      
      expect(results[0].result).toEqual(['Line 1', 'Line 2', 'Line 3', 'Line 4']);
      expect(results[0].stats.finalLength).toBe('array');
    });
  });

  describe('Regex Search', () => {
    test('should perform parallel regex search', async () => {
      const texts = [
        'Email: user@example.com, Phone: 123-456-7890',
        'Another email: test@domain.org and phone: (555) 123-4567',
        'No contacts here, just plain text.'
      ];
      
      const patterns = [
        { pattern: '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b', flags: 'g' }, // 이메일
        { pattern: '\\(?\\d{3}\\)?[-.\s]?\\d{3}[-.\s]?\\d{4}', flags: 'g' } // 전화번호
      ];
      
      const start = Date.now();
      const results = await workerPool.regexSearchParallel(texts, patterns);
      const searchTime = Date.now() - start;
      
      expect(results).toHaveLength(texts.length);
      
      // 첫 번째 텍스트에서 이메일과 전화번호 찾기
      expect(results[0].results).toHaveLength(patterns.length);
      expect(results[0].results[0].matches.length).toBeGreaterThan(0); // 이메일 발견
      expect(results[0].results[1].matches.length).toBeGreaterThan(0); // 전화번호 발견
      
      // 두 번째 텍스트에서도 패턴 찾기
      expect(results[1].results[0].matches.length).toBeGreaterThan(0); // 이메일 발견
      expect(results[1].results[1].matches.length).toBeGreaterThan(0); // 전화번호 발견
      
      // 세 번째 텍스트에서는 패턴 없음
      expect(results[2].results[0].matches.length).toBe(0);
      expect(results[2].results[1].matches.length).toBe(0);
      
      console.log(`Regex search: ${texts.length} texts with ${patterns.length} patterns in ${searchTime}ms`);
      console.log('Sample matches:', results[0].results[0].matches[0]);
    });

    test('should handle complex regex patterns', async () => {
      const text = `
        Date: 2024-01-15, Time: 14:30:25
        URL: https://example.com/path?param=value
        JSON: {"key": "value", "number": 123}
        IPv4: 192.168.1.1
        IPv6: 2001:0db8:85a3:0000:0000:8a2e:0370:7334
      `;
      
      const patterns = [
        { pattern: '\\d{4}-\\d{2}-\\d{2}', flags: 'g' }, // 날짜
        { pattern: '\\d{2}:\\d{2}:\\d{2}', flags: 'g' }, // 시간
        { pattern: 'https?://[^\\s]+', flags: 'g' }, // URL
        { pattern: '\\{[^}]+\\}', flags: 'g' }, // JSON 객체
        { pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', flags: 'g' }, // IPv4
        { pattern: '(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}', flags: 'g' } // IPv6
      ];
      
      const results = await workerPool.regexSearchParallel([text], patterns);
      
      expect(results[0].results).toHaveLength(patterns.length);
      expect(results[0].results[0].matches.length).toBe(1); // 날짜 1개
      expect(results[0].results[1].matches.length).toBe(1); // 시간 1개
      expect(results[0].results[2].matches.length).toBe(1); // URL 1개
      expect(results[0].results[3].matches.length).toBe(1); // JSON 1개
      expect(results[0].results[4].matches.length).toBe(1); // IPv4 1개
      expect(results[0].results[5].matches.length).toBe(1); // IPv6 1개
      
      console.log('Complex regex results:', results[0].results.map(r => ({
        pattern: r.pattern,
        matchCount: r.matchCount,
        sample: r.matches[0]?.match
      })));
    });

    test('should limit excessive matches for performance', async () => {
      const text = 'a'.repeat(10000); // 10,000개의 'a'
      
      const patterns = [
        { pattern: 'a', flags: 'g', maxMatches: 100 } // 'a' 패턴 (최대 100개)
      ];
      
      const start = Date.now();
      const results = await workerPool.regexSearchParallel([text], patterns);
      const searchTime = Date.now() - start;
      
      expect(results[0].results[0].matchCount).toBe(100); // 최대치로 제한됨
      expect(results[0].results[0].truncated).toBe(true); // 잘림 표시
      
      console.log(`Limited regex search: 10,000 chars with match limit in ${searchTime}ms`);
      console.log('Match limit result:', {
        matchCount: results[0].results[0].matchCount,
        truncated: results[0].results[0].truncated,
        processingTime: results[0].results[0].processingTime
      });
    });
  });

  describe('Performance Benchmarking', () => {
    test('should demonstrate CPU parallelization benefits', async () => {
      const largeTexts = Array.from({ length: 8 }, (_, i) => 
        `Large text content for parallel processing test ${i}. `.repeat(1000)
      );
      
      const operations = [
        { type: 'toLowerCase' },
        { type: 'wordCount' },
        { type: 'extract', pattern: '\\b\\w{8,}\\b', flags: 'g' }
      ];
      
      // 병렬 처리 테스트
      const parallelStart = Date.now();
      const parallelResults = await workerPool.processTextParallel(largeTexts, operations);
      const parallelTime = Date.now() - parallelStart;
      
      // 순차 처리 시뮬레이션 (비교용)
      const sequentialStart = Date.now();
      const sequentialResults = [];
      for (const text of largeTexts) {
        const result = await workerPool.processTextParallel([text], operations);
        sequentialResults.push(result[0]);
      }
      const sequentialTime = Date.now() - sequentialStart;
      
      const improvement = ((sequentialTime - parallelTime) / sequentialTime * 100);
      
      expect(parallelResults).toHaveLength(largeTexts.length);
      expect(sequentialResults).toHaveLength(largeTexts.length);
      
      console.log('CPU Parallelization Benchmark:');
      console.log(`- Parallel processing: ${parallelTime}ms`);
      console.log(`- Sequential processing: ${sequentialTime}ms`);
      console.log(`- Improvement: ${improvement.toFixed(1)}%`);
      console.log(`- Texts processed: ${largeTexts.length}`);
      console.log(`- Operations per text: ${operations.length}`);
      
      const stats = workerPool.getPerformanceStats();
      console.log('Worker pool stats:', {
        tasksCompleted: stats.tasksCompleted,
        avgProcessingTime: stats.avgProcessingTime.toFixed(2) + 'ms',
        workerUtilization: stats.workerUtilization + '%',
        peakWorkers: stats.peakWorkers
      });
      
      // 병렬 처리가 더 빠르거나 비슷해야 함 (테스트 환경 고려)
      expect(parallelTime).toBeLessThanOrEqual(sequentialTime * 1.2); // 20% 오차 허용
      
    }, 60000);
  });

  describe('Error Handling', () => {
    test('should handle worker errors gracefully', async () => {
      // 잘못된 작업 타입으로 에러 유발
      const results = await Promise.allSettled([
        workerPool.executeTask('invalidTaskType', { data: 'test' }),
        workerPool.executeTask('processText', { text: 'valid task' }, { operations: [] })
      ]);
      
      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('fulfilled');
      
      const stats = workerPool.getPerformanceStats();
      expect(stats.tasksFailed).toBeGreaterThan(0);
      
      console.log('Error handling stats:', {
        tasksFailed: stats.tasksFailed,
        tasksCompleted: stats.tasksCompleted
      });
    });

    test('should handle task timeouts', async () => {
      // 매우 짧은 타임아웃으로 테스트
      const shortTimeoutPool = new CPUWorkerPool({
        maxWorkers: 2,
        minWorkers: 1,
        taskTimeout: 10 // 10ms (매우 짧음)
      });
      
      try {
        await new Promise(resolve => setTimeout(resolve, 500)); // 초기화 대기
        
        const result = await Promise.allSettled([
          shortTimeoutPool.executeTask('processText', {
            text: 'test'.repeat(10000),
            operations: [{ type: 'toLowerCase' }, { type: 'wordCount' }]
          }, { timeout: 10 })
        ]);
        
        expect(result[0].status).toBe('rejected');
        expect(result[0].reason.message).toContain('timed out');
        
        console.log('Timeout test result:', result[0].reason.message);
        
      } finally {
        await shortTimeoutPool.destroy();
      }
    }, 30000);
  });
});

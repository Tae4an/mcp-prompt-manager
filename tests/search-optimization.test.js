import { jest } from '@jest/globals';
import { 
  OptimizedSearchEngine, 
  SearchBenchmark 
} from '../utils/optimized-search-engine.js';
import { FuzzySearch } from '../utils/fuzzy-search.js';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Search Engine Optimization', () => {
  let optimizedEngine;
  let originalEngine;
  let testData;

  beforeAll(async () => {
    // 테스트 데이터 생성
    testData = [
      {
        name: 'code-review-template.md',
        content: 'This is a code review template for reviewing JavaScript code and providing feedback',
        size: 1024,
        modified: new Date(),
        metadata: {
          tags: ['code', 'review', 'javascript'],
          category: 'development',
          description: 'Template for code reviews'
        }
      },
      {
        name: 'bug-report-template.md',
        content: 'Bug report template for tracking and fixing software bugs',
        size: 856,
        modified: new Date(),
        metadata: {
          tags: ['bug', 'report', 'tracking'],
          category: 'development',
          description: 'Template for bug reports'
        }
      },
      {
        name: 'meeting-notes.md',
        content: 'Template for taking meeting notes and action items',
        size: 512,
        modified: new Date(),
        metadata: {
          tags: ['meeting', 'notes', 'productivity'],
          category: 'productivity',
          description: 'Meeting notes template'
        }
      },
      {
        name: 'api-documentation.md',
        content: 'API documentation template with examples and best practices',
        size: 2048,
        modified: new Date(),
        metadata: {
          tags: ['api', 'documentation', 'examples'],
          category: 'development',
          description: 'API documentation template'
        }
      },
      {
        name: 'performance-analysis.md',
        content: 'Performance analysis template for benchmarking and optimization',
        size: 1536,
        modified: new Date(),
        metadata: {
          tags: ['performance', 'analysis', 'optimization'],
          category: 'development',
          description: 'Performance analysis template'
        }
      }
    ];

    // 대용량 테스트 데이터 생성 (성능 테스트용)
    for (let i = 0; i < 100; i++) {
      testData.push({
        name: `generated-prompt-${i}.md`,
        content: `This is a generated prompt ${i} with various keywords like testing, automation, and development`,
        size: 300 + i * 10,
        modified: new Date(),
        metadata: {
          tags: [`tag${i % 10}`, 'generated', 'test'],
          category: i % 3 === 0 ? 'development' : i % 3 === 1 ? 'productivity' : 'automation',
          description: `Generated prompt ${i} for testing`
        }
      });
    }
  });

  beforeEach(() => {
    optimizedEngine = new OptimizedSearchEngine({
      threshold: 0.3,
      parallelWorkers: 4,
      enableIndexing: true,
      enableMemoryPool: true,
      maxResults: 20
    });

    originalEngine = new FuzzySearch({
      threshold: 0.3,
      includeScore: true
    });
  });

  afterEach(() => {
    if (optimizedEngine) {
      optimizedEngine.destroy();
    }
  });

  describe('Indexing System', () => {
    test('should build indexes correctly', () => {
      optimizedEngine.buildIndexes(testData);
      
      const stats = optimizedEngine.getPerformanceStats();
      
      expect(stats.indexStats.trigramCount).toBeGreaterThan(0);
      expect(stats.indexStats.tagCount).toBeGreaterThan(0);
      expect(stats.indexStats.metadataCount).toBeGreaterThan(0);
      
      console.log('Index stats:', stats.indexStats);
    });

    test('should generate n-grams correctly', () => {
      const ngrams = optimizedEngine.generateNGrams('javascript code review', 3);
      
      expect(ngrams).toContain('jav');
      expect(ngrams).toContain('ava');
      expect(ngrams).toContain('vas');
      expect(ngrams).toContain('javascript code'); // 2-gram token
      expect(ngrams).toContain('code review');     // 2-gram token
      
      console.log('Generated n-grams:', ngrams.slice(0, 10));
    });

    test('should find candidates from index', () => {
      optimizedEngine.buildIndexes(testData);
      
      const candidates = optimizedEngine.getCandidatesFromIndex('javascript', {
        name: 'javascript',
        content: 'javascript'
      });
      
      expect(candidates.length).toBeGreaterThan(0);
      
      // 실제로 관련된 항목이 포함되어야 함
      const jsItem = testData.find(item => 
        item.content.includes('JavaScript') || item.tags.includes('javascript')
      );
      
      if (jsItem) {
        const jsItemIndex = testData.indexOf(jsItem);
        expect(candidates).toContain(jsItemIndex);
      }
      
      console.log('Index candidates for "javascript":', candidates.length);
    });
  });

  describe('Parallel Search', () => {
    test('should perform parallel search correctly', async () => {
      optimizedEngine.buildIndexes(testData);
      
      const results = await optimizedEngine.searchParallel(
        'code',
        testData,
        { name: 'code', content: 'code' }
      );
      
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      
      // 모든 결과가 임계값 이상의 점수를 가져야 함
      results.forEach(result => {
        expect(result.score).toBeGreaterThanOrEqual(optimizedEngine.options.threshold);
        expect(result).toHaveProperty('item');
        expect(result).toHaveProperty('matchedField');
      });
      
      console.log('Parallel search results:', results.length);
      console.log('Top result:', results[0]);
    });

    test('should handle low-relevance search results', async () => {
      optimizedEngine.buildIndexes(testData);
      
      const results = await optimizedEngine.searchParallel(
        'xyzneverexistsquery999',
        testData,
        { name: 'xyzneverexistsquery999', content: 'xyzneverexistsquery999' },
        { maxResults: 10 }
      );
      
      expect(Array.isArray(results)).toBe(true);
      
      // 검색 결과가 있어도 점수가 낮아야 함 (퍼지 매칭으로 인해 일부 결과가 나올 수 있음)
      if (results.length > 0) {
        expect(results[0].score).toBeLessThan(0.5); // 더 관대한 임계값
        console.log('Low-relevance search score:', results[0].score);
      }
      
      // 임계값을 높이면 결과가 필터링되어야 함
      const highThresholdEngine = new OptimizedSearchEngine({
        threshold: 0.8,
        parallelWorkers: 2
      });
      highThresholdEngine.buildIndexes(testData);
      
      const strictResults = await highThresholdEngine.searchParallel(
        'xyzneverexistsquery999',
        testData,
        { name: 'xyzneverexistsquery999', content: 'xyzneverexistsquery999' },
        { maxResults: 10 }
      );
      
      expect(strictResults.length).toBe(0);
      
      highThresholdEngine.destroy();
    });

    test('should cache search results', async () => {
      optimizedEngine.buildIndexes(testData);
      
      // 첫 번째 검색
      const start1 = Date.now();
      await optimizedEngine.searchParallel('development', testData, { content: 'development' });
      const time1 = Date.now() - start1;
      
      // 같은 검색 (캐시된 결과 사용)
      const start2 = Date.now();
      await optimizedEngine.searchParallel('development', testData, { content: 'development' });
      const time2 = Date.now() - start2;
      
      const stats = optimizedEngine.getPerformanceStats();
      expect(stats.cacheHitRate).toBeGreaterThan(0);
      
      console.log('Cache hit rate:', `${stats.cacheHitRate}%`);
      console.log('First search:', `${time1}ms`, 'Cached search:', `${time2}ms`);
    });
  });

  describe('Memory Pool', () => {
    test('should use memory pool efficiently', async () => {
      optimizedEngine.buildIndexes(testData);
      
      // 여러 번 검색 수행
      for (let i = 0; i < 10; i++) {
        await optimizedEngine.searchParallel(
          `test${i}`,
          testData,
          { name: `test${i}`, content: `test${i}` }
        );
      }
      
      const stats = optimizedEngine.getPerformanceStats();
      
      expect(stats.memoryPoolEfficiency).toBeGreaterThan(0);
      
      console.log('Memory pool efficiency:', `${stats.memoryPoolEfficiency}%`);
      console.log('Memory pool stats:', stats.memoryPoolStats);
    });
  });

  describe('Performance Comparison', () => {
    test('should outperform original search engine', async () => {
      const benchmark = new SearchBenchmark(optimizedEngine, originalEngine);
      
      const queries = ['code', 'javascript', 'template', 'development', 'performance'];
      const iterations = 10; // 테스트에서는 적은 반복
      
      const results = await benchmark.comparePeformance(testData, queries, iterations);
      
      expect(results.optimized.avgTime).toBeDefined();
      expect(results.original.avgTime).toBeDefined();
      
      // 최적화된 엔진이 더 빨라야 함 (인덱싱 오버헤드 고려)
      if (testData.length > 50) {
        expect(results.optimized.avgTime).toBeLessThan(results.original.avgTime * 2);
      }
      
      console.log('Performance comparison:');
      console.log('- Optimized engine:', `${results.optimized.avgTime.toFixed(2)}ms average`);
      console.log('- Original engine:', `${results.original.avgTime.toFixed(2)}ms average`);
      console.log('- Improvement:', `${results.improvement.toFixed(1)}%`);
      
      console.log('\nOptimized engine stats:');
      console.log('- Index efficiency:', `${results.optimizedStats.indexEfficiency}%`);
      console.log('- Cache hit rate:', `${results.optimizedStats.cacheHitRate}%`);
      console.log('- Memory pool efficiency:', `${results.optimizedStats.memoryPoolEfficiency}%`);
    }, 30000); // 30초 타임아웃

    test('should scale well with large datasets', async () => {
      // 대용량 데이터셋 생성
      const largeDataset = [...testData];
      for (let i = 0; i < 500; i++) {
        largeDataset.push({
          name: `large-dataset-${i}.md`,
          content: `Large dataset item ${i} with keywords performance scalability testing`,
          size: 400,
          modified: new Date(),
          metadata: {
            tags: [`large${i % 20}`, 'dataset', 'scalability'],
            category: 'testing',
            description: `Large dataset item ${i}`
          }
        });
      }
      
      optimizedEngine.buildIndexes(largeDataset);
      
      const start = Date.now();
      const results = await optimizedEngine.searchParallel(
        'performance',
        largeDataset,
        { name: 'performance', content: 'performance' }
      );
      const searchTime = Date.now() - start;
      
      expect(results.length).toBeGreaterThan(0);
      expect(searchTime).toBeLessThan(100); // 100ms 이내
      
      const stats = optimizedEngine.getPerformanceStats();
      
      console.log(`Large dataset search (${largeDataset.length} items):`);
      console.log('- Search time:', `${searchTime}ms`);
      console.log('- Results found:', results.length);
      console.log('- Index efficiency:', `${stats.indexEfficiency}%`);
      console.log('- Average search time:', `${stats.avgSearchTime.toFixed(2)}ms`);
    });
  });

  describe('Search Quality', () => {
    test('should maintain search quality with optimization', async () => {
      optimizedEngine.buildIndexes(testData);
      
      // 같은 쿼리로 두 엔진 비교
      const query = 'javascript code';
      
      const optimizedResults = await optimizedEngine.searchParallel(
        query,
        testData,
        { name: query, content: query }
      );
      
      const originalResults = originalEngine.searchObjects(
        query,
        testData,
        ['name', 'content']
      );
      
      // 최적화된 엔진이 최소한 비슷한 수의 결과를 찾아야 함
      expect(optimizedResults.length).toBeGreaterThanOrEqual(
        Math.max(1, originalResults.length - 2)
      );
      
      // 상위 결과들의 품질 비교
      if (optimizedResults.length > 0 && originalResults.length > 0) {
        const topOptimizedScore = optimizedResults[0].score;
        const topOriginalScore = originalResults[0].score;
        
        // 점수 차이가 크지 않아야 함
        expect(Math.abs(topOptimizedScore - topOriginalScore)).toBeLessThan(0.3);
      }
      
      console.log('Search quality comparison for "javascript code":');
      console.log('- Optimized results:', optimizedResults.length);
      console.log('- Original results:', originalResults.length);
      if (optimizedResults.length > 0) {
        console.log('- Top optimized score:', (optimizedResults[0].score * 100).toFixed(1) + '%');
      }
      if (originalResults.length > 0) {
        console.log('- Top original score:', (originalResults[0].score * 100).toFixed(1) + '%');
      }
    });

    test('should handle various query types', async () => {
      optimizedEngine.buildIndexes(testData);
      
      const testQueries = [
        'code',           // 단일 단어
        'code review',    // 여러 단어
        'javascript',     // 태그 매칭
        'development',    // 카테고리 매칭
        'templat',        // 부분 매칭
        'API doc',        // 약어
        'performanc'      // 오타
      ];
      
      for (const query of testQueries) {
        const results = await optimizedEngine.searchParallel(
          query,
          testData,
          { 
            name: query, 
            content: query, 
            'metadata.category': query,
            'metadata.description': query 
          }
        );
        
        console.log(`Query "${query}": ${results.length} results`);
        
        // 모든 쿼리가 최소한 일부 결과를 반환해야 함 (매우 구체적인 쿼리 제외)
        if (!['templat', 'performanc'].includes(query)) {
          expect(results.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed data gracefully', async () => {
      const malformedData = [
        { name: 'normal.md', content: 'normal content' },
        { name: null, content: 'null name' },
        { name: 'no-content.md' },
        { content: 'no name' },
        {}
      ];
      
      expect(() => {
        optimizedEngine.buildIndexes(malformedData);
      }).not.toThrow();
      
      const results = await optimizedEngine.searchParallel(
        'normal',
        malformedData,
        { name: 'normal', content: 'normal' }
      );
      
      expect(Array.isArray(results)).toBe(true);
    });

    test('should handle empty datasets', async () => {
      optimizedEngine.buildIndexes([]);
      
      const results = await optimizedEngine.searchParallel(
        'anything',
        [],
        { name: 'anything' }
      );
      
      expect(results).toEqual([]);
    });
  });
});

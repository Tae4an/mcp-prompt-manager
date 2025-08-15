import { log } from './logger.js';
import { FuzzySearch } from './fuzzy-search.js';

/**
 * 고성능 병렬 검색 엔진
 * - 병렬 검색 파이프라인
 * - 인덱싱 기반 빠른 검색
 * - 해시맵 기반 O(1) 중복 제거
 * - 메모리 풀링으로 GC 압력 감소
 */
export class OptimizedSearchEngine {
  constructor(options = {}) {
    this.options = {
      threshold: options.threshold || 0.3,
      maxResults: options.maxResults || 10,
      parallelWorkers: options.parallelWorkers || 4,
      enableIndexing: options.enableIndexing !== false,
      enableMemoryPool: options.enableMemoryPool !== false,
      ...options
    };
    
    // 기본 퍼지 검색 인스턴스
    this.fuzzySearcher = new FuzzySearch({
      threshold: this.options.threshold,
      includeScore: true
    });
    
    // 인덱싱 시스템
    this.indexes = {
      content: new Map(),     // 내용 인덱스
      filename: new Map(),    // 파일명 인덱스
      tags: new Map(),        // 태그 인덱스
      trigrams: new Map(),    // 3-gram 인덱스
      metadata: new Map()     // 메타데이터 인덱스
    };
    
    // 메모리 풀
    this.memoryPool = {
      searchResults: [],
      candidates: [],
      maxPoolSize: 1000
    };
    
    // 성능 통계
    this.stats = {
      searches: 0,
      parallelSearches: 0,
      indexHits: 0,
      indexMisses: 0,
      avgSearchTime: 0,
      totalSearchTime: 0,
      cacheHits: 0,
      memoryPoolHits: 0
    };
    
    // 결과 캐시
    this.resultCache = new Map();
    this.maxCacheSize = options.maxCacheSize || 500;
    
    log.info('Optimized search engine initialized', {
      parallelWorkers: this.options.parallelWorkers,
      enableIndexing: this.options.enableIndexing,
      threshold: this.options.threshold
    });
  }

  /**
   * 인덱스 구축 (프롬프트 로드 시 호출)
   */
  buildIndexes(prompts) {
    if (!this.options.enableIndexing) return;
    
    const startTime = Date.now();
    
    // 기존 인덱스 초기화
    Object.values(this.indexes).forEach(index => index.clear());
    
    prompts.forEach((prompt, index) => {
      // 파일명 인덱싱
      this.indexText(prompt.name, index, 'filename');
      
      // 내용 인덱싱
      if (prompt.content) {
        this.indexText(prompt.content, index, 'content');
      }
      
      // 태그 인덱싱
      if (prompt.metadata && prompt.metadata.tags && Array.isArray(prompt.metadata.tags)) {
        prompt.metadata.tags.forEach(tag => {
          if (tag && typeof tag === 'string') {
            const normalizedTag = tag.toLowerCase();
            if (!this.indexes.tags.has(normalizedTag)) {
              this.indexes.tags.set(normalizedTag, new Set());
            }
            this.indexes.tags.get(normalizedTag).add(index);
          }
        });
      }
      
      // 메타데이터 인덱싱
      if (prompt.metadata && prompt.metadata.category && typeof prompt.metadata.category === 'string') {
        const category = prompt.metadata.category.toLowerCase();
        if (!this.indexes.metadata.has(category)) {
          this.indexes.metadata.set(category, new Set());
        }
        this.indexes.metadata.get(category).add(index);
      }
    });
    
    const indexTime = Date.now() - startTime;
    log.info('Search indexes built', {
      prompts: prompts.length,
      indexTime: `${indexTime}ms`,
      trigramCount: this.indexes.trigrams.size,
      tagCount: this.indexes.tags.size
    });
  }

  /**
   * 텍스트 인덱싱 (N-gram 생성)
   */
  indexText(text, promptIndex, field) {
    if (!text || typeof text !== 'string') return;
    
    const normalizedText = text.toLowerCase();
    
    // 3-gram 생성 및 인덱싱
    const trigrams = this.generateNGrams(normalizedText, 3);
    trigrams.forEach(trigram => {
      if (!this.indexes.trigrams.has(trigram)) {
        this.indexes.trigrams.set(trigram, new Map());
      }
      
      const trigramIndex = this.indexes.trigrams.get(trigram);
      if (!trigramIndex.has(field)) {
        trigramIndex.set(field, new Set());
      }
      
      trigramIndex.get(field).add(promptIndex);
    });
    
    // 필드별 전체 텍스트 인덱싱
    if (!this.indexes[field].has(normalizedText)) {
      this.indexes[field].set(normalizedText, new Set());
    }
    this.indexes[field].get(normalizedText).add(promptIndex);
  }

  /**
   * N-gram 생성
   */
  generateNGrams(text, n = 3) {
    if (!text || typeof text !== 'string') return [];
    
    const ngrams = new Set();
    const cleanText = text.replace(/[^\w\s]/g, ' ').toLowerCase();
    const words = cleanText.split(/\s+/).filter(word => word.length > 0);
    
    // 단어별 character n-gram
    words.forEach(word => {
      if (word.length >= n) {
        for (let i = 0; i <= word.length - n; i++) {
          ngrams.add(word.substring(i, i + n));
        }
      }
    });
    
    // 전체 텍스트 token n-gram (2-gram까지만)
    if (words.length >= 2) {
      for (let i = 0; i <= words.length - 2; i++) {
        ngrams.add(words.slice(i, i + 2).join(' '));
      }
    }
    
    return Array.from(ngrams);
  }

  /**
   * 인덱스 기반 후보 추출
   */
  getCandidatesFromIndex(query, searchFields) {
    const candidates = new Set();
    const queryTrigrams = this.generateNGrams(query.toLowerCase(), 3);
    
    // Trigram 기반 후보 추출
    queryTrigrams.forEach(trigram => {
      const trigramIndex = this.indexes.trigrams.get(trigram);
      if (trigramIndex) {
        // 검색할 필드에 해당하는 후보만 추출
        Object.keys(searchFields).forEach(field => {
          const fieldCandidates = trigramIndex.get(field);
          if (fieldCandidates) {
            fieldCandidates.forEach(index => candidates.add(index));
          }
        });
      }
    });
    
    // 태그 직접 매칭
    const queryLower = query.toLowerCase();
    const tagCandidates = this.indexes.tags.get(queryLower);
    if (tagCandidates) {
      tagCandidates.forEach(index => candidates.add(index));
    }
    
    // 카테고리 직접 매칭
    const categoryCandidates = this.indexes.metadata.get(queryLower);
    if (categoryCandidates) {
      categoryCandidates.forEach(index => candidates.add(index));
    }
    
    return Array.from(candidates);
  }

  /**
   * 병렬 검색 실행
   */
  async searchParallel(query, searchItems, searchFields, options = {}) {
    const startTime = Date.now();
    this.stats.searches++;
    
    // 캐시 확인
    const cacheKey = this.generateCacheKey(query, searchFields);
    if (this.resultCache.has(cacheKey)) {
      this.stats.cacheHits++;
      return this.resultCache.get(cacheKey);
    }
    
    let candidateIndices = null;
    
    // 인덱스 기반 후보 추출 (활성화된 경우)
    if (this.options.enableIndexing && searchItems.length > 50) {
      candidateIndices = this.getCandidatesFromIndex(query, searchFields);
      
      if (candidateIndices.length > 0) {
        this.stats.indexHits++;
        log.debug('Index-based candidate filtering', {
          totalItems: searchItems.length,
          candidates: candidateIndices.length,
          reduction: `${((1 - candidateIndices.length / searchItems.length) * 100).toFixed(1)}%`
        });
      } else {
        this.stats.indexMisses++;
      }
    }
    
    // 검색할 아이템 결정
    const itemsToSearch = candidateIndices && candidateIndices.length > 0 
      ? candidateIndices.map(index => ({ item: searchItems[index], originalIndex: index }))
      : searchItems.map((item, index) => ({ item, originalIndex: index }));
    
    // 병렬 검색 실행
    const results = await this.executeParallelSearch(query, itemsToSearch, searchFields);
    
    // 결과 정렬 및 제한
    const sortedResults = results
      .filter(result => result.score >= this.options.threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, options.maxResults || this.options.maxResults);
    
    // 캐시에 저장
    if (this.resultCache.size >= this.maxCacheSize) {
      // LRU 기반 캐시 정리
      const firstKey = this.resultCache.keys().next().value;
      this.resultCache.delete(firstKey);
    }
    this.resultCache.set(cacheKey, sortedResults);
    
    // 성능 통계 업데이트
    const searchTime = Date.now() - startTime;
    this.stats.totalSearchTime += searchTime;
    this.stats.avgSearchTime = this.stats.totalSearchTime / this.stats.searches;
    
    log.debug('Parallel search completed', {
      query,
      results: sortedResults.length,
      searchTime: `${searchTime}ms`,
      usedIndex: !!candidateIndices,
      candidates: candidateIndices?.length || itemsToSearch.length
    });
    
    return sortedResults;
  }

  /**
   * 병렬 검색 실행 엔진
   */
  async executeParallelSearch(query, itemsToSearch, searchFields) {
    this.stats.parallelSearches++;
    
    // 워커 수에 따라 작업 분할
    const chunkSize = Math.ceil(itemsToSearch.length / this.options.parallelWorkers);
    const chunks = [];
    
    for (let i = 0; i < itemsToSearch.length; i += chunkSize) {
      chunks.push(itemsToSearch.slice(i, i + chunkSize));
    }
    
    // 각 필드별로 병렬 검색 실행
    const fieldPromises = Object.entries(searchFields).map(async ([field, fieldQuery]) => {
      const chunkPromises = chunks.map(chunk => 
        this.searchChunk(fieldQuery || query, chunk, field)
      );
      
      const chunkResults = await Promise.all(chunkPromises);
      return {
        field,
        results: chunkResults.flat()
      };
    });
    
    const fieldResults = await Promise.all(fieldPromises);
    
    // 해시맵 기반 O(1) 중복 제거 및 점수 통합
    return this.deduplicateAndMergeResults(fieldResults);
  }

  /**
   * 청크 단위 검색 처리
   */
  async searchChunk(query, chunk, field) {
    const results = [];
    
    for (const { item, originalIndex } of chunk) {
      const result = this.getFromMemoryPool('searchResult');
      
      // 필드별 검색
      const value = this.getNestedValue(item, field);
      if (value != null) {
        const score = this.fuzzySearcher.calculateScore(query, String(value));
        
        if (score >= this.options.threshold) {
          result.item = item;
          result.score = score;
          result.matchedField = field;
          result.matchedValue = String(value);
          result.originalIndex = originalIndex;
          
          results.push(result);
        } else {
          this.returnToMemoryPool('searchResult', result);
        }
      } else {
        this.returnToMemoryPool('searchResult', result);
      }
    }
    
    return results;
  }

  /**
   * 해시맵 기반 결과 중복 제거 및 병합
   */
  deduplicateAndMergeResults(fieldResults) {
    const resultMap = new Map();
    
    for (const { field, results } of fieldResults) {
      for (const result of results) {
        const key = result.item.name || result.originalIndex;
        const existing = resultMap.get(key);
        
        if (!existing || result.score > existing.score) {
          // 기존 결과를 메모리 풀에 반환
          if (existing) {
            this.returnToMemoryPool('searchResult', existing);
          }
          
          resultMap.set(key, {
            ...result,
            matchedField: field
          });
        } else {
          // 점수가 낮은 결과를 메모리 풀에 반환
          this.returnToMemoryPool('searchResult', result);
        }
      }
    }
    
    return Array.from(resultMap.values());
  }

  /**
   * 중첩 객체 속성 접근
   */
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : null;
    }, obj);
  }

  /**
   * 캐시 키 생성
   */
  generateCacheKey(query, searchFields) {
    const fieldsStr = Object.keys(searchFields).sort().join(',');
    return `${query}:${fieldsStr}:${this.options.threshold}`;
  }

  /**
   * 메모리 풀에서 객체 가져오기
   */
  getFromMemoryPool(type) {
    if (!this.options.enableMemoryPool) {
      return this.createNewObject(type);
    }
    
    const pool = this.memoryPool[type + 's'];
    if (pool && pool.length > 0) {
      this.stats.memoryPoolHits++;
      return pool.pop();
    }
    
    return this.createNewObject(type);
  }

  /**
   * 메모리 풀에 객체 반환
   */
  returnToMemoryPool(type, obj) {
    if (!this.options.enableMemoryPool) return;
    
    const pool = this.memoryPool[type + 's'];
    if (pool && pool.length < this.memoryPool.maxPoolSize) {
      // 객체 초기화
      this.resetObject(obj, type);
      pool.push(obj);
    }
  }

  /**
   * 새 객체 생성
   */
  createNewObject(type) {
    switch (type) {
      case 'searchResult':
        return {
          item: null,
          score: 0,
          matchedField: '',
          matchedValue: '',
          originalIndex: -1
        };
      default:
        return {};
    }
  }

  /**
   * 객체 초기화
   */
  resetObject(obj, type) {
    switch (type) {
      case 'searchResult':
        obj.item = null;
        obj.score = 0;
        obj.matchedField = '';
        obj.matchedValue = '';
        obj.originalIndex = -1;
        break;
    }
  }

  /**
   * 성능 통계 조회
   */
  getPerformanceStats() {
    const indexEfficiency = this.stats.indexHits / Math.max(1, this.stats.indexHits + this.stats.indexMisses);
    const cacheHitRate = this.stats.cacheHits / Math.max(1, this.stats.searches);
    const memoryPoolEfficiency = this.stats.memoryPoolHits / Math.max(1, this.stats.searches * 10); // 대략적인 객체 생성 수
    
    return {
      searches: this.stats.searches,
      parallelSearches: this.stats.parallelSearches,
      avgSearchTime: Math.round(this.stats.avgSearchTime * 100) / 100,
      indexEfficiency: Math.round(indexEfficiency * 100),
      cacheHitRate: Math.round(cacheHitRate * 100),
      memoryPoolEfficiency: Math.round(memoryPoolEfficiency * 100),
      indexStats: {
        trigramCount: this.indexes.trigrams.size,
        tagCount: this.indexes.tags.size,
        metadataCount: this.indexes.metadata.size
      },
      cacheStats: {
        size: this.resultCache.size,
        maxSize: this.maxCacheSize
      },
      memoryPoolStats: {
        searchResults: this.memoryPool.searchResults.length,
        maxPoolSize: this.memoryPool.maxPoolSize
      }
    };
  }

  /**
   * 캐시 초기화
   */
  clearCache() {
    this.resultCache.clear();
    Object.values(this.indexes).forEach(index => index.clear());
    
    log.info('Search cache and indexes cleared');
  }

  /**
   * 리소스 정리
   */
  destroy() {
    this.clearCache();
    
    // 메모리 풀 정리
    Object.values(this.memoryPool).forEach(pool => {
      if (Array.isArray(pool)) {
        pool.length = 0;
      }
    });
    
    log.info('Optimized search engine destroyed');
  }
}

/**
 * 검색 성능 벤치마킹 도구
 */
export class SearchBenchmark {
  constructor(searchEngine, originalEngine) {
    this.optimizedEngine = searchEngine;
    this.originalEngine = originalEngine;
  }

  /**
   * 성능 비교 테스트
   */
  async comparePeformance(testData, queries, iterations = 100) {
    const results = {
      optimized: { times: [], totalTime: 0, avgTime: 0, results: [] },
      original: { times: [], totalTime: 0, avgTime: 0, results: [] }
    };

    log.info('Starting search performance benchmark', {
      testDataSize: testData.length,
      queries: queries.length,
      iterations
    });

    // 인덱스 구축 (최적화된 엔진)
    if (this.optimizedEngine.buildIndexes) {
      const indexStart = Date.now();
      this.optimizedEngine.buildIndexes(testData);
      const indexTime = Date.now() - indexStart;
      log.info('Index building completed', { indexTime: `${indexTime}ms` });
    }

    // 최적화된 엔진 테스트
    for (let i = 0; i < iterations; i++) {
      for (const query of queries) {
        const start = Date.now();
        
        const result = await this.optimizedEngine.searchParallel(
          query, 
          testData, 
          { name: query, content: query }
        );
        
        const time = Date.now() - start;
        results.optimized.times.push(time);
        results.optimized.totalTime += time;
        
        if (i === 0) results.optimized.results.push(result.length);
      }
    }

    // 기존 엔진 테스트 (있는 경우)
    if (this.originalEngine) {
      for (let i = 0; i < iterations; i++) {
        for (const query of queries) {
          const start = Date.now();
          
          const result = this.originalEngine.searchObjects(
            query, 
            testData, 
            ['name', 'content']
          );
          
          const time = Date.now() - start;
          results.original.times.push(time);
          results.original.totalTime += time;
          
          if (i === 0) results.original.results.push(result.length);
        }
      }
    }

    // 통계 계산
    results.optimized.avgTime = results.optimized.totalTime / results.optimized.times.length;
    results.original.avgTime = results.original.totalTime / results.original.times.length;

    const improvement = results.original.avgTime > 0 
      ? ((results.original.avgTime - results.optimized.avgTime) / results.original.avgTime * 100)
      : 0;

    return {
      ...results,
      improvement: Math.round(improvement * 100) / 100,
      optimizedStats: this.optimizedEngine.getPerformanceStats()
    };
  }
}

export default OptimizedSearchEngine;

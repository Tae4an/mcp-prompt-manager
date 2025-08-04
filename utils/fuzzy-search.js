import { log } from './logger.js';

/**
 * 퍼지 검색 유틸리티
 * 오타나 부분 일치를 허용하는 고급 검색 기능
 */
export class FuzzySearch {
  constructor(options = {}) {
    this.options = {
      threshold: options.threshold || 0.6, // 매칭 임계값 (0-1)
      maxDistance: options.maxDistance || 5, // 레벤슈타인 거리 최대값
      caseSensitive: options.caseSensitive || false,
      includeScore: options.includeScore || true,
      keys: options.keys || [], // 검색할 객체 속성들
      ...options
    };
  }

  /**
   * 레벤슈타인 거리 계산
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];
    const len1 = str1.length;
    const len2 = str2.length;

    if (len1 === 0) return len2;
    if (len2 === 0) return len1;

    // 매트릭스 초기화
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    // 거리 계산
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,     // 삭제
          matrix[i][j - 1] + 1,     // 삽입
          matrix[i - 1][j - 1] + cost // 교체
        );
      }
    }

    return matrix[len1][len2];
  }

  /**
   * 자로-윈클러 거리 계산 (더 정확한 유사도)
   */
  jaroWinklerDistance(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    const len1 = str1.length;
    const len2 = str2.length;
    const maxDistance = Math.floor(Math.max(len1, len2) / 2) - 1;

    if (maxDistance < 0) return 0;

    const matches1 = new Array(len1).fill(false);
    const matches2 = new Array(len2).fill(false);
    let matches = 0;
    let transpositions = 0;

    // 매치 찾기
    for (let i = 0; i < len1; i++) {
      const start = Math.max(0, i - maxDistance);
      const end = Math.min(i + maxDistance + 1, len2);

      for (let j = start; j < end; j++) {
        if (matches2[j] || str1[i] !== str2[j]) continue;
        matches1[i] = true;
        matches2[j] = true;
        matches++;
        break;
      }
    }

    if (matches === 0) return 0;

    // 전치 계산
    let k = 0;
    for (let i = 0; i < len1; i++) {
      if (!matches1[i]) continue;
      while (!matches2[k]) k++;
      if (str1[i] !== str2[k]) transpositions++;
      k++;
    }

    const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

    // 윈클러 보정 (공통 접두사 가중치)
    if (jaro < 0.7) return jaro;

    let prefix = 0;
    for (let i = 0; i < Math.min(len1, len2) && str1[i] === str2[i]; i++) {
      prefix++;
    }

    return jaro + 0.1 * prefix * (1 - jaro);
  }

  /**
   * n-gram 기반 유사도 계산
   */
  ngramSimilarity(str1, str2, n = 2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    const getNgrams = (str, size) => {
      const ngrams = new Set();
      for (let i = 0; i <= str.length - size; i++) {
        ngrams.add(str.slice(i, i + size));
      }
      return ngrams;
    };

    const ngrams1 = getNgrams(str1, n);
    const ngrams2 = getNgrams(str2, n);

    const intersection = new Set([...ngrams1].filter(x => ngrams2.has(x)));
    const union = new Set([...ngrams1, ...ngrams2]);

    return intersection.size / union.size;
  }

  /**
   * 단일 문자열 매칭 점수 계산
   */
  calculateScore(query, target) {
    if (!query || !target) return 0;

    const normalizedQuery = this.options.caseSensitive ? query : query.toLowerCase();
    const normalizedTarget = this.options.caseSensitive ? target : target.toLowerCase();

    // 정확한 매치
    if (normalizedQuery === normalizedTarget) return 1;

    // 부분 문자열 매치
    if (normalizedTarget.includes(normalizedQuery)) {
      return 0.8 + (0.2 * (normalizedQuery.length / normalizedTarget.length));
    }

    // 퍼지 매칭
    const jaroWinkler = this.jaroWinklerDistance(normalizedQuery, normalizedTarget);
    const ngram = this.ngramSimilarity(normalizedQuery, normalizedTarget);
    
    // 레벤슈타인 거리 기반 점수
    const levenshtein = this.levenshteinDistance(normalizedQuery, normalizedTarget);
    const maxLen = Math.max(normalizedQuery.length, normalizedTarget.length);
    const levenshteinScore = 1 - (levenshtein / maxLen);

    // 가중 평균 계산
    const score = (jaroWinkler * 0.5) + (ngram * 0.3) + (levenshteinScore * 0.2);

    return Math.max(0, Math.min(1, score));
  }

  /**
   * 단일 문자열 배열에서 검색
   */
  searchStrings(query, targets) {
    if (!query || !Array.isArray(targets)) return [];

    const results = targets.map(target => {
      const score = this.calculateScore(query, target);
      return {
        item: target,
        score: score
      };
    }).filter(result => result.score >= this.options.threshold);

    // 점수순 정렬 (높은 점수 우선)
    results.sort((a, b) => b.score - a.score);

    return this.options.includeScore ? results : results.map(r => r.item);
  }

  /**
   * 객체 배열에서 검색
   */
  searchObjects(query, objects, keys = null) {
    if (!query || !Array.isArray(objects)) return [];

    const searchKeys = keys || this.options.keys;
    if (!searchKeys || searchKeys.length === 0) {
      throw new Error('검색할 키를 지정해야 합니다');
    }

    const results = objects.map(obj => {
      let bestScore = 0;
      let matchedKey = null;
      let matchedValue = null;

      // 각 키에 대해 검색 수행
      for (const key of searchKeys) {
        const value = this.getNestedValue(obj, key);
        if (value != null) {
          const stringValue = String(value);
          const score = this.calculateScore(query, stringValue);
          
          if (score > bestScore) {
            bestScore = score;
            matchedKey = key;
            matchedValue = stringValue;
          }
        }
      }

      return {
        item: obj,
        score: bestScore,
        matchedKey,
        matchedValue
      };
    }).filter(result => result.score >= this.options.threshold);

    // 점수순 정렬
    results.sort((a, b) => b.score - a.score);

    return this.options.includeScore ? results : results.map(r => r.item);
  }

  /**
   * 중첩된 객체에서 값 가져오기
   */
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : null;
    }, obj);
  }

  /**
   * 다중 필드 검색 (OR 조건)
   */
  searchMultipleFields(query, objects, fieldQueries) {
    if (!query || !Array.isArray(objects) || !fieldQueries) return [];

    const results = objects.map(obj => {
      let maxScore = 0;
      let matchInfo = null;

      // 각 필드 쿼리에 대해 검색
      for (const [field, fieldQuery] of Object.entries(fieldQueries)) {
        const value = this.getNestedValue(obj, field);
        if (value != null) {
          const score = this.calculateScore(fieldQuery || query, String(value));
          if (score > maxScore) {
            maxScore = score;
            matchInfo = { field, value: String(value), query: fieldQuery || query };
          }
        }
      }

      return {
        item: obj,
        score: maxScore,
        match: matchInfo
      };
    }).filter(result => result.score >= this.options.threshold);

    results.sort((a, b) => b.score - a.score);
    return this.options.includeScore ? results : results.map(r => r.item);
  }

  /**
   * 정규표현식 검색 지원
   */
  searchWithRegex(pattern, targets, flags = 'gi') {
    try {
      const regex = new RegExp(pattern, flags);
      
      if (Array.isArray(targets)) {
        return targets.filter(target => {
          const str = typeof target === 'object' ? JSON.stringify(target) : String(target);
          return regex.test(str);
        });
      }
      
      return regex.test(String(targets));
    } catch (error) {
      log.warn('Invalid regex pattern', { pattern, error: error.message });
      return [];
    }
  }

  /**
   * 하이라이트된 결과 생성
   */
  highlightMatches(query, text, highlightTag = 'mark') {
    if (!query || !text) return text;

    const normalizedQuery = this.options.caseSensitive ? query : query.toLowerCase();
    const normalizedText = this.options.caseSensitive ? text : text.toLowerCase();
    
    // 정확한 매치 하이라이트
    if (normalizedText.includes(normalizedQuery)) {
      const regex = new RegExp(
        normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 
        this.options.caseSensitive ? 'g' : 'gi'
      );
      return text.replace(regex, `<${highlightTag}>$&</${highlightTag}>`);
    }

    // 퍼지 매치의 경우 개별 문자 하이라이트 (간단 버전)
    let result = text;
    const queryChars = [...normalizedQuery];
    let textIndex = 0;

    for (const char of queryChars) {
      const searchFrom = this.options.caseSensitive ? result : result.toLowerCase();
      const charIndex = searchFrom.indexOf(char, textIndex);
      
      if (charIndex !== -1) {
        const before = result.slice(0, charIndex);
        const matched = result[charIndex];
        const after = result.slice(charIndex + 1);
        result = before + `<${highlightTag}>${matched}</${highlightTag}>` + after;
        textIndex = charIndex + `<${highlightTag}></${highlightTag}>`.length + 1;
      }
    }

    return result;
  }

  /**
   * 검색 통계 정보
   */
  getSearchStats(query, targets) {
    const results = Array.isArray(targets[0]) ? 
      this.searchObjects(query, targets, this.options.keys) :
      this.searchStrings(query, targets);

    const scores = results.map(r => r.score || 0);
    
    return {
      totalItems: targets.length,
      matchedItems: results.length,
      matchRate: results.length / targets.length,
      averageScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
      maxScore: scores.length > 0 ? Math.max(...scores) : 0,
      minScore: scores.length > 0 ? Math.min(...scores) : 0,
      threshold: this.options.threshold
    };
  }
}

/**
 * 싱글톤 인스턴스 (기본 설정)
 */
export const fuzzySearch = new FuzzySearch({
  threshold: 0.3,
  maxDistance: 3,
  caseSensitive: false,
  includeScore: true
});

export default FuzzySearch;
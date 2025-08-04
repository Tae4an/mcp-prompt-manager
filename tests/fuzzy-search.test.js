import { jest } from '@jest/globals';
import { FuzzySearch, fuzzySearch } from '../utils/fuzzy-search.js';

describe('FuzzySearch', () => {
  let search;

  beforeEach(() => {
    search = new FuzzySearch({
      threshold: 0.3,
      caseSensitive: false,
      includeScore: true
    });
  });

  describe('String Distance Calculations', () => {
    test('should calculate Levenshtein distance correctly', () => {
      expect(search.levenshteinDistance('cat', 'bat')).toBe(1);
      expect(search.levenshteinDistance('hello', 'helo')).toBe(1);
      expect(search.levenshteinDistance('test', 'test')).toBe(0);
      expect(search.levenshteinDistance('', 'abc')).toBe(3);
      expect(search.levenshteinDistance('abc', '')).toBe(3);
    });

    test('should calculate Jaro-Winkler distance correctly', () => {
      expect(search.jaroWinklerDistance('test', 'test')).toBe(1);
      expect(search.jaroWinklerDistance('hello', 'helo')).toBeGreaterThan(0.8);
      expect(search.jaroWinklerDistance('cat', 'dog')).toBeLessThan(0.5);
      expect(search.jaroWinklerDistance('', '')).toBe(0);
    });

    test('should calculate n-gram similarity correctly', () => {
      expect(search.ngramSimilarity('hello', 'hello')).toBe(1);
      expect(search.ngramSimilarity('hello', 'helo')).toBeGreaterThan(0.6);
      expect(search.ngramSimilarity('cat', 'dog')).toBeLessThan(0.3);
      expect(search.ngramSimilarity('', 'test')).toBe(0);
    });
  });

  describe('Score Calculation', () => {
    test('should return perfect score for exact matches', () => {
      expect(search.calculateScore('test', 'test')).toBe(1);
      expect(search.calculateScore('Hello', 'hello')).toBe(1); // case insensitive
    });

    test('should return high score for substring matches', () => {
      const score = search.calculateScore('test', 'testing');
      expect(score).toBeGreaterThan(0.8);
      expect(score).toBeLessThan(1);
    });

    test('should return moderate score for similar strings', () => {
      const score = search.calculateScore('hello', 'helo');
      expect(score).toBeGreaterThan(0.7);
      expect(score).toBeLessThan(0.95);
    });

    test('should return low score for dissimilar strings', () => {
      const score = search.calculateScore('cat', 'elephant');
      expect(score).toBeLessThan(0.5);
    });

    test('should handle empty strings', () => {
      expect(search.calculateScore('', 'test')).toBe(0);
      expect(search.calculateScore('test', '')).toBe(0);
      expect(search.calculateScore('', '')).toBe(0);
    });
  });

  describe('String Array Search', () => {
    const testStrings = [
      'javascript programming',
      'python coding',
      'web development',
      'database design',
      'machine learning',
      'artificial intelligence',
      'react framework',
      'node.js backend'
    ];

    test('should find exact matches', () => {
      const results = search.searchStrings('python coding', testStrings);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item).toBe('python coding');
      expect(results[0].score).toBe(1);
    });

    test('should find partial matches', () => {
      const results = search.searchStrings('python', testStrings);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item).toBe('python coding');
      expect(results[0].score).toBeGreaterThan(0.8);
    });

    test('should find fuzzy matches', () => {
      const results = search.searchStrings('javascrpt', testStrings); // typo
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item).toBe('javascript programming');
      expect(results[0].score).toBeGreaterThan(0.6);
    });

    test('should respect threshold', () => {
      const strictSearch = new FuzzySearch({ threshold: 0.8 });
      const results = strictSearch.searchStrings('xyz', testStrings);
      expect(results).toHaveLength(0);
    });

    test('should sort results by score', () => {
      const results = search.searchStrings('dev', testStrings);
      expect(results.length).toBeGreaterThan(1);
      
      // 점수가 내림차순으로 정렬되어 있는지 확인
      for (let i = 1; i < results.length; i++) {
        expect(results[i-1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });

  describe('Object Array Search', () => {
    const testObjects = [
      { name: 'JavaScript Tutorial', category: 'programming', tags: ['js', 'web'] },
      { name: 'Python Guide', category: 'programming', tags: ['python', 'beginner'] },
      { name: 'Web Development', category: 'frontend', tags: ['html', 'css'] },
      { name: 'Machine Learning', category: 'ai', tags: ['ml', 'python'] },
      { name: 'Database Design', category: 'backend', tags: ['sql', 'design'] }
    ];

    test('should search in specified keys', () => {
      const results = search.searchObjects('JavaScript', testObjects, ['name']);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.name).toBe('JavaScript Tutorial');
      expect(results[0].score).toBeGreaterThan(0.8);
    });

    test('should search in multiple keys', () => {
      const results = search.searchObjects('programming', testObjects, ['name', 'category']);
      expect(results.length).toBeGreaterThan(1);
      
      // programming 카테고리의 항목들이 포함되어야 함
      const programmingItems = results.filter(r => r.item.category === 'programming');
      expect(programmingItems.length).toBeGreaterThan(0);
    });

    test('should find fuzzy matches in objects', () => {
      const results = search.searchObjects('Javascrpt', testObjects, ['name']); // typo
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.name).toBe('JavaScript Tutorial');
    });

    test('should handle nested properties', () => {
      const nestedObjects = [
        { user: { name: 'John Doe', email: 'john@example.com' } },
        { user: { name: 'Jane Smith', email: 'jane@example.com' } }
      ];
      
      const results = search.searchObjects('John', nestedObjects, ['user.name']);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.user.name).toBe('John Doe');
      expect(results[0].score).toBeGreaterThan(0.8);
    });

    test('should throw error when no keys specified', () => {
      expect(() => {
        search.searchObjects('test', testObjects);
      }).toThrow('검색할 키를 지정해야 합니다');
    });
  });

  describe('Multiple Field Search', () => {
    const testObjects = [
      { title: 'JavaScript Basics', content: 'Learn JS fundamentals', author: 'John' },
      { title: 'Python Advanced', content: 'Advanced Python concepts', author: 'Jane' },
      { title: 'Web Design', content: 'HTML and CSS tutorial', author: 'Bob' }
    ];

    test('should search multiple fields with different queries', () => {
      const results = search.searchMultipleFields('search', testObjects, {
        'title': 'JavaScript',
        'content': 'Python',
        'author': 'Jane'
      });
      
      expect(results.length).toBeGreaterThan(0);
    });

    test('should return match information', () => {
      const results = search.searchMultipleFields('', testObjects, {
        'title': 'JavaScript',
        'author': 'John'
      });
      
      if (results.length > 0) {
        expect(results[0].match).toBeDefined();
        expect(results[0].match.field).toBeDefined();
        expect(results[0].match.value).toBeDefined();
      }
    });
  });

  describe('Regex Search', () => {
    const testStrings = ['test123', 'hello world', 'email@example.com', 'phone: 123-456-7890'];

    test('should search with regex patterns', () => {
      const results = search.searchWithRegex('\\d+', testStrings);
      expect(results.length).toBeGreaterThan(1); // test123과 phone 번호가 매치됨
    });

    test('should search email patterns', () => {
      const results = search.searchWithRegex('[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', testStrings);
      expect(results).toHaveLength(1);
      expect(results[0]).toBe('email@example.com');
    });

    test('should handle invalid regex gracefully', () => {
      const results = search.searchWithRegex('[invalid', testStrings);
      expect(results).toEqual([]);
    });
  });

  describe('Highlight Matches', () => {
    test('should highlight exact matches', () => {
      const result = search.highlightMatches('test', 'this is a test string');
      expect(result).toContain('<mark>test</mark>');
    });

    test('should highlight multiple matches', () => {
      const result = search.highlightMatches('test', 'test this test');
      expect(result).toBe('<mark>test</mark> this <mark>test</mark>');
    });

    test('should use custom highlight tags', () => {
      const result = search.highlightMatches('test', 'testing', 'strong');
      expect(result).toContain('<strong>');
      expect(result).toContain('</strong>');
    });

    test('should handle case insensitive highlighting', () => {
      const result = search.highlightMatches('TEST', 'this is a test');
      expect(result).toContain('<mark>test</mark>');
    });

    test('should handle empty inputs', () => {
      expect(search.highlightMatches('', 'test')).toBe('test');
      expect(search.highlightMatches('test', '')).toBe('');
    });
  });

  describe('Search Statistics', () => {
    const testStrings = ['apple', 'application', 'apply', 'orange', 'grape'];

    test('should calculate search statistics', () => {
      const stats = search.getSearchStats('app', testStrings);
      
      expect(stats.totalItems).toBe(5);
      expect(stats.matchedItems).toBeGreaterThan(0);
      expect(stats.matchRate).toBeGreaterThan(0);
      expect(stats.averageScore).toBeGreaterThan(0);
      expect(stats.maxScore).toBeGreaterThan(0);
      expect(stats.threshold).toBe(search.options.threshold);
    });

    test('should handle no matches', () => {
      const stats = search.getSearchStats('xyz', testStrings);
      
      expect(stats.totalItems).toBe(5);
      expect(stats.matchedItems).toBe(0);
      expect(stats.matchRate).toBe(0);
      expect(stats.averageScore).toBe(0);
      expect(stats.maxScore).toBe(0);
    });
  });

  describe('Configuration Options', () => {
    test('should respect case sensitivity option', () => {
      const caseSensitiveSearch = new FuzzySearch({ caseSensitive: true });
      const caseInsensitiveSearch = new FuzzySearch({ caseSensitive: false });
      
      const sensitiveScore = caseSensitiveSearch.calculateScore('Test', 'test');
      const insensitiveScore = caseInsensitiveSearch.calculateScore('Test', 'test');
      
      expect(insensitiveScore).toBeGreaterThan(sensitiveScore);
    });

    test('should respect threshold option', () => {
      const lowThreshold = new FuzzySearch({ threshold: 0.1 });
      const highThreshold = new FuzzySearch({ threshold: 0.9 });
      
      const strings = ['test', 'testing', 'completely different'];
      
      const lowResults = lowThreshold.searchStrings('test', strings);
      const highResults = highThreshold.searchStrings('test', strings);
      
      expect(lowResults.length).toBeGreaterThanOrEqual(highResults.length);
    });

    test('should respect includeScore option', () => {
      const withScores = new FuzzySearch({ includeScore: true });
      const withoutScores = new FuzzySearch({ includeScore: false });
      
      const strings = ['test', 'testing'];
      
      const resultsWithScores = withScores.searchStrings('test', strings);
      const resultsWithoutScores = withoutScores.searchStrings('test', strings);
      
      expect(resultsWithScores[0]).toHaveProperty('score');
      expect(typeof resultsWithoutScores[0]).toBe('string');
    });
  });

  describe('Singleton Instance', () => {
    test('should export singleton instance', () => {
      expect(fuzzySearch).toBeInstanceOf(FuzzySearch);
      expect(fuzzySearch.options.threshold).toBe(0.3);
      expect(fuzzySearch.options.caseSensitive).toBe(false);
    });

    test('should work with singleton instance', () => {
      const results = fuzzySearch.searchStrings('test', ['testing', 'contest', 'different']);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('score');
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty arrays', () => {
      expect(search.searchStrings('test', [])).toEqual([]);
      expect(search.searchObjects('test', [], ['name'])).toEqual([]);
    });

    test('should handle null/undefined inputs', () => {
      expect(search.calculateScore(null, 'test')).toBe(0);
      expect(search.calculateScore('test', null)).toBe(0);
      expect(search.searchStrings(null, ['test'])).toEqual([]);
    });

    test('should handle special characters', () => {
      const strings = ['test@example.com', 'hello-world', 'file.txt'];
      const results = search.searchStrings('test@', strings);
      expect(results.length).toBeGreaterThan(0);
    });

    test('should handle very long strings', () => {
      const longString = 'a'.repeat(1000);
      const score = search.calculateScore('a', longString);
      expect(score).toBeGreaterThan(0.8);
    });

    test('should handle unicode characters', () => {
      const strings = ['测试', '한글', 'عربي', 'русский'];
      const results = search.searchStrings('测试', strings);
      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(1);
    });
  });
});
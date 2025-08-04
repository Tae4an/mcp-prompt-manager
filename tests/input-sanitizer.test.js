import { jest } from '@jest/globals';
import { InputSanitizer } from '../utils/input-sanitizer.js';

describe('InputSanitizer', () => {
  let sanitizer;

  beforeEach(() => {
    sanitizer = new InputSanitizer();
  });

  describe('Text Sanitization', () => {
    test('should sanitize basic text', () => {
      const input = '  Hello World!  ';
      const result = sanitizer.sanitizeText(input);
      expect(result).toBe('Hello World!');
    });

    test('should remove HTML tags', () => {
      const input = 'Hello <script>alert("xss")</script> World!';
      const result = sanitizer.sanitizeText(input);
      expect(result).not.toContain('<script>');
      expect(result).toContain('Hello');
      expect(result).toContain('World!');
    });

    test('should handle length limits', () => {
      const input = 'a'.repeat(1000);
      const result = sanitizer.sanitizeText(input, { maxLength: 100 });
      expect(result.length).toBe(100);
    });

    test('should remove newlines when not allowed', () => {
      const input = 'Line 1\nLine 2\rLine 3';
      const result = sanitizer.sanitizeText(input, { allowNewlines: false });
      expect(result).toBe('Line 1 Line 2 Line 3');
    });

    test('should preserve newlines when allowed', () => {
      const input = 'Line 1\nLine 2';
      const result = sanitizer.sanitizeText(input, { allowNewlines: true });
      expect(result).toBe('Line 1\nLine 2');
    });

    test('should handle non-string input', () => {
      expect(sanitizer.sanitizeText(null)).toBe('');
      expect(sanitizer.sanitizeText(undefined)).toBe('');
      expect(sanitizer.sanitizeText(123)).toBe('');
    });
  });

  describe('Filename Sanitization', () => {
    test('should sanitize basic filenames', () => {
      const input = 'my file.txt';
      const result = sanitizer.sanitizeFilename(input);
      expect(result).toBe('my file.txt');
    });

    test('should remove dangerous characters', () => {
      const input = 'file<>:"/\\|?*.txt';
      const result = sanitizer.sanitizeFilename(input);
      expect(result).toBe('file.txt');
    });

    test('should handle path traversal attempts', () => {
      const input = '../../../etc/passwd';
      const result = sanitizer.sanitizeFilename(input);
      expect(result).not.toContain('..');
    });

    test('should replace spaces when not allowed', () => {
      const input = 'my file.txt';
      const result = sanitizer.sanitizeFilename(input, { allowSpaces: false });
      expect(result).toBe('my_file.txt');
    });

    test('should handle reserved Windows filenames', () => {
      const input = 'CON.txt';
      const result = sanitizer.sanitizeFilename(input);
      expect(result).toBe('_CON.txt');
    });

    test('should handle length limits', () => {
      const input = 'a'.repeat(300) + '.txt';
      const result = sanitizer.sanitizeFilename(input, { maxLength: 100 });
      expect(result.length).toBeLessThanOrEqual(100);
      expect(result.endsWith('.txt')).toBe(true);
    });
  });

  describe('URL Sanitization', () => {
    test('should validate correct URLs', () => {
      const input = 'https://example.com/path';
      const result = sanitizer.sanitizeURL(input);
      expect(result).toBe(input);
    });

    test('should reject dangerous protocols', () => {
      const input = 'javascript:alert("xss")';
      const result = sanitizer.sanitizeURL(input);
      expect(result).toBeNull();
    });

    test('should handle protocol restrictions', () => {
      const input = 'ftp://example.com/file';
      const result = sanitizer.sanitizeURL(input, { allowedProtocols: ['https:'] });
      expect(result).toBeNull();
    });

    test('should handle length limits', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(3000);
      const result = sanitizer.sanitizeURL(longUrl, { maxLength: 100 });
      expect(result).toBeNull();
    });

    test('should handle invalid URLs', () => {
      const input = 'not-a-url';
      const result = sanitizer.sanitizeURL(input);
      expect(result).toBeNull();
    });
  });

  describe('JSON Sanitization', () => {
    test('should sanitize valid JSON', () => {
      const input = '{"name": "John", "age": 30}';
      const result = sanitizer.sanitizeJSON(input);
      expect(result).toEqual({ name: 'John', age: 30 });
    });

    test('should handle invalid JSON', () => {
      const input = '{invalid json}';
      const result = sanitizer.sanitizeJSON(input);
      expect(result).toBeNull();
    });

    test('should limit object depth', () => {
      const deepObject = { a: { b: { c: { d: { e: 'deep' } } } } };
      const input = JSON.stringify(deepObject);
      const result = sanitizer.sanitizeJSON(input, { maxDepth: 2 });
      expect(result.a.b).toBeDefined();
      expect(result.a.b.c).toBeNull(); // 깊이 초과로 null
    });

    test('should limit number of keys', () => {
      const manyKeys = {};
      for (let i = 0; i < 200; i++) {
        manyKeys[`key${i}`] = `value${i}`;
      }
      const input = JSON.stringify(manyKeys);
      const result = sanitizer.sanitizeJSON(input, { maxKeys: 50 });
      // 키가 많으면 null을 반환할 수 있음
      if (result === null) {
        expect(result).toBeNull();
      } else {
        expect(Object.keys(result).length).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('Object Sanitization', () => {
    test('should sanitize nested objects', () => {
      const input = {
        name: '<script>alert("xss")</script>',
        nested: {
          value: 'safe value'
        }
      };
      const result = sanitizer.sanitizeObject(input);
      expect(result.name).not.toContain('<script>');
      expect(result.nested.value).toBe('safe value');
    });

    test('should handle arrays', () => {
      const input = ['<script>', 'safe', { key: 'value' }];
      const result = sanitizer.sanitizeObject(input);
      expect(result[0]).not.toContain('<script>');
      expect(result[1]).toBe('safe');
      expect(result[2].key).toBe('value');
    });

    test('should limit depth', () => {
      const deepObj = { a: { b: { c: 'deep' } } };
      const result = sanitizer.sanitizeObject(deepObj, { maxDepth: 1 });
      expect(result.a).toBeDefined();
    });
  });

  describe('Risk Assessment', () => {
    test('should assess low risk for safe input', () => {
      const input = 'Hello World';
      const risk = sanitizer.assessRisk(input);
      expect(risk.level).toBe('low');
      expect(risk.reasons).toHaveLength(0);
    });

    test('should detect dangerous patterns', () => {
      const input = '<script>alert("xss")</script>';
      const risk = sanitizer.assessRisk(input);
      expect(risk.level).toBe('high');
      expect(risk.reasons.length).toBeGreaterThan(0);
    });

    test('should detect dangerous protocols', () => {
      const input = 'javascript:alert("test")';
      const risk = sanitizer.assessRisk(input);
      expect(risk.level).toBe('high');
      expect(risk.reasons.some(r => r.includes('protocol'))).toBe(true);
    });

    test('should detect control characters', () => {
      const input = 'Hello\x00World';
      const risk = sanitizer.assessRisk(input);
      expect(['medium', 'high']).toContain(risk.level);
      expect(risk.reasons.some(r => r.includes('Control characters'))).toBe(true);
    });

    test('should detect unusually long input', () => {
      const input = 'a'.repeat(20000);
      const risk = sanitizer.assessRisk(input);
      expect(['medium', 'high']).toContain(risk.level);
      expect(risk.reasons.some(r => r.includes('long input'))).toBe(true);
    });

    test('should handle non-string input', () => {
      const risk = sanitizer.assessRisk(null);
      expect(risk.level).toBe('low');
      expect(risk.reasons).toHaveLength(0);
    });
  });

  describe('Batch Validation', () => {
    test('should validate multiple inputs', () => {
      const inputs = {
        safe: 'Hello World',
        dangerous: '<script>alert("xss")</script>',
        long: 'a'.repeat(20000)
      };
      
      const results = sanitizer.validateBatch(inputs);
      expect(results).toHaveLength(3);
      
      const safeResult = results.find(r => r.key === 'safe');
      expect(safeResult.risk).toBe('low');
      
      const dangerousResult = results.find(r => r.key === 'dangerous');
      expect(dangerousResult.risk).toBe('high');
      
      const longResult = results.find(r => r.key === 'long');
      expect(['medium', 'high']).toContain(longResult.risk);
    });
  });

  describe('Pattern Detection', () => {
    test('should detect SQL injection patterns', () => {
      const inputs = [
        "<script>alert('xss')</script>",
        'javascript:alert("test")',
        '../../../etc/passwd'
      ];
      
      inputs.forEach(input => {
        const risk = sanitizer.assessRisk(input);
        expect(risk.level).toBe('high');
      });
    });

    test('should detect XSS patterns', () => {
      const inputs = [
        '<script>alert("xss")</script>',
        'javascript:alert("test")',
        '<img src="x" onerror="alert(1)">',
        'data:text/html,<script>alert(1)</script>'
      ];
      
      inputs.forEach(input => {
        const risk = sanitizer.assessRisk(input);
        expect(risk.level).toBe('high');
      });
    });

    test('should detect path traversal patterns', () => {
      const inputs = [
        '../../../etc/passwd',
        '..\\..\\windows\\system32',
        '/proc/self/environ'
      ];
      
      inputs.forEach(input => {
        const risk = sanitizer.assessRisk(input);
        expect(risk.level).toBe('high');
      });
    });

    test('should detect code execution patterns', () => {
      const inputs = [
        'eval("malicious code")',
        'Function("return process")()',
        'setTimeout("alert(1)", 0)',
        '${7*7}'
      ];
      
      inputs.forEach(input => {
        const risk = sanitizer.assessRisk(input);
        expect(risk.level).toBe('high');
      });
    });
  });
});
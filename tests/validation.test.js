import {
  validateFilename,
  validateContent,
  validateTags,
  validateCategory,
  validateSearchQuery,
  validateVersionNumber,
  validateTemplateVariables,
  sanitizeInput,
  validatePathSafety,
  createValidationError
} from '../utils/validation.js';

describe('Validation Utils', () => {
  describe('validateFilename', () => {
    test('should accept valid filenames', () => {
      const result = validateFilename('valid-filename.txt');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
    });

    test('should reject empty filename', () => {
      const result = validateFilename('');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('필수');
    });

    test('should reject filename with path traversal', () => {
      const result = validateFilename('../secret.txt');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('상위 디렉토리');
    });

    test('should reject absolute paths', () => {
      const result = validateFilename('/etc/passwd');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('절대 경로');
    });

    test('should reject too long filename', () => {
      const longName = 'a'.repeat(256);
      const result = validateFilename(longName);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('255자');
    });
  });

  describe('validateContent', () => {
    test('should accept valid content', () => {
      const result = validateContent('This is valid content');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
    });

    test('should reject too large content', () => {
      const largeContent = 'a'.repeat(1024 * 1024 + 1);
      const result = validateContent(largeContent);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('1MB');
    });
  });

  describe('validateTags', () => {
    test('should accept valid tags', () => {
      const result = validateTags(['tag1', 'tag2', '한글태그']);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
    });

    test('should reject too many tags', () => {
      const manyTags = Array(11).fill('tag');
      const result = validateTags(manyTags);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('최대 10개');
    });

    test('should reject invalid tag characters', () => {
      const result = validateTags(['tag@invalid']);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('영문, 숫자, 한글');
    });

    test('should reject empty tags', () => {
      const result = validateTags(['']);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('비어있을 수 없습니다');
    });
  });

  describe('validateCategory', () => {
    test('should accept valid category', () => {
      const result = validateCategory('Valid Category');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
    });

    test('should reject empty category', () => {
      const result = validateCategory('');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('필수');
    });

    test('should reject too long category', () => {
      const longCategory = 'a'.repeat(51);
      const result = validateCategory(longCategory);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('50자');
    });
  });

  describe('validateSearchQuery', () => {
    test('should accept valid search query', () => {
      const result = validateSearchQuery('search term');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
    });

    test('should reject XSS attempts', () => {
      const result = validateSearchQuery('<script>alert("xss")</script>');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('XSS');
    });

    test('should reject too long query', () => {
      const longQuery = 'a'.repeat(101);
      const result = validateSearchQuery(longQuery);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('100자');
    });
  });

  describe('validateVersionNumber', () => {
    test('should accept valid version number', () => {
      const result = validateVersionNumber(1);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
    });

    test('should reject negative version', () => {
      const result = validateVersionNumber(-1);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('양수');
    });

    test('should reject non-integer version', () => {
      const result = validateVersionNumber(1.5);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('정수');
    });

    test('should reject too large version', () => {
      const result = validateVersionNumber(1000001);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('너무 큽니다');
    });
  });

  describe('validateTemplateVariables', () => {
    test('should accept valid template variables', () => {
      const result = validateTemplateVariables({ name: 'John', age: '25' });
      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
    });

    test('should reject too many variables', () => {
      const manyVars = {};
      for (let i = 0; i < 51; i++) {
        manyVars[`var${i}`] = 'value';
      }
      const result = validateTemplateVariables(manyVars);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('최대 50개');
    });

    test('should reject too long variable value', () => {
      const result = validateTemplateVariables({ 
        name: 'a'.repeat(1001) 
      });
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('1000자');
    });
  });

  describe('sanitizeInput', () => {
    test('should remove HTML tags', () => {
      const result = sanitizeInput('<script>alert("xss")</script>');
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
    });

    test('should trim whitespace', () => {
      const result = sanitizeInput('  text  ');
      expect(result).toBe('text');
    });

    test('should limit length', () => {
      const longText = 'a'.repeat(20000);
      const result = sanitizeInput(longText);
      expect(result.length).toBe(10000);
    });

    test('should handle non-string input', () => {
      const result = sanitizeInput(123);
      expect(result).toBe(123);
    });
  });

  describe('validatePathSafety', () => {
    test('should accept safe paths', () => {
      expect(validatePathSafety('safe/path.txt')).toBe(true);
      expect(validatePathSafety('file.txt')).toBe(true);
    });

    test('should reject path traversal attempts', () => {
      expect(validatePathSafety('../secret.txt')).toBe(false);
      expect(validatePathSafety('folder/../secret.txt')).toBe(false);
    });

    test('should reject absolute paths', () => {
      expect(validatePathSafety('/etc/passwd')).toBe(false);
      // Windows 스타일 절대 경로는 macOS/Linux에서 상대 경로로 인식될 수 있음
      if (process.platform === 'win32') {
        expect(validatePathSafety('C:\\Windows\\System32')).toBe(false);
      }
    });

    test('should reject dangerous Windows filenames', () => {
      expect(validatePathSafety('CON.txt')).toBe(false);
      expect(validatePathSafety('PRN.txt')).toBe(false);
      expect(validatePathSafety('AUX.txt')).toBe(false);
      expect(validatePathSafety('COM1.txt')).toBe(false);
    });
  });

  describe('createValidationError', () => {
    test('should create validation error with message', () => {
      const error = createValidationError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('ValidationError');
      expect(error.field).toBeNull();
    });

    test('should create validation error with field', () => {
      const error = createValidationError('Test error', 'filename');
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('ValidationError');
      expect(error.field).toBe('filename');
    });
  });
});
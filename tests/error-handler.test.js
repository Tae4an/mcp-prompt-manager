import { jest } from '@jest/globals';
import {
  PromptError,
  ValidationError,
  FileNotFoundError,
  FileAlreadyExistsError,
  PermissionError,
  StorageError,
  VersionError,
  classifyError,
  safeFileOperation,
  createErrorResponse,
  createSuccessResponse,
  retryOperation,
  logError,
  ErrorTracker
} from '../utils/error-handler.js';

describe('Error Handler', () => {
  describe('Custom Error Classes', () => {
    test('should create PromptError with correct properties', () => {
      const error = new PromptError('Test message', 'TEST_CODE', 400);
      
      expect(error.name).toBe('PromptError');
      expect(error.message).toBe('Test message');
      expect(error.code).toBe('TEST_CODE');
      expect(error.statusCode).toBe(400);
      expect(error.timestamp).toBeDefined();
    });

    test('should create ValidationError with field', () => {
      const error = new ValidationError('Invalid field', 'username');
      
      expect(error.name).toBe('ValidationError');
      expect(error.field).toBe('username');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
    });

    test('should create FileNotFoundError', () => {
      const error = new FileNotFoundError('test.txt');
      
      expect(error.name).toBe('FileNotFoundError');
      expect(error.filename).toBe('test.txt');
      expect(error.code).toBe('FILE_NOT_FOUND');
      expect(error.statusCode).toBe(404);
    });

    test('should create FileAlreadyExistsError', () => {
      const error = new FileAlreadyExistsError('test.txt');
      
      expect(error.name).toBe('FileAlreadyExistsError');
      expect(error.filename).toBe('test.txt');
      expect(error.code).toBe('FILE_ALREADY_EXISTS');
      expect(error.statusCode).toBe(409);
    });
  });

  describe('Error Classification', () => {
    test('should classify ENOENT error', () => {
      const fsError = new Error('File not found');
      fsError.code = 'ENOENT';
      fsError.path = '/test/path';
      
      const classified = classifyError(fsError);
      
      expect(classified).toBeInstanceOf(FileNotFoundError);
      expect(classified.filename).toBe('/test/path');
    });

    test('should classify EEXIST error', () => {
      const fsError = new Error('File exists');
      fsError.code = 'EEXIST';
      fsError.path = '/test/path';
      
      const classified = classifyError(fsError);
      
      expect(classified).toBeInstanceOf(FileAlreadyExistsError);
      expect(classified.filename).toBe('/test/path');
    });

    test('should classify EACCES error', () => {
      const fsError = new Error('Permission denied');
      fsError.code = 'EACCES';
      fsError.path = '/test/path';
      
      const classified = classifyError(fsError);
      
      expect(classified).toBeInstanceOf(PermissionError);
      expect(classified.filename).toBe('/test/path');
    });

    test('should classify ZodError', () => {
      const zodError = {
        name: 'ZodError',
        errors: [{
          path: ['field', 'subfield'],
          message: 'Invalid value'
        }]
      };
      
      const classified = classifyError(zodError);
      
      expect(classified).toBeInstanceOf(ValidationError);
      expect(classified.field).toBe('field.subfield');
      expect(classified.message).toContain('Invalid value');
    });

    test('should classify JSON SyntaxError', () => {
      const jsonError = new SyntaxError('Unexpected token in JSON');
      
      const classified = classifyError(jsonError);
      
      expect(classified).toBeInstanceOf(ValidationError);
      expect(classified.message).toContain('Invalid JSON format');
    });

    test('should wrap unknown errors', () => {
      const unknownError = new Error('Unknown error');
      
      const classified = classifyError(unknownError);
      
      expect(classified).toBeInstanceOf(PromptError);
      expect(classified.message).toBe('Unknown error');
    });
  });

  describe('Safe File Operation', () => {
    test('should execute successful operation', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      
      const result = await safeFileOperation(operation, 'test context');
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test('should classify and rethrow errors', async () => {
      const fsError = new Error('File not found');
      fsError.code = 'ENOENT';
      fsError.path = '/test/path';
      
      const operation = jest.fn().mockRejectedValue(fsError);
      
      await expect(safeFileOperation(operation, 'test context')).rejects.toThrow(FileNotFoundError);
    });

    test('should add context to error', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Test error'));
      
      try {
        await safeFileOperation(operation, 'test context');
      } catch (error) {
        expect(error.context).toBe('test context');
      }
    });
  });

  describe('Response Creation', () => {
    test('should create error response', () => {
      const error = new ValidationError('Invalid input', 'field');
      const response = createErrorResponse(error);
      
      expect(response.success).toBe(false);
      expect(response.error.name).toBe('ValidationError');
      expect(response.error.message).toBe('Invalid input');
      expect(response.error.field).toBe('field');
      expect(response.error.timestamp).toBeDefined();
    });

    test('should create success response', () => {
      const response = createSuccessResponse('test data', 'Success message');
      
      expect(response.success).toBe(true);
      expect(response.data).toBe('test data');
      expect(response.message).toBe('Success message');
      expect(response.timestamp).toBeDefined();
    });

    test('should include stack trace in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      
      const error = new Error('Test error');
      const response = createErrorResponse(error, true);
      
      expect(response.error.stack).toBeDefined();
      
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Retry Operation', () => {
    test('should succeed on first attempt', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      
      const result = await retryOperation(operation, 3, 10);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test('should retry on transient errors', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new StorageError('Temporary failure'))
        .mockResolvedValue('success');
      
      const result = await retryOperation(operation, 3, 10);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    test('should not retry on validation errors', async () => {
      const operation = jest.fn().mockRejectedValue(new ValidationError('Invalid input'));
      
      await expect(retryOperation(operation, 3, 10)).rejects.toThrow(ValidationError);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test('should fail after max retries', async () => {
      const error = new StorageError('Persistent failure');
      const operation = jest.fn().mockRejectedValue(error);
      
      await expect(retryOperation(operation, 2, 10)).rejects.toThrow(StorageError);
      expect(operation).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Tracker', () => {
    let tracker;

    beforeEach(() => {
      tracker = new ErrorTracker();
    });

    test('should track errors', () => {
      const error1 = new ValidationError('Error 1');
      const error2 = new FileNotFoundError('file.txt');
      const error3 = new ValidationError('Error 2');
      
      tracker.track(error1);
      tracker.track(error2);
      tracker.track(error3);
      
      const stats = tracker.getStats();
      
      expect(stats.totalErrors).toBe(3);
      expect(stats.errorsByType['ValidationError:VALIDATION_ERROR']).toBe(2);
      expect(stats.errorsByType['FileNotFoundError:FILE_NOT_FOUND']).toBe(1);
      expect(stats.recentErrors).toHaveLength(3);
    });

    test('should limit recent errors', () => {
      tracker.maxRecentErrors = 2;
      
      tracker.track(new Error('Error 1'));
      tracker.track(new Error('Error 2'));
      tracker.track(new Error('Error 3'));
      
      const stats = tracker.getStats();
      
      expect(stats.recentErrors).toHaveLength(2);
      expect(stats.recentErrors[0].message).toBe('Error 3'); // Most recent first
    });

    test('should reset statistics', () => {
      tracker.track(new Error('Error'));
      tracker.reset();
      
      const stats = tracker.getStats();
      
      expect(stats.totalErrors).toBe(0);
      expect(stats.recentErrors).toHaveLength(0);
    });
  });

  describe('Logging', () => {
    let consoleSpy;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    test('should log error with context', () => {
      const error = new ValidationError('Test error');
      const context = { operation: 'test' };
      
      logError(error, context);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"level": "ERROR"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"message": "Test error"')
      );
    });
  });
});
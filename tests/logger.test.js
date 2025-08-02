import { jest } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger, LogLevel, log } from '../utils/logger.js';

describe('Logger', () => {
  let testLogger;
  let testLogDir;

  beforeEach(() => {
    testLogDir = path.join(process.cwd(), 'tests', 'temp_logs');
    testLogger = new Logger({
      level: LogLevel.DEBUG,
      enableConsole: false,
      enableFile: true,
      logDir: testLogDir,
      format: 'json'
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(testLogDir, { recursive: true, force: true });
    } catch (error) {
      // 정리 실패는 무시
    }
  });

  describe('Log Levels', () => {
    test('should respect log level filtering', async () => {
      const logger = new Logger({ level: LogLevel.WARN, enableConsole: false });
      
      expect(logger.shouldLog(LogLevel.ERROR)).toBe(true);
      expect(logger.shouldLog(LogLevel.WARN)).toBe(true);
      expect(logger.shouldLog(LogLevel.INFO)).toBe(false);
      expect(logger.shouldLog(LogLevel.DEBUG)).toBe(false);
    });

    test('should create proper log entry structure', () => {
      const entry = testLogger.createLogEntry(LogLevel.INFO, 'Test message', { key: 'value' });
      
      expect(entry.timestamp).toBeDefined();
      expect(entry.level).toBe(LogLevel.INFO);
      expect(entry.message).toBe('Test message');
      expect(entry.pid).toBe(process.pid);
      expect(entry.key).toBe('value');
    });
  });

  describe('Formatting', () => {
    test('should format JSON logs correctly', () => {
      const entry = { timestamp: '2023-01-01T00:00:00.000Z', level: 'INFO', message: 'Test' };
      const formatted = testLogger.formatLogEntry(entry);
      
      expect(() => JSON.parse(formatted)).not.toThrow();
      expect(JSON.parse(formatted)).toEqual(entry);
    });

    test('should format text logs correctly', () => {
      const textLogger = new Logger({ format: 'text', enableConsole: false });
      const entry = { 
        timestamp: '2023-01-01T00:00:00.000Z', 
        level: 'INFO', 
        message: 'Test message',
        meta: 'data'
      };
      
      const formatted = textLogger.formatLogEntry(entry);
      
      expect(formatted).toContain('[2023-01-01T00:00:00.000Z]');
      expect(formatted).toContain('INFO: Test message');
      expect(formatted).toContain('meta');
    });
  });

  describe('File Logging', () => {
    test('should initialize log directory', async () => {
      await testLogger.init();
      
      const stats = await fs.stat(testLogDir);
      expect(stats.isDirectory()).toBe(true);
    });

    test('should write logs to file', async () => {
      await testLogger.init();
      await testLogger.info('Test log message', { test: true });
      
      const files = await fs.readdir(testLogDir);
      expect(files.length).toBeGreaterThan(0);
      
      const logFile = files.find(f => f.endsWith('.log'));
      expect(logFile).toBeDefined();
      
      const content = await fs.readFile(path.join(testLogDir, logFile), 'utf-8');
      expect(content).toContain('Test log message');
      expect(content).toContain('"test":true');
    });

    test('should handle file logging errors gracefully', async () => {
      const badLogger = new Logger({
        enableFile: true,
        logDir: '/invalid/path/that/does/not/exist',
        enableConsole: false
      });
      
      // 로그 디렉토리 생성 실패 시에도 에러가 발생하지 않아야 함
      await expect(badLogger.init()).resolves.not.toThrow();
      
      // 파일 쓰기 실패 시에도 에러가 발생하지 않아야 함
      await expect(badLogger.info('test')).resolves.not.toThrow();
    });
  });

  describe('Log Rotation', () => {
    test('should rotate log files when size limit reached', async () => {
      const smallLogger = new Logger({
        enableFile: true,
        logDir: testLogDir,
        maxFileSize: 100, // Very small size for testing
        enableConsole: false
      });
      
      await smallLogger.init();
      
      // Write enough logs to trigger rotation
      for (let i = 0; i < 20; i++) {
        await smallLogger.info(`Log message ${i}`, { iteration: i });
      }
      
      const files = await fs.readdir(testLogDir);
      const logFiles = files.filter(f => f.includes('.log'));
      
      // Should have main log file and at least one rotated file
      expect(logFiles.length).toBeGreaterThan(1);
    });
  });

  describe('Performance Timing', () => {
    test('should measure operation time', async () => {
      const timer = testLogger.time('test-operation');
      
      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const duration = await timer.end({ test: true });
      
      expect(duration).toBeGreaterThan(5); // Should be at least 5ms
      expect(typeof duration).toBe('number');
    });
  });

  describe('Log Statistics', () => {
    test('should provide log file statistics', async () => {
      await testLogger.init();
      await testLogger.info('Test message 1');
      await testLogger.error('Test error message');
      
      const stats = await testLogger.getLogStats();
      
      expect(stats.totalLogFiles).toBeGreaterThan(0);
      expect(stats.logDirectory).toBe(testLogDir);
      expect(stats.files).toBeDefined();
      expect(Array.isArray(stats.files)).toBe(true);
    });

    test('should handle stats request when file logging disabled', async () => {
      const noFileLogger = new Logger({ enableFile: false });
      const stats = await noFileLogger.getLogStats();
      
      expect(stats.error).toBeDefined();
    });
  });

  describe('Log Search', () => {
    test('should search logs by content', async () => {
      await testLogger.init();
      await testLogger.info('Important message');
      await testLogger.error('Error occurred');
      await testLogger.debug('Debug information');
      
      const results = await testLogger.searchLogs('Important');
      
      expect(results.results).toBeDefined();
      expect(results.results.length).toBeGreaterThan(0);
      expect(results.results[0].message).toContain('Important');
    });

    test('should filter logs by level', async () => {
      await testLogger.init();
      await testLogger.info('Info message');
      await testLogger.error('Error message');
      
      const results = await testLogger.searchLogs('message', { level: LogLevel.ERROR });
      
      expect(results.results).toBeDefined();
      expect(results.results.every(r => r.level === LogLevel.ERROR)).toBe(true);
    });

    test('should limit search results', async () => {
      await testLogger.init();
      
      for (let i = 0; i < 10; i++) {
        await testLogger.info(`Message ${i}`);
      }
      
      const results = await testLogger.searchLogs('Message', { limit: 5 });
      
      expect(results.results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Console Logging', () => {
    let consoleSpy;

    beforeEach(() => {
      consoleSpy = {
        log: jest.spyOn(console, 'log').mockImplementation(() => {}),
        error: jest.spyOn(console, 'error').mockImplementation(() => {}),
        warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
        debug: jest.spyOn(console, 'debug').mockImplementation(() => {})
      };
    });

    afterEach(() => {
      Object.values(consoleSpy).forEach(spy => spy.mockRestore());
    });

    test('should write to appropriate console methods', async () => {
      const consoleLogger = new Logger({ 
        enableConsole: true, 
        enableFile: false,
        level: LogLevel.DEBUG 
      });
      
      await consoleLogger.error('Error message');
      await consoleLogger.warn('Warning message');
      await consoleLogger.info('Info message');
      await consoleLogger.debug('Debug message');
      
      expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining('Error message'));
      expect(consoleSpy.warn).toHaveBeenCalledWith(expect.stringContaining('Warning message'));
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('Info message'));
      // Debug method might fallback to console.log in some environments
      expect(consoleSpy.debug.mock.calls.length + consoleSpy.log.mock.calls.filter(call => 
        call[0].includes('Debug message')).length).toBeGreaterThan(0);
    });
  });

  describe('Default Logger', () => {
    test('should use convenience functions', async () => {
      // Test that convenience functions exist and can be called
      expect(typeof log.info).toBe('function');
      expect(typeof log.error).toBe('function');
      expect(typeof log.warn).toBe('function');
      expect(typeof log.debug).toBe('function');
      expect(typeof log.time).toBe('function');
      
      // These should not throw errors
      await expect(log.info('Test message')).resolves.not.toThrow();
      await expect(log.error('Test error')).resolves.not.toThrow();
    });
  });
});
import * as fs from 'fs/promises';
import * as path from 'path';

// 로그 레벨 정의
export const LogLevel = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG'
};

// 로그 레벨 우선순위
const LOG_PRIORITIES = {
  [LogLevel.ERROR]: 0,
  [LogLevel.WARN]: 1,
  [LogLevel.INFO]: 2,
  [LogLevel.DEBUG]: 3
};

export class Logger {
  constructor(options = {}) {
    this.level = options.level || LogLevel.INFO;
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile || false;
    this.logDir = options.logDir || process.env.LOG_DIR || './logs';
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.maxFiles = options.maxFiles || 5;
    this.format = options.format || process.env.LOG_FORMAT || 'json'; // 'json' or 'text'
    this.redactKeys = new Set([
      'password', 'pass', 'secret', 'token', 'accessToken', 'authorization', 'apiKey'
    ]);
  }

  async init() {
    if (this.enableFile) {
      try {
        await fs.mkdir(this.logDir, { recursive: true });
      } catch (error) {
        console.error('Failed to create log directory:', error);
        this.enableFile = false;
      }
    }
  }

  shouldLog(level) {
    return LOG_PRIORITIES[level] <= LOG_PRIORITIES[this.level];
  }

  createLogEntry(level, message, metadata = {}) {
    return {
      timestamp: new Date().toISOString(),
      level: level,
      message: message,
      pid: process.pid,
      ...this.redactMetadata(metadata)
    };
  }

  formatLogEntry(entry) {
    if (this.format === 'json') {
      return JSON.stringify(entry);
    } else {
      const { timestamp, level, message, ...meta } = entry;
      let formatted = `[${timestamp}] ${level}: ${message}`;
      
      if (Object.keys(meta).length > 0) {
        formatted += ` | ${JSON.stringify(meta)}`;
      }
      
      return formatted;
    }
  }

  async writeToFile(entry) {
    if (!this.enableFile) return;

    try {
      const filename = `app-${new Date().toISOString().split('T')[0]}.log`;
      const filepath = path.join(this.logDir, filename);
      const logLine = this.formatLogEntry(entry) + '\n';

      // 파일 크기 체크 및 로테이션
      try {
        const stats = await fs.stat(filepath);
        if (stats.size + Buffer.byteLength(logLine) > this.maxFileSize) {
          await this.rotateLogFile(filepath);
        }
      } catch (error) {
        // 파일이 없으면 새로 생성
      }

      await fs.appendFile(filepath, logLine, 'utf-8');
    } catch (error) {
      console.error('Failed to write log to file:', error);
    }
  }

  async rotateLogFile(filepath) {
    try {
      const { dir, name, ext } = path.parse(filepath);
      
      // 기존 백업 파일들 이동
      for (let i = this.maxFiles - 1; i > 0; i--) {
        const oldFile = path.join(dir, `${name}.${i}${ext}`);
        const newFile = path.join(dir, `${name}.${i + 1}${ext}`);
        
        try {
          await fs.rename(oldFile, newFile);
        } catch (error) {
          // 파일이 없으면 무시
        }
      }

      // 현재 파일을 .1로 이동
      const backupFile = path.join(dir, `${name}.1${ext}`);
      await fs.rename(filepath, backupFile);

      // 오래된 백업 파일 삭제
      const deleteFile = path.join(dir, `${name}.${this.maxFiles + 1}${ext}`);
      try {
        await fs.unlink(deleteFile);
      } catch (error) {
        // 파일이 없으면 무시
      }
    } catch (error) {
      console.error('Failed to rotate log file:', error);
    }
  }

  writeToConsole(entry) {
    if (!this.enableConsole) return;

    const formatted = this.formatLogEntry(entry);
    
    switch (entry.level) {
      case LogLevel.ERROR:
        console.error(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      case LogLevel.DEBUG:
        console.debug(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  async log(level, message, metadata = {}) {
    if (!this.shouldLog(level)) return;

    const entry = this.createLogEntry(level, message, metadata);
    
    this.writeToConsole(entry);
    await this.writeToFile(entry);
  }

  redactMetadata(metadata) {
    try {
      const replacer = (key, value) => {
        if (this.redactKeys.has(key)) return '[REDACTED]';
        return value;
      };
      // 깊은 복사 + 레닥션
      return JSON.parse(JSON.stringify(metadata, replacer));
    } catch {
      return metadata;
    }
  }

  async error(message, metadata = {}) {
    await this.log(LogLevel.ERROR, message, metadata);
  }

  async warn(message, metadata = {}) {
    await this.log(LogLevel.WARN, message, metadata);
  }

  async info(message, metadata = {}) {
    await this.log(LogLevel.INFO, message, metadata);
  }

  async debug(message, metadata = {}) {
    await this.log(LogLevel.DEBUG, message, metadata);
  }

  // 성능 측정용 메서드
  time(label) {
    const start = process.hrtime.bigint();
    return {
      end: async (metadata = {}) => {
        const end = process.hrtime.bigint();
        const duration = Number(end - start) / 1000000; // nanoseconds to milliseconds
        
        await this.info(`Timer [${label}] completed`, {
          duration: `${duration.toFixed(2)}ms`,
          ...metadata
        });
        
        return duration;
      }
    };
  }

  // 통계 수집
  async getLogStats() {
    if (!this.enableFile) {
      return { error: 'File logging is disabled' };
    }

    try {
      const files = await fs.readdir(this.logDir);
      const logFiles = files.filter(f => f.endsWith('.log'));
      
      const stats = {
        totalLogFiles: logFiles.length,
        logDirectory: this.logDir,
        files: []
      };

      for (const file of logFiles) {
        const filepath = path.join(this.logDir, file);
        try {
          const fileStats = await fs.stat(filepath);
          stats.files.push({
            name: file,
            size: fileStats.size,
            created: fileStats.birthtime,
            modified: fileStats.mtime
          });
        } catch (error) {
          // 파일 통계 읽기 실패는 무시
        }
      }

      return stats;
    } catch (error) {
      return { error: error.message };
    }
  }

  // 로그 검색
  async searchLogs(query, options = {}) {
    if (!this.enableFile) {
      return { error: 'File logging is disabled' };
    }

    const {
      level = null,
      startDate = null,
      endDate = null,
      limit = 100
    } = options;

    try {
      const files = await fs.readdir(this.logDir);
      const logFiles = files.filter(f => f.endsWith('.log')).sort().reverse();
      
      const results = [];
      let found = 0;

      for (const file of logFiles) {
        if (found >= limit) break;

        const filepath = path.join(this.logDir, file);
        const content = await fs.readFile(filepath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());

        for (const line of lines) {
          if (found >= limit) break;

          try {
            let entry;
            if (this.format === 'json') {
              entry = JSON.parse(line);
            } else {
              // 텍스트 형식 파싱 (간단한 형태)
              const match = line.match(/\[(.*?)\] (.*?): (.*)/);
              if (match) {
                entry = {
                  timestamp: match[1],
                  level: match[2],
                  message: match[3]
                };
              }
            }

            if (!entry) continue;

            // 필터 적용
            if (level && entry.level !== level) continue;
            
            if (startDate && new Date(entry.timestamp) < new Date(startDate)) continue;
            if (endDate && new Date(entry.timestamp) > new Date(endDate)) continue;
            
            if (query && !entry.message.toLowerCase().includes(query.toLowerCase())) continue;

            results.push(entry);
            found++;
          } catch (error) {
            // 파싱 에러는 무시
          }
        }
      }

      return {
        results: results,
        total: found,
        query: query,
        filters: { level, startDate, endDate, limit }
      };
    } catch (error) {
      return { error: error.message };
    }
  }
}

// 기본 로거 인스턴스
export const defaultLogger = new Logger({
  level: process.env.LOG_LEVEL || LogLevel.INFO,
  enableConsole: process.env.NODE_ENV !== 'test',
  enableFile: process.env.ENABLE_FILE_LOGGING === 'true',
  logDir: process.env.LOG_DIR || './logs',
  format: process.env.LOG_FORMAT || 'json'
});

// 로거 초기화
defaultLogger.init().catch(error => {
  console.error('Failed to initialize logger:', error);
});

// 편의 함수들
export const log = {
  error: (message, meta) => defaultLogger.error(message, meta),
  warn: (message, meta) => defaultLogger.warn(message, meta),
  info: (message, meta) => defaultLogger.info(message, meta),
  debug: (message, meta) => defaultLogger.debug(message, meta),
  time: (label) => defaultLogger.time(label)
};
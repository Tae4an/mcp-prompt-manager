import * as fs from 'fs';

// 커스텀 에러 클래스들
export class PromptError extends Error {
  constructor(message, code = 'PROMPT_ERROR', statusCode = 500) {
    super(message);
    this.name = 'PromptError';
    this.code = code;
    this.statusCode = statusCode;
    this.timestamp = new Date().toISOString();
  }
}

export class ValidationError extends PromptError {
  constructor(message, field = null) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
    this.field = field;
  }
}

export class FileNotFoundError extends PromptError {
  constructor(filename) {
    super(`File not found: ${filename}`, 'FILE_NOT_FOUND', 404);
    this.name = 'FileNotFoundError';
    this.filename = filename;
  }
}

export class FileAlreadyExistsError extends PromptError {
  constructor(filename) {
    super(`File already exists: ${filename}`, 'FILE_ALREADY_EXISTS', 409);
    this.name = 'FileAlreadyExistsError';
    this.filename = filename;
  }
}

export class PermissionError extends PromptError {
  constructor(operation, filename) {
    super(`Permission denied for ${operation} on ${filename}`, 'PERMISSION_DENIED', 403);
    this.name = 'PermissionError';
    this.operation = operation;
    this.filename = filename;
  }
}

export class StorageError extends PromptError {
  constructor(message) {
    super(`Storage error: ${message}`, 'STORAGE_ERROR', 500);
    this.name = 'StorageError';
  }
}

export class VersionError extends PromptError {
  constructor(message) {
    super(`Version error: ${message}`, 'VERSION_ERROR', 400);
    this.name = 'VersionError';
  }
}

// 에러 타입 분류 함수
export function classifyError(error) {
  if (error instanceof PromptError) {
    return error;
  }

  // Node.js 파일 시스템 에러 처리
  if (error.code) {
    switch (error.code) {
      case 'ENOENT':
        return new FileNotFoundError(error.path || 'unknown');
      case 'EEXIST':
        return new FileAlreadyExistsError(error.path || 'unknown');
      case 'EACCES':
      case 'EPERM':
        return new PermissionError('access', error.path || 'unknown');
      case 'ENOSPC':
        return new StorageError('No space left on device');
      case 'EMFILE':
      case 'ENFILE':
        return new StorageError('Too many open files');
      case 'EISDIR':
        return new ValidationError('Expected file but got directory');
      case 'ENOTDIR':
        return new ValidationError('Expected directory but got file');
      default:
        return new PromptError(`File system error: ${error.message}`, error.code);
    }
  }

  // Zod 검증 에러 처리
  if (error.name === 'ZodError') {
    const firstError = error.errors?.[0];
    const field = firstError?.path?.join('.') || 'unknown';
    const message = firstError?.message || 'Validation failed';
    return new ValidationError(`${field}: ${message}`, field);
  }

  // JSON 파싱 에러 처리
  if (error instanceof SyntaxError && error.message.includes('JSON')) {
    return new ValidationError('Invalid JSON format');
  }

  // 일반 에러는 PromptError로 래핑
  return new PromptError(error.message || 'Unknown error occurred');
}

// 안전한 파일 작업 래퍼
export async function safeFileOperation(operation, errorContext = '') {
  try {
    return await operation();
  } catch (error) {
    const classifiedError = classifyError(error);
    
    // 에러 컨텍스트 추가
    if (errorContext) {
      classifiedError.context = errorContext;
    }
    
    throw classifiedError;
  }
}

// 에러 응답 생성 함수
export function createErrorResponse(error, includeStack = false) {
  const classifiedError = classifyError(error);
  
  const response = {
    success: false,
    error: {
      name: classifiedError.name,
      code: classifiedError.code,
      message: classifiedError.message,
      timestamp: classifiedError.timestamp
    }
  };

  // 개발 환경에서는 스택 트레이스 포함
  if (includeStack && process.env.NODE_ENV === 'development') {
    response.error.stack = classifiedError.stack;
  }

  // 추가 에러 정보
  if (classifiedError.field) {
    response.error.field = classifiedError.field;
  }
  
  if (classifiedError.filename) {
    response.error.filename = classifiedError.filename;
  }
  
  if (classifiedError.context) {
    response.error.context = classifiedError.context;
  }

  return response;
}

// 성공 응답 생성 함수
export function createSuccessResponse(data, message = null) {
  const response = {
    success: true,
    timestamp: new Date().toISOString()
  };

  if (message) {
    response.message = message;
  }

  if (data !== undefined) {
    response.data = data;
  }

  return response;
}

// 재시도 가능한 작업 실행
export async function retryOperation(operation, maxRetries = 3, delay = 1000) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = classifyError(error);
      
      // 재시도하지 않을 에러 타입들
      if (lastError instanceof ValidationError || 
          lastError instanceof FileNotFoundError ||
          lastError instanceof PermissionError) {
        throw lastError;
      }

      if (attempt === maxRetries) {
        throw lastError;
      }

      // 지연 후 재시도
      await new Promise(resolve => setTimeout(resolve, delay * attempt));
    }
  }

  throw lastError;
}

// 에러 로깅 함수
export function logError(error, context = {}) {
  const classifiedError = classifyError(error);
  
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    name: classifiedError.name,
    code: classifiedError.code,
    message: classifiedError.message,
    context: context
  };

  // 개발 환경에서는 스택 트레이스 포함
  if (process.env.NODE_ENV === 'development') {
    logEntry.stack = classifiedError.stack;
  }

  console.error(JSON.stringify(logEntry, null, 2));
}

// 에러 통계 수집
export class ErrorTracker {
  constructor() {
    this.errorCounts = new Map();
    this.recentErrors = [];
    this.maxRecentErrors = 100;
  }

  track(error) {
    const classifiedError = classifyError(error);
    const key = `${classifiedError.name}:${classifiedError.code}`;
    
    // 에러 카운트 증가
    this.errorCounts.set(key, (this.errorCounts.get(key) || 0) + 1);
    
    // 최근 에러 목록에 추가
    this.recentErrors.unshift({
      timestamp: new Date().toISOString(),
      name: classifiedError.name,
      code: classifiedError.code,
      message: classifiedError.message
    });

    // 최대 크기 초과시 오래된 에러 제거
    if (this.recentErrors.length > this.maxRecentErrors) {
      this.recentErrors = this.recentErrors.slice(0, this.maxRecentErrors);
    }
  }

  getStats() {
    return {
      totalErrors: Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0),
      errorsByType: Object.fromEntries(this.errorCounts),
      recentErrors: this.recentErrors.slice(0, 10) // 최근 10개만
    };
  }

  reset() {
    this.errorCounts.clear();
    this.recentErrors = [];
  }
}

// 전역 에러 트래커 인스턴스
export const globalErrorTracker = new ErrorTracker();
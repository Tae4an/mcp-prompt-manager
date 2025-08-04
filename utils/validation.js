import { z } from 'zod';
import sanitizeFilename from 'sanitize-filename';
import validator from 'validator';
import * as path from 'path';

// 스키마 정의
export const FileNameSchema = z.string()
  .min(1, ' 파일명은 필수입니다')
  .max(255, '파일명은 255자를 초과할 수 없습니다')
  .refine(
    (filename) => !filename.includes('..'),
    '상위 디렉토리 접근은 허용되지 않습니다'
  )
  .refine(
    (filename) => !path.isAbsolute(filename),
    '절대 경로는 허용되지 않습니다'
  )
  .refine(
    (filename) => sanitizeFilename(filename) === filename,
    '유효하지 않은 문자가 포함되어 있습니다'
  );

export const ContentSchema = z.string()
  .min(1, '내용은 필수입니다')
  .max(1024 * 1024, '내용은 1MB를 초과할 수 없습니다') // 1MB 제한
  .refine(
    (content) => !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g.test(content),
    '제어 문자는 허용되지 않습니다'
  )
  .refine(
    (content) => {
      // 바이너리 데이터 패턴 감지
      const binaryPattern = /[\x00-\x1F\x7F-\xFF]{10,}/g;
      return !binaryPattern.test(content);
    },
    '의심스러운 바이너리 데이터가 감지되었습니다'
  );

export const TagSchema = z.array(z.string()
  .min(1, '태그는 비어있을 수 없습니다')
  .max(50, '태그는 50자를 초과할 수 없습니다')
  .regex(/^[a-zA-Z0-9가-힣\-_]+$/, '태그는 영문, 숫자, 한글, 하이픈, 언더스코어만 허용됩니다')
).max(10, '태그는 최대 10개까지 허용됩니다');

export const CategorySchema = z.string()
  .min(1, '카테고리는 필수입니다')
  .max(50, '카테고리는 50자를 초과할 수 없습니다')
  .regex(/^[a-zA-Z0-9가-힣\-_\s]+$/, '카테고리는 영문, 숫자, 한글, 하이픈, 언더스코어, 공백만 허용됩니다');

export const SearchQuerySchema = z.string()
  .min(1, '검색어는 필수입니다')
  .max(100, '검색어는 100자를 초과할 수 없습니다')
  .refine(
    (query) => !validator.contains(query, '<script>'),
    'XSS 공격 패턴이 감지되었습니다'
  )
  .refine(
    (query) => !/<[^>]*>/g.test(query),
    'HTML 태그는 허용되지 않습니다'
  )
  .refine(
    (query) => !/[<>'"&]/g.test(query),
    '위험한 특수문자가 포함되어 있습니다'
  );

export const VersionNumberSchema = z.number()
  .int('버전 번호는 정수여야 합니다')
  .positive('버전 번호는 양수여야 합니다')
  .max(1000000, '버전 번호가 너무 큽니다');

export const TemplateVariablesSchema = z.record(
  z.string().min(1, '변수명은 비어있을 수 없습니다'),
  z.string().max(1000, '변수 값은 1000자를 초과할 수 없습니다')
).refine(
  (variables) => Object.keys(variables).length <= 50,
  '변수는 최대 50개까지 허용됩니다'
);

// 검증 함수들
export function validateFilename(filename) {
  try {
    FileNameSchema.parse(filename);
    return { isValid: true, error: null };
  } catch (error) {
    return { 
      isValid: false, 
      error: error.errors?.[0]?.message || '파일명 검증 실패' 
    };
  }
}

export function validateContent(content) {
  try {
    ContentSchema.parse(content);
    return { isValid: true, error: null };
  } catch (error) {
    return { 
      isValid: false, 
      error: error.errors?.[0]?.message || '내용 검증 실패' 
    };
  }
}

export function validateTags(tags) {
  try {
    TagSchema.parse(tags);
    return { isValid: true, error: null };
  } catch (error) {
    return { 
      isValid: false, 
      error: error.errors?.[0]?.message || '태그 검증 실패' 
    };
  }
}

export function validateCategory(category) {
  try {
    CategorySchema.parse(category);
    return { isValid: true, error: null };
  } catch (error) {
    return { 
      isValid: false, 
      error: error.errors?.[0]?.message || '카테고리 검증 실패' 
    };
  }
}

export function validateSearchQuery(query) {
  try {
    SearchQuerySchema.parse(query);
    return { isValid: true, error: null };
  } catch (error) {
    return { 
      isValid: false, 
      error: error.errors?.[0]?.message || '검색어 검증 실패' 
    };
  }
}

export function validateVersionNumber(version) {
  try {
    VersionNumberSchema.parse(version);
    return { isValid: true, error: null };
  } catch (error) {
    return { 
      isValid: false, 
      error: error.errors?.[0]?.message || '버전 번호 검증 실패' 
    };
  }
}

export function validateTemplateVariables(variables) {
  try {
    TemplateVariablesSchema.parse(variables);
    return { isValid: true, error: null };
  } catch (error) {
    return { 
      isValid: false, 
      error: error.errors?.[0]?.message || '템플릿 변수 검증 실패' 
    };
  }
}

// 추가 보안 검증 함수들
export function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  
  return input
    .replace(/[<>]/g, '') // HTML 태그 제거
    .replace(/[;&|`$()]/g, '') // 명령 주입 방지
    .replace(/['";]/g, '') // SQL 주입 방지
    .trim() // 앞뒤 공백 제거
    .substring(0, 10000); // 최대 길이 제한
}

export function validatePathSafety(filepath) {
  // 상위 디렉토리 접근 체크 (정규화 전에 먼저 체크)
  if (filepath.includes('..')) {
    return false;
  }
  
  // 절대 경로 체크
  if (path.isAbsolute(filepath)) {
    return false;
  }
  
  const normalizedPath = path.normalize(filepath);
  
  // 정규화 후에도 상위 디렉토리 접근 체크
  if (normalizedPath.includes('..')) {
    return false;
  }
  
  // 특수 파일명 체크
  const dangerousNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
  const basename = path.basename(normalizedPath, path.extname(normalizedPath));
  
  if (dangerousNames.includes(basename.toUpperCase())) {
    return false;
  }
  
  return true;
}

export function createValidationError(message, field = null) {
  const error = new Error(message);
  error.name = 'ValidationError';
  error.field = field;
  return error;
}
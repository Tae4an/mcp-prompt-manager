import validator from 'validator';
import { log } from './logger.js';

/**
 * 고급 입력 검증 및 정제 유틸리티
 */
export class InputSanitizer {
  constructor() {
    // 위험한 패턴들
    this.dangerousPatterns = [
      // 스크립트 관련
      /<script[^>]*>.*?<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /data:text\/html/gi,
      
      // SQL Injection 패턴
      /(\bUNION\b|\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b).*?(\bFROM\b|\bINTO\b|\bWHERE\b)/gi,
      /[';].*?(\bOR\b|\bAND\b).*?['"].*?=/gi,
      
      // Path Traversal
      /\.\.[\\/]/g,
      /[\\/]\.\.[\\/]/g,
      
      // 코드 실행 패턴
      /eval\s*\(/gi,
      /Function\s*\(/gi,
      /setTimeout\s*\(/gi,
      /setInterval\s*\(/gi,
      
      // 파일 시스템 관련
      /\/etc\/passwd/gi,
      /\/proc\/self/gi,
      /\${.*?}/g, // Template injection
    ];

    // 허용되지 않는 프로토콜
    this.dangerousProtocols = [
      'javascript:',
      'data:',
      'vbscript:',
      'file:',
      'ftp:'
    ];
  }

  /**
   * 텍스트 입력 정제
   */
  sanitizeText(input, options = {}) {
    if (typeof input !== 'string') {
      return '';
    }

    const {
      maxLength = 10000,
      allowHTML = false,
      allowNewlines = true,
      trimWhitespace = true
    } = options;

    let sanitized = input;

    // 길이 제한
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
      log.warn('Input truncated due to length limit', { 
        originalLength: input.length, 
        maxLength 
      });
    }

    // HTML 태그 제거 (허용되지 않는 경우)
    if (!allowHTML) {
      sanitized = sanitized.replace(/<[^>]*>/g, '');
      // 위험한 패턴들 제거
      this.dangerousPatterns.forEach(pattern => {
        if (pattern.test(sanitized)) {
          sanitized = sanitized.replace(pattern, '');
        }
      });
      sanitized = validator.stripLow(sanitized, true);
    }

    // 개행 문자 처리
    if (!allowNewlines) {
      sanitized = sanitized.replace(/[\r\n]/g, ' ');
    }

    // 공백 정리 (개행문자 보존 모드가 아닐 때만)
    if (trimWhitespace) {
      if (!allowNewlines) {
        sanitized = sanitized.trim();
        sanitized = sanitized.replace(/\s+/g, ' ');
      } else {
        // 개행 문자는 보존하되 다른 공백 정리
        sanitized = sanitized.trim();
        sanitized = sanitized.replace(/[ \t]+/g, ' ');
      }
    }

    return sanitized;
  }

  /**
   * 파일명 정제
   */
  sanitizeFilename(filename, options = {}) {
    if (typeof filename !== 'string') {
      return '';
    }

    const {
      maxLength = 255,
      allowSpaces = true,
      allowUnicode = true
    } = options;

    let sanitized = filename;

    // 길이 제한
    if (sanitized.length > maxLength) {
      const ext = sanitized.split('.').pop();
      const nameWithoutExt = sanitized.substring(0, sanitized.lastIndexOf('.'));
      const allowedNameLength = maxLength - ext.length - 1;
      sanitized = nameWithoutExt.substring(0, allowedNameLength) + '.' + ext;
    }

    // 위험한 문자 제거
    sanitized = sanitized.replace(/[<>:"/\\|?*\x00-\x1f]/g, '');
    
    // 공백 처리
    if (!allowSpaces) {
      sanitized = sanitized.replace(/\s+/g, '_');
    }

    // 유니코드 처리
    if (!allowUnicode) {
      sanitized = sanitized.replace(/[^\x00-\x7F]/g, '');
    }

    // 경로 탐색 방지
    sanitized = sanitized.replace(/\.\./g, '');
    
    // 예약된 파일명 확인 (Windows)
    const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 
      'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
      'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
    
    const nameWithoutExt = sanitized.split('.')[0].toUpperCase();
    if (reservedNames.includes(nameWithoutExt)) {
      sanitized = '_' + sanitized;
    }

    return sanitized;
  }

  /**
   * URL 검증 및 정제
   */
  sanitizeURL(url, options = {}) {
    if (typeof url !== 'string') {
      return null;
    }

    const {
      allowedProtocols = ['http:', 'https:'],
      maxLength = 2048
    } = options;

    try {
      // 길이 제한
      if (url.length > maxLength) {
        log.warn('URL truncated due to length limit', { 
          originalLength: url.length, 
          maxLength 
        });
        return null;
      }

      // URL 파싱
      const parsedUrl = new URL(url);

      // 프로토콜 검증
      if (!allowedProtocols.includes(parsedUrl.protocol)) {
        log.warn('Dangerous protocol detected', { 
          protocol: parsedUrl.protocol,
          url: url.substring(0, 100) + '...' 
        });
        return null;
      }

      // 위험한 프로토콜 확인
      if (this.dangerousProtocols.some(proto => url.toLowerCase().startsWith(proto))) {
        log.warn('Dangerous protocol blocked', { url: url.substring(0, 100) + '...' });
        return null;
      }

      // 기본적인 URL 검증만 수행
      if (!url.match(/^https?:\/\/.+/)) {
        return null;
      }

      return parsedUrl.toString();
    } catch (error) {
      log.warn('Invalid URL format', { url: url.substring(0, 100) + '...', error: error.message });
      return null;
    }
  }

  /**
   * JSON 입력 검증 및 정제
   */
  sanitizeJSON(jsonString, options = {}) {
    if (typeof jsonString !== 'string') {
      return null;
    }

    const {
      maxDepth = 10,
      maxKeys = 100,
      maxStringLength = 1000
    } = options;

    try {
      const parsed = JSON.parse(jsonString);
      return this.sanitizeObject(parsed, { maxDepth, maxKeys, maxStringLength });
    } catch (error) {
      log.warn('Invalid JSON format', { error: error.message });
      return null;
    }
  }

  /**
   * 객체 정제 (재귀적)
   */
  sanitizeObject(obj, options = {}, depth = 0) {
    const {
      maxDepth = 10,
      maxKeys = 100,
      maxStringLength = 1000
    } = options;

    // 깊이 제한
    if (depth > maxDepth) {
      log.warn('Object depth limit exceeded', { depth, maxDepth });
      return null;
    }

    if (Array.isArray(obj)) {
      return obj.slice(0, maxKeys).map(item => 
        this.sanitizeObject(item, options, depth + 1)
      );
    }

    if (obj && typeof obj === 'object') {
      const keys = Object.keys(obj);
      
      // 키 개수 제한
      if (keys.length > maxKeys) {
        log.warn('Object keys limit exceeded', { keysCount: keys.length, maxKeys });
        return null;
      }

      const sanitized = {};
      for (const key of keys.slice(0, maxKeys)) {
        // 키 정제
        const sanitizedKey = this.sanitizeText(key, { 
          maxLength: 100, 
          allowHTML: false, 
          allowNewlines: false 
        });
        
        if (sanitizedKey) {
          sanitized[sanitizedKey] = this.sanitizeObject(obj[key], options, depth + 1);
        }
      }
      return sanitized;
    }

    if (typeof obj === 'string') {
      return this.sanitizeText(obj, { 
        maxLength: maxStringLength, 
        allowHTML: false 
      });
    }

    return obj;
  }

  /**
   * 입력 위험도 평가
   */
  assessRisk(input) {
    if (typeof input !== 'string') {
      return { level: 'low', reasons: [] };
    }

    const reasons = [];
    let riskLevel = 'low';

    // 위험한 패턴 검사
    this.dangerousPatterns.forEach((pattern, index) => {
      if (pattern.test(input)) {
        reasons.push(`Dangerous pattern ${index + 1} detected`);
        riskLevel = 'high';
      }
    });

    // 위험한 프로토콜 검사
    this.dangerousProtocols.forEach(proto => {
      if (input.toLowerCase().includes(proto)) {
        reasons.push(`Dangerous protocol detected: ${proto}`);
        riskLevel = 'high';
      }
    });

    // 의심스러운 문자 검사
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(input)) {
      reasons.push('Control characters detected');
      riskLevel = riskLevel === 'low' ? 'medium' : 'high';
    }

    // 긴 문자열
    if (input.length > 10000) {
      reasons.push('Unusually long input');
      riskLevel = riskLevel === 'low' ? 'medium' : riskLevel;
    }

    return { level: riskLevel, reasons };
  }

  /**
   * 일괄 입력 검증
   */
  validateBatch(inputs) {
    const results = [];
    
    for (const [key, value] of Object.entries(inputs)) {
      const risk = this.assessRisk(value);
      results.push({
        key,
        value: typeof value === 'string' ? value.substring(0, 100) + '...' : value,
        risk: risk.level,
        reasons: risk.reasons
      });
    }

    return results;
  }
}

// 싱글톤 인스턴스
export const inputSanitizer = new InputSanitizer();

export default InputSanitizer;
import { log } from './logger.js';
import { inputSanitizer } from './input-sanitizer.js';

/**
 * 고급 프롬프트 템플릿 엔진
 * 조건부 로직, 반복문, 중첩 변수 지원
 */
export class TemplateEngine {
  constructor() {
    // 템플릿 구문 패턴들
    this.patterns = {
      // 기본 변수: {{variable}}
      variable: /\{\{([^}]+)\}\}/g,
      // 조건문: {{#if condition}}...{{/if}}
      ifBlock: /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      // 조건문 with else: {{#if condition}}...{{#else}}...{{/if}}
      ifElseBlock: /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{#else\}\}([\s\S]*?)\{\{\/if\}\}/g,
      // 반복문: {{#each items}}...{{/each}}
      eachBlock: /\{\{#each\s+([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
      // unless문: {{#unless condition}}...{{/unless}}
      unlessBlock: /\{\{#unless\s+([^}]+)\}\}([\s\S]*?)\{\{\/unless\}\}/g,
      // 함수 호출: {{function arg1 arg2}}
      function: /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\s+([^}]+)\}\}/g,
      // 주석: {{!-- comment --}}
      comment: /\{\{!--[\s\S]*?--\}\}/g
    };

    // 내장 함수들
    this.builtinFunctions = {
      // 문자열 함수들
      upper: (str) => String(str).toUpperCase(),
      lower: (str) => String(str).toLowerCase(),
      capitalize: (str) => String(str).charAt(0).toUpperCase() + String(str).slice(1),
      trim: (str) => String(str).trim(),
      length: (str) => String(str).length,
      
      // 날짜 함수들
      now: () => new Date().toISOString(),
      date: (format) => {
        const now = new Date();
        switch (format) {
          case 'iso': return now.toISOString();
          case 'local': return now.toLocaleString();
          case 'date': return now.toDateString();
          case 'time': return now.toTimeString();
          default: return now.toString();
        }
      },
      
      // 숫자 함수들
      add: (a, b) => Number(a) + Number(b),
      subtract: (a, b) => Number(a) - Number(b),
      multiply: (a, b) => Number(a) * Number(b),
      divide: (a, b) => Number(a) / Number(b),
      round: (num, decimals = 0) => Number(Number(num).toFixed(decimals)),
      
      // 배열 함수들
      join: (arr, separator = ',') => Array.isArray(arr) ? arr.join(separator) : String(arr),
      first: (arr) => Array.isArray(arr) ? arr[0] : undefined,
      last: (arr) => Array.isArray(arr) ? arr[arr.length - 1] : undefined,
      count: (arr) => Array.isArray(arr) ? arr.length : 0,
      
      // 조건 함수들
      default: (value, defaultValue) => value != null && value !== '' ? value : defaultValue,
      isEmpty: (value) => value == null || value === '' || (Array.isArray(value) && value.length === 0),
      isNotEmpty: (value) => !this.builtinFunctions.isEmpty(value),
      
      // 유틸리티 함수들
      json: (obj) => JSON.stringify(obj, null, 2),
      escape: (str) => inputSanitizer.sanitizeText(String(str), { allowHTML: false }),
      random: (min = 0, max = 100) => Math.floor(Math.random() * (max - min + 1)) + min
    };
  }

  /**
   * 템플릿 렌더링
   */
  render(template, context = {}, options = {}) {
    if (typeof template !== 'string') {
      throw new Error('Template must be a string');
    }

    const {
      maxIterations = 1000,
      allowUnsafeEval = false,
      sanitizeOutput = true,
      logExecution = false
    } = options;

    try {
      let result = template;
      let iterations = 0;

      if (logExecution) {
        log.debug('Template rendering started', {
          templateLength: template.length,
          contextKeys: Object.keys(context)
        });
      }

      // 주석 제거
      result = this.removeComments(result);

      // 반복문 처리
      result = this.processEachBlocks(result, context, maxIterations);

      // 조건문 처리 (if/else)
      result = this.processIfElseBlocks(result, context);

      // 조건문 처리 (if)
      result = this.processIfBlocks(result, context);

      // unless문 처리
      result = this.processUnlessBlocks(result, context);

      // 함수 호출 처리
      result = this.processFunctions(result, context);

      // 기본 변수 치환
      result = this.processVariables(result, context);

      // 출력 정제
      if (sanitizeOutput) {
        result = inputSanitizer.sanitizeText(result, {
          maxLength: 10 * 1024 * 1024, // 10MB
          allowHTML: false,
          allowNewlines: true
        });
      }

      if (logExecution) {
        log.debug('Template rendering completed', {
          resultLength: result.length
        });
      }

      return result;

    } catch (error) {
      log.error('Template rendering failed', {
        error: error.message,
        templatePreview: template.substring(0, 200) + '...'
      });
      throw new Error(`Template rendering failed: ${error.message}`);
    }
  }

  /**
   * 주석 제거
   */
  removeComments(template) {
    return template.replace(this.patterns.comment, '');
  }

  /**
   * 변수 처리
   */
  processVariables(template, context) {
    return template.replace(this.patterns.variable, (match, varPath) => {
      const value = this.getNestedValue(context, varPath.trim());
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * if/else 블록 처리
   */
  processIfElseBlocks(template, context) {
    return template.replace(this.patterns.ifElseBlock, (match, condition, ifContent, elseContent) => {
      const conditionResult = this.evaluateCondition(condition.trim(), context);
      return conditionResult ? ifContent : elseContent;
    });
  }

  /**
   * if 블록 처리
   */
  processIfBlocks(template, context) {
    return template.replace(this.patterns.ifBlock, (match, condition, content) => {
      const conditionResult = this.evaluateCondition(condition.trim(), context);
      return conditionResult ? content : '';
    });
  }

  /**
   * unless 블록 처리
   */
  processUnlessBlocks(template, context) {
    return template.replace(this.patterns.unlessBlock, (match, condition, content) => {
      const conditionResult = this.evaluateCondition(condition.trim(), context);
      return !conditionResult ? content : '';
    });
  }

  /**
   * each 블록 처리
   */  
  processEachBlocks(template, context, maxIterations) {
    return template.replace(this.patterns.eachBlock, (match, arrayPath, content) => {
      const array = this.getNestedValue(context, arrayPath.trim());
      
      if (!Array.isArray(array)) {
        log.warn('Each block target is not an array', { arrayPath, type: typeof array });
        return '';
      }

      if (array.length > maxIterations) {
        log.warn('Each block iteration limit exceeded', { 
          arrayLength: array.length, 
          maxIterations 
        });
        return '';
      }

      return array.map((item, index) => {
        const itemContext = {
          ...context,
          this: item,
          '@index': index,
          '@first': index === 0,
          '@last': index === array.length - 1,
          '@length': array.length
        };
        
        return this.processVariables(content, itemContext);
      }).join('');
    });
  }

  /**
   * 함수 호출 처리
   */
  processFunctions(template, context) {
    return template.replace(this.patterns.function, (match, funcName, argsStr) => {
      try {
        const args = this.parseArguments(argsStr, context);
        
        // 내장 함수 확인
        if (this.builtinFunctions[funcName]) {
          const result = this.builtinFunctions[funcName](...args);
          return result !== undefined ? String(result) : '';
        }

        // 컨텍스트 함수 확인
        if (context[funcName] && typeof context[funcName] === 'function') {
          const result = context[funcName](...args);
          return result !== undefined ? String(result) : '';
        }

        log.warn('Unknown function called in template', { funcName, args });
        return match;

      } catch (error) {
        log.error('Function execution failed in template', {
          funcName,
          error: error.message
        });
        return match;
      }
    });
  }

  /**
   * 조건 평가
   */
  evaluateCondition(condition, context) {
    try {
      // 기본 비교 연산자들
      const operators = [
        { pattern: /(.+?)\s*===\s*(.+)/, op: (a, b) => a === b },
        { pattern: /(.+?)\s*!==\s*(.+)/, op: (a, b) => a !== b },
        { pattern: /(.+?)\s*==\s*(.+)/, op: (a, b) => a == b },
        { pattern: /(.+?)\s*!=\s*(.+)/, op: (a, b) => a != b },
        { pattern: /(.+?)\s*>=\s*(.+)/, op: (a, b) => Number(a) >= Number(b) },
        { pattern: /(.+?)\s*<=\s*(.+)/, op: (a, b) => Number(a) <= Number(b) },
        { pattern: /(.+?)\s*>\s*(.+)/, op: (a, b) => Number(a) > Number(b) },
        { pattern: /(.+?)\s*<\s*(.+)/, op: (a, b) => Number(a) < Number(b) }
      ];

      for (const { pattern, op } of operators) {
        const match = condition.match(pattern);
        if (match) {
          const left = this.resolveValue(match[1].trim(), context);
          const right = this.resolveValue(match[2].trim(), context);
          return op(left, right);
        }
      }

      // 단순 변수 평가
      const value = this.resolveValue(condition, context);
      return this.isTruthy(value);

    } catch (error) {
      log.warn('Condition evaluation failed', { condition, error: error.message });
      return false;
    }
  }

  /**
   * 값 해석
   */
  resolveValue(expr, context) {
    expr = expr.trim();

    // 문자열 리터럴
    if ((expr.startsWith('"') && expr.endsWith('"')) ||
        (expr.startsWith("'") && expr.endsWith("'"))) {
      return expr.slice(1, -1);
    }

    // 숫자 리터럴
    if (/^-?\d+(\.\d+)?$/.test(expr)) {
      return Number(expr);
    }

    // 불린 리터럴
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (expr === 'undefined') return undefined;

    // 변수 참조
    return this.getNestedValue(context, expr);
  }

  /**
   * 인자 파싱
   */
  parseArguments(argsStr, context) {
    const args = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < argsStr.length; i++) {
      const char = argsStr[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
        current += char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        current += char;
      } else if (char === ' ' && !inQuotes) {
        if (current.trim()) {
          args.push(this.resolveValue(current.trim(), context));
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      args.push(this.resolveValue(current.trim(), context));
    }

    return args;
  }

  /**
   * 중첩된 객체 값 가져오기
   */
  getNestedValue(obj, path) {
    const keys = path.split('.');
    let current = obj;

    for (const key of keys) {
      if (current == null || typeof current !== 'object') {
        return undefined;
      }
      current = current[key];
    }

    return current;
  }

  /**
   * Truthy 값 판정
   */
  isTruthy(value) {
    if (value == null) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value !== '';
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return Boolean(value);
  }

  /**
   * 템플릿에서 사용된 변수 추출
   */
  extractVariables(template) {
    const variables = new Set();
    
    // 기본 변수들
    const variableMatches = template.match(this.patterns.variable) || [];
    variableMatches.forEach(match => {
      const varName = match.replace(/[{}]/g, '').trim();
      if (!varName.startsWith('@')) { // 특수 변수 제외
        variables.add(varName.split('.')[0]); // 최상위 변수만
      }
    });

    // 조건문에서 사용된 변수들
    const conditionMatches = [
      ...template.matchAll(this.patterns.ifBlock),
      ...template.matchAll(this.patterns.ifElseBlock),
      ...template.matchAll(this.patterns.unlessBlock)
    ];
    
    conditionMatches.forEach(match => {
      const condition = match[1];
      const condVars = condition.match(/[a-zA-Z_][a-zA-Z0-9_.]*(?![a-zA-Z0-9_.])/g) || [];
      condVars.forEach(v => {
        if (!['true', 'false', 'null', 'undefined'].includes(v)) {
          variables.add(v.split('.')[0]);
        }
      });
    });

    // each 블록에서 사용된 변수들
    const eachMatches = template.matchAll(this.patterns.eachBlock) || [];
    eachMatches.forEach(match => {
      const arrayPath = match[1].trim();
      variables.add(arrayPath.split('.')[0]);
    });

    return Array.from(variables);
  }

  /**
   * 템플릿 유효성 검사
   */
  validate(template) {
    const errors = [];
    
    try {
      // 괄호 균형 검사
      const openBraces = (template.match(/\{\{/g) || []).length;
      const closeBraces = (template.match(/\}\}/g) || []).length;
      
      if (openBraces !== closeBraces) {
        errors.push(`Unbalanced braces: ${openBraces} opening, ${closeBraces} closing`);
      }

      // 블록 태그 균형 검사
      const blockTags = ['if', 'unless', 'each'];
      blockTags.forEach(tag => {
        const openTags = (template.match(new RegExp(`\\{\\{#${tag}\\b`, 'g')) || []).length;
        const closeTags = (template.match(new RegExp(`\\{\\{\\/${tag}\\}\\}`, 'g')) || []).length;
        
        if (openTags !== closeTags) {
          errors.push(`Unbalanced ${tag} blocks: ${openTags} opening, ${closeTags} closing`);
        }
      });

      // 중첩 블록 검사 (간단한 검사)
      let depth = 0;
      const blockPattern = /\{\{(#\w+|\/#?\w+)\b[^}]*\}\}/g;
      let match;
      
      while ((match = blockPattern.exec(template)) !== null) {
        const tag = match[1];
        if (tag.startsWith('#') && !tag.startsWith('#/')) {
          depth++;
        } else if (tag.startsWith('/') || tag.startsWith('#/')) {
          depth--;
        }
        
        if (depth < 0) {
          errors.push(`Unexpected closing tag at position ${match.index}`);
          break;
        }
      }
      
      if (depth > 0) {
        errors.push(`${depth} unclosed block(s)`);
      }

    } catch (error) {
      errors.push(`Validation error: ${error.message}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

// 싱글톤 인스턴스
export const templateEngine = new TemplateEngine();

export default TemplateEngine;
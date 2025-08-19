import { parentPort, workerData } from 'worker_threads';

/**
 * CPU 집약적 작업을 처리하는 워커 스크립트
 * - JSON 파싱/직렬화
 * - 대용량 텍스트 처리
 * - 정규식 검색
 */

const { workerId, options } = workerData;

// 워커 통계
const stats = {
  tasksProcessed: 0,
  totalProcessingTime: 0,
  startTime: Date.now()
};

/**
 * 메인 스레드로부터 메시지 수신
 */
parentPort.on('message', async (message) => {
  const { taskId, type, data, options: taskOptions } = message;
  const startTime = Date.now();
  
  try {
    let result;
    
    switch (type) {
      case 'parseJSON':
        result = await parseJSON(data);
        break;
      case 'stringifyJSON':
        result = await stringifyJSON(data);
        break;
      case 'processText':
        result = await processText(data);
        break;
      case 'regexSearch':
        result = await regexSearch(data);
        break;
      default:
        throw new Error(`Unknown task type: ${type}`);
    }
    
    const processingTime = Date.now() - startTime;
    stats.tasksProcessed++;
    stats.totalProcessingTime += processingTime;
    
    parentPort.postMessage({
      taskId,
      success: true,
      data: result,
      processingTime,
      workerStats: {
        tasksProcessed: stats.tasksProcessed,
        avgProcessingTime: stats.totalProcessingTime / stats.tasksProcessed,
        uptime: Date.now() - stats.startTime
      }
    });
    
  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    parentPort.postMessage({
      taskId,
      success: false,
      error: error.message,
      processingTime,
      workerStats: {
        tasksProcessed: stats.tasksProcessed,
        avgProcessingTime: stats.totalProcessingTime / (stats.tasksProcessed || 1),
        uptime: Date.now() - stats.startTime
      }
    });
  }
});

/**
 * JSON 파싱 (안전하고 최적화된)
 */
async function parseJSON(data) {
  const { jsonString } = data;
  
  if (typeof jsonString !== 'string') {
    throw new Error('Input must be a string');
  }
  
  if (jsonString.length === 0) {
    return null;
  }
  
  // 큰 JSON의 경우 청크 단위로 처리하여 블로킹 방지
  if (jsonString.length > 100000) { // 100KB 이상
    return await parseJSONChunked(jsonString);
  }
  
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    // 복구 시도: 일반적인 JSON 오류 수정
    const fixedJson = attemptJSONFix(jsonString);
    if (fixedJson !== jsonString) {
      try {
        return JSON.parse(fixedJson);
      } catch (secondError) {
        throw new Error(`JSON parsing failed: ${error.message}`);
      }
    }
    throw new Error(`JSON parsing failed: ${error.message}`);
  }
}

/**
 * 대용량 JSON 청크 파싱
 */
async function parseJSONChunked(jsonString) {
  return new Promise((resolve, reject) => {
    // 비동기적으로 파싱하여 이벤트 루프 블로킹 방지
    setImmediate(() => {
      try {
        const result = JSON.parse(jsonString);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * JSON 수정 시도 (일반적인 오류 패턴)
 */
function attemptJSONFix(jsonString) {
  let fixed = jsonString;
  
  // 후행 쉼표 제거
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
  
  // 단일 따옴표를 쌍따옴표로 변경
  fixed = fixed.replace(/'/g, '"');
  
  // 키에 따옴표 추가
  fixed = fixed.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
  
  return fixed;
}

/**
 * JSON 직렬화 (최적화된)
 */
async function stringifyJSON(data) {
  const { object } = data;
  
  if (object === undefined) {
    return undefined;
  }
  
  try {
    // 간단한 직렬화 시도 (순환 참조 확인)
    JSON.stringify(object);
  } catch (error) {
    if (error.message.includes('circular') || error.message.includes('Converting circular')) {
      // 순환 참조 처리
      const seen = new WeakSet();
      const replacer = (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular Reference]';
          }
          seen.add(value);
        }
        
        // 함수는 문자열로 변환
        if (typeof value === 'function') {
          return '[Function]';
        }
        
        // undefined는 null로 변환
        if (value === undefined) {
          return null;
        }
        
        return value;
      };
      
      return JSON.stringify(object, replacer, 2);
    }
  }
  
  // 일반 처리를 위한 replacer
  const replacer = (key, value) => {
    // 함수는 문자열로 변환
    if (typeof value === 'function') {
      return '[Function]';
    }
    
    // undefined는 null로 변환
    if (value === undefined) {
      return null;
    }
    
    return value;
  };
  
  // 큰 객체의 경우 청크 단위로 처리
  const estimatedSize = JSON.stringify(object).length;
  if (estimatedSize > 100000) { // 100KB 이상
    return await stringifyJSONChunked(object, replacer);
  }
  
  try {
    return JSON.stringify(object, replacer, 2);
  } catch (error) {
    throw new Error(`JSON stringification failed: ${error.message}`);
  }
}

/**
 * 대용량 객체 직렬화
 */
async function stringifyJSONChunked(object, replacer) {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        const result = JSON.stringify(object, replacer, 2);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * 대용량 텍스트 처리
 */
async function processText(data) {
  const { text, operations } = data;
  
  if (typeof text !== 'string') {
    throw new Error('Text must be a string');
  }
  
  if (!Array.isArray(operations)) {
    throw new Error('Operations must be an array');
  }
  
  let result = text;
  const stats = {
    originalLength: text.length,
    operationsApplied: 0,
    processingTime: 0
  };
  
  const startTime = Date.now();
  
  for (const operation of operations) {
    const opStart = Date.now();
    
    switch (operation.type) {
      case 'toLowerCase':
        result = result.toLowerCase();
        break;
        
      case 'toUpperCase':
        result = result.toUpperCase();
        break;
        
      case 'trim':
        result = result.trim();
        break;
        
      case 'replace':
        if (operation.global) {
          const regex = new RegExp(operation.search, 'g');
          result = result.replace(regex, operation.replace);
        } else {
          result = result.replace(operation.search, operation.replace);
        }
        break;
        
      case 'split':
        const delimiter = operation.delimiter || '\n';
        return {
          result: result.split(delimiter),
          stats: {
            ...stats,
            operationsApplied: stats.operationsApplied + 1,
            processingTime: Date.now() - startTime,
            finalLength: 'array'
          }
        };
        
      case 'wordCount':
        const words = result.trim().split(/\s+/).filter(word => word.length > 0);
        return {
          result: {
            text: result,
            wordCount: words.length,
            characterCount: result.length,
            lineCount: result.split('\n').length
          },
          stats: {
            ...stats,
            operationsApplied: stats.operationsApplied + 1,
            processingTime: Date.now() - startTime,
            finalLength: result.length
          }
        };
        
      case 'extract':
        const regex = new RegExp(operation.pattern, operation.flags || 'g');
        const matches = Array.from(result.matchAll(regex));
        return {
          result: matches.map(match => ({
            match: match[0],
            groups: match.slice(1),
            index: match.index
          })),
          stats: {
            ...stats,
            operationsApplied: stats.operationsApplied + 1,
            processingTime: Date.now() - startTime,
            finalLength: matches.length
          }
        };
        
      default:
        throw new Error(`Unknown text operation: ${operation.type}`);
    }
    
    stats.operationsApplied++;
    
    // 대용량 텍스트 처리 시 중간에 이벤트 루프 양보
    if (result.length > 50000 && Date.now() - opStart > 10) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  
  stats.processingTime = Date.now() - startTime;
  stats.finalLength = result.length;
  
  return {
    result,
    stats
  };
}

/**
 * 정규식 검색 (병렬 최적화)
 */
async function regexSearch(data) {
  const { text, patterns } = data;
  
  if (typeof text !== 'string') {
    throw new Error('Text must be a string');
  }
  
  if (!Array.isArray(patterns)) {
    throw new Error('Patterns must be an array');
  }
  
  const results = [];
  const startTime = Date.now();
  
  for (const pattern of patterns) {
    const patternStart = Date.now();
    
    try {
      let regex;
      
      if (typeof pattern === 'string') {
        regex = new RegExp(pattern, 'gi');
      } else if (pattern.pattern) {
        regex = new RegExp(pattern.pattern, pattern.flags || 'gi');
      } else {
        throw new Error('Invalid pattern format');
      }
      
      const matches = [];
      let match;
      let matchCount = 0;
      const maxMatches = pattern.maxMatches || 1000;
      
      // 대용량 텍스트에서 매치 제한으로 성능 보장
      while ((match = regex.exec(text)) !== null && matchCount < maxMatches) {
        matches.push({
          match: match[0],
          index: match.index,
          groups: match.slice(1),
          pattern: pattern.pattern || pattern
        });
        
        matchCount++;
        
        // 무한 루프 방지
        if (regex.lastIndex === match.index) {
          regex.lastIndex++;
        }
        
        // 너무 많은 매치가 있으면 중간에 이벤트 루프 양보
        if (matchCount % 100 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
      
      results.push({
        pattern: pattern.pattern || pattern,
        matches,
        matchCount: matches.length,
        processingTime: Date.now() - patternStart,
        truncated: matchCount >= maxMatches
      });
      
    } catch (error) {
      results.push({
        pattern: pattern.pattern || pattern,
        error: error.message,
        matches: [],
        matchCount: 0,
        processingTime: Date.now() - patternStart
      });
    }
  }
  
  return {
    results,
    totalMatches: results.reduce((sum, r) => sum + r.matchCount, 0),
    totalProcessingTime: Date.now() - startTime,
    textLength: text.length,
    patternsProcessed: patterns.length
  };
}

/**
 * 워커 시작 로그
 */
process.on('uncaughtException', (error) => {
  parentPort.postMessage({
    taskId: null,
    success: false,
    error: `Worker uncaught exception: ${error.message}`,
    fatal: true
  });
  process.exit(1);
});

// 워커 준비 완료 신호
parentPort.postMessage({
  type: 'ready',
  workerId: workerId,
  pid: process.pid,
  startTime: stats.startTime
});

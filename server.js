import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { VersionManager } from "./utils/version-manager.js";
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
} from "./utils/validation.js";
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
  globalErrorTracker
} from "./utils/error-handler.js";
import { log, defaultLogger } from "./utils/logger.js";
import { RateLimiter, rateLimitPresets } from "./utils/rate-limiter.js";
import { inputSanitizer } from "./utils/input-sanitizer.js";
import { templateEngine } from "./utils/template-engine.js";
import { 
  createFileCache, 
  createMetadataCache, 
  createSearchCache, 
  createTemplateCache,
  ServerCacheKeyGenerator as CacheKeyGenerator 
} from "./utils/cache.js";
import { fuzzySearch, FuzzySearch } from "./utils/fuzzy-search.js";
import { OptimizedSearchEngine } from "./utils/optimized-search-engine.js";
import { OptimizedFileIO } from "./utils/optimized-file-io.js";
import { CPUWorkerPool } from "./utils/cpu-worker-pool.js";
import { templateLibrary } from "./utils/template-library.js";
import { createImportExportManager } from "./utils/import-export.js";

// ESM에서 __dirname 구하기
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 프롬프트 디렉토리 설정
const PROMPTS_DIR = process.env.PROMPTS_DIR || path.join(__dirname, "prompts");

// 버전 관리자 인스턴스 생성
const versionManager = new VersionManager(PROMPTS_DIR);

// Rate limiter 인스턴스 생성
const rateLimiters = {
  standard: new RateLimiter(rateLimitPresets.standard),
  strict: new RateLimiter(rateLimitPresets.strict),
  upload: new RateLimiter(rateLimitPresets.upload)
};

// 캐시 인스턴스 생성
const caches = {
  files: createFileCache(),
  metadata: createMetadataCache(),
  search: createSearchCache(),
  templates: createTemplateCache()
};

// Import/Export 관리자 인스턴스 생성
const importExportManager = createImportExportManager(PROMPTS_DIR);

// 최적화된 검색 엔진 인스턴스 생성
const optimizedSearchEngine = new OptimizedSearchEngine({
  threshold: parseFloat(process.env.SEARCH_THRESHOLD) || 0.3,
  parallelWorkers: parseInt(process.env.SEARCH_PARALLEL_WORKERS) || 4,
  enableIndexing: process.env.SEARCH_ENABLE_INDEXING !== 'false',
  enableMemoryPool: process.env.SEARCH_ENABLE_MEMORY_POOL !== 'false',
  maxResults: 50
});

// 최적화된 파일 I/O 인스턴스 생성
const optimizedFileIO = new OptimizedFileIO({
  maxConcurrentFiles: parseInt(process.env.FILE_IO_CONCURRENT) || 10,
  streamThreshold: parseInt(process.env.FILE_IO_STREAM_THRESHOLD) || 1024 * 1024, // 1MB
  compressionThreshold: parseInt(process.env.FILE_IO_COMPRESSION_THRESHOLD) || 10 * 1024, // 10KB
  enableCompression: process.env.FILE_IO_ENABLE_COMPRESSION !== 'false',
  enableStreaming: process.env.FILE_IO_ENABLE_STREAMING !== 'false',
  enableCaching: process.env.FILE_IO_ENABLE_CACHING !== 'false',
  watchFiles: process.env.FILE_IO_WATCH_FILES !== 'false'
});

// 파일 변경 감지 설정
if (process.env.FILE_IO_WATCH_FILES !== 'false') {
  optimizedFileIO.watchDirectory(PROMPTS_DIR, (eventType, filePath) => {
    log.debug('Prompt directory changed', { eventType, filePath });
    
    // 관련 캐시 무효화
    const filename = path.basename(filePath);
    const cacheKey = CacheKeyGenerator.file(filename);
    caches.files.delete(cacheKey);
    
    // 검색 캐시도 무효화 (파일 변경 시 검색 결과가 달라질 수 있음)
    caches.search.clear();
  });
}

// CPU 워커 풀 인스턴스 생성
const cpuWorkerPool = new CPUWorkerPool({
  maxWorkers: parseInt(process.env.CPU_MAX_WORKERS) || require('os').cpus().length,
  minWorkers: parseInt(process.env.CPU_MIN_WORKERS) || Math.max(2, Math.floor(require('os').cpus().length / 2)),
  enableAutoScaling: process.env.CPU_AUTO_SCALING !== 'false',
  workerIdleTimeout: parseInt(process.env.CPU_WORKER_IDLE_TIMEOUT) || 30000,
  taskTimeout: parseInt(process.env.CPU_TASK_TIMEOUT) || 60000
});

// 서버 종료 시 워커 풀 정리
process.on('SIGINT', async () => {
  log.info('Shutting down server...');
  await cpuWorkerPool.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log.info('Shutting down server...');
  await cpuWorkerPool.destroy();
  process.exit(0);
});

// 서버 인스턴스 생성
const server = new McpServer({
  name: "prompt-manager",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// 서버 시작 시간 기록
const SERVER_START_TIME = Date.now();

// 검색 데이터 로딩 헬퍼 함수 (최적화된 I/O 사용)
async function loadSearchItems(promptFiles, searchInContent, searchInMeta) {
  const useOptimizedIO = process.env.USE_OPTIMIZED_IO !== 'false';
  
  if (useOptimizedIO && promptFiles.length > 5) {
    return await loadSearchItemsOptimized(promptFiles, searchInContent, searchInMeta);
  } else {
    return await loadSearchItemsStandard(promptFiles, searchInContent, searchInMeta);
  }
}

// 최적화된 I/O를 사용한 검색 데이터 로딩
async function loadSearchItemsOptimized(promptFiles, searchInContent, searchInMeta) {
  const searchItems = [];
  
  // 읽을 파일 경로들 준비
  const filesToRead = [];
  const metaFilesToRead = [];
  
  promptFiles.forEach(filename => {
    const filePath = path.join(PROMPTS_DIR, filename);
    const metaPath = path.join(PROMPTS_DIR, `.${filename}.meta`);
    
    if (searchInContent) {
      filesToRead.push(filePath);
    }
    if (searchInMeta) {
      metaFilesToRead.push(metaPath);
    }
  });
  
  try {
    // 병렬 배치 파일 읽기
    const [contentResults, metaResults] = await Promise.allSettled([
      searchInContent ? optimizedFileIO.readFilesBatch(filesToRead) : Promise.resolve([]),
      searchInMeta ? optimizedFileIO.readFilesBatch(metaFilesToRead) : Promise.resolve([])
    ]);
    
    // 결과 조합
    for (let i = 0; i < promptFiles.length; i++) {
      const filename = promptFiles[i];
      const filePath = path.join(PROMPTS_DIR, filename);
      
      try {
        const stats = await fs.stat(filePath);
        const item = {
          name: filename,
          size: stats.size,
          modified: stats.mtime,
          content: '',
          metadata: { tags: [], category: '', description: '' }
        };

        // 내용 설정
        if (searchInContent && contentResults.status === 'fulfilled') {
          const contentResult = contentResults.value[i];
          if (contentResult && contentResult.status === 'fulfilled') {
            item.content = contentResult.value.content || '';
          }
        }

        // 메타데이터 설정 (CPU 워커 풀 활용)
        if (searchInMeta && metaResults.status === 'fulfilled') {
          const metaResult = metaResults.value[i];
          if (metaResult && metaResult.status === 'fulfilled') {
            try {
              const useWorkerPool = process.env.USE_CPU_WORKERS !== 'false' && 
                                   metaResult.value.content.length > 1000; // 1KB 이상
              
              if (useWorkerPool) {
                // CPU 워커로 JSON 파싱
                const parsed = await cpuWorkerPool.parseJSONParallel([metaResult.value.content]);
                item.metadata = parsed[0] || item.metadata;
              } else {
                // 표준 JSON 파싱
                item.metadata = JSON.parse(metaResult.value.content) || item.metadata;
              }
            } catch (e) {
              // JSON 파싱 실패 시 기본값 유지
              log.debug('JSON parsing failed', { filename, error: e.message });
            }
          }
        }

        searchItems.push(item);
      } catch (e) {
        log.warn('Failed to process prompt file', { filename, error: e.message });
      }
    }
    
    log.debug('Search items loaded with optimized I/O', {
      itemCount: searchItems.length,
      useContent: searchInContent,
      useMeta: searchInMeta,
      stats: optimizedFileIO.getPerformanceStats()
    });
    
  } catch (error) {
    log.error('Optimized file loading failed, falling back to standard', { error: error.message });
    return await loadSearchItemsStandard(promptFiles, searchInContent, searchInMeta);
  }
  
  return searchItems;
}

// 표준 I/O를 사용한 검색 데이터 로딩 (폴백)
async function loadSearchItemsStandard(promptFiles, searchInContent, searchInMeta) {
  const searchItems = [];
  
  // 병렬 파일 읽기로 성능 향상
  const filePromises = promptFiles.map(async (filename) => {
    const filePath = path.join(PROMPTS_DIR, filename);
    const metaPath = path.join(PROMPTS_DIR, `.${filename}.meta`);
    
    try {
      const stats = await fs.stat(filePath);
      const item = {
        name: filename,
        size: stats.size,
        modified: stats.mtime,
        content: '',
        metadata: { tags: [], category: '', description: '' }
      };

      // 병렬로 내용과 메타데이터 읽기
      const promises = [];
      
      if (searchInContent) {
        promises.push(
          fs.readFile(filePath, "utf-8")
            .then(content => { item.content = content; })
            .catch(e => log.warn('Failed to read prompt content', { filename, error: e.message }))
        );
      }

      if (searchInMeta) {
        promises.push(
          fs.readFile(metaPath, "utf-8")
            .then(async (metaContent) => { 
              try {
                const useWorkerPool = process.env.USE_CPU_WORKERS !== 'false' && 
                                     metaContent.length > 1000; // 1KB 이상
                
                if (useWorkerPool) {
                  // CPU 워커로 JSON 파싱
                  const parsed = await cpuWorkerPool.parseJSONParallel([metaContent]);
                  item.metadata = parsed[0] || item.metadata;
                } else {
                  // 표준 JSON 파싱
                  item.metadata = JSON.parse(metaContent);
                }
              } catch (e) {
                log.debug('JSON parsing failed in standard loader', { filename, error: e.message });
              }
            })
            .catch(() => {}) // 메타데이터가 없어도 계속 진행
        );
      }
      
      await Promise.all(promises);
      return item;
    } catch (e) {
      log.warn('Failed to process prompt file', { filename, error: e.message });
      return null;
    }
  });
  
  const items = await Promise.all(filePromises);
  return items.filter(item => item !== null);
}

// 최적화된 검색 수행 함수
async function performOptimizedSearch(query, promptFiles, options) {
  const { searchInContent, searchInMeta, threshold, maxResults } = options;
  
  // 검색 데이터 로딩
  const searchItems = await loadSearchItems(promptFiles, searchInContent, searchInMeta);
  
  if (searchItems.length === 0) {
    return '검색할 프롬프트가 없습니다';
  }
  
  // 인덱스가 비어있거나 데이터가 변경된 경우 재구축
  const shouldRebuildIndex = optimizedSearchEngine.indexes.trigrams.size === 0 || 
                            searchItems.length !== optimizedSearchEngine.lastIndexedCount;
  
  if (shouldRebuildIndex) {
    optimizedSearchEngine.buildIndexes(searchItems);
    optimizedSearchEngine.lastIndexedCount = searchItems.length;
  }
  
  // 검색 필드 설정
  const searchFields = {};
  if (searchInContent) searchFields.content = query;
  if (searchInMeta) {
    searchFields['metadata.category'] = query;
    searchFields['metadata.description'] = query;
  }
  searchFields.name = query; // 파일명은 항상 검색
  
  // 최적화된 병렬 검색 실행
  const results = await optimizedSearchEngine.searchParallel(query, searchItems, searchFields);
  
  // 태그 검색 (배열 처리)
  if (searchInMeta) {
    const tagResults = [];
    for (const item of searchItems) {
      if (item.metadata.tags && Array.isArray(item.metadata.tags)) {
        for (const tag of item.metadata.tags) {
          if (tag.toLowerCase().includes(query.toLowerCase())) {
            const score = query.toLowerCase() === tag.toLowerCase() ? 1.0 : 0.8;
            if (score >= threshold) {
              tagResults.push({
                item,
                score,
                matchedField: 'tags',
                matchedValue: tag
              });
            }
          }
        }
      }
    }
    
    // 태그 결과를 메인 결과와 병합
    const resultMap = new Map(results.map(r => [r.item.name, r]));
    
    for (const tagResult of tagResults) {
      const existing = resultMap.get(tagResult.item.name);
      if (!existing || tagResult.score > existing.score) {
        resultMap.set(tagResult.item.name, tagResult);
      }
    }
    
    results.length = 0;
    results.push(...Array.from(resultMap.values()));
    results.sort((a, b) => b.score - a.score);
  }
  
  // 결과를 지정된 개수로 제한
  const limitedResults = results.slice(0, maxResults);
  
  // 결과 포맷팅
  return formatSearchResults(query, limitedResults, searchItems);
}

// 검색 결과 포맷팅 함수
function formatSearchResults(query, results, allItems) {
  if (results.length === 0) {
    return `🔍 검색 결과: "${query}" (0개 발견)\n\n검색된 결과가 없습니다.`;
  }

  let resultText = `🔍 검색 결과: "${query}" (${results.length}개 발견)\n\n`;
  
  results.forEach((result, index) => {
    const item = result.item;
    const matchInfo = result.matchedField === 'tags' ? 
      `태그: ${result.matchedValue}` : 
      `${result.matchedField}: ${result.matchedValue?.substring(0, 50) || ''}${result.matchedValue?.length > 50 ? '...' : ''}`;
    
    resultText += `${index + 1}. **${item.name}** (점수: ${(result.score * 100).toFixed(1)}%)\n`;
    resultText += `   📊 ${formatFileSize(item.size)} | 📅 ${formatDate(new Date(item.modified))}\n`;
    resultText += `   🎯 매치: ${matchInfo}\n`;
    
    if (item.metadata.category) {
      resultText += `   📂 카테고리: ${item.metadata.category}\n`;
    }
    
    if (item.metadata.tags && item.metadata.tags.length > 0) {
      resultText += `   🏷️ 태그: ${item.metadata.tags.join(', ')}\n`;
    }
    
    resultText += '\n';
  });

  // 검색 통계 추가 (최적화된 엔진에서)
  const searchStats = optimizedSearchEngine.getPerformanceStats();
  resultText += `📈 검색 통계:\n`;
  resultText += `- 전체 프롬프트: ${allItems.length}개\n`;
  resultText += `- 매치율: ${(results.length / allItems.length * 100).toFixed(1)}%\n`;
  resultText += `- 평균 점수: ${results.length > 0 ? (results.reduce((sum, r) => sum + r.score, 0) / results.length * 100).toFixed(1) : 0}%\n`;
  resultText += `- 검색 성능: ${searchStats.avgSearchTime.toFixed(2)}ms`;
  
  return resultText;
}

// 프롬프트 디렉토리 확인 및 생성
async function ensurePromptsDir() {
  try {
    await fs.mkdir(PROMPTS_DIR, { recursive: true });
    console.error(`프롬프트 디렉토리 확인: ${PROMPTS_DIR}`);
  } catch (err) {
    console.error('프롬프트 디렉토리 생성 오류:', err);
    process.exit(1);
  }
}

// Rate limiting helper function
function checkRateLimit(operation, clientId = 'default') {
  const limiter = rateLimiters.standard;
  const result = limiter.checkLimit(clientId);
  
  if (!result.allowed) {
    log.warn('Rate limit exceeded for operation', {
      operation,
      clientId,
      retryAfter: result.retryAfter
    });
    throw new Error(`Rate limit exceeded. Retry after ${result.retryAfter} seconds.`);
  }
  
  return result;
}

// 캐시 무효화 헬퍼
function invalidateCaches({ filename = null, invalidateList = true, invalidateContent = true, invalidateMetadata = true, invalidateSearch = true } = {}) {
  try {
    if (invalidateList) {
      caches.files.delete(CacheKeyGenerator.list());
    }
    if (filename && invalidateContent) {
      caches.files.delete(CacheKeyGenerator.file(filename));
    }
    if (filename && invalidateMetadata) {
      caches.metadata.delete(CacheKeyGenerator.metadata(filename));
    }
    if (invalidateSearch) {
      caches.search.clear();
    }
    log.debug('Caches invalidated', { filename, invalidateList, invalidateContent, invalidateMetadata, invalidateSearch });
  } catch (e) {
    log.warn('Cache invalidation error', { error: e.message, filename });
  }
}

// 정책/권한 헬퍼
function envBool(key, defaultValue = false) {
  const raw = process.env[key];
  if (raw == null) return defaultValue;
  const normalized = String(raw).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function enforcePolicy(operation) {
  // 읽기 전용 모드: 쓰기성 작업 차단
  const readOnly = envBool('READ_ONLY', false);
  const writeOps = new Set(['create', 'update', 'delete', 'tag', 'categorize', 'create_from_template']);
  if (readOnly && writeOps.has(operation)) {
    throw new PermissionError(operation, 'policy');
  }

  // 임포트/익스포트 개별 제어
  if (operation === 'import' && envBool('DISABLE_IMPORT', false)) {
    throw new PermissionError('import', 'policy');
  }
  if (operation === 'export' && envBool('DISABLE_EXPORT', false)) {
    throw new PermissionError('export', 'policy');
  }

  // 롤백 금지 옵션
  if (operation === 'rollback' && envBool('DISABLE_VERSION_ROLLBACK', false)) {
    throw new PermissionError('rollback', 'policy');
  }
}

// 프롬프트 목록 조회 도구 등록
server.tool(
  "list-prompts",
  "List all available prompts",
  {},
  async () => {
    try {
      // Rate limiting 적용
      checkRateLimit('list-prompts');
      
      // 캐시 확인
      const cacheKey = CacheKeyGenerator.list();
      let prompts = caches.files.get(cacheKey);
      
      if (!prompts) {
        // 캐시 미스 - 파일 시스템에서 읽기
        const files = await fs.readdir(PROMPTS_DIR);
        prompts = await Promise.all(
          files.map(async (filename) => {
            const filePath = path.join(PROMPTS_DIR, filename);
            const stats = await fs.stat(filePath);
            return {
              name: filename,
              size: stats.size,
              modified: stats.mtime.toISOString()
            };
          })
        );
        
        // 캐시에 저장 (5분 TTL)
        caches.files.set(cacheKey, prompts, 300000);
        log.debug('Prompt list cached', { count: prompts.length });
      } else {
        log.debug('Prompt list served from cache', { count: prompts.length });
      }

      if (prompts.length === 0) {
        return createSuccessResponse("No prompts found. Create one using the create-prompt tool.");
      }

      // 목록 포맷팅
      const promptsList = prompts.map(p => 
        `${p.name} (${formatFileSize(p.size)}, last modified: ${formatDate(new Date(p.modified))})`
      ).join("\n");

      return createSuccessResponse(`Available prompts:\n\n${promptsList}`);
    } catch (error) {
      return createErrorResponse(`Failed to list prompts: ${error.message}`, error);
    }
  }
);

// 서버 상태 조회 도구 등록
server.tool(
  "get-server-stats",
  "Get process and server runtime stats",
  {},
  async () => {
    try {
      checkRateLimit('get-server-stats');
      const mem = process.memoryUsage();
      const uptimeMs = Date.now() - SERVER_START_TIME;
      const fmtMb = (b) => (b / 1024 / 1024).toFixed(2) + ' MB';
      const policy = {
        READ_ONLY: envBool('READ_ONLY', false),
        DISABLE_IMPORT: envBool('DISABLE_IMPORT', false),
        DISABLE_EXPORT: envBool('DISABLE_EXPORT', false),
        DISABLE_VERSION_ROLLBACK: envBool('DISABLE_VERSION_ROLLBACK', false)
      };
      const cachesInfo = {
        files: caches.files.getInfo(),
        metadata: caches.metadata.getInfo(),
        search: caches.search.getInfo(),
        templates: caches.templates.getInfo()
      };
      let result = `서버 상태\n\n`;
      result += `- version: 1.0.0\n`;
      result += `- node: ${process.version}\n`;
      result += `- pid: ${process.pid}\n`;
      result += `- promptsDir: ${PROMPTS_DIR}\n`;
      result += `- uptime: ${(uptimeMs/1000).toFixed(0)} sec\n\n`;
      result += `메모리 사용량\n`;
      result += `- rss: ${fmtMb(mem.rss)} / heapUsed: ${fmtMb(mem.heapUsed)} / external: ${fmtMb(mem.external)}\n\n`;
      result += `정책\n`;
      Object.entries(policy).forEach(([k,v])=>{ result += `- ${k}: ${v ? 'ON' : 'OFF'}\n`; });
      result += `\n캐시 정보\n`;
      Object.entries(cachesInfo).forEach(([name, info])=>{
        result += `■ ${name} (size: ${info.size}/${info.maxSize}, ttl: ${info.defaultTTL}ms)\n`;
      });
      return createSuccessResponse(result.trim());
    } catch (error) {
      return createErrorResponse(`서버 상태 조회 실패: ${error.message}`, error);
    }
  }
);

// 프롬프트 조회 도구 등록
server.tool(
  "get-prompt",
  "Get the content of a specific prompt",
  {
    filename: z.string().describe("The filename of the prompt to retrieve")
  },
  async ({ filename }) => {
    try {
      // Rate limiting 적용
      checkRateLimit('get-prompt');
      
      // 입력 정제
      const sanitizedFilename = inputSanitizer.sanitizeFilename(filename);
      
      // 캐시 확인
      const cacheKey = CacheKeyGenerator.file(sanitizedFilename);
      let content = caches.files.get(cacheKey);
      
      if (!content) {
        // 캐시 미스 - 파일 시스템에서 읽기
        const filePath = path.join(PROMPTS_DIR, sanitizedFilename);
        content = await fs.readFile(filePath, "utf-8");
        
        // 캐시에 저장 (10분 TTL)
        caches.files.set(cacheKey, content, 600000);
        log.debug('Prompt content cached', { filename: sanitizedFilename, size: content.length });
      } else {
        log.debug('Prompt content served from cache', { filename: sanitizedFilename });
      }
      
      return createSuccessResponse(`Prompt: ${sanitizedFilename}\n\n${content}`);
    } catch (error) {
      return createErrorResponse(`Failed to get prompt ${filename}: ${error.message}`, error);
    }
  }
);

// 프롬프트 생성 도구 등록
server.tool(
  "create-prompt",
  "Create a new prompt",
  {
    filename: z.string().describe("The filename for the new prompt"),
    content: z.string().describe("The content of the prompt")
  },
  async ({ filename, content }) => {
    try {
      // Rate limiting 적용 (업로드 타입 제한)
      checkRateLimit('create-prompt');
      enforcePolicy('create');
      
      // 고급 입력 검증 및 정제
      const sanitizedFilename = inputSanitizer.sanitizeFilename(filename);
      const sanitizedContent = inputSanitizer.sanitizeText(content, { 
        maxLength: 1024 * 1024, // 1MB
        allowHTML: false,
        allowNewlines: true 
      });
      
      // 위험도 평가
      const filenameRisk = inputSanitizer.assessRisk(sanitizedFilename);
      const contentRisk = inputSanitizer.assessRisk(sanitizedContent);
      
      if (filenameRisk.level === 'high' || contentRisk.level === 'high') {
        log.warn('High risk input detected', {
          operation: 'create-prompt',
          filenameRisk,
          contentRisk
        });
        throw new ValidationError('위험한 입력이 감지되었습니다', 'security');
      }
      
      // 기존 검증 로직도 유지
      const filenameValidation = validateFilename(sanitizedFilename);
      if (!filenameValidation.isValid) {
        throw new ValidationError(filenameValidation.error, 'filename');
      }

      const contentValidation = validateContent(sanitizedContent);
      if (!contentValidation.isValid) {
        throw new ValidationError(contentValidation.error, 'content');
      }

      // 경로 안전성 검증
      if (!validatePathSafety(sanitizedFilename)) {
        throw new ValidationError(`Unsafe path detected: ${sanitizedFilename}`, 'filename');
      }
      
      const filePath = path.join(PROMPTS_DIR, sanitizedFilename);
      
      // 작업 시작 로깅
      const timer = log.time(`create-prompt-${sanitizedFilename}`);
      log.info('Creating new prompt', { 
        filename: sanitizedFilename, 
        contentLength: sanitizedContent.length 
      });

      // 파일 작업을 안전하게 실행
      const result = await safeFileOperation(async () => {
        // 파일 존재 여부 확인
        try {
          await fs.access(filePath);
          throw new FileAlreadyExistsError(sanitizedFilename);
        } catch (e) {
          if (e instanceof FileAlreadyExistsError) throw e;
          // 파일이 없으면 계속 진행
        }
        
        // 재시도 가능한 파일 쓰기 작업
        await retryOperation(async () => {
          await fs.writeFile(filePath, sanitizedContent, "utf-8");
        });
        
        // 버전 히스토리에 저장
        const version = await versionManager.saveVersion(sanitizedFilename, sanitizedContent, "create");
        
        log.info('Prompt created successfully', {
          filename: sanitizedFilename,
          version: version.version,
          size: sanitizedContent.length
        });
        
        return `Successfully created prompt: ${sanitizedFilename} (Version ${version.version})`;
      }, `Creating prompt: ${sanitizedFilename}`);
      
      await timer.end({ operation: 'create-prompt', filename: sanitizedFilename });
      
      // 캐시 무효화 일원화
      invalidateCaches({ filename: sanitizedFilename });
      
      return toMcpSuccessResponse(result);
    } catch (error) {
      return toMcpErrorResponse(error);
    }
  }
);

// 프롬프트 수정 도구 등록
server.tool(
  "update-prompt",
  "Update an existing prompt",
  {
    filename: z.string().describe("The filename of the prompt to update"),
    content: z.string().describe("The new content for the prompt")
  },
  async ({ filename, content }) => {
    try {
      // Rate limiting 적용
      checkRateLimit('update-prompt');
      enforcePolicy('update');
      
      // 입력 검증
      const filenameValidation = validateFilename(filename);
      if (!filenameValidation.isValid) {
        return createErrorResponse(`Invalid filename: ${filenameValidation.error}`);
      }

      const contentValidation = validateContent(content);
      if (!contentValidation.isValid) {
        return createErrorResponse(`Invalid content: ${contentValidation.error}`);
      }

      // 경로 안전성 검증
      if (!validatePathSafety(filename)) {
        return createErrorResponse(`Unsafe path detected: ${filename}`);
      }

      // 입력 정제
      const sanitizedFilename = sanitizeInput(filename);
      const sanitizedContent = sanitizeInput(content);
      
      const filePath = path.join(PROMPTS_DIR, sanitizedFilename);
      
      // 파일 존재 여부 확인
      try {
        await fs.access(filePath);
      } catch (e) {
        return createErrorResponse(`Prompt "${sanitizedFilename}" does not exist. Use create-prompt to create it.`);
      }
      
      await fs.writeFile(filePath, sanitizedContent, "utf-8");
      
      // 버전 히스토리에 저장
      const version = await versionManager.saveVersion(sanitizedFilename, sanitizedContent, "update");
      
      // 캐시 무효화
      invalidateCaches({ filename: sanitizedFilename });
      
      return createSuccessResponse(`Successfully updated prompt: ${sanitizedFilename} (Version ${version.version})`);
    } catch (error) {
      return createErrorResponse(`Failed to update prompt ${filename}: ${error.message}`, error);
    }
  }
);

// 프롬프트 삭제 도구 등록
server.tool(
  "delete-prompt",
  "Delete an existing prompt",
  {
    filename: z.string().describe("The filename of the prompt to delete")
  },
  async ({ filename }) => {
    try {
      // Rate limiting 적용
      checkRateLimit('delete-prompt');
      enforcePolicy('delete');
      const filePath = path.join(PROMPTS_DIR, filename);
      const metaPath = path.join(PROMPTS_DIR, `.${filename}.meta`);
      
      // 파일 존재 여부 확인
      try {
        await fs.access(filePath);
      } catch (e) {
        return createErrorResponse(`Prompt "${filename}" does not exist.`);
      }
      
      // 프롬프트 파일 삭제
      await fs.unlink(filePath);
      
      // 메타데이터 파일도 삭제 (존재하는 경우)
      try {
        await fs.access(metaPath);
        await fs.unlink(metaPath);
      } catch (e) {
        // 메타데이터 파일이 없으면 무시
      }
      
      // 버전 히스토리도 삭제
      await versionManager.deleteVersionHistory(filename);
      
      // 캐시 무효화
      invalidateCaches({ filename, invalidateContent: true, invalidateMetadata: true });
      
      return createSuccessResponse(`Successfully deleted prompt: ${filename}`);
    } catch (error) {
      return createErrorResponse(`Failed to delete prompt ${filename}: ${error.message}`, error);
    }
  }
);

// 프롬프트 검색 도구 등록 (퍼지 검색)
server.tool(
  "search-prompts",
  "Search prompts by filename or content with intelligent fuzzy matching",
  {
    query: z.string().describe("Search query (supports typos and partial matches)"),
    searchInContent: z.boolean().optional().describe("Whether to search in prompt content (default: true)"),
    searchInMeta: z.boolean().optional().describe("Whether to search in metadata (tags, category) (default: true)"),
    threshold: z.number().optional().describe("Similarity threshold (0-1, lower = more permissive, default: 0.3)"),
    maxResults: z.number().optional().describe("Maximum number of results (default: 10)")
  },
  async ({ query, searchInContent = true, searchInMeta = true, threshold = 0.3, maxResults = 10 }) => {
    try {
      // Rate limiting 적용
      checkRateLimit('search-prompts');
      
      // 입력 검증
      const sanitizedQuery = inputSanitizer.sanitizeText(query, { 
        maxLength: 200, 
        allowHTML: false 
      });
      
      if (!sanitizedQuery) {
        return createErrorResponse('검색어를 입력해주세요');
      }

      // 캐시 확인
      const cacheKey = CacheKeyGenerator.search(sanitizedQuery, { searchInContent, searchInMeta, threshold });
      let cachedResults = caches.search.get(cacheKey);
      
      if (cachedResults) {
        log.debug('Search results served from cache', { 
          query: sanitizedQuery 
        });
        return createSuccessResponse(cachedResults);
      }

      const files = await fs.readdir(PROMPTS_DIR);
      const promptFiles = files.filter(f => !f.startsWith('.'));
      
      // 환경 변수로 최적화된 검색 엔진 사용 여부 결정
      const useOptimizedSearch = process.env.USE_OPTIMIZED_SEARCH !== 'false';
      
      if (useOptimizedSearch) {
        // 최적화된 검색 엔진 사용
        const searchResults = await performOptimizedSearch(
          sanitizedQuery, 
          promptFiles, 
          { searchInContent, searchInMeta, threshold, maxResults }
        );
        
        // 캐시에 저장 (2분 TTL)
        caches.search.set(cacheKey, searchResults, 120000);
        
        log.info('Optimized search completed', {
          query: sanitizedQuery,
          searchTime: Date.now()
        });

        return createSuccessResponse(searchResults);
      }

      // 기존 검색 로직 (폴백) - 향상된 병렬 처리 버전
      const searchItems = await loadSearchItems(promptFiles, searchInContent, searchInMeta);

      if (searchItems.length === 0) {
        return createSuccessResponse('검색할 프롬프트가 없습니다');
      }

      // 퍼지 검색 설정
      const fuzzySearcher = new FuzzySearch({
        threshold,
        caseSensitive: false,
        includeScore: true
      });

      // 다중 필드 검색 수행
      const searchFields = {};
      if (searchInContent) searchFields.content = sanitizedQuery;
      if (searchInMeta) {
        searchFields['metadata.category'] = sanitizedQuery;
        searchFields['metadata.description'] = sanitizedQuery;
      }
      
      // 파일명은 항상 검색
      searchFields.name = sanitizedQuery;

      let results = [];

      // 개별 필드별로 검색 수행
      for (const [field, fieldQuery] of Object.entries(searchFields)) {
        const fieldResults = fuzzySearcher.searchObjects(fieldQuery, searchItems, [field]);
        
        // 기존 결과와 병합 (중복 제거)
        for (const result of fieldResults) {
          const existingIndex = results.findIndex(r => r.item.name === result.item.name);
          if (existingIndex >= 0) {
            // 더 높은 점수로 업데이트
            if (result.score > results[existingIndex].score) {
              results[existingIndex] = { 
                ...result, 
                matchedField: field, 
                matchedValue: result.matchedValue 
              };
            }
          } else {
            results.push({ 
              ...result, 
              matchedField: field, 
              matchedValue: result.matchedValue 
            });
          }
        }
      }

      // 태그 검색 (배열 처리)
      if (searchInMeta) {
        for (const item of searchItems) {
          if (item.metadata.tags && Array.isArray(item.metadata.tags)) {
            const tagResults = fuzzySearcher.searchStrings(sanitizedQuery, item.metadata.tags);
            if (tagResults.length > 0) {
              const bestTagMatch = tagResults[0];
              const existingIndex = results.findIndex(r => r.item.name === item.name);
              
              if (existingIndex >= 0) {
                if (bestTagMatch.score > results[existingIndex].score) {
                  results[existingIndex] = {
                    item,
                    score: bestTagMatch.score,
                    matchedField: 'tags',
                    matchedValue: bestTagMatch.item
                  };
                }
              } else if (bestTagMatch.score >= threshold) {
                results.push({
                  item,
                  score: bestTagMatch.score,
                  matchedField: 'tags',
                  matchedValue: bestTagMatch.item
                });
              }
            }
          }
        }
      }

      // 결과 정렬 및 제한
      results.sort((a, b) => b.score - a.score);
      results = results.slice(0, maxResults);

      if (results.length === 0) {
        const noResultsMessage = `"${sanitizedQuery}"와 일치하는 프롬프트를 찾을 수 없습니다.\n\n💡 검색 팁:\n- 철자를 확인해보세요\n- 더 간단한 단어를 사용해보세요\n- 임계값을 낮춰보세요 (현재: ${threshold})`;
        
        // 캐시에 저장 (빈 결과도 짧게 캐시)
        caches.search.set(cacheKey, noResultsMessage, 60000); // 1분
        
        return createSuccessResponse(noResultsMessage);
      }

      // 결과 포맷팅
      let resultText = `🔍 검색 결과: "${sanitizedQuery}" (${results.length}개 발견)\n\n`;
      
      results.forEach((result, index) => {
        const item = result.item;
        const matchInfo = result.matchedField === 'tags' ? 
          `태그: ${result.matchedValue}` : 
          `${result.matchedField}: ${result.matchedValue?.substring(0, 50) || ''}${result.matchedValue?.length > 50 ? '...' : ''}`;
        
        resultText += `${index + 1}. **${item.name}** (점수: ${(result.score * 100).toFixed(1)}%)\n`;
        resultText += `   📊 ${formatFileSize(item.size)} | 📅 ${formatDate(new Date(item.modified))}\n`;
        resultText += `   🎯 매치: ${matchInfo}\n`;
        
        if (item.metadata.category) {
          resultText += `   📂 카테고리: ${item.metadata.category}\n`;
        }
        
        if (item.metadata.tags && item.metadata.tags.length > 0) {
          resultText += `   🏷️ 태그: ${item.metadata.tags.join(', ')}\n`;
        }
        
        resultText += '\n';
      });

      // 검색 통계 추가
      const stats = fuzzySearcher.getSearchStats(sanitizedQuery, searchItems);
      resultText += `📈 검색 통계:\n`;
      resultText += `- 전체 프롬프트: ${stats.totalItems}개\n`;
      resultText += `- 매치율: ${(stats.matchRate * 100).toFixed(1)}%\n`;
      resultText += `- 평균 점수: ${(stats.averageScore * 100).toFixed(1)}%\n`;
      resultText += `- 임계값: ${(threshold * 100).toFixed(1)}%`;

      // 캐시에 저장 (2분 TTL)
      caches.search.set(cacheKey, resultText, 120000);
      
      log.info('Search completed', {
        query: sanitizedQuery,
        resultCount: results.length,
        searchTime: Date.now(),
        fields: Object.keys(searchFields)
      });

      return createSuccessResponse(resultText);
    } catch (error) {
      log.error('Search failed', {
        query,
        error: error.message,
        stack: error.stack
      });
      return createErrorResponse(`검색 실패: ${error.message}`, error);
    }
  }
);


// 프롬프트 태그 추가 도구 등록
server.tool(
  "tag-prompt",
  "Add tags to a prompt",
  {
    filename: z.string().describe("The filename of the prompt to tag"),
    tags: z.array(z.string()).describe("Array of tags to add to the prompt")
  },
  async ({ filename, tags }) => {
    try {
      enforcePolicy('tag');
      const filePath = path.join(PROMPTS_DIR, filename);
      const metaPath = path.join(PROMPTS_DIR, `.${filename}.meta`);
      
      // 파일 존재 여부 확인
      try {
        await fs.access(filePath);
      } catch (e) {
        return createErrorResponse(`Prompt "${filename}" does not exist.`);
      }

      // 기존 메타데이터 로드
      let metadata = { tags: [], category: "", description: "" };
      try {
        const existingMeta = await fs.readFile(metaPath, "utf-8");
        metadata = JSON.parse(existingMeta);
      } catch (e) {
        // 메타데이터 파일이 없으면 새로 생성
      }

      // 태그 추가 (중복 제거)
      const existingTags = new Set(metadata.tags || []);
      tags.forEach(tag => existingTags.add(tag.toLowerCase()));
      metadata.tags = Array.from(existingTags).sort();
      metadata.lastModified = new Date().toISOString();

      // 메타데이터 저장
      await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), "utf-8");
      
      // 캐시 무효화
      invalidateCaches({ filename });

      return createSuccessResponse(`Successfully added tags [${tags.join(", ")}] to prompt: ${filename}`);
    } catch (error) {
      return createErrorResponse(`Failed to tag prompt ${filename}: ${error.message}`, error);
    }
  }
);

// 프롬프트 카테고리 설정 도구 등록
server.tool(
  "categorize-prompt",
  "Set category for a prompt",
  {
    filename: z.string().describe("The filename of the prompt to categorize"),
    category: z.string().describe("Category name for the prompt")
  },
  async ({ filename, category }) => {
    try {
      enforcePolicy('categorize');
      const filePath = path.join(PROMPTS_DIR, filename);
      const metaPath = path.join(PROMPTS_DIR, `.${filename}.meta`);
      
      // 파일 존재 여부 확인
      try {
        await fs.access(filePath);
      } catch (e) {
        return createErrorResponse(`Prompt "${filename}" does not exist.`);
      }

      // 기존 메타데이터 로드
      let metadata = { tags: [], category: "", description: "" };
      try {
        const existingMeta = await fs.readFile(metaPath, "utf-8");
        metadata = JSON.parse(existingMeta);
      } catch (e) {
        // 메타데이터 파일이 없으면 새로 생성
      }

      // 카테고리 설정
      metadata.category = category.toLowerCase();
      metadata.lastModified = new Date().toISOString();

      // 메타데이터 저장
      await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), "utf-8");
      
      // 캐시 무효화
      invalidateCaches({ filename });

      return createSuccessResponse(`Successfully set category "${category}" for prompt: ${filename}`);
    } catch (error) {
      return createErrorResponse(`Failed to categorize prompt ${filename}: ${error.message}`, error);
    }
  }
);

// 카테고리별 프롬프트 조회 도구 등록
server.tool(
  "list-by-category",
  "List prompts by category",
  {
    category: z.string().optional().describe("Category to filter by (optional, shows all categories if not specified)")
  },
  async ({ category }) => {
    try {
      const files = await fs.readdir(PROMPTS_DIR);
      const promptFiles = files.filter(f => !f.startsWith('.'));
      const categorizedPrompts = {};

      for (const filename of promptFiles) {
        const metaPath = path.join(PROMPTS_DIR, `.${filename}.meta`);
        let promptCategory = "uncategorized";
        
        try {
          const metaContent = await fs.readFile(metaPath, "utf-8");
          const metadata = JSON.parse(metaContent);
          promptCategory = metadata.category || "uncategorized";
        } catch (e) {
          // 메타데이터가 없으면 uncategorized
        }

        if (!categorizedPrompts[promptCategory]) {
          categorizedPrompts[promptCategory] = [];
        }
        categorizedPrompts[promptCategory].push(filename);
      }

      // 특정 카테고리 필터링
      if (category) {
        const targetCategory = category.toLowerCase();
        const categoryPrompts = categorizedPrompts[targetCategory] || [];
        
        if (categoryPrompts.length === 0) {
          return createSuccessResponse(`No prompts found in category "${category}"`);
        }

        const promptsList = categoryPrompts.join("\n");
        return createSuccessResponse(`Prompts in category "${category}":\n\n${promptsList}`);
      }

      // 모든 카테고리 표시
      if (Object.keys(categorizedPrompts).length === 0) {
        return createSuccessResponse("No prompts found.");
      }

      let result = "Prompts by category:\n\n";
      for (const [cat, prompts] of Object.entries(categorizedPrompts)) {
        result += `**${cat}** (${prompts.length}):\n`;
        result += prompts.map(p => `  - ${p}`).join("\n") + "\n\n";
      }

      return createSuccessResponse(result.trim());
    } catch (error) {
      return createErrorResponse(`Failed to list prompts by category: ${error.message}`, error);
    }
  }
);

// 프롬프트 템플릿 처리 도구 등록
server.tool(
  "process-template",
  "Process a prompt template with advanced logic (conditions, loops, functions)",
  {
    filename: z.string().describe("The filename of the template prompt"),
    variables: z.record(z.any()).describe("Object with variable names as keys and values (supports nested objects and arrays)")
  },
  async ({ filename, variables }) => {
    try {
      // Rate limiting 적용
      checkRateLimit('process-template');
      
      // 입력 검증
      const sanitizedFilename = inputSanitizer.sanitizeFilename(filename);
      const filenameRisk = inputSanitizer.assessRisk(sanitizedFilename);
      
      if (filenameRisk.level === 'high') {
        throw new ValidationError('위험한 파일명이 감지되었습니다', 'filename');
      }
      
      const filePath = path.join(PROMPTS_DIR, sanitizedFilename);
      
      // 파일 존재 여부 확인
      try {
        await fs.access(filePath);
      } catch (e) {
        return createErrorResponse(`Template "${sanitizedFilename}" does not exist.`);
      }

      // 템플릿 내용 읽기
      const templateContent = await fs.readFile(filePath, "utf-8");
      
      // 템플릿 유효성 검사
      const validation = templateEngine.validate(templateContent);
      if (!validation.isValid) {
        return createErrorResponse(
          `Template validation failed: ${validation.errors.join(', ')}`
        );
      }
      
      // 변수 정제 및 위험도 평가
      const sanitizedVariables = inputSanitizer.sanitizeObject(variables, {
        maxDepth: 5,
        maxKeys: 50,
        maxStringLength: 10000
      });
      
      // 템플릿 렌더링 (고급 기능 사용)
      const processedContent = templateEngine.render(templateContent, sanitizedVariables, {
        maxIterations: 100,
        sanitizeOutput: true,
        logExecution: true
      });
      
      // 사용된 변수들 추출
      const requiredVariables = templateEngine.extractVariables(templateContent);
      const providedVariables = Object.keys(variables);
      const missingVariables = requiredVariables.filter(v => !providedVariables.includes(v));
      
      let result = `Processed template "${sanitizedFilename}":\n\n${processedContent}`;
      
      if (missingVariables.length > 0) {
        result += `\n\n⚠️ Missing variables: ${missingVariables.join(", ")}`;
      }
      
      // 템플릿 처리 통계
      result += `\n\n📊 Template Stats:`;
      result += `\n- Required variables: ${requiredVariables.length}`;
      result += `\n- Provided variables: ${providedVariables.length}`;
      result += `\n- Template length: ${templateContent.length} chars`;
      result += `\n- Output length: ${processedContent.length} chars`;

      return createSuccessResponse(result);
    } catch (error) {
      return createErrorResponse(`Failed to process template ${filename}: ${error.message}`, error);
    }
  }
);

// 템플릿 변수 목록 조회 도구 등록
server.tool(
  "list-template-variables",
  "List all variables in a template prompt",
  {
    filename: z.string().describe("The filename of the template prompt to analyze")
  },
  async ({ filename }) => {
    try {
      const filePath = path.join(PROMPTS_DIR, filename);
      
      // 파일 존재 여부 확인
      try {
        await fs.access(filePath);
      } catch (e) {
        return createErrorResponse(`Template "${filename}" does not exist.`);
      }

      // 템플릿 내용 읽기
      const templateContent = await fs.readFile(filePath, "utf-8");
      
      // 변수 패턴 찾기 {{variable}}
      const variableMatches = templateContent.match(/\{\{\s*([^}]+)\s*\}\}/g) || [];
      
      if (variableMatches.length === 0) {
        return createSuccessResponse(`No template variables found in "${filename}"`);
      }

      // 변수명 추출 및 중복 제거
      const variables = [...new Set(variableMatches.map(match => {
        return match.replace(/\{\{\s*|\s*\}\}/g, '');
      }))].sort();

      const variablesList = variables.map(v => `- {{${v}}}`).join("\n");
      
      return createSuccessResponse(`Template variables in "${filename}":\n\n${variablesList}`);
    } catch (error) {
      return createErrorResponse(`Failed to analyze template ${filename}: ${error.message}`, error);
    }
  }
);

// 즐겨찾기 추가 도구 등록
server.tool(
  "favorite-prompt",
  "Add or remove a prompt from favorites",
  {
    filename: z.string().describe("The filename of the prompt to favorite/unfavorite"),
    action: z.enum(["add", "remove"]).describe("Action to perform: add to favorites or remove from favorites")
  },
  async ({ filename, action }) => {
    try {
      const filePath = path.join(PROMPTS_DIR, filename);
      const metaPath = path.join(PROMPTS_DIR, `.${filename}.meta`);
      
      // 파일 존재 여부 확인
      try {
        await fs.access(filePath);
      } catch (e) {
        return createErrorResponse(`Prompt "${filename}" does not exist.`);
      }

      // 기존 메타데이터 로드
      let metadata = { tags: [], category: "", description: "", favorite: false };
      try {
        const existingMeta = await fs.readFile(metaPath, "utf-8");
        metadata = JSON.parse(existingMeta);
      } catch (e) {
        // 메타데이터 파일이 없으면 새로 생성
      }

      // 즐겨찾기 상태 변경
      if (action === "add") {
        metadata.favorite = true;
        metadata.favoriteDate = new Date().toISOString();
      } else {
        metadata.favorite = false;
        delete metadata.favoriteDate;
      }
      
      metadata.lastModified = new Date().toISOString();

      // 메타데이터 저장
      await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), "utf-8");

      const actionWord = action === "add" ? "added to" : "removed from";
      return createSuccessResponse(`Successfully ${actionWord} favorites: ${filename}`);
    } catch (error) {
      return createErrorResponse(`Failed to ${action} favorite for ${filename}: ${error.message}`, error);
    }
  }
);

// 즐겨찾기 목록 조회 도구 등록
server.tool(
  "list-favorites",
  "List all favorite prompts",
  {},
  async () => {
    try {
      const files = await fs.readdir(PROMPTS_DIR);
      const promptFiles = files.filter(f => !f.startsWith('.'));
      const favoritePrompts = [];

      for (const filename of promptFiles) {
        const metaPath = path.join(PROMPTS_DIR, `.${filename}.meta`);
        
        try {
          const metaContent = await fs.readFile(metaPath, "utf-8");
          const metadata = JSON.parse(metaContent);
          
          if (metadata.favorite) {
            const filePath = path.join(PROMPTS_DIR, filename);
            const stats = await fs.stat(filePath);
            
            favoritePrompts.push({
              name: filename,
              size: formatFileSize(stats.size),
              modified: formatDate(new Date(stats.mtime)),
              favoriteDate: metadata.favoriteDate ? formatDate(new Date(metadata.favoriteDate)) : "Unknown",
              category: metadata.category || "uncategorized",
              tags: metadata.tags || []
            });
          }
        } catch (e) {
          // 메타데이터가 없거나 파싱 실패 시 무시
        }
      }

      if (favoritePrompts.length === 0) {
        return createSuccessResponse("No favorite prompts found. Use 'favorite-prompt' to add some!");
      }

      // 즐겨찾기 날짜순 정렬 (최신 순)
      favoritePrompts.sort((a, b) => {
        if (a.favoriteDate === "Unknown") return 1;
        if (b.favoriteDate === "Unknown") return -1;
        return new Date(b.favoriteDate) - new Date(a.favoriteDate);
      });

      let result = `Favorite prompts (${favoritePrompts.length}):\n\n`;
      
      favoritePrompts.forEach((prompt, index) => {
        result += `${index + 1}. **${prompt.name}** (${prompt.size})\n`;
        result += `   Category: ${prompt.category}\n`;
        if (prompt.tags.length > 0) {
          result += `   Tags: ${prompt.tags.join(", ")}\n`;
        }
        result += `   Added to favorites: ${prompt.favoriteDate}\n`;
        result += `   Last modified: ${prompt.modified}\n\n`;
      });

      return createSuccessResponse(result.trim());
    } catch (error) {
      return createErrorResponse(`Failed to list favorite prompts: ${error.message}`, error);
    }
  }
);

// 프롬프트 버전 히스토리 조회 도구 등록
server.tool(
  "list-prompt-versions",
  "List all versions of a specific prompt",
  {
    filename: z.string().describe("The filename of the prompt to get version history for")
  },
  async ({ filename }) => {
    try {
      const filePath = path.join(PROMPTS_DIR, filename);
      
      // 파일 존재 여부 확인
      try {
        await fs.access(filePath);
      } catch (e) {
        return createErrorResponse(`Prompt "${filename}" does not exist.`);
      }

      const versions = await versionManager.getAllVersions(filename);
      
      if (versions.length === 0) {
        return createSuccessResponse(`No version history found for "${filename}". This prompt may have been created before version tracking was enabled.`);
      }

      let result = `Version history for "${filename}" (${versions.length} versions):\n\n`;
      
      versions.forEach((version, index) => {
        result += `Version ${version.version} (${version.action})\n`;
        result += `  Date: ${formatDate(new Date(version.timestamp))}\n`;
        result += `  Size: ${formatFileSize(version.size)}\n`;
        result += `  Checksum: ${version.checksum}\n`;
        if (index < versions.length - 1) result += "\n";
      });

      return createSuccessResponse(result);
    } catch (error) {
      return createErrorResponse(`Failed to get version history for ${filename}: ${error.message}`, error);
    }
  }
);

// 프롬프트 버전 비교 도구 등록
server.tool(
  "compare-prompt-versions",
  "Compare two versions of a prompt and show differences",
  {
    filename: z.string().describe("The filename of the prompt to compare"),
    fromVersion: z.number().describe("The source version number to compare from"),
    toVersion: z.number().describe("The target version number to compare to")
  },
  async ({ filename, fromVersion, toVersion }) => {
    try {
      const filePath = path.join(PROMPTS_DIR, filename);
      
      // 파일 존재 여부 확인
      try {
        await fs.access(filePath);
      } catch (e) {
        return createErrorResponse(`Prompt "${filename}" does not exist.`);
      }

      const comparison = await versionManager.compareVersionsDetailed(filename, fromVersion, toVersion);
      
      let result = `Comparison: ${filename} v${fromVersion} → v${toVersion}\n\n`;
      result += `Summary:\n`;
      result += `  Lines added: ${comparison.summary.linesAdded}\n`;
      result += `  Lines removed: ${comparison.summary.linesRemoved}\n`;
      result += `  Lines changed: ${comparison.summary.linesChanged}\n`;
      result += `  Total lines (from): ${comparison.summary.totalOldLines}\n`;
      result += `  Total lines (to): ${comparison.summary.totalNewLines}\n\n`;
      result += `Detailed diff:\n`;
      result += "```diff\n";
      result += comparison.diff;
      result += "```";

      return createSuccessResponse(result);
    } catch (error) {
      return createErrorResponse(`Failed to compare versions for ${filename}: ${error.message}`, error);
    }
  }
);

// 프롬프트 버전 롤백 도구 등록
server.tool(
  "rollback-prompt",
  "Rollback a prompt to a specific version",
  {
    filename: z.string().describe("The filename of the prompt to rollback"),
    version: z.number().describe("The version number to rollback to")
  },
  async ({ filename, version }) => {
    try {
      enforcePolicy('rollback');
      const filePath = path.join(PROMPTS_DIR, filename);
      
      // 파일 존재 여부 확인
      try {
        await fs.access(filePath);
      } catch (e) {
        return createErrorResponse(`Prompt "${filename}" does not exist.`);
      }

      const rollbackResult = await versionManager.rollbackToVersion(filename, version);
      
      let result = `Successfully rolled back "${filename}" to version ${rollbackResult.rolledBackTo}\n`;
      result += `New version: ${rollbackResult.newVersion}\n\n`;
      result += `Content preview (first 200 characters):\n`;
      result += rollbackResult.content.substring(0, 200);
      if (rollbackResult.content.length > 200) {
        result += "...";
      }

      return createSuccessResponse(result);
    } catch (error) {
      return createErrorResponse(`Failed to rollback ${filename}: ${error.message}`, error);
    }
  }
);

// 프롬프트 특정 버전 조회 도구 등록
server.tool(
  "get-prompt-version",
  "Get the content of a specific version of a prompt",
  {
    filename: z.string().describe("The filename of the prompt"),
    version: z.number().describe("The version number to retrieve")
  },
  async ({ filename, version }) => {
    try {
      const filePath = path.join(PROMPTS_DIR, filename);
      
      // 파일 존재 여부 확인
      try {
        await fs.access(filePath);
      } catch (e) {
        return createErrorResponse(`Prompt "${filename}" does not exist.`);
      }

      const versionData = await versionManager.getVersion(filename, version);
      
      if (!versionData) {
        return createErrorResponse(`Version ${version} not found for prompt "${filename}".`);
      }

      let result = `Prompt: ${filename} (Version ${version})\n`;
      result += `Action: ${versionData.action}\n`;
      result += `Date: ${formatDate(new Date(versionData.timestamp))}\n`;
      result += `Size: ${formatFileSize(versionData.size)}\n`;
      result += `Checksum: ${versionData.checksum}\n\n`;
      result += `Content:\n${versionData.content}`;

      return createSuccessResponse(result);
    } catch (error) {
      return createErrorResponse(`Failed to get version ${version} of ${filename}: ${error.message}`, error);
    }
  }
);

// 프롬프트 버전 통계 도구 등록
server.tool(
  "get-prompt-version-stats",
  "Get statistics about a prompt's version history",
  {
    filename: z.string().describe("The filename of the prompt to get statistics for")
  },
  async ({ filename }) => {
    try {
      const filePath = path.join(PROMPTS_DIR, filename);
      
      // 파일 존재 여부 확인
      try {
        await fs.access(filePath);
      } catch (e) {
        return createErrorResponse(`Prompt "${filename}" does not exist.`);
      }

      const stats = await versionManager.getVersionStats(filename);
      
      if (stats.totalVersions === 0) {
        return createSuccessResponse(`No version history found for "${filename}".`);
      }

      let result = `Version statistics for "${filename}":\n\n`;
      result += `Total versions: ${stats.totalVersions}\n`;
      result += `First version: ${formatDate(new Date(stats.firstVersion.timestamp))} (${stats.firstVersion.action})\n`;
      result += `Latest version: ${formatDate(new Date(stats.lastVersion.timestamp))} (${stats.lastVersion.action})\n\n`;
      
      result += `Actions breakdown:\n`;
      Object.entries(stats.actions).forEach(([action, count]) => {
        result += `  ${action}: ${count}\n`;
      });
      
      result += `\nSize history:\n`;
      stats.totalSizeHistory.slice(-5).forEach((entry) => {
        result += `  v${entry.version}: ${formatFileSize(entry.size)} (${formatDate(new Date(entry.timestamp))})\n`;
      });
      
      if (stats.totalSizeHistory.length > 5) {
        result += `  ... and ${stats.totalSizeHistory.length - 5} more versions`;
      }

      return createSuccessResponse(result);
    } catch (error) {
      return createErrorResponse(`Failed to get version statistics for ${filename}: ${error.message}`, error);
    }
  }
);

// 템플릿 라이브러리 카테고리 목록 조회 도구 등록
server.tool(
  "list-template-categories",
  "List all available template categories in the template library",
  {},
  async () => {
    try {
      checkRateLimit('list-template-categories');
      
      const categories = templateLibrary.getCategories();
      
      if (categories.length === 0) {
        return createSuccessResponse('템플릿 카테고리가 없습니다.');
      }

      let result = `📚 템플릿 라이브러리 카테고리 (${categories.length}개)\n\n`;
      
      categories.forEach((category, index) => {
        result += `${index + 1}. **${category.name}** (${category.templateCount}개 템플릿)\n`;
        result += `   ${category.description}\n`;
        result += `   ID: \`${category.id}\`\n\n`;
      });

      const stats = templateLibrary.getStatistics();
      result += `📊 전체 통계:\n`;
      result += `- 총 템플릿: ${stats.totalTemplates}개\n`;
      result += `- 총 카테고리: ${stats.totalCategories}개\n`;
      result += `- 총 태그: ${stats.totalTags}개\n\n`;
      
      result += `🏷️ 인기 태그:\n`;
      stats.mostCommonTags.slice(0, 5).forEach(({tag, count}) => {
        result += `- ${tag} (${count}개)\n`;
      });

      return createSuccessResponse(result);
    } catch (error) {
      return createErrorResponse(`템플릿 카테고리 조회 실패: ${error.message}`, error);
    }
  }
);

// 특정 카테고리의 템플릿 목록 조회 도구 등록
server.tool(
  "list-templates-by-category",
  "List all templates in a specific category",
  {
    category: z.string().describe("Category ID to list templates from")
  },
  async ({ category }) => {
    try {
      checkRateLimit('list-templates-by-category');
      
      const templates = templateLibrary.getTemplatesByCategory(category);
      
      if (templates.length === 0) {
        return createSuccessResponse(`카테고리 "${category}"에 템플릿이 없습니다.`);
      }

      let result = `📁 카테고리: ${category} (${templates.length}개 템플릿)\n\n`;
      
      templates.forEach((template, index) => {
        result += `${index + 1}. **${template.name}**\n`;
        result += `   ${template.description}\n`;
        result += `   ID: \`${template.id}\`\n`;
        
        if (template.tags.length > 0) {
          result += `   태그: ${template.tags.map(tag => `\`${tag}\``).join(', ')}\n`;
        }
        
        if (template.variables.length > 0) {
          result += `   필요 변수: ${template.variables.map(v => `\`${v}\``).join(', ')}\n`;
        }
        
        result += '\n';
      });

      return createSuccessResponse(result);
    } catch (error) {
      return createErrorResponse(`템플릿 목록 조회 실패: ${error.message}`, error);
    }
  }
);

// 템플릿 상세 정보 조회 도구 등록
server.tool(
  "get-template-details",
  "Get detailed information about a specific template",
  {
    templateId: z.string().describe("Template ID (format: category.template)")
  },
  async ({ templateId }) => {
    try {
      checkRateLimit('get-template-details');
      
      const template = templateLibrary.getTemplate(templateId);
      
      let result = `📋 템플릿 상세 정보\n\n`;
      result += `**이름**: ${template.name}\n`;
      result += `**ID**: ${template.id}\n`;
      result += `**카테고리**: ${template.categoryName}\n`;
      result += `**설명**: ${template.description}\n\n`;
      
      if (template.tags.length > 0) {
        result += `**태그**: ${template.tags.map(tag => `\`${tag}\``).join(', ')}\n\n`;
      }
      
      if (template.variables.length > 0) {
        result += `**필요 변수** (${template.variables.length}개):\n`;
        template.variables.forEach(variable => {
          result += `- \`{{${variable}}}\`\n`;
        });
        result += '\n';
      }
      
      result += `**템플릿 내용**:\n`;
      result += '```\n';
      result += template.template;
      result += '\n```\n\n';
      
      // 관련 템플릿 추천
      const relatedTemplates = templateLibrary.getRelatedTemplates(templateId, 3);
      if (relatedTemplates.length > 0) {
        result += `🔗 **관련 템플릿**:\n`;
        relatedTemplates.forEach(related => {
          result += `- ${related.name} (\`${related.id}\`)\n`;
        });
      }

      return createSuccessResponse(result);
    } catch (error) {
      return createErrorResponse(`템플릿 상세 정보 조회 실패: ${error.message}`, error);
    }
  }
);

// 템플릿 검색 도구 등록
server.tool(
  "search-templates",
  "Search templates in the template library",
  {
    query: z.string().describe("Search query"),
    category: z.string().optional().describe("Filter by category"),
    tags: z.array(z.string()).optional().describe("Filter by tags"),
    limit: z.number().optional().describe("Maximum number of results (default: 10)")
  },
  async ({ query, category, tags = [], limit = 10 }) => {
    try {
      checkRateLimit('search-templates');
      
      const results = templateLibrary.searchTemplates(query, {
        category,
        tags,
        limit
      });
      
      if (results.length === 0) {
        return createSuccessResponse(`"${query}"에 대한 템플릿을 찾을 수 없습니다.`);
      }

      let result = `🔍 템플릿 검색 결과: "${query}" (${results.length}개 발견)\n\n`;
      
      results.forEach((template, index) => {
        result += `${index + 1}. **${template.name}**\n`;
        result += `   ${template.description}\n`;
        result += `   ID: \`${template.id}\` | 카테고리: ${template.categoryName}\n`;
        
        if (template.tags.length > 0) {
          result += `   태그: ${template.tags.map(tag => `\`${tag}\``).join(', ')}\n`;
        }
        
        if (template.score) {
          result += `   매치 점수: ${(template.score * 100).toFixed(0)}%\n`;
        }
        
        result += '\n';
      });

      return createSuccessResponse(result);
    } catch (error) {
      return createErrorResponse(`템플릿 검색 실패: ${error.message}`, error);
    }
  }
);

// 템플릿 렌더링 도구 등록
server.tool(
  "render-template",
  "Render a template with provided variables",
  {
    templateId: z.string().describe("Template ID (format: category.template)"),
    variables: z.record(z.any()).describe("Variables to use in template rendering")
  },
  async ({ templateId, variables }) => {
    try {
      checkRateLimit('render-template');
      
      const result = templateLibrary.renderTemplate(templateId, variables);
      
      let response = `✅ 템플릿 렌더링 완료: **${result.templateName}**\n\n`;
      
      response += `**렌더링 결과**:\n`;
      response += '---\n';
      response += result.renderedContent;
      response += '\n---\n\n';
      
      response += `📊 **렌더링 정보**:\n`;
      response += `- 사용된 변수: ${result.usedVariables.length}개 (${result.usedVariables.join(', ')})\n`;
      response += `- 필요한 변수: ${result.requiredVariables.length}개\n`;
      
      if (result.missingVariables.length > 0) {
        response += `- ⚠️ 누락된 변수: ${result.missingVariables.join(', ')}\n`;
      }
      
      response += `- 출력 길이: ${result.renderedContent.length}자\n`;

      return createSuccessResponse(response);
    } catch (error) {
      return createErrorResponse(`템플릿 렌더링 실패: ${error.message}`, error);
    }
  }
);

// 인기 템플릿 조회 도구 등록
server.tool(
  "get-popular-templates",
  "Get most popular templates from the library",
  {
    limit: z.number().optional().describe("Number of templates to return (default: 5)")
  },
  async ({ limit = 5 }) => {
    try {
      checkRateLimit('get-popular-templates');
      
      const popularTemplates = templateLibrary.getPopularTemplates(limit);
      
      if (popularTemplates.length === 0) {
        return createSuccessResponse('인기 템플릿이 없습니다.');
      }

      let result = `🌟 인기 템플릿 TOP ${popularTemplates.length}\n\n`;
      
      popularTemplates.forEach((template, index) => {
        result += `${index + 1}. **${template.name}**\n`;
        result += `   ${template.description}\n`;
        result += `   ID: \`${template.id}\` | 카테고리: ${template.categoryName}\n`;
        result += `   태그: ${template.tags.map(tag => `\`${tag}\``).join(', ')}\n\n`;
      });

      return createSuccessResponse(result);
    } catch (error) {
      return createErrorResponse(`인기 템플릿 조회 실패: ${error.message}`, error);
    }
  }
);

// 템플릿을 프롬프트로 생성하는 도구 등록
server.tool(
  "create-prompt-from-template",
  "Create a new prompt file from a template with variables",
  {
    templateId: z.string().describe("Template ID to use"),
    filename: z.string().describe("Filename for the new prompt"),
    variables: z.record(z.any()).describe("Variables to use in template rendering"),
    addMetadata: z.boolean().optional().describe("Whether to add template metadata (default: true)")
  },
  async ({ templateId, filename, variables, addMetadata = true }) => {
    try {
      checkRateLimit('create-prompt-from-template');
      enforcePolicy('create_from_template');
      
      // 템플릿 렌더링
      const renderResult = templateLibrary.renderTemplate(templateId, variables);
      const template = templateLibrary.getTemplate(templateId);
      
      // 파일명 정제
      const sanitizedFilename = inputSanitizer.sanitizeFilename(filename);
      
      // 파일 경로 설정
      const filePath = path.join(PROMPTS_DIR, sanitizedFilename);
      
      // 파일 존재 여부 확인
      try {
        await fs.access(filePath);
        return createErrorResponse(`프롬프트 "${sanitizedFilename}"이 이미 존재합니다.`);
      } catch (e) {
        // 파일이 없으면 계속 진행
      }
      
      // 프롬프트 내용 생성
      let promptContent = renderResult.renderedContent;
      
      // 템플릿 정보를 주석으로 추가 (선택사항)
      if (addMetadata) {
        const metadataComment = `<!-- 
템플릿: ${template.name} (${templateId})
생성일: ${new Date().toISOString()}
사용된 변수: ${Object.keys(variables).join(', ')}
-->

`;
        promptContent = metadataComment + promptContent;
      }
      
      // 파일 생성
      await fs.writeFile(filePath, promptContent, "utf-8");
      
      // 버전 히스토리에 저장
      const version = await versionManager.saveVersion(sanitizedFilename, promptContent, "create_from_template");
      
      // 메타데이터 생성
      if (addMetadata) {
        const metaPath = path.join(PROMPTS_DIR, `.${sanitizedFilename}.meta`);
        const metadata = {
          tags: [...template.tags, 'template-generated'],
          category: template.categoryId,
          description: `${template.name} 템플릿으로 생성됨`,
          templateId: templateId,
          templateName: template.name,
          generatedDate: new Date().toISOString(),
          usedVariables: Object.keys(variables),
          lastModified: new Date().toISOString()
        };
        
        await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), "utf-8");
      }
      
      // 캐시 무효화
      invalidateCaches({ filename: sanitizedFilename });
      
      let result = `✅ 템플릿으로부터 프롬프트 생성 완료!\n\n`;
      result += `**파일명**: ${sanitizedFilename}\n`;
      result += `**템플릿**: ${template.name} (\`${templateId}\`)\n`;
      result += `**버전**: ${version.version}\n`;
      result += `**크기**: ${formatFileSize(promptContent.length)}\n\n`;
      
      if (renderResult.missingVariables.length > 0) {
        result += `⚠️ **누락된 변수**: ${renderResult.missingVariables.join(', ')}\n`;
        result += `이 변수들은 템플릿에서 빈 값으로 처리되었습니다.\n\n`;
      }
      
      result += `**내용 미리보기** (처음 200자):\n`;
      result += '```\n';
      result += promptContent.substring(0, 200);
      if (promptContent.length > 200) result += '...';
      result += '\n```';

      log.info('Prompt created from template', {
        templateId,
        filename: sanitizedFilename,
        version: version.version,
        variableCount: Object.keys(variables).length
      });

      return createSuccessResponse(result);
    } catch (error) {
      return createErrorResponse(`템플릿으로부터 프롬프트 생성 실패: ${error.message}`, error);
    }
  }
);

// 프롬프트 내보내기 도구 등록
server.tool(
  "export-prompts",
  "Export prompts to JSON format for backup or sharing",
  {
    format: z.enum(["json"]).optional().describe("Export format (default: json)"),
    includeMetadata: z.boolean().optional().describe("Include metadata in export (default: true)"),
    includeVersionHistory: z.boolean().optional().describe("Include version history in export (default: false)"),
    filterByTags: z.array(z.string()).optional().describe("Filter prompts by tags"),
    filterByCategory: z.string().optional().describe("Filter prompts by category"),
    compress: z.boolean().optional().describe("Compress export data (default: false)")
  },
  async ({ format = "json", includeMetadata = true, includeVersionHistory = false, filterByTags = [], filterByCategory, compress = false }) => {
    try {
      checkRateLimit('export-prompts');
      enforcePolicy('export');
      
      log.info('Starting prompt export', { 
        format, 
        includeMetadata, 
        includeVersionHistory,
        filterByTags,
        filterByCategory
      });

      const exportResult = await importExportManager.exportPrompts({
        format,
        includeMetadata,
        includeVersionHistory,
        filterByTags,
        filterByCategory,
        compress
      });

      if (exportResult.success) {
        let result = `✅ 프롬프트 내보내기 완료!\n\n`;
        result += `**형식**: ${format.toUpperCase()}\n`;
        result += `**파일명**: ${exportResult.filename}\n`;
        result += `**전체 프롬프트**: ${exportResult.summary.totalPrompts}개\n`;
        result += `**내보낸 프롬프트**: ${exportResult.summary.exportedPrompts}개\n`;
        result += `**생성 시간**: ${new Date(exportResult.summary.timestamp).toLocaleString('ko-KR')}\n`;
        result += `**데이터 크기**: ${formatFileSize(JSON.stringify(exportResult.data).length)}\n\n`;
        
        if (filterByTags.length > 0) {
          result += `**태그 필터**: ${filterByTags.join(', ')}\n`;
        }
        
        if (filterByCategory) {
          result += `**카테고리 필터**: ${filterByCategory}\n`;
        }
        
        result += `**포함 항목**:\n`;
        result += `- 프롬프트 내용: ✅\n`;
        result += `- 메타데이터: ${includeMetadata ? '✅' : '❌'}\n`;
        result += `- 버전 히스토리: ${includeVersionHistory ? '✅' : '❌'}\n\n`;
        
        result += `**내보내기 데이터 샘플**:\n`;
        result += '```json\n';
        result += JSON.stringify({
          exportInfo: exportResult.data.exportInfo,
          promptSample: exportResult.data.prompts.slice(0, 1).map(p => ({
            filename: p.filename,
            size: p.size,
            checksum: p.checksum.substring(0, 8) + '...',
            hasMetadata: !!p.metadata,
            hasVersionHistory: !!p.versionHistory
          }))
        }, null, 2);
        result += '\n```';

        return createSuccessResponse(result);
      } else {
        return createErrorResponse('내보내기 실패');
      }

    } catch (error) {
      log.error('Export failed', { error: error.message });
      return createErrorResponse(`프롬프트 내보내기 실패: ${error.message}`, error);
    }
  }
);

// 프롬프트 가져오기 도구 등록
server.tool(
  "import-prompts",
  "Import prompts from JSON format",
  {
    importData: z.object({
      exportInfo: z.object({}).optional(),
      prompts: z.array(z.object({
        filename: z.string(),
        content: z.string(),
        checksum: z.string().optional(),
        size: z.number().optional(),
        created: z.string().optional(),
        modified: z.string().optional(),
        metadata: z.object({}).optional(),
        versionHistory: z.array(z.object({})).optional()
      }))
    }).describe("Import data in export format"),
    overwriteExisting: z.boolean().optional().describe("Overwrite existing files (default: false)"),
    skipDuplicates: z.boolean().optional().describe("Skip duplicate files (default: true)"),
    validateChecksums: z.boolean().optional().describe("Validate file checksums (default: true)"),
    createBackup: z.boolean().optional().describe("Create backup before import (default: true)"),
    mergeMetadata: z.boolean().optional().describe("Merge with existing metadata (default: true)")
  },
  async ({ importData, overwriteExisting = false, skipDuplicates = true, validateChecksums = true, createBackup = true, mergeMetadata = true }) => {
    try {
      checkRateLimit('import-prompts');
      enforcePolicy('import');
      
      log.info('Starting prompt import', { 
        promptCount: importData.prompts?.length || 0,
        overwriteExisting,
        skipDuplicates,
        validateChecksums,
        createBackup
      });

      const importResult = await importExportManager.importPrompts(importData, {
        overwriteExisting,
        skipDuplicates,
        validateChecksums,
        createBackup,
        mergeMetadata
      });

      if (importResult.success) {
        // 캐시 무효화
        caches.files.delete(CacheKeyGenerator.list());
        caches.metadata.clear();
        caches.search.clear();

        let result = `✅ 프롬프트 가져오기 완료!\n\n`;
        result += `**가져온 프롬프트**: ${importResult.imported}개\n`;
        result += `**덮어쓴 프롬프트**: ${importResult.overwritten}개\n`;
        result += `**건너뛴 프롬프트**: ${importResult.skipped}개\n`;
        result += `**오류 발생**: ${importResult.errors.length}개\n\n`;
        
        if (importResult.backupInfo) {
          result += `**백업 정보**:\n`;
          result += `- 백업 위치: ${path.basename(importResult.backupInfo.backupDir)}\n`;
          result += `- 백업된 파일: ${importResult.backupInfo.fileCount}개\n`;
          result += `- 백업 시간: ${new Date(importResult.backupInfo.timestamp).toLocaleString('ko-KR')}\n\n`;
        }
        
        if (importResult.errors.length > 0) {
          result += `**오류 상세**:\n`;
          importResult.errors.slice(0, 5).forEach(error => {
            result += `- ${error.filename}: ${error.error}\n`;
          });
          if (importResult.errors.length > 5) {
            result += `- ... 외 ${importResult.errors.length - 5}개 오류\n`;
          }
          result += '\n';
        }
        
        result += `**처리된 파일 상세**:\n`;
        importResult.processedFiles.slice(0, 10).forEach(file => {
          const actionText = {
            'imported': '✅ 가져옴',
            'overwritten': '🔄 덮어씀',
            'skipped': '⏭️ 건너뜀'
          }[file.action] || file.action;
          
          result += `- ${file.filename}: ${actionText}\n`;
        });
        
        if (importResult.processedFiles.length > 10) {
          result += `- ... 외 ${importResult.processedFiles.length - 10}개 파일\n`;
        }

        return createSuccessResponse(result);
      } else {
        return createErrorResponse('가져오기 실패');
      }

    } catch (error) {
      log.error('Import failed', { error: error.message });
      return createErrorResponse(`프롬프트 가져오기 실패: ${error.message}`, error);
    }
  }
);

// 가져오기/내보내기 상태 조회 도구 등록
server.tool(
  "get-import-export-status",
  "Get import/export system status and capabilities",
  {},
  async () => {
    try {
      checkRateLimit('get-import-export-status');
      
      const status = await importExportManager.getImportExportStatus();
      const policy = {
        readOnly: envBool('READ_ONLY', false),
        disableImport: envBool('DISABLE_IMPORT', false),
        disableExport: envBool('DISABLE_EXPORT', false),
        disableVersionRollback: envBool('DISABLE_VERSION_ROLLBACK', false)
      };
      
      let result = `📊 가져오기/내보내기 시스템 상태\n\n`;
      result += `**현재 프롬프트**: ${status.totalPrompts}개\n`;
      result += `**메타데이터 지원**: ${status.hasMetadata ? '✅' : '❌'}\n`;
      result += `**백업 개수**: ${status.backupCount}개\n`;
      result += `**최대 파일 크기**: ${status.maxFileSize}\n\n`;
      
      result += `**정책 상태**:\n`;
      result += `- 읽기 전용(READ_ONLY): ${policy.readOnly ? 'ON' : 'OFF'}\n`;
      result += `- 임포트 금지(DISABLE_IMPORT): ${policy.disableImport ? 'ON' : 'OFF'}\n`;
      result += `- 익스포트 금지(DISABLE_EXPORT): ${policy.disableExport ? 'ON' : 'OFF'}\n`;
      result += `- 롤백 금지(DISABLE_VERSION_ROLLBACK): ${policy.disableVersionRollback ? 'ON' : 'OFF'}\n\n`;
      
      if (status.lastBackup) {
        result += `**최근 백업**:\n`;
        result += `- 이름: ${status.lastBackup.name}\n`;
        result += `- 생성 시간: ${new Date(status.lastBackup.created).toLocaleString('ko-KR')}\n`;
        result += `- 파일 수: ${status.lastBackup.fileCount}개\n\n`;
      }
      
      result += `**지원 형식**: ${status.supportedFormats.join(', ')}\n\n`;
      
      result += `**기능 지원**:\n`;
      Object.entries(status.features).forEach(([feature, supported]) => {
        const featureNames = {
          export: '내보내기',
          import: '가져오기',
          backup: '백업',
          validation: '유효성 검사',
          metadata: '메타데이터',
          versionHistory: '버전 히스토리'
        };
        
        result += `- ${featureNames[feature] || feature}: ${supported ? '✅' : '❌'}\n`;
      });

      return createSuccessResponse(result);

    } catch (error) {
      log.error('Failed to get import/export status', { error: error.message });
      return createErrorResponse(`상태 조회 실패: ${error.message}`, error);
    }
  }
);

// 정책 상태 조회 도구 등록
server.tool(
  "get-policy-status",
  "Get current policy/permission flags",
  {},
  async () => {
    try {
      checkRateLimit('get-policy-status');
      const flags = {
        READ_ONLY: envBool('READ_ONLY', false),
        DISABLE_IMPORT: envBool('DISABLE_IMPORT', false),
        DISABLE_EXPORT: envBool('DISABLE_EXPORT', false),
        DISABLE_VERSION_ROLLBACK: envBool('DISABLE_VERSION_ROLLBACK', false)
      };
      let result = `🔐 정책/권한 상태\n\n`;
      Object.entries(flags).forEach(([k, v]) => {
        result += `- ${k}: ${v ? 'ON' : 'OFF'}\n`;
      });
      return createSuccessResponse(result);
    } catch (error) {
      return createErrorResponse(`정책 상태 조회 실패: ${error.message}`, error);
    }
  }
);

// 캐시 상태 조회 도구 등록
server.tool(
  "get-cache-stats",
  "Read cache statistics for files/metadata/search/templates",
  {},
  async () => {
    try {
      checkRateLimit('get-cache-stats');
      const stats = {
        files: caches.files.getStats(),
        metadata: caches.metadata.getStats(),
        search: caches.search.getStats(),
        templates: caches.templates.getStats()
      };
      let result = `캐시 통계\n\n`;
      Object.entries(stats).forEach(([name, s]) => {
        result += `■ ${name}\n`;
        result += `- size: ${s.size}/${s.maxSize}\n`;
        result += `- hitRate: ${s.hitRate}\n`;
        result += `- hits/misses/sets/del: ${s.hits}/${s.misses}/${s.sets}/${s.deletes}\n`;
        result += `- evictions/cleanups: ${s.evictions}/${s.cleanups}\n`;
        result += `- memory: ${s.memoryUsage.mb} MB\n\n`;
      });
      return createSuccessResponse(result.trim());
    } catch (error) {
      return createErrorResponse(`캐시 통계 조회 실패: ${error.message}`, error);
    }
  }
);

// 레이트 리미터 상태 조회 도구 등록
server.tool(
  "get-rate-limit-status",
  "Get current rate limiter stats (standard/strict/upload)",
  {},
  async () => {
    try {
      checkRateLimit('get-rate-limit-status');
      const status = {
        standard: rateLimiters.standard.getStats(),
        strict: rateLimiters.strict.getStats(),
        upload: rateLimiters.upload.getStats()
      };
      let result = `레이트 리미터 상태\n\n`;
      Object.entries(status).forEach(([name, s]) => {
        result += `■ ${name}\n`;
        result += `- windowMs/max: ${s.windowMs}/${s.maxRequests}\n`;
        result += `- totalClients: ${s.totalClients}\n`;
        result += `- activeClients(sample): ${Math.min(s.activeClients?.length || 0, 5)} 보여줌\n\n`;
      });
      return createSuccessResponse(result.trim());
    } catch (error) {
      return createErrorResponse(`레이트 리미터 상태 조회 실패: ${error.message}`, error);
    }
  }
);

// MCP 응답 형식으로 변환하는 함수들
function toMcpErrorResponse(error) {
  const errorResponse = createErrorResponse(error, process.env.NODE_ENV === 'development');
  globalErrorTracker.track(error);
  
  // 구조화된 로깅
  log.error('MCP operation failed', {
    errorName: error.name,
    errorCode: error.code,
    message: error.message,
    filename: error.filename,
    field: error.field,
    context: error.context
  });
  
  return {
    content: [
      {
        type: "text",
        text: errorResponse.error.message
      }
    ]
  };
}

function toMcpSuccessResponse(data, message) {
  const successResponse = createSuccessResponse(data, message);
  const text = message || (typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  
  return {
    content: [
      {
        type: "text",
        text: text
      }
    ]
  };
}

// 유틸리티 함수: 파일 크기 포맷팅
function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// 유틸리티 함수: 날짜 포맷팅
function formatDate(date) {
  return date.toLocaleString();
}

// 메인 함수
async function main() {
  try {
    log.info('Starting MCP Prompt Manager Server', {
      version: '1.0.0',
      promptsDir: PROMPTS_DIR,
      nodeVersion: process.version,
      pid: process.pid
    });

    await ensurePromptsDir();
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    log.info('MCP Server connected successfully', {
      transport: 'stdio',
      capabilities: Object.keys(server.capabilities || {})
    });
    
    console.error("Prompt Manager MCP Server running on stdio");
  } catch (error) {
    log.error('Fatal error during server startup', {
      error: error.message,
      stack: error.stack
    });
    console.error("Fatal error in main():", error);
    process.exit(1);
  }
}

// 프로세스 종료 시 정리
async function gracefulShutdown(signal) {
  try {
    log.info(`Received ${signal}, shutting down gracefully`);
    // 리미터/캐시 정리
    try { rateLimiters.standard.destroy(); } catch {}
    try { rateLimiters.strict.destroy(); } catch {}
    try { rateLimiters.upload.destroy(); } catch {}
    try { caches.files.destroy(); } catch {}
    try { caches.metadata.destroy(); } catch {}
    try { caches.search.destroy(); } catch {}
    try { caches.templates.destroy(); } catch {}
    const stats = globalErrorTracker.getStats();
    log.info('Server shutdown stats', stats);
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// 서버 실행
main().catch((error) => {
  log.error('Unhandled exception in main', {
    error: error.message,
    stack: error.stack
  });
  console.error("Unhandled exception:", error);
  process.exit(1);
});
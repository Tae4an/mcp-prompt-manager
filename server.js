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
  CacheKeyGenerator 
} from "./utils/cache.js";

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

// 서버 인스턴스 생성
const server = new McpServer({
  name: "prompt-manager",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

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
      
      // 캐시 무효화 (리스트 캐시 삭제)
      caches.files.delete(CacheKeyGenerator.list());
      log.debug('Cache invalidated after prompt creation');
      
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
      
      return createSuccessResponse(`Successfully deleted prompt: ${filename}`);
    } catch (error) {
      return createErrorResponse(`Failed to delete prompt ${filename}: ${error.message}`, error);
    }
  }
);

// 프롬프트 검색 도구 등록
server.tool(
  "search-prompts",
  "Search prompts by filename or content",
  {
    query: z.string().describe("Search query to match against filename or content"),
    searchInContent: z.boolean().optional().describe("Whether to search in prompt content (default: false)")
  },
  async ({ query, searchInContent = false }) => {
    try {
      // Rate limiting 적용
      checkRateLimit('search-prompts');
      const files = await fs.readdir(PROMPTS_DIR);
      const matchedPrompts = [];

      for (const filename of files) {
        const filePath = path.join(PROMPTS_DIR, filename);
        let isMatch = false;

        // 파일명 검색
        if (filename.toLowerCase().includes(query.toLowerCase())) {
          isMatch = true;
        }

        // 내용 검색 (옵션)
        if (!isMatch && searchInContent) {
          try {
            const content = await fs.readFile(filePath, "utf-8");
            const normalizedContent = content.toLowerCase().replace(/\s+/g, ' ').trim();
            const normalizedQuery = query.toLowerCase().replace(/\s+/g, ' ').trim();
            if (normalizedContent.includes(normalizedQuery)) {
              isMatch = true;
            }
          } catch (e) {
            // 파일 읽기 실패 시 무시
          }
        }

        if (isMatch) {
          const stats = await fs.stat(filePath);
          matchedPrompts.push({
            name: filename,
            size: formatFileSize(stats.size),
            modified: formatDate(new Date(stats.mtime))
          });
        }
      }

      if (matchedPrompts.length === 0) {
        return createSuccessResponse(`No prompts found matching "${query}"`);
      }

      const resultsList = matchedPrompts.map(p => 
        `${p.name} (${p.size}, last modified: ${p.modified})`
      ).join("\n");

      return createSuccessResponse(`Found ${matchedPrompts.length} prompt(s) matching "${query}":\n\n${resultsList}`);
    } catch (error) {
      return createErrorResponse(`Failed to search prompts: ${error.message}`, error);
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

      const comparison = await versionManager.compareVersions(filename, fromVersion, toVersion);
      
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
process.on('SIGINT', async () => {
  log.info('Received SIGINT, shutting down gracefully');
  const stats = globalErrorTracker.getStats();
  log.info('Server shutdown stats', stats);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

// 서버 실행
main().catch((error) => {
  log.error('Unhandled exception in main', {
    error: error.message,
    stack: error.stack
  });
  console.error("Unhandled exception:", error);
  process.exit(1);
});
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

// ESM에서 __dirname 구하기
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 프롬프트 디렉토리 설정
const PROMPTS_DIR = process.env.PROMPTS_DIR || path.join(__dirname, "prompts");

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

// 프롬프트 목록 조회 도구 등록
server.tool(
  "list-prompts",
  "List all available prompts",
  {},
  async () => {
    try {
      const files = await fs.readdir(PROMPTS_DIR);
      const prompts = await Promise.all(
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

      if (prompts.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No prompts found. Create one using the create-prompt tool."
            }
          ]
        };
      }

      // 목록 포맷팅
      const promptsList = prompts.map(p => 
        `${p.name} (${formatFileSize(p.size)}, last modified: ${formatDate(new Date(p.modified))})`
      ).join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Available prompts:\n\n${promptsList}`
          }
        ]
      };
    } catch (error) {
      console.error("Error listing prompts:", error);
      return {
        content: [
          {
            type: "text",
            text: `Failed to list prompts: ${error.message}`
          }
        ]
      };
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
      const filePath = path.join(PROMPTS_DIR, filename);
      const content = await fs.readFile(filePath, "utf-8");
      
      return {
        content: [
          {
            type: "text",
            text: `Prompt: ${filename}\n\n${content}`
          }
        ]
      };
    } catch (error) {
      console.error(`Error getting prompt ${filename}:`, error);
      return {
        content: [
          {
            type: "text",
            text: `Failed to get prompt ${filename}: ${error.message}`
          }
        ]
      };
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
      const filePath = path.join(PROMPTS_DIR, filename);
      
      // 파일 존재 여부 확인
      try {
        await fs.access(filePath);
        return {
          content: [
            {
              type: "text",
              text: `A prompt with filename "${filename}" already exists. Use update-prompt to modify it.`
            }
          ]
        };
      } catch (e) {
        // 파일이 없으면 계속 진행
      }
      
      await fs.writeFile(filePath, content, "utf-8");
      
      return {
        content: [
          {
            type: "text",
            text: `Successfully created prompt: ${filename}`
          }
        ]
      };
    } catch (error) {
      console.error(`Error creating prompt ${filename}:`, error);
      return {
        content: [
          {
            type: "text",
            text: `Failed to create prompt ${filename}: ${error.message}`
          }
        ]
      };
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
      const filePath = path.join(PROMPTS_DIR, filename);
      
      // 파일 존재 여부 확인
      try {
        await fs.access(filePath);
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `Prompt "${filename}" does not exist. Use create-prompt to create it.`
            }
          ]
        };
      }
      
      await fs.writeFile(filePath, content, "utf-8");
      
      return {
        content: [
          {
            type: "text",
            text: `Successfully updated prompt: ${filename}`
          }
        ]
      };
    } catch (error) {
      console.error(`Error updating prompt ${filename}:`, error);
      return {
        content: [
          {
            type: "text",
            text: `Failed to update prompt ${filename}: ${error.message}`
          }
        ]
      };
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
      const filePath = path.join(PROMPTS_DIR, filename);
      
      // 파일 존재 여부 확인
      try {
        await fs.access(filePath);
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `Prompt "${filename}" does not exist.`
            }
          ]
        };
      }
      
      await fs.unlink(filePath);
      
      return {
        content: [
          {
            type: "text",
            text: `Successfully deleted prompt: ${filename}`
          }
        ]
      };
    } catch (error) {
      console.error(`Error deleting prompt ${filename}:`, error);
      return {
        content: [
          {
            type: "text",
            text: `Failed to delete prompt ${filename}: ${error.message}`
          }
        ]
      };
    }
  }
);

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
    await ensurePromptsDir();
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Prompt Manager MCP Server running on stdio");
  } catch (error) {
    console.error("Fatal error in main():", error);
    process.exit(1);
  }
}

// 서버 실행
main().catch((error) => {
  console.error("Unhandled exception:", error);
  process.exit(1);
});
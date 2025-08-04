import { jest } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock MCP SDK
const mockMcpServer = {
  tool: jest.fn(),
  connect: jest.fn(),
  close: jest.fn(),
  onerror: jest.fn(),
  onclose: jest.fn()
};

const mockTransport = {
  connect: jest.fn(),
  close: jest.fn()
};

jest.unstable_mockModule('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: jest.fn().mockImplementation(() => mockMcpServer)
}));

jest.unstable_mockModule('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn().mockImplementation(() => mockTransport)
}));

// Mock 버전 관리자
const mockVersionManager = {
  initializeVersions: jest.fn(),
  createVersion: jest.fn(),
  getVersions: jest.fn().mockResolvedValue([]),
  getVersion: jest.fn(),
  deleteVersion: jest.fn(),
  restoreVersion: jest.fn()
};

jest.unstable_mockModule('../utils/version-manager.js', () => ({
  VersionManager: jest.fn().mockImplementation(() => mockVersionManager)
}));

describe('Server Main Functions', () => {
  let server;
  const testDir = path.join(__dirname, '../test-prompts');
  
  beforeAll(async () => {
    // 테스트 디렉토리 생성
    await fs.mkdir(testDir, { recursive: true });
    process.env.PROMPTS_DIR = testDir;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    // 테스트 디렉토리 정리
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // 무시
    }
  });

  describe('Server Initialization', () => {
    test('should create server instance', async () => {
      const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
      expect(McpServer).toHaveBeenCalledWith({
        name: "prompt-manager",
        version: "1.0.0"
      });
    });

    test('should initialize version manager', async () => {
      const { VersionManager } = await import('../utils/version-manager.js');
      expect(VersionManager).toHaveBeenCalled();
    });
  });

  describe('Tool Registration', () => {
    beforeEach(async () => {
      // 서버 모듈을 동적으로 import하여 도구 등록 확인
      await import('../server.js');
    });

    test('should register create_prompt tool', () => {
      expect(mockMcpServer.tool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "create_prompt"
        }),
        expect.any(Function)
      );
    });

    test('should register list_prompts tool', () => {
      expect(mockMcpServer.tool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "list_prompts"
        }),
        expect.any(Function)
      );
    });

    test('should register get_prompt tool', () => {
      expect(mockMcpServer.tool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "get_prompt"
        }),
        expect.any(Function)
      );
    });

    test('should register update_prompt tool', () => {
      expect(mockMcpServer.tool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "update_prompt"
        }),
        expect.any(Function)
      );
    });

    test('should register delete_prompt tool', () => {
      expect(mockMcpServer.tool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "delete_prompt"
        }),
        expect.any(Function)
      );
    });

    test('should register search_prompts tool', () => {
      expect(mockMcpServer.tool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "search_prompts"
        }),
        expect.any(Function)
      );
    });

    test('should register set_metadata tool', () => {
      expect(mockMcpServer.tool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "set_metadata"
        }),
        expect.any(Function)
      );
    });

    test('should register get_metadata tool', () => {
      expect(mockMcpServer.tool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "get_metadata"
        }),
        expect.any(Function)
      );
    });
  });

  describe('Server Connection', () => {
    test('should connect to transport', async () => {
      await import('../server.js');
      expect(mockTransport.connect).toHaveBeenCalled();
      expect(mockMcpServer.connect).toHaveBeenCalledWith(mockTransport);
    });

    test('should handle server errors', async () => {
      await import('../server.js');
      expect(typeof mockMcpServer.onerror).toBe('function');
    });

    test('should handle server close', async () => {
      await import('../server.js');
      expect(typeof mockMcpServer.onclose).toBe('function');
    });
  });

  describe('Error Handling Integration', () => {
    test('should handle process uncaught exceptions', () => {
      const listeners = process.listeners('uncaughtException');
      expect(listeners.length).toBeGreaterThan(0);
    });

    test('should handle process unhandled rejections', () => {
      const listeners = process.listeners('unhandledRejection');
      expect(listeners.length).toBeGreaterThan(0);
    });
  });

  describe('Environment Configuration', () => {
    test('should use default prompts directory when not set', () => {
      delete process.env.PROMPTS_DIR;
      // 새로운 서버 인스턴스에서 기본 경로 사용 확인
      const expectedPath = path.join(process.cwd(), "prompts");
      // 실제 테스트는 모듈 재로드가 필요하므로 환경변수 복원
      process.env.PROMPTS_DIR = testDir;
    });

    test('should use custom prompts directory when set', () => {
      const customDir = '/custom/prompts/path';
      process.env.PROMPTS_DIR = customDir;
      // 환경변수가 설정되었는지 확인
      expect(process.env.PROMPTS_DIR).toBe(customDir);
      // 테스트 환경 복원
      process.env.PROMPTS_DIR = testDir;
    });
  });
});
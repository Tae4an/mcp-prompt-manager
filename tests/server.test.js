import { jest } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock MCP SDK
const mockMcpServer = {
  tool: jest.fn(),
  connect: jest.fn(),
  close: jest.fn()
};

jest.unstable_mockModule('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: jest.fn().mockImplementation(() => mockMcpServer)
}));

jest.unstable_mockModule('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn()
}));

describe('Server Tools', () => {
  const testDir = process.env.PROMPTS_DIR;
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('File Operations', () => {
    test('should create prompt file', async () => {
      const filename = 'test-prompt.txt';
      const content = 'Test prompt content';
      const filePath = path.join(testDir, filename);

      await fs.writeFile(filePath, content);
      
      const result = await fs.readFile(filePath, 'utf-8');
      expect(result).toBe(content);
    });

    test('should list prompt files', async () => {
      // 테스트 파일들 생성
      await fs.writeFile(path.join(testDir, 'prompt1.txt'), 'Content 1');
      await fs.writeFile(path.join(testDir, 'prompt2.txt'), 'Content 2');

      const files = await fs.readdir(testDir);
      expect(files).toContain('prompt1.txt');
      expect(files).toContain('prompt2.txt');
      expect(files).toHaveLength(2);
    });

    test('should update prompt file', async () => {
      const filename = 'update-test.txt';
      const filePath = path.join(testDir, filename);
      
      await fs.writeFile(filePath, 'Original content');
      await fs.writeFile(filePath, 'Updated content');
      
      const result = await fs.readFile(filePath, 'utf-8');
      expect(result).toBe('Updated content');
    });

    test('should delete prompt file', async () => {
      const filename = 'delete-test.txt';
      const filePath = path.join(testDir, filename);
      
      await fs.writeFile(filePath, 'To be deleted');
      await fs.unlink(filePath);
      
      await expect(fs.access(filePath)).rejects.toThrow();
    });
  });

  describe('Metadata Operations', () => {
    test('should handle metadata file operations', async () => {
      const filename = 'meta-test.txt';
      const metaPath = path.join(testDir, '.metadata', `${filename}.meta`);
      
      // 메타데이터 디렉토리 생성
      await fs.mkdir(path.join(testDir, '.metadata'), { recursive: true });
      
      const metadata = {
        tags: ['test', 'example'],
        category: 'testing',
        favorites: false,
        created: new Date().toISOString()
      };

      await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));
      
      const result = await fs.readFile(metaPath, 'utf-8');
      const parsedMeta = JSON.parse(result);
      
      expect(parsedMeta.tags).toEqual(['test', 'example']);
      expect(parsedMeta.category).toBe('testing');
      expect(parsedMeta.favorites).toBe(false);
    });
  });

  describe('Search Functionality', () => {
    beforeEach(async () => {
      // 테스트용 프롬프트 파일들 생성
      await fs.writeFile(path.join(testDir, 'search1.txt'), 'This is a test prompt about coding');
      await fs.writeFile(path.join(testDir, 'search2.txt'), 'Another prompt for testing search');
      await fs.writeFile(path.join(testDir, 'different.txt'), 'Completely different content');
    });

    test('should search in filenames', async () => {
      const files = await fs.readdir(testDir);
      const searchResults = files.filter(file => file.includes('search'));
      
      expect(searchResults).toContain('search1.txt');
      expect(searchResults).toContain('search2.txt');
      expect(searchResults).not.toContain('different.txt');
    });

    test('should search in file content', async () => {
      const files = await fs.readdir(testDir);
      const matchingFiles = [];

      for (const file of files) {
        const content = await fs.readFile(path.join(testDir, file), 'utf-8');
        if (content.includes('test')) {
          matchingFiles.push(file);
        }
      }

      expect(matchingFiles).toContain('search1.txt');
      expect(matchingFiles).toContain('search2.txt');
      expect(matchingFiles).not.toContain('different.txt');
    });
  });

  describe('Template Processing', () => {
    test('should extract template variables', () => {
      const content = 'Hello {{name}}, welcome to {{platform}}!';
      const variableRegex = /\{\{(\w+)\}\}/g;
      const variables = [];
      let match;

      while ((match = variableRegex.exec(content)) !== null) {
        variables.push(match[1]);
      }

      expect(variables).toEqual(['name', 'platform']);
    });

    test('should process template variables', () => {
      const template = 'Hello {{name}}, you have {{count}} messages';
      const variables = { name: 'John', count: '5' };
      
      let result = template;
      for (const [key, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }

      expect(result).toBe('Hello John, you have 5 messages');
    });
  });
});
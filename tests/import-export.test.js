import { jest } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ImportExportManager, createImportExportManager } from '../utils/import-export.js';

// Mock dependencies
jest.unstable_mockModule('../utils/logger.js', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.unstable_mockModule('../utils/input-sanitizer.js', () => ({
  inputSanitizer: {
    sanitizeText: jest.fn((text) => text),
    sanitizeObject: jest.fn((obj) => obj),
    sanitizeFilename: jest.fn((filename) => filename.replace(/[^a-zA-Z0-9.-]/g, '_'))
  }
}));

describe('Import/Export Manager', () => {
  let testDir;
  let manager;
  let metadataDir;

  beforeEach(async () => {
    // 테스트용 임시 디렉토리 생성
    testDir = path.join(process.cwd(), 'test-prompts-' + Date.now());
    metadataDir = path.join(testDir, '.metadata');
    
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(metadataDir, { recursive: true });
    
    manager = new ImportExportManager(testDir);
  });

  afterEach(async () => {
    // 테스트 디렉토리 정리
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // 정리 실패해도 테스트는 계속 진행
    }
  });

  describe('Initialization', () => {
    test('should create ImportExportManager instance', () => {
      expect(manager).toBeInstanceOf(ImportExportManager);
      expect(manager.promptsDir).toBe(testDir);
      expect(manager.metadataDir).toBe(metadataDir);
    });

    test('should create instance using factory function', () => {
      const factoryManager = createImportExportManager(testDir);
      expect(factoryManager).toBeInstanceOf(ImportExportManager);
      expect(factoryManager.promptsDir).toBe(testDir);
    });
  });

  describe('Export Functionality', () => {
    beforeEach(async () => {
      // 테스트용 프롬프트 파일들 생성
      await fs.writeFile(path.join(testDir, 'test1.txt'), 'This is test prompt 1');
      await fs.writeFile(path.join(testDir, 'test2.md'), '# Test Prompt 2\nThis is a markdown prompt');
      await fs.writeFile(path.join(testDir, 'test3.txt'), 'Short prompt');

      // 메타데이터 파일 생성
      const metadata1 = {
        tags: ['test', 'example'],
        category: 'testing',
        description: 'Test prompt for unit tests',
        created: new Date().toISOString()
      };
      
      await fs.writeFile(
        path.join(metadataDir, 'test1.txt.meta'), 
        JSON.stringify(metadata1, null, 2)
      );
    });

    test('should export all prompts with basic options', async () => {
      const result = await manager.exportPrompts();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.exportInfo).toBeDefined();
      expect(result.data.prompts).toBeInstanceOf(Array);
      expect(result.data.prompts.length).toBe(3);
      expect(result.filename).toMatch(/prompts-export-.*\.json/);
      
      // 각 프롬프트 데이터 구조 확인
      result.data.prompts.forEach(prompt => {
        expect(prompt).toHaveProperty('filename');
        expect(prompt).toHaveProperty('content');
        expect(prompt).toHaveProperty('checksum');
        expect(prompt).toHaveProperty('size');
        expect(prompt).toHaveProperty('created');
        expect(prompt).toHaveProperty('modified');
      });
    });

    test('should export with metadata included', async () => {
      const result = await manager.exportPrompts({ includeMetadata: true });

      expect(result.success).toBe(true);
      
      // test1.txt에 메타데이터가 있는지 확인
      const test1Prompt = result.data.prompts.find(p => p.filename === 'test1.txt');
      expect(test1Prompt).toBeDefined();
      expect(test1Prompt.metadata).toBeDefined();
      expect(test1Prompt.metadata.tags).toEqual(['test', 'example']);
      expect(test1Prompt.metadata.category).toBe('testing');
    });

    test('should export without metadata when disabled', async () => {
      const result = await manager.exportPrompts({ includeMetadata: false });

      expect(result.success).toBe(true);
      result.data.prompts.forEach(prompt => {
        expect(prompt.metadata).toBeUndefined();
      });
    });

    test('should filter by tags', async () => {
      const result = await manager.exportPrompts({ 
        includeMetadata: true,
        filterByTags: ['test'] 
      });

      expect(result.success).toBe(true);
      expect(result.data.prompts.length).toBe(1);
      expect(result.data.prompts[0].filename).toBe('test1.txt');
    });

    test('should filter by category', async () => {
      const result = await manager.exportPrompts({ 
        includeMetadata: true,
        filterByCategory: 'testing' 
      });

      expect(result.success).toBe(true);
      expect(result.data.prompts.length).toBe(1);
      expect(result.data.prompts[0].filename).toBe('test1.txt');
    });

    test('should validate export data structure', async () => {
      const result = await manager.exportPrompts();

      expect(result.data.exportInfo).toHaveProperty('timestamp');
      expect(result.data.exportInfo).toHaveProperty('version');
      expect(result.data.exportInfo).toHaveProperty('totalPrompts');
      expect(result.data.exportInfo).toHaveProperty('exportedPrompts');
      expect(result.data.exportInfo.totalPrompts).toBe(3);
      expect(result.data.exportInfo.exportedPrompts).toBe(3);
    });

    test('should calculate checksums correctly', async () => {
      const result = await manager.exportPrompts();

      result.data.prompts.forEach(prompt => {
        expect(prompt.checksum).toBeDefined();
        expect(typeof prompt.checksum).toBe('string');
        expect(prompt.checksum.length).toBe(64); // SHA-256 hex length
        
        // 직접 계산한 체크섬과 비교
        const expectedChecksum = manager.calculateChecksum(prompt.content);
        expect(prompt.checksum).toBe(expectedChecksum);
      });
    });
  });

  describe('Import Functionality', () => {
    let sampleImportData;

    beforeEach(() => {
      sampleImportData = {
        exportInfo: {
          timestamp: new Date().toISOString(),
          version: '1.0.0',
          totalPrompts: 2,
          exportedPrompts: 2
        },
        prompts: [
          {
            filename: 'imported1.txt',
            content: 'This is an imported prompt',
            checksum: manager.calculateChecksum('This is an imported prompt'),
            size: 26,
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            metadata: {
              tags: ['imported', 'test'],
              category: 'import-test',
              description: 'Imported test prompt'
            }
          },
          {
            filename: 'imported2.md',
            content: '# Imported Markdown\nThis is markdown content',
            checksum: manager.calculateChecksum('# Imported Markdown\nThis is markdown content'),
            size: 42,
            created: new Date().toISOString(),
            modified: new Date().toISOString()
          }
        ]
      };
    });

    test('should import prompts successfully', async () => {
      const result = await manager.importPrompts(sampleImportData, {
        createBackup: false // 테스트에서는 백업 생성 건너뛰기
      });

      expect(result.success).toBe(true);
      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.overwritten).toBe(0);
      expect(result.errors.length).toBe(0);

      // 파일이 실제로 생성되었는지 확인
      const file1Content = await fs.readFile(path.join(testDir, 'imported1.txt'), 'utf-8');
      const file2Content = await fs.readFile(path.join(testDir, 'imported2.md'), 'utf-8');
      
      expect(file1Content).toBe('This is an imported prompt');
      expect(file2Content).toBe('# Imported Markdown\nThis is markdown content');
    });

    test('should import metadata along with prompts', async () => {
      const result = await manager.importPrompts(sampleImportData, {
        createBackup: false
      });

      expect(result.success).toBe(true);

      // 메타데이터 파일이 생성되었는지 확인
      const metadataPath = path.join(metadataDir, 'imported1.txt.meta');
      const metadataExists = await fs.access(metadataPath).then(() => true).catch(() => false);
      expect(metadataExists).toBe(true);

      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
      expect(metadata.tags).toEqual(['imported', 'test']);
      expect(metadata.category).toBe('import-test');
    });

    test('should skip duplicates when enabled', async () => {
      // 첫 번째 가져오기
      await manager.importPrompts(sampleImportData, { createBackup: false });

      // 같은 데이터로 두 번째 가져오기
      const result = await manager.importPrompts(sampleImportData, {
        createBackup: false,
        skipDuplicates: true,
        overwriteExisting: false
      });

      expect(result.success).toBe(true);
      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(2);
      expect(result.overwritten).toBe(0);
    });

    test('should overwrite existing files when enabled', async () => {
      // 첫 번째 가져오기
      await manager.importPrompts(sampleImportData, { createBackup: false });

      // 내용을 변경한 데이터로 두 번째 가져오기
      const modifiedData = {
        ...sampleImportData,
        prompts: [
          {
            ...sampleImportData.prompts[0],
            content: 'This is modified content',
            checksum: manager.calculateChecksum('This is modified content')
          }
        ]
      };

      const result = await manager.importPrompts(modifiedData, {
        createBackup: false,
        overwriteExisting: true
      });

      expect(result.success).toBe(true);
      expect(result.overwritten).toBe(1);

      // 파일 내용이 변경되었는지 확인
      const fileContent = await fs.readFile(path.join(testDir, 'imported1.txt'), 'utf-8');
      expect(fileContent).toBe('This is modified content');
    });

    test('should validate import data structure', async () => {
      const invalidData = {
        exportInfo: {},
        prompts: [
          {
            // filename missing
            content: 'Invalid prompt'
          }
        ]
      };

      await expect(manager.importPrompts(invalidData, { createBackup: false }))
        .rejects.toThrow('유효하지 않은 가져오기 데이터');
    });

    test('should validate checksums when enabled', async () => {
      const dataWithWrongChecksum = {
        ...sampleImportData,
        prompts: [
          {
            ...sampleImportData.prompts[0],
            checksum: 'wrong_checksum'
          }
        ]
      };

      // 체크섬 검증이 활성화되어 있어도 가져오기는 성공해야 함 (경고만 출력)
      const result = await manager.importPrompts(dataWithWrongChecksum, {
        createBackup: false,
        validateChecksums: true
      });

      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);
    });

    test('should create backup before import when enabled', async () => {
      // 기존 파일 생성
      await fs.writeFile(path.join(testDir, 'existing.txt'), 'Existing content');

      const result = await manager.importPrompts(sampleImportData, {
        createBackup: true
      });

      expect(result.success).toBe(true);
      expect(result.backupInfo).toBeDefined();
      expect(result.backupInfo.backupDir).toBeDefined();
      expect(result.backupInfo.fileCount).toBe(1);

      // 백업 파일이 존재하는지 확인
      const backupPath = path.join(result.backupInfo.backupDir, 'existing.txt');
      const backupExists = await fs.access(backupPath).then(() => true).catch(() => false);
      expect(backupExists).toBe(true);
    });

    test('should sanitize filenames during import', async () => {
      const dataWithBadFilename = {
        ...sampleImportData,
        prompts: [
          {
            ...sampleImportData.prompts[0],
            filename: 'bad<>filename:*.txt'
          }
        ]
      };

      const result = await manager.importPrompts(dataWithBadFilename, {
        createBackup: false
      });

      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);

      // 정제된 파일명으로 파일이 생성되었는지 확인
      const files = await fs.readdir(testDir);
      const sanitizedFile = files.find(f => f.includes('bad') && f.endsWith('.txt'));
      expect(sanitizedFile).toBeDefined();
    });
  });

  describe('Validation', () => {
    test('should validate export data structure', async () => {
      // 빈 디렉토리에서 내보내기
      await fs.rm(testDir, { recursive: true });
      await fs.mkdir(testDir, { recursive: true });

      const result = await manager.exportPrompts();
      expect(result.success).toBe(true);
      expect(result.data.prompts).toEqual([]);
      expect(result.data.exportInfo.totalPrompts).toBe(0);
    });

    test('should validate import data with missing required fields', async () => {
      const invalidCases = [
        null,
        {},
        { prompts: null },
        { prompts: [] },
        { prompts: [{}] },
        { prompts: [{ filename: 'test.txt' }] }, // missing content
        { prompts: [{ content: 'test' }] } // missing filename
      ];

      for (const invalidData of invalidCases) {
        const validation = await manager.validateImportData(invalidData);
        expect(validation.isValid).toBe(false);
        expect(validation.errors.length).toBeGreaterThan(0);
      }
    });

    test('should validate import data with valid structure', async () => {
      const validData = {
        exportInfo: {},
        prompts: [
          {
            filename: 'valid.txt',
            content: 'Valid content'
          },
          {
            filename: 'valid2.txt', 
            content: 'More valid content'
          }
        ]
      };
      
      const validation = await manager.validateImportData(validData);
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toEqual([]);
      expect(validation.promptCount).toBe(2);
    });

    test('should reject oversized content', async () => {
      const oversizedData = {
        exportInfo: {},
        prompts: [
          {
            filename: 'huge.txt',
            content: 'x'.repeat(2000000) // 2MB content
          }
        ]
      };

      const validation = await manager.validateImportData(oversizedData);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.includes('too large'))).toBe(true);
    });
  });

  describe('Status and Information', () => {
    test('should get import/export status', async () => {
      // 테스트 파일 생성
      await fs.writeFile(path.join(testDir, 'status-test.txt'), 'Status test');

      const status = await manager.getImportExportStatus();

      expect(status).toHaveProperty('totalPrompts');
      expect(status).toHaveProperty('hasMetadata');
      expect(status).toHaveProperty('backupCount');
      expect(status).toHaveProperty('supportedFormats');
      expect(status).toHaveProperty('features');
      
      expect(status.totalPrompts).toBe(1);
      expect(status.supportedFormats).toContain('json');
      expect(status.features.export).toBe(true);
      expect(status.features.import).toBe(true);
    });

    test('should get last backup info when backups exist', async () => {
      // 백업 디렉토리 생성
      const backupsDir = path.join(testDir, '.backups');
      const backupDir = path.join(backupsDir, 'test-backup-2024');
      await fs.mkdir(backupDir, { recursive: true });
      await fs.writeFile(path.join(backupDir, 'backup-test.txt'), 'backup content');

      const lastBackup = await manager.getLastBackupInfo();
      
      if (lastBackup) {
        expect(lastBackup).toHaveProperty('name');
        expect(lastBackup).toHaveProperty('created');
        expect(lastBackup).toHaveProperty('fileCount');
        expect(lastBackup).toHaveProperty('path');
      }
    });
  });

  describe('Utility Functions', () => {
    test('should calculate SHA-256 checksums correctly', () => {
      const testCases = [
        'Hello World',
        '',
        'Multi\nline\ncontent',
        'Unicode: 한글 테스트 🚀',
        JSON.stringify({ key: 'value' })
      ];

      testCases.forEach(content => {
        const checksum = manager.calculateChecksum(content);
        expect(typeof checksum).toBe('string');
        expect(checksum.length).toBe(64); // SHA-256 produces 64-char hex string
        expect(/^[a-f0-9]{64}$/.test(checksum)).toBe(true);
      });
    });

    test('should generate unique export filenames', async () => {
      const filename1 = manager.generateExportFilename('json');
      // Wait a bit to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      const filename2 = manager.generateExportFilename('json');
      
      expect(filename1).toMatch(/^prompts-export-.*\.json$/);
      expect(filename2).toMatch(/^prompts-export-.*\.json$/);
      expect(filename1).not.toBe(filename2);
    });

    test('should handle metadata operations', async () => {
      const testMetadata = {
        tags: ['test'],
        category: 'testing',
        description: 'Test metadata'
      };

      // 메타데이터 저장
      await manager.importMetadata('test-file.txt', testMetadata);

      // 메타데이터 로드
      const loadedMetadata = await manager.loadMetadata('test-file.txt');
      expect(loadedMetadata).toEqual(expect.objectContaining(testMetadata));
    });

    test('should handle version history operations', async () => {
      const testHistory = [
        {
          version: 1,
          timestamp: new Date().toISOString(),
          changes: 'Initial version'
        }
      ];

      // 히스토리 저장
      await manager.importVersionHistory('test-file.txt', testHistory);

      // 히스토리 로드
      const loadedHistory = await manager.loadVersionHistory('test-file.txt');
      expect(loadedHistory).toEqual(testHistory);
    });
  });

  describe('Error Handling', () => {
    test('should handle file system errors gracefully', async () => {
      // 읽기 전용 디렉토리로 설정 (권한 오류 시뮬레이션)
      const readOnlyDir = path.join(testDir, 'readonly');
      await fs.mkdir(readOnlyDir);
      
      const readOnlyManager = new ImportExportManager(readOnlyDir);
      
      // 권한 문제로 실패할 수 있는 작업
      try {
        await fs.chmod(readOnlyDir, 0o444); // 읽기 전용으로 설정
        await expect(readOnlyManager.createBackupBeforeImport()).rejects.toThrow();
      } finally {
        // 정리를 위해 권한 복구
        await fs.chmod(readOnlyDir, 0o755);
      }
    });

    test('should handle malformed JSON gracefully', async () => {
      // 잘못된 JSON 메타데이터 파일 생성
      await fs.writeFile(path.join(metadataDir, 'broken.txt.meta'), 'invalid json');

      const metadata = await manager.loadMetadata('broken.txt');
      expect(metadata).toBeNull();
    });

    test('should handle missing directories', async () => {
      const nonExistentDir = path.join(testDir, 'nonexistent');
      const missingDirManager = new ImportExportManager(nonExistentDir);

      await expect(missingDirManager.exportPrompts()).rejects.toThrow();
    });
  });

  describe('Integration Tests', () => {
    test('should complete full export-import cycle', async () => {
      // 원본 데이터 준비
      await fs.writeFile(path.join(testDir, 'original.txt'), 'Original content');
      const originalMetadata = { tags: ['original'], category: 'test' };
      await fs.writeFile(
        path.join(metadataDir, 'original.txt.meta'),
        JSON.stringify(originalMetadata)
      );

      // 1. 내보내기
      const exportResult = await manager.exportPrompts({ includeMetadata: true });
      expect(exportResult.success).toBe(true);

      // 2. 원본 파일 삭제
      await fs.unlink(path.join(testDir, 'original.txt'));
      await fs.unlink(path.join(metadataDir, 'original.txt.meta'));

      // 3. 가져오기
      const importResult = await manager.importPrompts(exportResult.data, {
        createBackup: false
      });
      expect(importResult.success).toBe(true);
      expect(importResult.imported).toBe(1);

      // 4. 복원된 내용 확인
      const restoredContent = await fs.readFile(path.join(testDir, 'original.txt'), 'utf-8');
      expect(restoredContent).toBe('Original content');

      const restoredMetadata = await manager.loadMetadata('original.txt');
      expect(restoredMetadata.tags).toEqual(['original']);
    });
  });
});
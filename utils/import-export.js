import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { log } from './logger.js';
import { inputSanitizer } from './input-sanitizer.js';
import sanitizeFilename from 'sanitize-filename';

/**
 * 프롬프트 가져오기/내보내기 유틸리티
 * JSON 및 ZIP 형식으로 프롬프트를 백업/복원할 수 있는 기능 제공
 */
export class ImportExportManager {
  constructor(promptsDir) {
    this.promptsDir = promptsDir;
    this.metadataDir = path.join(promptsDir, '.metadata');
  }

  /**
   * 프롬프트 데이터 내보내기 (JSON 형식)
   */
  async exportPrompts(options = {}) {
    const {
      format = 'json',
      includeMetadata = true,
      includeVersionHistory = false,
      filterByTags = [],
      filterByCategory = null,
      compress = false
    } = options;

    try {
      log.info('Starting prompt export', { format, includeMetadata, includeVersionHistory });

      // 프롬프트 파일 목록 가져오기
      const files = await fs.readdir(this.promptsDir);
      const promptFiles = files.filter(file => 
        !file.startsWith('.') && 
        (file.endsWith('.txt') || file.endsWith('.md'))
      );

      const exportData = {
        exportInfo: {
          timestamp: new Date().toISOString(),
          version: '1.0.0',
          totalPrompts: promptFiles.length,
          format,
          includeMetadata,
          includeVersionHistory
        },
        prompts: []
      };

      // 각 프롬프트 파일 처리
      for (const file of promptFiles) {
        const filePath = path.join(this.promptsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        
        const promptData = {
          filename: file,
          content,
          checksum: this.calculateChecksum(content),
          size: Buffer.byteLength(content, 'utf-8'),
          created: (await fs.stat(filePath)).birthtime.toISOString(),
          modified: (await fs.stat(filePath)).mtime.toISOString()
        };

        // 메타데이터 로드 및 필터링 처리
        let metadata = null;
        if (includeMetadata || filterByTags.length > 0 || filterByCategory) {
          try {
            metadata = await this.loadMetadata(file);
          } catch (error) {
            log.warn('Failed to load metadata for file', { file, error: error.message });
          }
        }

        // 필터링 검사
        if (filterByTags.length > 0) {
          if (!metadata || !metadata.tags) {
            continue; // 메타데이터나 태그가 없으면 건너뜀
          }
          const hasMatchingTag = filterByTags.some(tag => 
            metadata.tags.includes(tag)
          );
          if (!hasMatchingTag) continue;
        }

        if (filterByCategory) {
          if (!metadata || metadata.category !== filterByCategory) {
            continue; // 메타데이터가 없거나 카테고리가 일치하지 않으면 건너뜀
          }
        }

        // 메타데이터 포함
        if (includeMetadata && metadata) {
          promptData.metadata = metadata;
        }

        // 버전 히스토리 포함
        if (includeVersionHistory) {
          try {
            const history = await this.loadVersionHistory(file);
            if (history && history.length > 0) {
              promptData.versionHistory = history;
            }
          } catch (error) {
            log.warn('Failed to load version history for file', { file, error: error.message });
          }
        }

        exportData.prompts.push(promptData);
      }

      exportData.exportInfo.exportedPrompts = exportData.prompts.length;

      log.info('Export completed successfully', {
        totalFiles: promptFiles.length,
        exportedPrompts: exportData.prompts.length,
        dataSize: JSON.stringify(exportData).length
      });

      return {
        success: true,
        data: exportData,
        filename: this.generateExportFilename(format),
        summary: {
          totalPrompts: promptFiles.length,
          exportedPrompts: exportData.prompts.length,
          format,
          timestamp: exportData.exportInfo.timestamp
        }
      };

    } catch (error) {
      log.error('Prompt export failed', { error: error.message, options });
      throw new Error(`내보내기 실패: ${error.message}`);
    }
  }

  /**
   * 프롬프트 데이터 가져오기 (JSON 형식)
   */
  async importPrompts(importData, options = {}) {
    const {
      overwriteExisting = false,
      skipDuplicates = true,
      validateChecksums = true,
      createBackup = true,
      mergeMetadata = true
    } = options;

    try {
      log.info('Starting prompt import', { 
        overwriteExisting, 
        skipDuplicates, 
        validateChecksums,
        promptCount: importData.prompts?.length || 0
      });

      // 입력 데이터 유효성 검사
      const validation = await this.validateImportData(importData);
      if (!validation.isValid) {
        throw new Error(`유효하지 않은 가져오기 데이터: ${validation.errors.join(', ')}`);
      }

      // 백업 생성 (옵션)
      let backupInfo = null;
      if (createBackup) {
        backupInfo = await this.createBackupBeforeImport();
      }

      const results = {
        success: true,
        imported: 0,
        skipped: 0,
        overwritten: 0,
        errors: [],
        backupInfo,
        processedFiles: []
      };

      // 메타데이터 디렉토리 확인/생성
      await fs.mkdir(this.metadataDir, { recursive: true });

      // 각 프롬프트 처리
      for (const promptData of importData.prompts) {
        try {
          const result = await this.importSinglePrompt(promptData, {
            overwriteExisting,
            skipDuplicates,
            validateChecksums,
            mergeMetadata
          });

          if (result.action === 'imported') {
            results.imported++;
          } else if (result.action === 'skipped') {
            results.skipped++;
          } else if (result.action === 'overwritten') {
            results.overwritten++;
          }

          results.processedFiles.push({
            filename: promptData.filename,
            action: result.action,
            message: result.message
          });

        } catch (error) {
          log.error('Failed to import single prompt', { 
            filename: promptData.filename, 
            error: error.message 
          });
          
          results.errors.push({
            filename: promptData.filename,
            error: error.message
          });
        }
      }

      log.info('Import completed', {
        imported: results.imported,
        skipped: results.skipped,
        overwritten: results.overwritten,
        errors: results.errors.length
      });

      return results;

    } catch (error) {
      log.error('Prompt import failed', { error: error.message, options });
      throw new Error(`가져오기 실패: ${error.message}`);
    }
  }

  /**
   * 단일 프롬프트 가져오기
   */
  async importSinglePrompt(promptData, options) {
    const { overwriteExisting, skipDuplicates, validateChecksums, mergeMetadata } = options;
    
    // 파일명 정제
    const sanitizedFilename = sanitizeFilename(promptData.filename);
    const filePath = path.join(this.promptsDir, sanitizedFilename);
    
    // 기존 파일 존재 확인
    const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
    
    if (fileExists) {
      if (skipDuplicates && !overwriteExisting) {
        // 중복 파일 건너뛰기
        if (validateChecksums) {
          const existingContent = await fs.readFile(filePath, 'utf-8');
          const existingChecksum = this.calculateChecksum(existingContent);
          
          if (existingChecksum === promptData.checksum) {
            return { action: 'skipped', message: 'Identical file already exists' };
          }
        }
        
        return { action: 'skipped', message: 'File already exists' };
      }
    }

    // 콘텐츠 유효성 검사 및 정제
    const sanitizedContent = inputSanitizer.sanitizeText(promptData.content, {
      allowNewlines: true,
      maxLength: 100000,
      preserveStructure: true
    });

    // 체크섬 검증
    if (validateChecksums && promptData.checksum) {
      const calculatedChecksum = this.calculateChecksum(sanitizedContent);
      if (calculatedChecksum !== promptData.checksum) {
        log.warn('Checksum mismatch detected', { 
          filename: promptData.filename,
          expected: promptData.checksum,
          calculated: calculatedChecksum
        });
      }
    }

    // 파일 작성
    await fs.writeFile(filePath, sanitizedContent, 'utf-8');

    // 메타데이터 처리
    if (promptData.metadata) {
      await this.importMetadata(sanitizedFilename, promptData.metadata, mergeMetadata);
    }

    // 버전 히스토리 처리
    if (promptData.versionHistory) {
      await this.importVersionHistory(sanitizedFilename, promptData.versionHistory);
    }

    const action = fileExists ? 'overwritten' : 'imported';
    return { 
      action, 
      message: `File ${action} successfully`,
      path: filePath
    };
  }

  /**
   * 가져오기 데이터 유효성 검사
   */
  async validateImportData(importData) {
    const errors = [];

    // 기본 구조 확인
    if (!importData || typeof importData !== 'object') {
      errors.push('Invalid import data structure');
      return { isValid: false, errors };
    }

    if (!importData.prompts || !Array.isArray(importData.prompts)) {
      errors.push('Missing or invalid prompts array');
      return { isValid: false, errors };
    }

    if (importData.prompts.length === 0) {
      errors.push('No prompts to import');
      return { isValid: false, errors };
    }

    // 각 프롬프트 데이터 검증
    for (let i = 0; i < importData.prompts.length; i++) {
      const prompt = importData.prompts[i];
      const prefix = `Prompt ${i + 1}`;

      if (!prompt.filename || typeof prompt.filename !== 'string') {
        errors.push(`${prefix}: Missing or invalid filename`);
      }

      if (!prompt.content || typeof prompt.content !== 'string') {
        errors.push(`${prefix}: Missing or invalid content`);
      }

      // 파일명 보안 검사
      if (prompt.filename) {
        const sanitized = sanitizeFilename(prompt.filename);
        if (sanitized !== prompt.filename) {
          log.warn('Filename will be sanitized', { 
            original: prompt.filename, 
            sanitized 
          });
        }
      }

      // 콘텐츠 크기 제한
      if (prompt.content && prompt.content.length > 1000000) {
        errors.push(`${prefix}: Content too large (max 1MB)`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      promptCount: importData.prompts.length
    };
  }

  /**
   * 가져오기 전 백업 생성
   */
  async createBackupBeforeImport() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(this.promptsDir, '.backups', `import-backup-${timestamp}`);
    
    await fs.mkdir(backupDir, { recursive: true });

    try {
      // 현재 모든 프롬프트 파일 백업
      const files = await fs.readdir(this.promptsDir);
      const promptFiles = files.filter(file => 
        !file.startsWith('.') && 
        (file.endsWith('.txt') || file.endsWith('.md'))
      );

      for (const file of promptFiles) {
        const sourcePath = path.join(this.promptsDir, file);
        const backupPath = path.join(backupDir, file);
        await fs.copyFile(sourcePath, backupPath);
      }

      // 메타데이터 백업
      const metadataExists = await fs.access(this.metadataDir).then(() => true).catch(() => false);
      if (metadataExists) {
        const metadataBackupDir = path.join(backupDir, '.metadata');
        await fs.mkdir(metadataBackupDir, { recursive: true });
        
        const metadataFiles = await fs.readdir(this.metadataDir);
        for (const file of metadataFiles) {
          const sourcePath = path.join(this.metadataDir, file);
          const backupPath = path.join(metadataBackupDir, file);
          await fs.copyFile(sourcePath, backupPath);
        }
      }

      log.info('Backup created successfully', { 
        backupDir, 
        fileCount: promptFiles.length 
      });

      return {
        backupDir,
        timestamp,
        fileCount: promptFiles.length
      };

    } catch (error) {
      log.error('Failed to create backup', { error: error.message });
      throw new Error(`백업 생성 실패: ${error.message}`);
    }
  }

  /**
   * 메타데이터 로드
   */
  async loadMetadata(filename) {
    const metaPath = path.join(this.metadataDir, `${filename}.meta`);
    
    try {
      const metaContent = await fs.readFile(metaPath, 'utf-8');
      return JSON.parse(metaContent);
    } catch (error) {
      return null;
    }
  }

  /**
   * 메타데이터 가져오기
   */
  async importMetadata(filename, metadata, mergeWithExisting = true) {
    const metaPath = path.join(this.metadataDir, `${filename}.meta`);
    
    let finalMetadata = { ...metadata };

    if (mergeWithExisting) {
      const existingMetadata = await this.loadMetadata(filename);
      if (existingMetadata) {
        // 기존 메타데이터와 병합
        finalMetadata = {
          ...existingMetadata,
          ...metadata,
          // 태그는 중복 제거하여 병합
          tags: [...new Set([
            ...(existingMetadata.tags || []),
            ...(metadata.tags || [])
          ])],
          // 가져오기 정보 추가
          importInfo: {
            importedAt: new Date().toISOString(),
            originalMetadata: existingMetadata
          }
        };
      }
    }

    // 메타데이터 정제
    const sanitizedMetadata = inputSanitizer.sanitizeObject(finalMetadata, {
      maxDepth: 5,
      maxKeys: 20,
      maxStringLength: 1000
    });

    await fs.writeFile(metaPath, JSON.stringify(sanitizedMetadata, null, 2), 'utf-8');
  }

  /**
   * 버전 히스토리 로드
   */
  async loadVersionHistory(filename) {
    const historyPath = path.join(this.metadataDir, `${filename}.history`);
    
    try {
      const historyContent = await fs.readFile(historyPath, 'utf-8');
      return JSON.parse(historyContent);
    } catch (error) {
      return [];
    }
  }

  /**
   * 버전 히스토리 가져오기
   */
  async importVersionHistory(filename, history) {
    const historyPath = path.join(this.metadataDir, `${filename}.history`);
    
    // 기존 히스토리와 병합
    const existingHistory = await this.loadVersionHistory(filename);
    const mergedHistory = [...existingHistory, ...history];
    
    // 중복 제거 (타임스탬프 기준)
    const uniqueHistory = mergedHistory.filter((item, index, arr) => 
      arr.findIndex(h => h.timestamp === item.timestamp) === index
    );
    
    // 시간순 정렬
    uniqueHistory.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    await fs.writeFile(historyPath, JSON.stringify(uniqueHistory, null, 2), 'utf-8');
  }

  /**
   * 체크섬 계산
   */
  calculateChecksum(content) {
    return createHash('sha256').update(content, 'utf-8').digest('hex');
  }

  /**
   * 내보내기 파일명 생성
   */
  generateExportFilename(format) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `prompts-export-${timestamp}.${format}`;
  }

  /**
   * 가져오기/내보내기 상태 조회
   */
  async getImportExportStatus() {
    try {
      const files = await fs.readdir(this.promptsDir);
      const promptFiles = files.filter(file => 
        !file.startsWith('.') && 
        (file.endsWith('.txt') || file.endsWith('.md'))
      );

      const backupsExist = await fs.access(path.join(this.promptsDir, '.backups')).then(() => true).catch(() => false);
      let backupCount = 0;
      
      if (backupsExist) {
        const backups = await fs.readdir(path.join(this.promptsDir, '.backups'));
        backupCount = backups.length;
      }

      return {
        totalPrompts: promptFiles.length,
        hasMetadata: await fs.access(this.metadataDir).then(() => true).catch(() => false),
        backupCount,
        lastBackup: backupsExist ? await this.getLastBackupInfo() : null,
        supportedFormats: ['json'],
        maxFileSize: '1MB',
        features: {
          export: true,
          import: true,
          backup: true,
          validation: true,
          metadata: true,
          versionHistory: true
        }
      };

    } catch (error) {
      log.error('Failed to get import/export status', { error: error.message });
      throw new Error(`상태 조회 실패: ${error.message}`);
    }
  }

  /**
   * 마지막 백업 정보 조회
   */
  async getLastBackupInfo() {
    try {
      const backupsDir = path.join(this.promptsDir, '.backups');
      const backups = await fs.readdir(backupsDir);
      
      if (backups.length === 0) return null;

      // 가장 최근 백업 찾기
      let latestBackup = backups[0];
      let latestTime = 0;

      for (const backup of backups) {
        const backupPath = path.join(backupsDir, backup);
        const stats = await fs.stat(backupPath);
        if (stats.mtime.getTime() > latestTime) {
          latestTime = stats.mtime.getTime();
          latestBackup = backup;
        }
      }

      const backupPath = path.join(backupsDir, latestBackup);
      const backupFiles = await fs.readdir(backupPath);
      const promptFileCount = backupFiles.filter(file => 
        !file.startsWith('.') && 
        (file.endsWith('.txt') || file.endsWith('.md'))
      ).length;

      return {
        name: latestBackup,
        created: new Date(latestTime).toISOString(),
        fileCount: promptFileCount,
        path: backupPath
      };

    } catch (error) {
      return null;
    }
  }
}

/**
 * 싱글톤 인스턴스 생성 함수
 */
export function createImportExportManager(promptsDir) {
  return new ImportExportManager(promptsDir);
}

export default ImportExportManager;
import * as fs from "fs/promises";
import * as path from "path";
import { createTwoFilesPatch } from "diff";

export class VersionManager {
  constructor(promptsDir) {
    this.promptsDir = promptsDir;
    this.versionsDir = path.join(promptsDir, ".versions");
  }

  async ensureVersionsDir() {
    try {
      await fs.mkdir(this.versionsDir, { recursive: true });
    } catch (err) {
      console.error('버전 디렉토리 생성 오류:', err);
    }
  }

  getVersionPath(filename) {
    return path.join(this.versionsDir, `${filename}.history`);
  }

  async loadVersionHistory(filename) {
    const versionPath = this.getVersionPath(filename);
    try {
      const historyData = await fs.readFile(versionPath, "utf-8");
      return JSON.parse(historyData);
    } catch (err) {
      // 히스토리 파일이 없으면 빈 배열 반환
      return [];
    }
  }

  async saveVersion(filename, content, action = "update") {
    await this.ensureVersionsDir();
    
    const history = await this.loadVersionHistory(filename);
    const version = {
      version: history.length + 1,
      content: content,
      timestamp: new Date().toISOString(),
      action: action,
      size: Buffer.byteLength(content, 'utf8'),
      checksum: this.calculateChecksum(content)
    };

    history.push(version);
    
    const versionPath = this.getVersionPath(filename);
    await fs.writeFile(versionPath, JSON.stringify(history, null, 2), "utf-8");
    
    return version;
  }

  async getVersion(filename, versionNumber) {
    const history = await this.loadVersionHistory(filename);
    return history.find(v => v.version === versionNumber);
  }

  async getAllVersions(filename) {
    return await this.loadVersionHistory(filename);
  }

  async getLatestVersion(filename) {
    const history = await this.loadVersionHistory(filename);
    return history.length > 0 ? history[history.length - 1] : null;
  }

  async compareVersions(filename, fromVersion, toVersion) {
    const history = await this.loadVersionHistory(filename);
    
    const fromVer = history.find(v => v.version === fromVersion);
    const toVer = history.find(v => v.version === toVersion);
    
    if (!fromVer || !toVer) {
      throw new Error('지정된 버전을 찾을 수 없습니다.');
    }

    const patch = createTwoFilesPatch(
      `${filename} (v${fromVersion})`,
      `${filename} (v${toVersion})`,
      fromVer.content,
      toVer.content,
      '', // old header
      '', // new header
      { context: 3 }
    );

    return {
      fromVersion: fromVersion,
      toVersion: toVersion,
      diff: patch,
      summary: this.generateDiffSummary(fromVer.content, toVer.content)
    };
  }

  async rollbackToVersion(filename, targetVersion) {
    const history = await this.loadVersionHistory(filename);
    const targetVer = history.find(v => v.version === targetVersion);
    
    if (!targetVer) {
      throw new Error(`버전 ${targetVersion}을 찾을 수 없습니다.`);
    }

    // 롤백된 내용을 새 버전으로 저장
    const rollbackVersion = await this.saveVersion(
      filename, 
      targetVer.content, 
      `rollback_to_v${targetVersion}`
    );

    // 실제 파일도 업데이트
    const filePath = path.join(this.promptsDir, filename);
    await fs.writeFile(filePath, targetVer.content, "utf-8");

    return {
      rolledBackTo: targetVersion,
      newVersion: rollbackVersion.version,
      content: targetVer.content
    };
  }

  async deleteVersionHistory(filename) {
    const versionPath = this.getVersionPath(filename);
    try {
      await fs.unlink(versionPath);
      return true;
    } catch (err) {
      // 파일이 없어도 성공으로 처리
      return true;
    }
  }

  calculateChecksum(content) {
    // 간단한 해시 생성 (실제 프로덕션에서는 crypto 모듈 사용 권장)
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32비트 정수로 변환
    }
    return hash.toString(16);
  }

  generateDiffSummary(oldContent, newContent) {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    
    const added = newLines.length - oldLines.length;
    const changed = this.countChangedLines(oldLines, newLines);
    
    return {
      linesAdded: Math.max(0, added),
      linesRemoved: Math.max(0, -added),
      linesChanged: changed,
      totalOldLines: oldLines.length,
      totalNewLines: newLines.length
    };
  }

  countChangedLines(oldLines, newLines) {
    let changed = 0;
    const maxLength = Math.max(oldLines.length, newLines.length);
    
    for (let i = 0; i < maxLength; i++) {
      const oldLine = oldLines[i] || '';
      const newLine = newLines[i] || '';
      
      if (oldLine !== newLine && oldLine !== '' && newLine !== '') {
        changed++;
      }
    }
    
    return changed;
  }

  async getVersionStats(filename) {
    const history = await this.loadVersionHistory(filename);
    
    if (history.length === 0) {
      return {
        totalVersions: 0,
        firstVersion: null,
        lastVersion: null,
        totalSizeHistory: []
      };
    }

    const sizeHistory = history.map(v => ({
      version: v.version,
      size: v.size,
      timestamp: v.timestamp
    }));

    return {
      totalVersions: history.length,
      firstVersion: history[0],
      lastVersion: history[history.length - 1],
      totalSizeHistory: sizeHistory,
      actions: history.reduce((acc, v) => {
        acc[v.action] = (acc[v.action] || 0) + 1;
        return acc;
      }, {})
    };
  }
}
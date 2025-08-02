import { VersionManager } from '../utils/version-manager.js';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('VersionManager', () => {
  let versionManager;
  const testDir = process.env.PROMPTS_DIR;

  beforeEach(() => {
    versionManager = new VersionManager(testDir);
  });

  describe('saveVersion', () => {
    test('should save a new version', async () => {
      const filename = 'test-prompt.txt';
      const content = 'This is a test prompt';

      await versionManager.saveVersion(filename, content, 'create');

      const history = await versionManager.loadVersionHistory(filename);
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe(content);
      expect(history[0].action).toBe('create');
      expect(history[0].version).toBe(1);
    });

    test('should increment version number', async () => {
      const filename = 'test-prompt.txt';
      
      await versionManager.saveVersion(filename, 'Version 1', 'create');
      await versionManager.saveVersion(filename, 'Version 2', 'update');

      const history = await versionManager.loadVersionHistory(filename);
      expect(history).toHaveLength(2);
      expect(history[1].version).toBe(2);
      expect(history[1].content).toBe('Version 2');
    });
  });

  describe('getVersion', () => {
    test('should retrieve specific version content', async () => {
      const filename = 'test-prompt.txt';
      
      await versionManager.saveVersion(filename, 'Version 1', 'create');
      await versionManager.saveVersion(filename, 'Version 2', 'update');

      const version1 = await versionManager.getVersion(filename, 1);
      const version2 = await versionManager.getVersion(filename, 2);

      expect(version1.content).toBe('Version 1');
      expect(version2.content).toBe('Version 2');
    });

    test('should return null for non-existent version', async () => {
      const filename = 'test-prompt.txt';
      const result = await versionManager.getVersion(filename, 999);
      expect(result).toBeNull();
    });
  });

  describe('compareVersions', () => {
    test('should compare two versions', async () => {
      const filename = 'test-prompt.txt';
      
      await versionManager.saveVersion(filename, 'Original content', 'create');
      await versionManager.saveVersion(filename, 'Modified content', 'update');

      const comparison = await versionManager.compareVersions(filename, 1, 2);
      
      expect(comparison).toContain('Original content');
      expect(comparison).toContain('Modified content');
      expect(comparison).toContain('@@'); // diff marker
    });
  });

  describe('rollback', () => {
    test('should rollback to previous version', async () => {
      const filename = 'test-prompt.txt';
      const promptPath = path.join(testDir, filename);
      
      await versionManager.saveVersion(filename, 'Version 1', 'create');
      await fs.writeFile(promptPath, 'Version 1');
      
      await versionManager.saveVersion(filename, 'Version 2', 'update');
      await fs.writeFile(promptPath, 'Version 2');

      await versionManager.rollback(filename, 1);
      
      const currentContent = await fs.readFile(promptPath, 'utf-8');
      expect(currentContent).toBe('Version 1');
      
      const history = await versionManager.loadVersionHistory(filename);
      expect(history[history.length - 1].action).toBe('rollback_to_v1');
    });
  });

  describe('getVersionStats', () => {
    test('should return version statistics', async () => {
      const filename = 'test-prompt.txt';
      
      await versionManager.saveVersion(filename, 'Short', 'create');
      await versionManager.saveVersion(filename, 'A longer version', 'update');
      await versionManager.saveVersion(filename, 'Medium length', 'update');

      const stats = await versionManager.getVersionStats(filename);
      
      expect(stats.totalVersions).toBe(3);
      expect(stats.actions.create).toBe(1);
      expect(stats.actions.update).toBe(2);
      expect(stats.sizeHistory).toHaveLength(3);
    });
  });
});
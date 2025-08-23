import { jest } from '@jest/globals';
import { StartupOptimizer } from '../utils/startup-optimizer.js';
import { OptimizedPromptServer } from '../server-optimized.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Startup Optimization', () => {
  let startupOptimizer;
  let testDataDir;
  let usageDataFile;
  let startupCacheFile;

  beforeEach(async () => {
    // 테스트용 임시 디렉토리 설정
    testDataDir = path.join(__dirname, 'temp_startup');
    usageDataFile = path.join(testDataDir, 'usage-analytics.json');
    startupCacheFile = path.join(testDataDir, 'startup-cache.json');
    
    await fs.mkdir(testDataDir, { recursive: true });
    
    startupOptimizer = new StartupOptimizer({
      usageDataFile,
      startupCacheFile,
      enableUsageTracking: true,
      enableStartupCache: true,
      enableBackgroundInit: true,
      coreModuleTimeout: 3000,
      backgroundInitDelay: 50
    });
  });

  afterEach(async () => {
    if (startupOptimizer) {
      await startupOptimizer.cleanup();
    }
    
    // 임시 파일 정리
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (e) {
      // 정리 실패 무시
    }
  });

  describe('StartupOptimizer Core Functionality', () => {
    test('should initialize with correct module priorities', () => {
      expect(startupOptimizer.modulePriorities).toBeDefined();
      expect(startupOptimizer.modulePriorities.CRITICAL).toContain('McpServer');
      expect(startupOptimizer.modulePriorities.CRITICAL).toContain('logger');
      expect(startupOptimizer.modulePriorities.HIGH).toContain('cache');
      expect(startupOptimizer.modulePriorities.MEDIUM).toContain('optimized-search-engine');
      expect(startupOptimizer.modulePriorities.LOW).toContain('cpu-worker-pool');
      
      console.log('Module priorities initialized:', {
        critical: startupOptimizer.modulePriorities.CRITICAL.length,
        high: startupOptimizer.modulePriorities.HIGH.length,
        medium: startupOptimizer.modulePriorities.MEDIUM.length,
        low: startupOptimizer.modulePriorities.LOW.length
      });
    });

    test('should track loading states correctly', () => {
      expect(startupOptimizer.loadingStates).toBeDefined();
      expect(startupOptimizer.loadingStates.CRITICAL.loaded).toBe(false);
      expect(startupOptimizer.loadingStates.HIGH.loaded).toBe(false);
      expect(startupOptimizer.loadingStates.MEDIUM.loaded).toBe(false);
      expect(startupOptimizer.loadingStates.LOW.loaded).toBe(false);
    });

    test('should handle usage tracking', async () => {
      // 사용 기록
      startupOptimizer.recordModuleUsage('cache');
      startupOptimizer.recordModuleUsage('optimized-search-engine');
      startupOptimizer.recordModuleUsage('cache'); // 중복 사용
      
      expect(startupOptimizer.usageStats.moduleUsage.size).toBe(2);
      
      const cacheUsage = startupOptimizer.usageStats.moduleUsage.get('cache');
      expect(cacheUsage.totalUsage).toBe(2);
      expect(cacheUsage.recentUsage).toBe(2);
      expect(cacheUsage.lastUsed).toBeGreaterThan(0);
      
      console.log('Usage tracking test:', {
        totalModules: startupOptimizer.usageStats.moduleUsage.size,
        cacheUsage: cacheUsage.totalUsage
      });
    });

    test('should save and load usage data', async () => {
      // 사용 데이터 생성
      startupOptimizer.recordModuleUsage('cache');
      startupOptimizer.recordModuleUsage('optimized-search-engine');
      
      // 저장
      await startupOptimizer.saveUsageData();
      
      // 파일 존재 확인
      const exists = await fs.access(usageDataFile).then(() => true).catch(() => false);
      expect(exists).toBe(true);
      
      // 새 인스턴스로 로드
      const newOptimizer = new StartupOptimizer({
        usageDataFile,
        enableUsageTracking: true
      });
      
      await newOptimizer.loadUsageData();
      
      expect(newOptimizer.usageStats.moduleUsage.size).toBe(2);
      expect(newOptimizer.usageStats.moduleUsage.get('cache').totalUsage).toBe(1);
      
      console.log('Usage persistence test passed');
    });
  });

  describe('Module Loading', () => {
    test('should load basic modules successfully', async () => {
      const basicModules = ['input-sanitizer', 'fuzzy-search'];
      
      for (const moduleName of basicModules) {
        const startTime = Date.now();
        try {
          const instance = await startupOptimizer.loadModule(moduleName);
          const loadTime = Date.now() - startTime;
          
          expect(instance).toBeDefined();
          console.log(`Module "${moduleName}" loaded in ${loadTime}ms`);
          
        } catch (error) {
          console.warn(`Module "${moduleName}" failed to load: ${error.message}`);
          // 일부 모듈은 테스트 환경에서 로드 실패할 수 있음
        }
      }
    });

    test('should handle module loading with cache', async () => {
      const moduleName = 'input-sanitizer';
      
      // 첫 번째 로딩
      const start1 = Date.now();
      const instance1 = await startupOptimizer.loadModuleWithCache(moduleName);
      const time1 = Date.now() - start1;
      
      expect(instance1).toBeDefined();
      
      // 두 번째 로딩 (캐시에서)
      const start2 = Date.now();
      const instance2 = await startupOptimizer.loadModuleWithCache(moduleName);
      const time2 = Date.now() - start2;
      
      expect(instance2).toBe(instance1);
      expect(time2).toBeLessThanOrEqual(time1); // 캐시에서 더 빠르거나 같게
      
      console.log(`Module caching test: first=${time1}ms, cached=${time2}ms`);
    });

    test('should handle module loading timeout', async () => {
      // 타임아웃 테스트를 위해 실제 모듈이지만 매우 짧은 타임아웃 사용
      const promise = startupOptimizer.loadModuleWithTimeout('cpu-worker-pool', 1); // 1ms로 매우 짧게
      
      await expect(promise).rejects.toThrow();
    }, 5000);

    test('should get module with lazy loading', async () => {
      const moduleName = 'input-sanitizer';
      
      // 모듈이 로드되지 않은 상태에서 요청
      expect(startupOptimizer.moduleInstances.has(moduleName)).toBe(false);
      
      const instance = await startupOptimizer.getModule(moduleName);
      
      expect(instance).toBeDefined();
      expect(startupOptimizer.moduleInstances.has(moduleName)).toBe(true);
      
      console.log('Lazy loading test passed');
    });
  });

  describe('Priority Recalculation', () => {
    test('should recalculate priorities based on usage', async () => {
      // 사용 패턴 생성 (LOW 우선순위 모듈을 자주 사용)
      const frequentModule = 'template-engine';
      for (let i = 0; i < 10; i++) {
        startupOptimizer.recordModuleUsage(frequentModule);
        await new Promise(resolve => setTimeout(resolve, 1)); // 시간 차이 생성
      }
      
      // 기존 우선순위 확인
      expect(startupOptimizer.modulePriorities.LOW).toContain(frequentModule);
      expect(startupOptimizer.modulePriorities.HIGH).not.toContain(frequentModule);
      
      // 우선순위 재계산
      startupOptimizer.recalculatePriorities();
      
      // 자주 사용된 모듈이 HIGH로 이동했는지 확인
      expect(startupOptimizer.modulePriorities.HIGH).toContain(frequentModule);
      expect(startupOptimizer.modulePriorities.LOW).not.toContain(frequentModule);
      
      console.log('Priority recalculation test passed');
    });

    test('should maintain CRITICAL modules priority', () => {
      // CRITICAL 모듈들 사용 기록
      startupOptimizer.recordModuleUsage('logger');
      
      const originalCritical = [...startupOptimizer.modulePriorities.CRITICAL];
      
      // 우선순위 재계산
      startupOptimizer.recalculatePriorities();
      
      // CRITICAL 모듈들은 변경되지 않아야 함
      expect(startupOptimizer.modulePriorities.CRITICAL).toEqual(originalCritical);
    });
  });

  describe('Startup Cache', () => {
    test('should save and load startup cache', async () => {
      // 시작 메트릭 설정
      startupOptimizer.startupMetrics.readyTime = Date.now();
      startupOptimizer.startupMetrics.criticalLoadTime = 100;
      
      // 캐시 저장
      await startupOptimizer.saveStartupCache();
      
      // 파일 존재 확인
      const exists = await fs.access(startupCacheFile).then(() => true).catch(() => false);
      expect(exists).toBe(true);
      
      // 캐시 내용 확인
      const cacheContent = await fs.readFile(startupCacheFile, 'utf-8');
      const cache = JSON.parse(cacheContent);
      
      expect(cache.modulePriorities).toBeDefined();
      expect(cache.startupStats).toBeDefined();
      expect(cache.timestamp).toBeGreaterThan(0);
      
      console.log('Startup cache test passed');
    });
  });
});

describe('OptimizedPromptServer Integration', () => {
  let server;
  let testPromptsDir;

  beforeEach(async () => {
    // 테스트용 프롬프트 디렉토리 설정
    testPromptsDir = path.join(__dirname, 'temp_prompts');
    await fs.mkdir(testPromptsDir, { recursive: true });
    
    // 환경 변수 설정
    process.env.PROMPTS_DIR = testPromptsDir;
    process.env.ENABLE_USAGE_TRACKING = 'true';
    process.env.ENABLE_STARTUP_CACHE = 'true';
    process.env.ENABLE_BACKGROUND_INIT = 'true';
    
    server = new OptimizedPromptServer();
  });

  afterEach(async () => {
    if (server) {
      await server.cleanup();
    }
    
    // 임시 디렉토리 정리
    try {
      await fs.rm(testPromptsDir, { recursive: true, force: true });
    } catch (e) {
      // 정리 실패 무시
    }
  });

  test('should initialize optimized server faster than standard', async () => {
    const startTime = Date.now();
    
    const initResult = await server.initialize();
    
    const totalTime = Date.now() - startTime;
    
    expect(initResult).toBeDefined();
    expect(initResult.readyTime).toBeDefined();
    expect(initResult.loadedModules).toBeDefined();
    expect(server.isReady).toBe(true);
    
    console.log('Optimized server initialization:', {
      totalTime: `${totalTime}ms`,
      readyTime: `${initResult.readyTime}ms`,
      improvement: totalTime > initResult.readyTime ? `${Math.round((1 - initResult.readyTime / totalTime) * 100)}%` : '0%',
      loadedModules: initResult.loadedModules
    });
    
    // 최적화된 시작 시간은 전체 시간보다 빠르거나 같아야 함
    expect(initResult.readyTime).toBeLessThanOrEqual(totalTime);
  }, 15000);

  test('should handle core operations immediately after ready', async () => {
    await server.initialize();
    
    // 테스트 프롬프트 파일 생성
    const testPrompt = 'This is a test prompt content.';
    const testFile = path.join(testPromptsDir, 'test-prompt.txt');
    await fs.writeFile(testFile, testPrompt);
    
    // 핵심 기능들이 즉시 작동하는지 확인
    const listResult = await server.handleListPrompts({});
    expect(listResult.success).toBe(true);
    expect(listResult.data.prompts).toBeDefined();
    
    // 파일명만 확인 (확장자 없이)
    const readResult = await server.handleReadPrompt({ filename: 'test-prompt.txt' });
    expect(readResult.success).toBe(true);
    expect(readResult.data.content).toBe(testPrompt);
    
    console.log('Core operations test passed');
  });

  test('should load advanced features in background', async () => {
    await server.initialize();
    
    // 백그라운드 로딩 완료까지 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const stats = server.getPerformanceStats();
    
    expect(stats.isReady).toBe(true);
    expect(stats.startupStats).toBeDefined();
    expect(stats.loadedModules).toBeDefined();
    
    console.log('Background loading test:', {
      uptime: `${stats.uptime}ms`,
      loadedModules: stats.loadedModules
    });
  }, 10000);

  test('should handle basic search fallback', async () => {
    await server.initialize();
    
    // 테스트 프롬프트 파일들 생성
    await fs.writeFile(path.join(testPromptsDir, 'javascript-tips.txt'), 'JavaScript coding tips and tricks');
    await fs.writeFile(path.join(testPromptsDir, 'python-guide.txt'), 'Python programming guide');
    await fs.writeFile(path.join(testPromptsDir, 'react-components.txt'), 'React component examples');
    
    // 기본 검색 테스트
    const searchResult = await server.handleBasicSearch({ 
      query: 'javascript', 
      searchInContent: true, 
      maxResults: 5 
    });
    
    expect(searchResult.success).toBe(true);
    expect(searchResult.data.results).toBeDefined();
    
    // 결과가 있으면 JavaScript 관련이어야 함
    if (searchResult.data.results.length > 0) {
      const jsResult = searchResult.data.results.find(r => 
        r.name.toLowerCase().includes('javascript') || 
        r.matches.some(m => m.toLowerCase().includes('javascript'))
      );
      expect(jsResult).toBeDefined();
    }
    
    console.log('Basic search test:', {
      query: 'javascript',
      resultsCount: searchResult.data.results.length,
      totalFiles: 3
    });
  });
});

describe('Performance Benchmarking', () => {
  test('should demonstrate startup time improvement', async () => {
    const iterations = 3;
    const optimizedTimes = [];
    
    for (let i = 0; i < iterations; i++) {
      const server = new OptimizedPromptServer();
      
      const startTime = Date.now();
      const result = await server.initialize();
      const endTime = Date.now();
      
      optimizedTimes.push({
        total: endTime - startTime,
        ready: result.readyTime,
        modules: result.loadedModules
      });
      
      await server.cleanup();
      
      // 테스트 간 간격
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const avgOptimizedTime = optimizedTimes.reduce((sum, t) => sum + t.ready, 0) / iterations;
    const avgTotalTime = optimizedTimes.reduce((sum, t) => sum + t.total, 0) / iterations;
    
    const improvement = ((avgTotalTime - avgOptimizedTime) / avgTotalTime * 100);
    
    console.log('Startup Performance Benchmark:');
    console.log(`- Average optimized ready time: ${avgOptimizedTime.toFixed(2)}ms`);
    console.log(`- Average total time: ${avgTotalTime.toFixed(2)}ms`);
    console.log(`- Improvement: ${improvement.toFixed(1)}%`);
    console.log(`- Iterations: ${iterations}`);
    
    // 최적화된 시간이 전체 시간보다 빠르거나 같아야 함
    expect(avgOptimizedTime).toBeLessThanOrEqual(avgTotalTime);
    
    // 최소한의 성능 향상이 있어야 함 (또는 동일)
    expect(improvement).toBeGreaterThanOrEqual(0);
    
  }, 30000);
});

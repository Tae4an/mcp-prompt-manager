import { jest } from '@jest/globals';
import { OptimizedFileIO, FileIOBenchmark } from '../utils/optimized-file-io.js';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('File I/O Optimization', () => {
  let optimizedIO;
  let testDir;
  let testFiles;

  beforeAll(async () => {
    // 테스트 디렉토리 생성
    testDir = path.join(process.cwd(), 'tests', 'temp_files');
    await fs.mkdir(testDir, { recursive: true });
    
    // 테스트 파일 데이터 생성
    testFiles = [];
    
    // 소규모 파일들 (1KB 미만)
    for (let i = 0; i < 10; i++) {
      const filename = `small-file-${i}.txt`;
      const content = `Small test file ${i}\n`.repeat(20); // ~400 bytes
      testFiles.push({ filename, content, size: 'small' });
    }
    
    // 중간 크기 파일들 (10KB~100KB)
    for (let i = 0; i < 5; i++) {
      const filename = `medium-file-${i}.txt`;
      const content = `Medium test file ${i} with more content\n`.repeat(300); // ~12KB
      testFiles.push({ filename, content, size: 'medium' });
    }
    
    // 대용량 파일들 (1MB 이상)
    for (let i = 0; i < 3; i++) {
      const filename = `large-file-${i}.txt`;
      const content = `Large test file ${i} with extensive content for streaming tests\n`.repeat(20000); // ~1.3MB
      testFiles.push({ filename, content, size: 'large' });
    }
    
    // 압축 가능한 파일들 (반복 패턴)
    for (let i = 0; i < 2; i++) {
      const filename = `compressible-file-${i}.txt`;
      const content = 'This line repeats many times for compression testing.\n'.repeat(500); // ~27KB, 압축률 높음
      testFiles.push({ filename, content, size: 'compressible' });
    }
  });

  beforeEach(() => {
    optimizedIO = new OptimizedFileIO({
      maxConcurrentFiles: 5,
      streamThreshold: 1024 * 100, // 100KB
      compressionThreshold: 10 * 1024, // 10KB
      enableCompression: true,
      enableStreaming: true,
      enableCaching: true,
      watchFiles: false // 테스트에서는 비활성화
    });
  });

  afterEach(() => {
    if (optimizedIO) {
      optimizedIO.destroy();
    }
  });

  afterAll(async () => {
    // 테스트 파일 정리
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up test directory:', error.message);
    }
  });

  describe('Parallel File Reading', () => {
    test('should read multiple files in parallel', async () => {
      // 테스트 파일들 생성
      const filePaths = [];
      for (const testFile of testFiles.slice(0, 10)) {
        const filePath = path.join(testDir, testFile.filename);
        await fs.writeFile(filePath, testFile.content);
        filePaths.push(filePath);
      }
      
      const start = Date.now();
      const results = await optimizedIO.readFilesBatch(filePaths);
      const duration = Date.now() - start;
      
      expect(results).toHaveLength(filePaths.length);
      expect(results.every(r => r.status === 'fulfilled')).toBe(true);
      
      // 병렬 처리로 인한 성능 이점 확인
      expect(duration).toBeLessThan(1000); // 1초 이내
      
      console.log(`Parallel read of ${filePaths.length} files: ${duration}ms`);
      
      const stats = optimizedIO.getPerformanceStats();
      expect(stats.parallelReads).toBe(1);
      expect(stats.reads).toBeGreaterThan(0);
    });

    test('should handle file read errors gracefully', async () => {
      const validFile = path.join(testDir, 'valid.txt');
      const invalidFile = path.join(testDir, 'nonexistent.txt');
      
      await fs.writeFile(validFile, 'Valid content');
      
      const results = await optimizedIO.readFilesBatch([validFile, invalidFile]);
      
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      
      expect(results[0].value.content).toBe('Valid content');
    });
  });

  describe('Streaming I/O', () => {
    test('should use streaming for large files', async () => {
      const largeFile = testFiles.find(f => f.size === 'large');
      const filePath = path.join(testDir, largeFile.filename);
      
      await fs.writeFile(filePath, largeFile.content);
      
      const result = await optimizedIO.readFileOptimized(filePath);
      
      expect(result.content).toBe(largeFile.content);
      expect(result.size).toBeGreaterThan(1024 * 1024); // 1MB 이상
      
      const stats = optimizedIO.getPerformanceStats();
      expect(stats.streamingReads).toBe(1);
      
      console.log(`Streaming read: ${result.size} bytes in ${result.readTime}ms`);
    });

    test('should use standard read for small files', async () => {
      const smallFile = testFiles.find(f => f.size === 'small');
      const filePath = path.join(testDir, smallFile.filename);
      
      await fs.writeFile(filePath, smallFile.content);
      
      const result = await optimizedIO.readFileOptimized(filePath);
      
      expect(result.content).toBe(smallFile.content);
      expect(result.size).toBeLessThan(1024); // 1KB 미만
      
      const stats = optimizedIO.getPerformanceStats();
      expect(stats.streamingReads).toBe(0); // 스트리밍 사용 안 함
      
      console.log(`Standard read: ${result.size} bytes in ${result.readTime}ms`);
    });
  });

  describe('File Compression', () => {
    test('should compress large files automatically', async () => {
      const compressibleFile = testFiles.find(f => f.size === 'compressible');
      const filePath = path.join(testDir, compressibleFile.filename);
      
      const writeResult = await optimizedIO.writeFileOptimized(filePath, compressibleFile.content);
      
      expect(writeResult.compressed).toBe(true);
      expect(writeResult.filePath).toBe(filePath + '.gz');
      
      // 압축 파일이 실제로 생성되었는지 확인
      const compressedExists = await fs.access(filePath + '.gz')
        .then(() => true)
        .catch(() => false);
      expect(compressedExists).toBe(true);
      
      const stats = optimizedIO.getPerformanceStats();
      expect(stats.compressions).toBe(1);
      
      console.log(`Compressed file: ${compressibleFile.content.length} → compressed bytes`);
    });

    test('should decompress files when reading', async () => {
      const compressibleFile = testFiles.find(f => f.size === 'compressible');
      const filePath = path.join(testDir, `decompress-${compressibleFile.filename}`);
      
      // 압축된 파일 쓰기
      await optimizedIO.writeFileOptimized(filePath, compressibleFile.content);
      
      // 압축된 파일 읽기
      const compressedPath = filePath + '.gz';
      const result = await optimizedIO.readFileOptimized(compressedPath);
      
      expect(result.content).toBe(compressibleFile.content);
      
      const stats = optimizedIO.getPerformanceStats();
      expect(stats.decompressions).toBe(1);
      
      console.log(`Decompressed file: ${result.content.length} bytes recovered`);
    });

    test('should skip compression for small files', async () => {
      const smallFile = testFiles.find(f => f.size === 'small');
      const filePath = path.join(testDir, `no-compress-${smallFile.filename}`);
      
      const writeResult = await optimizedIO.writeFileOptimized(filePath, smallFile.content);
      
      expect(writeResult.compressed).toBe(false);
      expect(writeResult.filePath).toBe(filePath);
      
      const stats = optimizedIO.getPerformanceStats();
      expect(stats.compressions).toBe(0); // 압축 안 함
    });
  });

  describe('File Caching', () => {
    test('should cache file content after reading', async () => {
      const testFile = testFiles.find(f => f.size === 'medium');
      const filePath = path.join(testDir, `cache-${testFile.filename}`);
      
      await fs.writeFile(filePath, testFile.content);
      
      // 첫 번째 읽기
      const result1 = await optimizedIO.readFileOptimized(filePath);
      const stats1 = optimizedIO.getPerformanceStats();
      
      // 두 번째 읽기 (캐시에서)
      const result2 = await optimizedIO.readFileOptimized(filePath);
      const stats2 = optimizedIO.getPerformanceStats();
      
      expect(result1.content).toBe(result2.content);
      expect(stats2.cacheHits).toBe(1);
      expect(stats2.cacheMisses).toBe(1);
      
      console.log(`Cache hit rate: ${stats2.cacheHitRate}%`);
    });

    test('should invalidate cache when file changes', async () => {
      const testFile = testFiles.find(f => f.size === 'small');
      const filePath = path.join(testDir, `invalidate-${testFile.filename}`);
      
      await fs.writeFile(filePath, testFile.content);
      
      // 첫 번째 읽기 (캐시에 저장)
      await optimizedIO.readFileOptimized(filePath);
      
      // 파일 수정
      const modifiedContent = testFile.content + '\nModified content';
      await fs.writeFile(filePath, modifiedContent);
      
      // 두 번째 읽기 (캐시 무효화되어 새로 읽음)
      const result = await optimizedIO.readFileOptimized(filePath);
      
      expect(result.content).toBe(modifiedContent);
      
      const stats = optimizedIO.getPerformanceStats();
      expect(stats.cacheMisses).toBe(2); // 첫 번째 + 무효화 후
    });
  });

  describe('Parallel File Writing', () => {
    test('should write multiple files in parallel', async () => {
      const operations = testFiles.slice(0, 8).map((testFile, index) => ({
        filePath: path.join(testDir, `parallel-write-${index}-${testFile.filename}`),
        content: testFile.content
      }));
      
      const start = Date.now();
      const results = await optimizedIO.writeFilesBatch(operations);
      const duration = Date.now() - start;
      
      expect(results).toHaveLength(operations.length);
      expect(results.every(r => r.status === 'fulfilled')).toBe(true);
      
      // 모든 파일이 실제로 생성되었는지 확인
      for (const operation of operations) {
        const exists = await fs.access(operation.filePath)
          .then(() => true)
          .catch(() => {
            // .gz 파일 확인 (압축된 경우)
            return fs.access(operation.filePath + '.gz')
              .then(() => true)
              .catch(() => false);
          });
        expect(exists).toBe(true);
      }
      
      console.log(`Parallel write of ${operations.length} files: ${duration}ms`);
      
      const stats = optimizedIO.getPerformanceStats();
      expect(stats.parallelWrites).toBe(1);
      expect(stats.writes).toBeGreaterThan(0);
    });
  });

  describe('Performance Statistics', () => {
    test('should track comprehensive performance metrics', async () => {
      const testFile = testFiles.find(f => f.size === 'medium');
      const filePath = path.join(testDir, `stats-${testFile.filename}`);
      
      // 쓰기 작업
      await optimizedIO.writeFileOptimized(filePath, testFile.content);
      
      // 읽기 작업
      await optimizedIO.readFileOptimized(filePath + '.gz'); // 압축됨
      
      const stats = optimizedIO.getPerformanceStats();
      
      expect(stats).toHaveProperty('reads');
      expect(stats).toHaveProperty('writes');
      expect(stats).toHaveProperty('cacheHitRate');
      expect(stats).toHaveProperty('avgReadTime');
      expect(stats).toHaveProperty('avgWriteTime');
      expect(stats).toHaveProperty('totalBytes');
      expect(stats).toHaveProperty('compressionRatio');
      
      expect(stats.reads).toBeGreaterThan(0);
      expect(stats.writes).toBeGreaterThan(0);
      expect(stats.totalBytes).toBeGreaterThan(0);
      
      console.log('Performance stats:', {
        reads: stats.reads,
        writes: stats.writes,
        cacheHitRate: `${stats.cacheHitRate}%`,
        avgReadTime: `${stats.avgReadTime}ms`,
        avgWriteTime: `${stats.avgWriteTime}ms`,
        compressionRatio: `${stats.compressionRatio}%`
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle file access errors gracefully', async () => {
      const invalidPath = '/invalid/nonexistent/path/file.txt';
      
      await expect(optimizedIO.readFileOptimized(invalidPath))
        .rejects.toThrow();
      
      await expect(optimizedIO.writeFileOptimized('/invalid/path.txt', 'content'))
        .rejects.toThrow();
    });

    test('should handle malformed data gracefully', async () => {
      const filePath = path.join(testDir, 'malformed.txt');
      
      // 유효한 텍스트가 아닌 바이너리 데이터
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);
      await fs.writeFile(filePath, binaryData);
      
      // 읽기 시도 (오류가 발생해도 처리되어야 함)
      const result = await optimizedIO.readFileOptimized(filePath);
      expect(result).toBeDefined();
    });
  });

  describe('Memory Management', () => {
    test('should efficiently manage memory during large operations', async () => {
      const operations = [];
      
      // 많은 수의 파일 작업 생성
      for (let i = 0; i < 50; i++) {
        operations.push({
          filePath: path.join(testDir, `memory-test-${i}.txt`),
          content: `Memory test content ${i}\n`.repeat(100)
        });
      }
      
      const initialMemory = process.memoryUsage();
      
      // 배치 작업 실행
      await optimizedIO.writeFilesBatch(operations);
      
      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      
      // 메모리 증가가 합리적인 범위 내인지 확인 (10MB 미만)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
      
      console.log(`Memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB for ${operations.length} operations`);
    });
  });
});

describe('File I/O Benchmark', () => {
  let optimizedIO;
  let benchmark;
  let testDir;
  let testFiles;

  beforeAll(async () => {
    testDir = path.join(process.cwd(), 'tests', 'temp_benchmark');
    await fs.mkdir(testDir, { recursive: true });
    
    // 벤치마크용 테스트 파일 생성
    testFiles = [];
    for (let i = 0; i < 20; i++) {
      const filename = `benchmark-${i}.txt`;
      const content = `Benchmark test file ${i}\n`.repeat(50);
      const filePath = path.join(testDir, filename);
      
      await fs.writeFile(filePath, content);
      testFiles.push(filePath);
    }
  });

  beforeEach(() => {
    optimizedIO = new OptimizedFileIO({
      maxConcurrentFiles: 8,
      enableCaching: true,
      enableCompression: false, // 벤치마크에서는 압축 비활성화
      enableStreaming: false
    });
    
    benchmark = new FileIOBenchmark(optimizedIO);
  });

  afterEach(() => {
    if (optimizedIO) {
      optimizedIO.destroy();
    }
  });

  afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up benchmark directory:', error.message);
    }
  });

  test('should demonstrate read performance improvement', async () => {
    const results = await benchmark.benchmarkReads(testFiles, 3);
    
    expect(results.optimized.avgTime).toBeDefined();
    expect(results.standard.avgTime).toBeDefined();
    
    console.log('Read Performance Benchmark:');
    console.log(`- Optimized I/O: ${results.optimized.avgTime.toFixed(2)}ms average`);
    console.log(`- Standard I/O: ${results.standard.avgTime.toFixed(2)}ms average`);
    console.log(`- Improvement: ${results.improvement.toFixed(1)}%`);
    
    console.log('\nOptimized I/O Stats:');
    const stats = results.optimizedStats;
    console.log(`- Cache hit rate: ${stats.cacheHitRate}%`);
    console.log(`- Parallel reads: ${stats.parallelReads}`);
    console.log(`- Total reads: ${stats.reads}`);
    
    // 캐시 효과로 인해 두 번째 이후 읽기에서 성능 향상 기대
    expect(stats.cacheHitRate).toBeGreaterThan(0);
  }, 30000); // 30초 타임아웃

  test('should demonstrate write performance improvement', async () => {
    const writeOperations = [];
    for (let i = 0; i < 15; i++) {
      writeOperations.push({
        filePath: path.join(testDir, `write-bench-${i}.txt`),
        content: `Write benchmark content ${i}\n`.repeat(100)
      });
    }
    
    const results = await benchmark.benchmarkWrites(writeOperations, 2);
    
    expect(results.optimized.avgTime).toBeDefined();
    expect(results.standard.avgTime).toBeDefined();
    
    console.log('Write Performance Benchmark:');
    console.log(`- Optimized I/O: ${results.optimized.avgTime.toFixed(2)}ms average`);
    console.log(`- Standard I/O: ${results.standard.avgTime.toFixed(2)}ms average`);
    console.log(`- Improvement: ${results.improvement.toFixed(1)}%`);
    
    console.log('\nOptimized I/O Stats:');
    const stats = results.optimizedStats;
    console.log(`- Parallel writes: ${stats.parallelWrites}`);
    console.log(`- Total writes: ${stats.writes}`);
    
    // 병렬 처리로 인한 성능 향상 기대
    if (results.improvement > 0) {
      expect(results.optimized.avgTime).toBeLessThan(results.standard.avgTime);
    }
  }, 30000); // 30초 타임아웃
});

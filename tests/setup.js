import * as fs from 'fs/promises';
import * as path from 'path';

// 테스트용 임시 디렉토리 설정
const TEST_PROMPTS_DIR = path.join(process.cwd(), 'tests', 'temp_prompts');

// 각 테스트 전에 임시 디렉토리 정리
beforeEach(async () => {
  try {
    await fs.rm(TEST_PROMPTS_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_PROMPTS_DIR, { recursive: true });
  } catch (error) {
    // 디렉토리가 존재하지 않는 경우 무시
  }
});

// 모든 테스트 후 정리
afterAll(async () => {
  try {
    await fs.rm(TEST_PROMPTS_DIR, { recursive: true, force: true });
  } catch (error) {
    // 정리 실패는 무시
  }
});

// 환경 변수 설정
process.env.PROMPTS_DIR = TEST_PROMPTS_DIR;
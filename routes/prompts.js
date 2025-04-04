const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const router = express.Router();
const PROMPTS_DIR = process.env.PROMPTS_DIR || path.join(__dirname, '..', 'prompts');

// 파일 경로 검증 유틸리티 함수
function validateFilePath(filename) {
  // 파일명에 경로 구분자나 상위 디렉토리 이동을 방지하여 보안 강화
  const normalizedPath = path.normalize(filename);
  if (normalizedPath.includes('..') || path.isAbsolute(normalizedPath)) {
    return false;
  }
  return true;
}

// 모든 프롬프트 목록 조회
router.get('/', async (req, res) => {
  try {
    const files = await fs.readdir(PROMPTS_DIR);
    
    // 각 파일의 메타데이터 추가
    const promptsWithMeta = await Promise.all(files.map(async (filename) => {
      const filePath = path.join(PROMPTS_DIR, filename);
      const stats = await fs.stat(filePath);
      
      return {
        name: filename,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime
      };
    }));
    
    res.json(promptsWithMeta);
  } catch (err) {
    console.error('프롬프트 목록 조회 오류:', err);
    res.status(500).json({ error: '프롬프트 목록을 가져오는 중 오류가 발생했습니다.' });
  }
});

// 특정 프롬프트 내용 조회
router.get('/:filename', async (req, res) => {
  const { filename } = req.params;
  
  // 파일 경로 검증
  if (!validateFilePath(filename)) {
    return res.status(400).json({ error: '유효하지 않은 파일명입니다.' });
  }
  
  const filePath = path.join(PROMPTS_DIR, filename);
  
  try {
    // 파일 존재 여부 확인
    await fs.access(filePath);
    
    // 파일 내용 읽기
    const content = await fs.readFile(filePath, 'utf-8');
    
    res.json({
      name: filename,
      content
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: '프롬프트를 찾을 수 없습니다.' });
    }
    
    console.error('프롬프트 조회 오류:', err);
    res.status(500).json({ error: '프롬프트를 읽는 중 오류가 발생했습니다.' });
  }
});

// 새 프롬프트 생성
router.post('/:filename', async (req, res) => {
  const { filename } = req.params;
  const { content } = req.body;
  
  // 입력 검증
  if (!content) {
    return res.status(400).json({ error: '프롬프트 내용이 필요합니다.' });
  }
  
  // 파일 경로 검증
  if (!validateFilePath(filename)) {
    return res.status(400).json({ error: '유효하지 않은 파일명입니다.' });
  }
  
  const filePath = path.join(PROMPTS_DIR, filename);
  
  try {
    // 파일 이미 존재하는지 확인
    try {
      await fs.access(filePath);
      return res.status(409).json({ error: '이미 존재하는 프롬프트 파일입니다.' });
    } catch (e) {
      // 파일이 없으면 계속 진행
    }
    
    // 새 파일 쓰기
    await fs.writeFile(filePath, content, 'utf-8');
    
    res.status(201).json({
      message: '프롬프트가 성공적으로 생성되었습니다.',
      name: filename
    });
  } catch (err) {
    console.error('프롬프트 생성 오류:', err);
    res.status(500).json({ error: '프롬프트를 생성하는 중 오류가 발생했습니다.' });
  }
});

// 프롬프트 수정
router.put('/:filename', async (req, res) => {
  const { filename } = req.params;
  const { content } = req.body;
  
  // 입력 검증
  if (!content) {
    return res.status(400).json({ error: '프롬프트 내용이 필요합니다.' });
  }
  
  // 파일 경로 검증
  if (!validateFilePath(filename)) {
    return res.status(400).json({ error: '유효하지 않은 파일명입니다.' });
  }
  
  const filePath = path.join(PROMPTS_DIR, filename);
  
  try {
    // 파일 존재 여부 확인
    try {
      await fs.access(filePath);
    } catch (e) {
      return res.status(404).json({ error: '수정할 프롬프트를 찾을 수 없습니다.' });
    }
    
    // 파일 수정
    await fs.writeFile(filePath, content, 'utf-8');
    
    res.json({
      message: '프롬프트가 성공적으로 수정되었습니다.',
      name: filename
    });
  } catch (err) {
    console.error('프롬프트 수정 오류:', err);
    res.status(500).json({ error: '프롬프트를 수정하는 중 오류가 발생했습니다.' });
  }
});

// 프롬프트 삭제
router.delete('/:filename', async (req, res) => {
  const { filename } = req.params;
  
  // 파일 경로 검증
  if (!validateFilePath(filename)) {
    return res.status(400).json({ error: '유효하지 않은 파일명입니다.' });
  }
  
  const filePath = path.join(PROMPTS_DIR, filename);
  
  try {
    // 파일 존재 여부 확인
    try {
      await fs.access(filePath);
    } catch (e) {
      return res.status(404).json({ error: '삭제할 프롬프트를 찾을 수 없습니다.' });
    }
    
    // 파일 삭제
    await fs.unlink(filePath);
    
    res.json({
      message: '프롬프트가 성공적으로 삭제되었습니다.',
      name: filename
    });
  } catch (err) {
    console.error('프롬프트 삭제 오류:', err);
    res.status(500).json({ error: '프롬프트를 삭제하는 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
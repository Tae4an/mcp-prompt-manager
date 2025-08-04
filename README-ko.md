# MCP 프롬프트 매니저

**MCP Review 인증 획득**

이 프로젝트는 [MCP Review](https://mcpreview.com/mcp-servers/tae4an/mcp-prompt-manager)에서 공식 인증을 받았습니다.

MCP(Model Context Protocol) 프롬프트 매니저는 Claude와 같은 AI 모델이 로컬 프롬프트 파일에 액세스할 수 있게 해주는 서버입니다. 자주 사용하는 프롬프트의 효율적인 관리를 위한 생성, 조회, 수정, 삭제 기능을 제공합니다.

## 주요 기능

### 핵심 기능
- 모든 프롬프트 목록 조회
- 특정 프롬프트 콘텐츠 검색
- 새 프롬프트 생성
- 프롬프트 콘텐츠 수정
- 프롬프트 삭제

### 고급 기능
- **지능형 검색**: 다중 알고리즘(Levenshtein, Jaro-Winkler, n-gram 유사도) 기반 고급 퍼지 검색
- **카테고리 및 태그 시스템**: 카테고리와 태그를 통한 프롬프트 체계적 관리
- **템플릿 처리**: `{{변수}}` 구문 및 고급 조건문을 사용한 변수 치환
- **템플릿 라이브러리**: 5개 카테고리의 12개 전문 템플릿 내장
- **즐겨찾기 관리**: 자주 사용하는 프롬프트를 즐겨찾기로 설정
- **메타데이터 관리**: 향상된 구성을 위한 자동 메타데이터 추적
- **버전 관리**: 히스토리 추적, diff 비교, 롤백 기능을 갖춘 완전한 버전 제어
- **가져오기/내보내기 시스템**: 메타데이터 및 버전 히스토리를 포함한 JSON 형식 백업 및 복원
- **보안 및 검증**: 포괄적인 입력 정제, 속도 제한, 오류 처리
- **캐싱 시스템**: 성능 향상을 위한 지능형 캐싱
- **구조화된 로깅**: 다중 레벨 및 파일 출력을 지원하는 고급 로깅

## 설치

### 사전 요구사항

- Node.js v18 이상
- npm

### 설치 단계

1. 저장소 복제
   ```bash
   git clone https://github.com/Tae4an/mcp-prompt-manager.git
   cd mcp-prompt-manager
   ```

2. 의존성 설치
   ```bash
   npm install
   ```

3. 실행 권한 부여
   ```bash
   chmod +x server.js
   ```

## Claude Desktop 연결

1. Claude Desktop 설치 (아직 설치하지 않은 경우)
   - [Claude Desktop 다운로드](https://claude.ai/desktop)

2. Claude Desktop 설정 파일 열기:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

3. 설정 파일에 다음 내용 추가:
   ```json
   {
     "mcpServers": {
       "promptManager": {
         "command": "node",
         "args": ["복제한_저장소의_절대경로/server.js"]
       }
     }
   }
   ```
   
   예시:
   ```json
   {
     "mcpServers": {
       "promptManager": {
         "command": "node",
         "args": ["/Users/사용자명/projects/mcp-prompt-manager/server.js"]
       }
     }
   }
   ```

4. Claude Desktop 재시작

## 사용법

Claude Desktop에서 도구 아이콘(🛠️)을 클릭하여 다음 MCP 도구에 액세스할 수 있습니다:

## 핵심 도구

### list-prompts
모든 프롬프트 목록을 가져옵니다.
- 매개변수: 없음

### get-prompt
특정 프롬프트의 콘텐츠를 가져옵니다.
- 매개변수: `filename` - 가져올 프롬프트 파일명

### create-prompt
새 프롬프트를 생성합니다.
- 매개변수: 
  - `filename` - 생성할 프롬프트 파일명 (예: my-prompt.txt)
  - `content` - 프롬프트 내용

### update-prompt
기존 프롬프트의 내용을 업데이트합니다.
- 매개변수:
  - `filename` - 업데이트할 프롬프트 파일명
  - `content` - 새 프롬프트 내용

### delete-prompt
프롬프트를 삭제합니다 (관련 메타데이터도 자동 제거).
- 매개변수: `filename` - 삭제할 프롬프트 파일명

## 고급 도구

### search-prompts
지능형 순위 매김을 통한 파일명 또는 내용 기반 고급 퍼지 검색.
- 매개변수:
  - `query` - 검색 쿼리 문자열
  - `searchInContent` - (선택) 프롬프트 내용 내 검색 여부 (기본값: false)
  - `limit` - (선택) 반환할 최대 결과 수 (기본값: 10)
  - `threshold` - (선택) 최소 유사도 임계값 (0.0-1.0, 기본값: 0.3)

### tag-prompt
더 나은 구성을 위해 프롬프트에 태그를 추가합니다.
- 매개변수:
  - `filename` - 태그를 추가할 프롬프트 파일명
  - `tags` - 태그 문자열 배열

### categorize-prompt
프롬프트에 카테고리를 설정합니다.
- 매개변수:
  - `filename` - 분류할 프롬프트 파일명
  - `category` - 카테고리명 문자열

### list-by-category
카테고리별로 구성된 프롬프트 목록을 표시합니다.
- 매개변수:
  - `category` - (선택) 필터링할 특정 카테고리

### process-template
변수 치환을 통한 프롬프트 템플릿 처리.
- 매개변수:
  - `filename` - 템플릿 프롬프트 파일명
  - `variables` - 변수명을 키로, 치환값을 값으로 하는 객체
- 참고: 템플릿에서 `{{변수}}` 형식 사용

### list-template-variables
템플릿 프롬프트에서 발견된 모든 변수를 나열합니다.
- 매개변수:
  - `filename` - 분석할 템플릿 프롬프트 파일명

### favorite-prompt
즐겨찾기에서 프롬프트를 추가하거나 제거합니다.
- 매개변수:
  - `filename` - 프롬프트 파일명
  - `action` - "add" 또는 "remove"

### list-favorites
상세 정보와 함께 모든 즐겨찾기 프롬프트를 나열합니다.
- 매개변수: 없음

## 버전 관리 도구

### list-prompt-versions
타임스탬프 및 작업과 함께 특정 프롬프트의 모든 버전을 나열합니다.
- 매개변수:
  - `filename` - 버전 히스토리를 가져올 프롬프트 파일명

### compare-prompt-versions
프롬프트의 두 버전을 비교하고 상세한 차이점을 표시합니다.
- 매개변수:
  - `filename` - 비교할 프롬프트 파일명
  - `fromVersion` - 비교 원본 버전 번호
  - `toVersion` - 비교 대상 버전 번호

### rollback-prompt
프롬프트를 특정 이전 버전으로 롤백합니다.
- 매개변수:
  - `filename` - 롤백할 프롬프트 파일명
  - `version` - 롤백할 버전 번호

### get-prompt-version
프롬프트의 특정 버전 내용을 가져옵니다.
- 매개변수:
  - `filename` - 프롬프트 파일명
  - `version` - 가져올 버전 번호

### get-prompt-version-stats
총 버전 수, 작업 분석, 크기 히스토리를 포함한 프롬프트 버전 히스토리 통계를 가져옵니다.
- 매개변수:
  - `filename` - 통계를 가져올 프롬프트 파일명

## 템플릿 라이브러리 도구

내장 템플릿 라이브러리는 5개 카테고리에 걸쳐 12개의 전문 템플릿을 포함합니다:

### 사용 가능한 템플릿 카테고리:
- **🖥️ 코딩 및 개발** (3개 템플릿): 코드 리뷰, 디버깅 도움, API 문서화
- **🌐 번역 및 언어** (2개 템플릿): 텍스트 번역, 문법 검사
- **📝 문서 작성** (2개 템플릿): 문서 요약, 회의록
- **📊 분석 및 리서치** (2개 템플릿): SWOT 분석, 경쟁사 분석  
- **🎓 교육 및 학습** (3개 템플릿): 수업 계획, 퀴즈 생성

### list-template-categories
설명 및 템플릿 수와 함께 사용 가능한 모든 템플릿 카테고리를 나열합니다.
- 매개변수: 없음

### list-templates-by-category
특정 카테고리의 모든 템플릿을 나열합니다.
- 매개변수:
  - `categoryId` - 템플릿을 나열할 카테고리 ID

### get-template-details
변수 및 사용법을 포함한 특정 템플릿의 상세 정보를 가져옵니다.
- 매개변수:
  - `templateId` - 템플릿 ID (형식: category.template-name)

### search-templates
퍼지 매칭을 사용하여 템플릿 라이브러리를 검색합니다.
- 매개변수:
  - `query` - 검색 쿼리 문자열
  - `category` - (선택) 특정 카테고리로 필터링
  - `tags` - (선택) 필터링할 태그 배열
  - `limit` - (선택) 최대 결과 수 (기본값: 10)

### render-template
제공된 변수로 템플릿을 렌더링하고 처리된 내용을 가져옵니다.
- 매개변수:
  - `templateId` - 렌더링할 템플릿 ID
  - `variables` - 변수명과 값을 가진 객체
  - `sanitizeOutput` - (선택) 출력 정제 활성화 (기본값: true)

### validate-template
템플릿 구문을 검증하고 잠재적 문제를 확인합니다.
- 매개변수:
  - `templateId` - 검증할 템플릿 ID

### get-popular-templates
사용 패턴을 기반으로 가장 인기 있는 템플릿 목록을 가져옵니다.
- 매개변수:
  - `limit` - (선택) 반환할 템플릿 수 (기본값: 5)

### get-related-templates
태그와 카테고리를 기반으로 특정 템플릿과 관련된 템플릿을 가져옵니다.
- 매개변수:
  - `templateId` - 관련 템플릿을 찾을 템플릿 ID
  - `limit` - (선택) 관련 템플릿 수 (기본값: 3)

### get-template-library-stats
템플릿 라이브러리에 대한 포괄적인 통계를 가져옵니다.
- 매개변수: 없음

### create-prompt-from-template
변수 치환을 통해 템플릿을 사용하여 새 프롬프트 파일을 생성합니다.
- 매개변수:
  - `templateId` - 사용할 템플릿 ID
  - `filename` - 새 프롬프트 파일명
  - `variables` - 템플릿 변수를 가진 객체
  - `addMetadata` - (선택) 파일에 템플릿 메타데이터 추가 (기본값: true)

## 가져오기/내보내기 도구

### export-prompts
백업 또는 공유를 위해 프롬프트를 JSON 형식으로 내보냅니다.
- 매개변수:
  - `format` - (선택) 내보내기 형식: "json" (기본값: json)
  - `includeMetadata` - (선택) 내보내기에 메타데이터 포함 (기본값: true)
  - `includeVersionHistory` - (선택) 버전 히스토리 포함 (기본값: false)
  - `filterByTags` - (선택) 프롬프트를 필터링할 태그 배열
  - `filterByCategory` - (선택) 프롬프트를 필터링할 카테고리
  - `compress` - (선택) 내보내기 데이터 압축 (기본값: false)

### import-prompts
검증 및 충돌 해결을 통해 JSON 형식에서 프롬프트를 가져옵니다.
- 매개변수:
  - `importData` - 내보내기 형식의 가져오기 데이터 객체
  - `overwriteExisting` - (선택) 기존 파일 덮어쓰기 (기본값: false)
  - `skipDuplicates` - (선택) 중복 파일 건너뛰기 (기본값: true)
  - `validateChecksums` - (선택) 파일 체크섬 검증 (기본값: true)
  - `createBackup` - (선택) 가져오기 전 백업 생성 (기본값: true)
  - `mergeMetadata` - (선택) 기존 메타데이터와 병합 (기본값: true)

### get-import-export-status
가져오기/내보내기 시스템 상태와 기능을 가져옵니다.
- 매개변수: 없음

## 기술적 특징

### 보안 및 성능
- **입력 정제**: 포괄적인 XSS 및 인젝션 공격 방지
- **속도 제한**: 슬라이딩 윈도우 알고리즘을 통한 구성 가능한 속도 제한
- **캐싱 시스템**: 성능 향상을 위한 TTL 지원 다중 레벨 LRU 캐싱
- **오류 처리**: 고급 오류 복구 및 로깅 시스템
- **파일 검증**: SHA-256 체크섬 및 무결성 확인

### 고급 템플릿 엔진
- **조건부 로직**: `{{#if}}`, `{{#unless}}`, `{{#each}}` 구문 지원
- **루프 처리**: 템플릿에서 배열 및 객체 반복
- **함수 호출**: 포맷팅 및 처리를 위한 내장 헬퍼 함수
- **중첩 변수**: 복잡한 객체 구조 지원
- **오류 복구**: 누락된 변수 및 잘못된 템플릿의 우아한 처리

### 퍼지 검색 알고리즘
- **레벤슈타인 거리**: 문자 기반 유사도 매칭
- **자로-윈클러 거리**: 접두사 매칭에 최적화
- **N-gram 유사도**: 부분 문자열 패턴 매칭
- **지능형 순위 매김**: 사용자 정의 임계값을 가진 다중 요소 점수 매김
- **하이라이팅**: 더 나은 사용자 경험을 위한 검색 결과 하이라이팅

### 데이터 관리
- **버전 제어**: diff 비교를 통한 완전한 히스토리 추적
- **메타데이터 시스템**: 자동 태깅, 분류 및 즐겨찾기
- **백업 시스템**: 가져오기 작업 중 자동 백업 생성
- **내보내기 형식**: 선택적 압축 및 필터링을 지원하는 JSON
- **파일 구성**: 숨겨진 메타데이터 디렉토리를 가진 구조화된 저장소

## 고급 설정

### 프롬프트 저장 경로 변경

기본적으로 프롬프트는 서버 파일이 위치한 디렉토리의 `prompts` 폴더에 저장됩니다. 환경 변수를 사용하여 경로를 변경할 수 있습니다:

```bash
PROMPTS_DIR=/원하는/경로 node server.js
```

또는 claude_desktop_config.json에서 환경 변수를 설정합니다:

```json
{
  "mcpServers": {
    "promptManager": {
      "command": "node",
      "args": ["/절대/경로/mcp-prompt-manager/server.js"],
      "env": {
        "PROMPTS_DIR": "/원하는/경로"
      }
    }
  }
}
```

## 예시

### 기본 사용법

1. **새 프롬프트 생성**:
   - 도구: `create-prompt`
   - 파일명: `greeting.txt`
   - 콘텐츠: `당신은 친근하고 도움이 되는 AI 어시스턴트입니다. 사용자 질문에 정중하게 응답해 주세요.`

2. **프롬프트 목록 조회**:
   - 도구: `list-prompts`

3. **프롬프트 콘텐츠 가져오기**:
   - 도구: `get-prompt`
   - 파일명: `greeting.txt`

### 고급 사용법

4. **템플릿 프롬프트 생성**:
   - 도구: `create-prompt`
   - 파일명: `email-template.txt`
   - 콘텐츠: `안녕하세요 {{이름}}님, {{제품}}에 관심을 가져주셔서 감사합니다. {{발신자}} 드림`

5. **템플릿 처리**:
   - 도구: `process-template`
   - 파일명: `email-template.txt`
   - 변수: `{"이름": "홍길동", "제품": "MCP 서버", "발신자": "지원팀"}`

6. **프롬프트 구성**:
   - 도구: `categorize-prompt`
   - 파일명: `greeting.txt`
   - 카테고리: `고객-서비스`
   
   - 도구: `tag-prompt`
   - 파일명: `greeting.txt`
   - 태그: `["정중한", "전문적인", "인사"]`

7. **프롬프트 검색**:
   - 도구: `search-prompts`
   - 쿼리: `어시스턴트`
   - 콘텐츠내검색: `true`

8. **즐겨찾기 관리**:
   - 도구: `favorite-prompt`
   - 파일명: `greeting.txt`
   - 작업: `add`

### 버전 관리 사용법

9. **버전 히스토리 보기**:
   - 도구: `list-prompt-versions`
   - 파일명: `greeting.txt`

10. **버전 비교**:
    - 도구: `compare-prompt-versions`
    - 파일명: `greeting.txt`
    - 원본버전: `1`
    - 대상버전: `3`

11. **이전 버전으로 롤백**:
    - 도구: `rollback-prompt`
    - 파일명: `greeting.txt`
    - 버전: `2`

12. **버전 통계 가져오기**:
    - 도구: `get-prompt-version-stats`
    - 파일명: `greeting.txt`

### 템플릿 라이브러리 사용법

13. **템플릿 카테고리 탐색**:
    - 도구: `list-template-categories`

14. **템플릿 사용**:
    - 도구: `render-template`
    - 템플릿ID: `coding.code-review`
    - 변수: `{"code": "function hello() { console.log('안녕하세요'); }", "language": "javascript"}`

15. **템플릿에서 프롬프트 생성**:
    - 도구: `create-prompt-from-template`
    - 템플릿ID: `writing.meeting-minutes`
    - 파일명: `주간-스탠드업.txt`
    - 변수: `{"meeting_title": "주간 스탠드업", "date": "2024-08-04", "attendees": "알파팀"}`

16. **템플릿 검색**:
    - 도구: `search-templates`
    - 쿼리: `코드 리뷰`
    - 카테고리: `coding`

### 가져오기/내보내기 사용법

17. **백업용 프롬프트 내보내기**:
    - 도구: `export-prompts`
    - 메타데이터포함: `true`
    - 버전히스토리포함: `false`
    - 태그필터: `["중요", "운영"]`

18. **백업에서 프롬프트 가져오기**:
    - 도구: `import-prompts`
    - 가져오기데이터: `{내보낸 데이터 객체}`
    - 백업생성: `true`
    - 기존파일덮어쓰기: `false`

19. **가져오기/내보내기 상태 확인**:
    - 도구: `get-import-export-status`

### 고급 검색 사용법

20. **매개변수가 있는 퍼지 검색**:
    - 도구: `search-prompts`
    - 쿼리: `고객 서비스` (의도적 오타)
    - 콘텐츠내검색: `true`
    - 임계값: `0.6`
    - 제한: `15`

## 문제 해결

### MCP 서버가 연결되지 않는 경우
- 서버 파일 경로가 올바른지 확인
- 서버에 실행 권한이 있는지 확인
- Node.js 버전이 v18 이상인지 확인

### 도구가 나타나지 않는 경우
- Claude Desktop 재시작 시도
- `claude_desktop_config.json` 파일이 올바르게 구성되었는지 확인

### 파일 액세스 권한 문제
- 프롬프트 디렉토리에 대한 읽기/쓰기 권한이 있는지 확인

## 라이선스

이 프로젝트는 MIT 라이선스 하에 라이선스가 부여됩니다. 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

## 기여

기여를 환영합니다! Pull Request를 자유롭게 제출해 주세요.

## 지원

문제가 발생하거나 질문이 있으시면 [GitHub 저장소](https://github.com/Tae4an/mcp-prompt-manager/issues)에서 이슈를 열어주세요.

## 다른 언어
- [English](README.md)
- [日本語](README-ja.md)  
- [中文](README-zh.md)
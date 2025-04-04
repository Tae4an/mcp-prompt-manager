# MCP 프롬프트 관리자

MCP(Model Context Protocol) 프롬프트 관리자는 Claude와 같은 AI 모델이 로컬 프롬프트 파일에 접근할 수 있게 해주는 서버입니다. 프롬프트의 생성, 조회, 수정, 삭제 기능을 제공하여 자주 사용하는 프롬프트를 효율적으로 관리할 수 있습니다.

## 주요 기능

- 프롬프트 목록 조회
- 특정 프롬프트 내용 조회
- 새 프롬프트 생성
- 프롬프트 내용 수정
- 프롬프트 삭제

## 설치 방법

### 필수 요구사항
- Node.js v18 이상
- npm

### 설치 과정

1. 저장소 클론
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

## Claude 데스크탑 연결 방법

1. Claude 데스크탑 설치 (아직 설치하지 않은 경우)
   - [Claude 데스크탑 다운로드](https://claude.ai/desktop)

2. Claude 데스크탑 설정 파일 열기:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

3. 설정 파일에 다음 내용 추가:
   ```json
   {
     "mcpServers": {
       "promptManager": {
         "command": "node",
         "args": ["클론한_저장소의_절대경로/server.js"]
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
         "args": ["/Users/username/projects/mcp-prompt-manager/server.js"]
       }
     }
   }
   ```

4. Claude 데스크탑 재시작

## 사용 방법

Claude 데스크탑에서 도구 아이콘(🛠️)을 클릭하여 다음 MCP 도구에 접근할 수 있습니다:

### list-prompts
모든 프롬프트 목록을 조회합니다.
- 매개변수: 없음

### get-prompt
특정 프롬프트의 내용을 조회합니다.
- 매개변수: `filename` - 조회할 프롬프트 파일명

### create-prompt
새 프롬프트를 생성합니다.
- 매개변수: 
  - `filename` - 생성할 프롬프트 파일명 (예: my-prompt.txt)
  - `content` - 프롬프트 내용

### update-prompt
기존 프롬프트 내용을 수정합니다.
- 매개변수:
  - `filename` - 수정할 프롬프트 파일명
  - `content` - 새 프롬프트 내용

### delete-prompt
프롬프트를 삭제합니다.
- 매개변수: `filename` - 삭제할 프롬프트 파일명

## 고급 설정

### 프롬프트 저장 경로 변경
기본적으로 프롬프트는 서버 파일이 있는 디렉토리의 `prompts` 폴더에 저장됩니다. 환경 변수를 사용하여 경로를 변경할 수 있습니다:

```bash
PROMPTS_DIR=/원하는/경로 node server.js
```

또는 claude_desktop_config.json에서 환경 변수 설정:
```json
{
  "mcpServers": {
    "promptManager": {
      "command": "node",
      "args": ["/절대경로/mcp-prompt-manager/server.js"],
      "env": {
        "PROMPTS_DIR": "/원하는/경로"
      }
    }
  }
}
```

## 예시

1. 새 프롬프트 생성:
   - 도구: `create-prompt`
   - 파일명: `greeting.txt`
   - 내용: `당신은 친절하고 도움이 되는 AI 비서입니다. 사용자의 질문에 정중하게 답변해 주세요.`

2. 프롬프트 목록 조회:
   - 도구: `list-prompts`

3. 프롬프트 내용 조회:
   - 도구: `get-prompt`
   - 파일명: `greeting.txt`

## 문제 해결

### MCP 서버가 연결되지 않는 경우
- 서버 파일 경로가 정확한지 확인하세요
- 서버 실행 권한이 있는지 확인하세요
- Node.js 버전이 v16 이상인지 확인하세요

### 도구가 표시되지 않는 경우
- Claude 데스크탑을 재시작해보세요
- `claude_desktop_config.json` 파일이 올바르게 설정되었는지 확인하세요

### 파일 접근 권한 문제
- 프롬프트 디렉토리에 읽기/쓰기 권한이 있는지 확인하세요
# MCP UI Lab

Browser automation playground with an HTML/CSS/JavaScript UI and a Node.js server for read-only AI chat.

## Features
- Text input, textarea, native select boxes and checkboxes; validated request submission.
- Accessible native dialog with cancel, Escape, confirmation and focus restoration.
- Search, status filtering, name sorting, row selection, bulk completion and table pagination.
- Hash-based list/detail navigation and browser history support.
- Simulated asynchronous success and error responses with disabled loading controls.
- Six natural-language scenarios with observable completion evidence, stable IDs and data-testid attributes.
- Browser-local state and up to 200 event logs, JSON export, filters and reset confirmation.
- Responsive navigation and layouts, including 390px mobile viewport.

## Run
For AI chat, run the Node server below; serving static files alone does not run the AI APIs. The original static-only playground remains usable without the server.

## Scope
The UI playground remains browser-local. A read-only AI chat now calls the Responses API from the server after explicit account connection or server-side API-key setup. MCP-driven UI actions remain a later milestone. Existing UI data is stored in localStorage; chat history stays only in tab memory.

## Access
Created owner-private. Do not change to public without the owner’s explicit confirmation.


## AI 채팅 실행 (v1.1)

읽기 전용 AI 채팅을 추가했습니다. 현재 화면의 요청 수·입력/오류·테이블·모달 상태를 전달해 답합니다. UI 자동 조작과 MCP 서버 연결은 후속 단계입니다.

```bash
npm ci
npm run dev
```

같은 PC의 브라우저에서 **http://127.0.0.1:5173**을 열고 **Continue with ChatGPT**로 직접 로그인·승인하세요. 이 로컬 모드는 승인한 ChatGPT 구독을 사용하며, 과거 ChatGPT 대화나 현재 세션을 자동으로 가져오지 않습니다. 토큰은 프로젝트 밖의 보호된 저장소에만 보관합니다.

Vercel에서는 별도 승인 없는 로컬 구독 로그인 토큰을 사용하지 않습니다. 서버 API 키 모드를 제공하며, Root Directory `./`와 Output Directory `build`, 서버 비밀 환경변수 설정이 필요합니다.

**[계정 연결·Vercel 배포·Git 보안 설정 전체 안내](docs/ai-chat-setup.md)**

```bash
npm run check
```

실제 계정 인증 없이 자동 검사를 수행합니다. 실제 연결은 사용자가 로그인하거나 서버 API 키를 등록한 후 완료됩니다. 비밀번호·API 키·토큰을 채팅에 공유하지 마세요.

ZIP으로 받은 소스에는 Git 이력이 포함되지 않습니다. 기존 저장소의 작업 폴더에 소스를 반영한 뒤 검사하세요. 새 작업 폴더라면 `git init` 후 `npm run check`를 실행합니다. 보안 검사는 Git의 추적 파일·무시 규칙을 기준으로 동작합니다.

## 현재 파일 구성

| 경로 | 내용 |
| --- | --- |
| `dist/index.html`, `dist/style.css`, `dist/app.js` | 기존 UI 실습 기능 |
| `dist/chat.js`, `dist/chat.css`, `dist/snapshot.js` | AI 채팅·화면 정보 수집 |
| `api/` | Vercel 서버 API 키 모드의 엔드포인트 |
| `server/` | 서버 요청 검증, 제공자 호출, 로컬 OAuth와 보호 저장소 |
| `tests/` | 인증·권한·응답 처리·비밀 보호 검사 |
| `.env.example` | 비밀이 없는 빈 환경변수 템플릿 |
| `vercel.json` | 정적 출력과 서버 함수 배포 설정 |
| `scripts/build.mjs` | 공개 파일만 `build/`로 출력하고 배포 버전 생성 |
| `docs/ai-chat-setup.md` | 현재 AI 채팅 연결 및 보안 안내 |
| `docs/ai-chat-qa.md` | 이번 변경의 검증 결과와 미검증 범위 |
| `docs/mcp-ui-lab-development-spec.*` | v1 시점의 전체 확장 설계 문서 |
| `QA.md` | 기존 UI 6개 시나리오 검증 기록 |

## 기존 아키텍처·명세

- [개발 명세 (Markdown)](docs/mcp-ui-lab-development-spec.md)
- [개발 명세 (PDF)](docs/mcp-ui-lab-development-spec.pdf)
- [아키텍처 이미지](docs/mcp-ui-lab-architecture.png)

기존 문서의 현재 구현 설명은 v1 기준이며, 새 AI 채팅의 구현 상태와 연결 방법은 `docs/ai-chat-setup.md`가 기준입니다.

## 배포 버전 표시

왼쪽 위 로고 아래에 `ver 1.1.1 · abc1234`와 빌드 시각(KST)을 표시합니다. 사이드바가 축소되는 화면에서는 상단 바에 같은 버전을 표시합니다. 릴리스 번호는 `package.json`의 `version`, 커밋 번호는 Vercel Git 메타데이터, 빌드 시각은 매 빌드의 현재 시각에서 생성합니다. 동일 커밋 재배포도 빌드 시각으로 구분할 수 있습니다. 릴리스 번호 자체는 `npm version patch --no-git-tag-version` 등으로 변경합니다.

`npm run build`로 `build/`를 생성합니다. 배포 출력에는 허용된 공개 파일과 `version.json`만 들어갑니다. 환경변수 전체, 로컬 파일, 인증 저장소는 복사하지 않습니다. Vercel Git 연동의 Production Branch를 `main`, Root Directory를 `./`로 설정하면 다음 push부터 빌드할 때 버전이 자동 갱신됩니다. 정적 소스인 `dist/`를 직접 실행하는 로컬 개발 화면에는 `ver 개발중`이 표시됩니다.

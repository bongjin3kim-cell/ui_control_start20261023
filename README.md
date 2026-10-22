# MCP UI Lab

Private browser automation playground built with dependency-free HTML, CSS and JavaScript.

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
The hosting manifest serves `dist/` directly. There are no dependencies or build commands.

## Scope
This is a target for browser MCP automation. It does not implement an MCP server or call an LLM. The operator must connect their own browser MCP and authenticate as the Site owner to access the private deployment. Data is stored in localStorage and is not synchronized between devices.

## Access
Created owner-private. Do not change to public without the owner’s explicit confirmation.


## 로컬에서 실행

이 프로젝트는 별도 설치나 빌드 없이 실행되는 정적 웹사이트입니다. 저장소를 복제한 뒤 아래 명령을 실행하세요.

```bash
git clone https://github.com/bongjin3kim-cell/ui_control_start20261023.git
cd ui_control_start20261023
python -m http.server 5173 --directory dist
```

브라우저에서 <http://localhost:5173>을 여세요. Windows에서 `python` 명령을 사용할 수 없다면 `py -m http.server 5173 --directory dist`를 사용하거나 VS Code Live Server로 `dist/index.html`을 실행할 수 있습니다.

로컬 서버는 로그인 없이 개발 화면을 제공합니다. 현재 Sites 배포본은 소유자만 접근할 수 있는 비공개 설정을 사용합니다. `.openai/hosting.json`에는 기존 Sites 프로젝트 연결이 보존되어 있습니다. GitHub 업로드 자체가 배포나 접근 권한 변경을 수행하지는 않습니다.

## 아키텍처와 개발 문서

- [개발 명세 (Markdown)](docs/mcp-ui-lab-development-spec.md): 현재 기능, 식별자, 데이터·로그 구조, MCP 확장 설계, 개발 단계와 Claude Code 시작 지시문.
- [개발 명세 (PDF, 6쪽)](docs/mcp-ui-lab-development-spec.pdf)
- [아키텍처 이미지 (PNG)](docs/mcp-ui-lab-architecture.png)
- [기존 브라우저 검증 기록](QA.md)

![현재 구조와 내부 AI 채팅 확장 설계](docs/mcp-ui-lab-architecture.png)

현재 배포본은 브라우저 자동화의 테스트 대상 UI입니다. **사이트 내부 AI 채팅창, LLM API 호출, 자체 MCP Client/Server와 현재 탭 UI Bridge는 추가 개발 범위**이며 아직 구현되어 있지 않습니다. 문서에서 현재 구현과 확장 제안을 구분했습니다.

`QA.md`는 2026-10-22 수행한 6개 브라우저 시나리오의 검증 기록입니다. 실행 코드와 설계 문서를 함께 관리합니다. 외부 Claude/GPT MCP 연결 통합 테스트는 아직 수행되지 않았습니다.

## 소스 구성

| 경로 | 내용 |
| --- | --- |
| `dist/index.html` | 화면 구조와 자동화 식별자 |
| `dist/style.css` | 반응형 스타일 |
| `dist/app.js` | UI 이벤트, 상태 저장, 라우팅, 로그, 시나리오 판정 |
| `.openai/hosting.json` | 기존 Sites 정적 배포 설정 |
| `docs/` | 개발 명세와 아키텍처 이미지 |
| `QA.md` | 기존 브라우저 검증 기록 |

JavaScript 문법 확인:

```bash
node --check dist/app.js
```

# 화면을 읽는 AI 채팅 - 실행 및 연결 안내

## 구현된 범위

- 기존 UI에 채팅창, 모델 선택, 대화 초기화, 응답 중지, 전송할 화면 정보 미리보기 추가.
- 서버가 현재 화면 스냅샷과 질문을 받아 OpenAI Responses API를 호출.
- 스냅샷에는 현재 경로, 전체 요청 수, 현재 테이블 페이지·표시 행, 필터·정렬, 폼 선택 상태, 모달·비동기 상태, 오류, 최근 이벤트 이름만 포함.
- 이름·메모·검색어 등 직접 입력한 값은 기본적으로 제외. 사용자가 '직접 입력한 값도 포함'을 선택해야 전송.
- 질문·스냅샷·답변의 알려진 키/토큰 패턴을 마스킹. 이는 완전한 개인정보 탐지가 아니므로 비밀번호·토큰을 질문이나 실습 입력에 넣지 않는다.
- 대화는 현재 탭 메모리에서만 유지. 서버는 질문·응답·인증 헤더를 로그에 남기지 않으며, Responses 요청은 `store: false`를 사용한다. 제공자 측 처리·보존 정책까지 무보존을 보장하는 설정은 아니다.
- 실제 UI 조작, MCP 서버, 과거 ChatGPT 대화·메모리 접근은 이 단계의 범위에 포함되지 않는다.

## 연결 방식은 두 가지

| 실행 환경 | 연결 | 비밀 정보 위치 |
| --- | --- | --- |
| 개인 PC의 로컬 앱 | Continue with ChatGPT로 로그인하고 구독 사용 승인 | 프로젝트 밖의 로컬 보호 저장소 |
| Vercel 호스팅 | OpenAI API 키로 서버 호출, 소유자 비밀번호 인증 | Vercel 서버 환경변수 |

OpenAI의 현재 공개 ChatGPT 구독 사용 흐름은 오픈소스·로컬 및 자체 호스트 앱용이다. 원격 호스팅 앱에 같은 흐름을 제공하려면 별도 승인 절차가 필요하다. 로컬 로그인 토큰을 Vercel 환경변수로 복사해 이 제한을 우회하지 않는다. 로컬 앱은 `127.0.0.1`에만 바인딩하며, Vercel 함수에는 ChatGPT 로그인/토큰 파일 로딩 경로를 제공하지 않는다.

이 앱이 사용 중인 ChatGPT 세션을 자동으로 가져오는 것은 아니다. 사용자가 직접 OpenAI 로그인 페이지에서 계정을 선택하고, MCP UI Lab에 허용할 구독 사용 범위를 승인해야 연결이 완료된다.

## 1. 내 ChatGPT 계정으로 연결하기: 개인 PC

Node.js 22 이상이 필요하다. 현재 코드는 Node.js 24에서 검증했다.

```bash
cd ui-control-start20261023
npm ci
npm run dev
```

1. 터미널에 출력된 `http://127.0.0.1:5173`을 같은 PC의 브라우저로 연다. `localhost`로 바꾸지 않는다.
2. **Continue with ChatGPT**를 누른다.
3. OpenAI 페이지에서 자신의 ChatGPT 계정을 선택하고 MCP UI Lab 등록 및 구독 사용 권한을 검토한다. 지원되는 Plus/Pro 계정과 해당 계정의 허용 범위가 필요하다.
4. 승인 후 `/auth/callback`을 거쳐 실습 화면으로 돌아온다.
5. 연결 상태와 계정을 확인하고, 계정에서 실제 제공하는 모델 목록 중 하나를 선택한다.
6. “현재 전체 요청 수와 테이블에 표시된 요청 수를 알려줘.”라고 질문한다.

로그인 전 원격 LLM 호출은 발생하지 않는다. 로그인 거부·잘못된 state/nonce·서명·issuer·audience·만료·계정 불일치는 거부한다. `chatgpt.tokens.use.direct` 권한이 없으면 로그인 신원만으로 모델을 호출하지 않는다.

기존 계정 재연결 시 등록된 client ID와 호스트 ID를 재사용한다. 선택적 `id_token_hint`는 보내지 않아 저장된 ID 토큰을 프론트엔드로 전달하지 않는다. 따라서 재로그인 때 계정 선택 화면이 나타날 수 있다. 저장된 계정 목록에서 전환하거나 '다른 계정 추가'로 별도 등록할 수 있다.

로그인 정보는 기본적으로 `~/.config/mcp-ui-lab-chatgpt/`에 저장된다. 저장소는 소유자 전용 디렉터리(Unix 0700)와 파일(0600)을 사용한다. 계정 자격 증명은 AES-256-GCM으로 암호화하고 키는 별도 소유자 전용 파일에 저장한다. 같은 OS 사용자나 관리자에게까지 내용을 숨기는 시스템은 아니다. Windows에서는 사용자 프로필 폴더의 접근 권한도 확인한다.

호스트 ID, 등록 계정, 토큰을 재사용하려면 이 디렉터리를 보존한다. 이 디렉터리 전체를 다른 사람에게 전달하거나 코드 ZIP에 넣지 않는다. 필요 시 `CHATGPT_DATA_DIR`로 경로를 지정할 수 있지만 프로젝트 내부 경로는 거부한다.

### 연결 해제와 문제 해결

- '연결 해제'는 갱신 토큰의 원격 폐기를 시도한 뒤 로컬 토큰을 삭제한다. 앱 등록과 호스트 ID는 재연결을 위해 유지한다.
- 원격 폐기를 확인하지 못하면 안내를 표시한다. [ChatGPT 사용량 설정](https://chatgpt.com/settings/usage)에서도 앱 연결을 확인한다.
- 모델 목록이 비어 있거나 구독 한도 오류가 나면 해당 앱에 허용한 구독 사용량과 계정/워크스페이스 권한을 확인한다.
- 서버를 종료한 채 OAuth 콜백으로 돌아오면 연결할 수 없다. 서버를 켜 두고 새 로그인 흐름을 시작한다. code/state/토큰을 채팅으로 보내지 않는다.
- 다른 브라우저나 다른 PC에서 승인하고 원래 콜백 주소만 복사해도 연결되지 않는다. 시작한 로컬 앱과 브라우저 흐름을 유지한다.

## 2. Vercel에서 실행하기: 서버 API 키 모드

Git에 코드를 반영한 뒤 Vercel 프로젝트의 **Root Directory를 저장소 최상위 `./`**로 설정한다. `dist`를 Root Directory로 지정하면 최상위 `api/`가 배포에 포함되지 않는다.

| 항목 | 설정 |
| --- | --- |
| Framework Preset | Other |
| Root Directory | `./` |
| Output Directory | `build` (`vercel.json`에도 지정) |
| Build Command | `npm run build` (`vercel.json`에도 지정) |
| Install Command | 기본값 (`npm ci`로 의존성 설치) |

Vercel의 서버 환경변수에 아래 값을 등록한다. API 키는 브라우저에 입력하거나 `VITE_`, `NEXT_PUBLIC_` 등의 공개 변수로 만들지 않는다.

| 환경변수 | 값 |
| --- | --- |
| `OPENAI_API_KEY` | 본인의 OpenAI API 키 |
| `OPENAI_MODEL` | API 프로젝트에서 사용할 수 있는 Responses 지원 모델 ID |
| `APP_ACCESS_PASSWORD` | 무작위로 생성한 24자 이상의 소유자 비밀번호 |
| `APP_SESSION_SECRET` | 별도로 생성한 32자 이상의 무작위 서명 키 |
| `APP_ORIGIN` | 실제 사이트 origin. 예: `https://my-project.vercel.app` (끝에 `/` 없음) |

두 비밀 값을 각각 생성하려면 본인 PC에서 아래 명령을 두 번 실행한다. 출력은 Vercel 비밀 설정에만 붙여 넣고 문서/채팅/Git에 저장하지 않는다.

```bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Preview와 Production 환경변수는 각각 관리한다. Preview는 그 환경에서 실제 사용하는 origin을 정확히 설정해야 한다. 환경변수 변경 후 다시 배포한다. 필요한 설정이 없으면 API는 503으로 닫히며, 무인증 상태로 API 키를 사용하지 않는다.

사이트에서 **소유자 비밀번호**로 인증하면 HttpOnly·Secure·SameSite 쿠키가 발급된다. API 키 자체는 전송하지 않는다. 별도로 Vercel Authentication 및 All Deployments 보호도 유지한다. 소유자 인증은 앱 API를 보호하며, 정적 화면 전체의 비공개 설정을 대신하지 않는다.

로그인 시도 제한은 서버 인스턴스 단위의 추가 방어다. 전체 Vercel 인스턴스에 걸친 전역 제한은 아니므로 플랫폼 접근 보호·요청 제한과 제공자 프로젝트의 사용량 한도를 함께 설정한다. 노출 의심 시 API 키/비밀번호/서명 키를 교체한다. 서명 키 교체는 기존 앱 쿠키를 무효화한다.

로컬에서 API 키 모드를 확인할 때만 `.env.example`을 `.env.local`로 복사해 값을 채우고 `npm run dev:api`를 실행한다. `.env.local`은 반드시 Git에서 제외한다.

## Git 등록 전 검사

```bash
npm run check
git status --short
git check-ignore .env.local .vercel/project.json credentials.json
git diff --cached --stat
```

- `.env*`, `.vercel/`, private/secrets 디렉터리, 인증 JSON, 개인키 파일은 무시한다. `.env.example`만 빈 값 템플릿으로 커밋한다.
- 토큰은 기본적으로 프로젝트 밖에 있으므로 `.gitignore`에만 의존하지 않는다.
- 보안 검사 스크립트는 추적 파일과 무시되지 않은 신규 파일에서 알려진 자격 증명 패턴을 찾는다. 완전한 비밀 탐지나 이미 커밋한 키의 회수를 보장하지 않는다.
- 이미 비밀이 커밋됐다면 `.gitignore` 추가로 해결되지 않는다. 먼저 폐기/교체하고 이력을 정리한다.
- 실제 OAuth 로그인 토큰, API 키, 로컬 대화, node_modules는 배포 ZIP에 넣지 않는다.

## 검증 범위

`npm run check`는 실제 API 사용료 없이 테스트 응답으로 인증·권한·화면 정보 계약·응답 완료 판정·비밀 비노출을 검증한다. 실제 ChatGPT 로그인, 계정별 모델 접근, 실제 유료 API 호출은 사용자의 계정 승인 또는 키 등록 후 별도로 확인해야 한다. 모의 검증 결과를 실제 계정 연결 성공으로 표시하지 않는다.

## 공식 문서

- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations

2026-10-23 확인. 원격 호스팅에 대한 자격/승인과 계정별 모델·구독 권한은 변경될 수 있다.

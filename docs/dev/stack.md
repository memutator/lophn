---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---
# 기술 스택과 개발 환경

판은 처음 뼈대를 만들 때 그때의 최신 안정판으로 정하고 lockfile로 고정한다. 정한 판은 이 문서에 적는다. 판을 올리는 것은 별도 작업이다.

## 고른 것

| 영역 | 고른 것 | 비고 |
|---|---|---|
| 언어 | TypeScript strict | 모든 코드 |
| core, worker, agent runtime, 앱, CLI, MCP | Deno 2 | Deno workspace 하나 |
| shell | Electron, Node 24 LTS | `apps/shell/main`만 npm과 package-lock. 이전 lophn은 Electron 44 |
| ledger, 앱 DB, derived store | SQLite (Deno의 `node:sqlite`), WAL, FTS5 | |
| renderer, SDK UI | React, CodeMirror 6 | 이전 lophn shell과 같다 |
| 터미널 | xterm.js, node-pty(ConPTY) | |
| schema | Zod 한 가지 | contracts와 경계 검사 |
| format, lint | `deno fmt`, `deno lint` | 저장소 전체(npm 쪽 포함) |
| 테스트 | `deno test`; shell main은 `node --test`; E2E는 Playwright(Electron) | |
| secret | OS keychain | 평문 금지 |

의존성을 더할 때는 이 표나 아래 목록에 이유와 함께 적는다. 같은 일을 하는 라이브러리를 둘 들이지 않는다.

## check 명령 하나

저장소 루트의 `deno task check`가 모든 관문이다. 모든 작업은 이것을 통과해야 끝난다. skeleton slice가 이 명령을 만들기 전까지는 `deno check`, `deno test`, `node tools/check-docs.ts`를 직접 돌린다.

1. `deno fmt --check`, `deno lint`
2. `deno check` (Deno workspace 전체)
3. `deno test` (단위·통합)
4. `npm --prefix apps/shell/main run check` (tsc --noEmit, node --test)
5. `node tools/check-docs.ts`

E2E는 `deno task e2e`로 따로 돈다. slice를 끝낼 때 돈다([tasks.md](tasks.md)).

## 개발 환경

- `deno task dev`: core, agent runtime, app supervisor, shell을 개발 데이터 root(`.dev-data/`)로 함께 띄운다. 실제 `~/.lophn`을 건드리지 않는다.
- `tools/fake-provider/`: Anthropic Messages, OpenAI Responses, Chat Completions의 필요한 부분을 흉내 내는 로컬 HTTP server. `fixtures/model/`의 녹화 응답이나 script로 답한다. 테스트와 E2E는 실제 provider를 부르지 않는다.
- `fixtures/projects/`: 예시 project 폴더(Markdown 문서, 하위 폴더, 바깥에서 고친 파일 경우).
- `fixtures/apps/`: 예시 앱. 할 일 앱, 캘린더 앱(command를 다른 앱과 agent가 씀), rate limit 대시보드 앱(패널·카드), 일부러 깨지는 앱(문제 보고와 수리).
- 실제 provider로 확인할 때만 `LOPHN_LIVE_PROVIDER=1`과 사람의 계정을 쓴다. key를 저장소나 fixture에 넣지 않는다.

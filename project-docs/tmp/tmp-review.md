# 임시 리뷰 — docs 재작성과 src 구조 (2026-10-12)

docs를 새로 쓰기 전에 src 구조부터 다시 잡은 핑퐁 기록. 사람 말은 원문 그대로 둔다. lead(Claude) 해석·제안은 "lead"로 표시하고, 사람이 확인한 것만 "결정"이라 부른다.

## 1. 배경

사람(원문 그대로):

```text
진짜 제일 처음에 막 기획했어, 엄청 많은 이야기를 했고 클로드가 명세작성하고 기획하고 설계해서 작업했는데 plan도 task가 350개가 넘었어
근데 결과는 슬롭 대폭발
그래서 내가 각 잡고 기존걸 다 조졌어
그리고 지금은 각 두 세션이 자기 작업 중인데
다른 부분들도 조져야 돼
근데 그전에 리팩터링이 우선인 것 같아
일단 docs부터
```

- 두 session: CTX(`track/context`, `.dev-data/d-plan.md`)와 agent(`track/agent`, agent-review worktree의 `.dev-data/agent-plan.md`).
- 지금까지의 사람 결정은 `.dev-data/human-review.md`, `.dev-data/context-review.md`(닫힘), agent-review worktree의 `.dev-data/agent-review.md`에 있다.

## 2. 결정: docs는 고치지 않고 새로 쓴다

사람: "일단 그래서 리팩터링 수정보다는 재작성이 나을 것 같아 / 컨텍스트가 오염될 여지가 농후하기 때문에"

- 옛 `docs/`를 읽고 고치면 옛 모델·구조·요구 번호가 context에 들어와 그대로 따라온다. 예: 사람이 정한 적 없는 화면 말 "Focus"가 agent 손에 퍼진 일, agent track A1에서 제자리 고치기가 남긴 `moved_to`·옛 참조.
- 새 docs는 `project-docs/`에 쓴다. 재료는 사람이 고친 intent와 review 파일의 사람 원문 결정이다.
- lead: 새로 쓰는 worker는 옛 docs를 받지 않는다. lead가 읽은 agent-plan·agent-design에도 lead 해석과 지금 코드 사정이 섞여 있어 재료로 쓰지 않는다.

## 3. 결정: att docs에서는 규격과 형식만 가져온다

사람: "그리고 docs 규격이라든가 형식 규칙 따위들을 다시 쓸건데 ../att/docs/boundary-catlog.yaml, ../att/docs/requirements/ 에서 아무거나 한 두개 읽고 와봐" → "아니 규격과 형식만 가져올거라니까"

- 가져오는 것: `boundary-catalog.yaml`의 모양(`elements` tree는 `children` 하나로, `interfaces`는 flat 목록과 `defined_by`·`provided_by`·`used_by`, 닫힌 `kind` 목록, ID 규칙), requirements YAML의 칸(`id`·`subject`·`statement`·`acceptance` 필수, `details` 고정 키 11개, `related`), 메타 문서의 주제 카드·관심사 분할표·접점 표.
- 가져오지 않는 것: att의 내용과 운영 규칙(예: MVP 비목표를 지우지 않고 남기기, 옛 판 이행 기록).
- `project-docs/boundary-catalog.yaml`을 만들었다(요소 94·interface 12, 검사 통과). **아래 src 구조 논의로 구조가 바뀌어 다시 고쳐야 한다**(8장).

## 4. src 구조가 더럽다 — 무엇이 문제인가

사람: "근데 내가 생각해봤는데 우리 src 구조가 너무 더러워" / "apps도 7개 packages도 10개 documents가 왜 package까지 나와야하는데 problems, platfrom도 마찬가지야 apps는 뭐고 packages는 뭐야"

lead가 origin/main(f3a6eef1)에서 센 것:
- `apps/` = process entry 7개(shell, core, agent-runtime, app-supervisor, worker, cli, mcp). 규칙은 "조립만"인데 `apps/core`가 268 files(test 173)이고 `documents-*` 51, `problems-*` 24, `coding-*` 21, `ticket-*` 11, `contexts-*` 11처럼 concern 일이 쌓였다.
- `packages/` = 공용 4개(contracts, base, design, sdk) + concern마다 1개(platform, documents, apps, problems, lophn-agent, coding-agent).
- concern 축(packages)과 process 축(apps)이 교차해서 concern 하나가 여러 칸에 흩어진다. 예: documents = `packages/documents` + `contracts/documents` + `apps/core/documents-*.ts` + `apps/worker/documents` + renderer.
- 이름 `apps`가 셋으로 겹친다(실행 entry 폴더, 사용자 앱 concern, 제품 말 "앱").
- 코드 주석에 task·plan 번호(`T36`, `plan Q25` …)가 830곳.
- documents·problems·platform이 package인 이유는 옛 docs 규칙("concern 하나 = 코드 자리 하나", "최상위끼리는 contracts로만")을 import 경계로 옮긴 것뿐이다.

## 5. 다른 하네스의 src 구조 (조사)

사람: "src 구조가 마음에 안 드는데;; opencode, codex, hermes 같은 src 구조 한 번 보고와봐"

받아 둔 source는 agent-review worktree `.dev-data/agent-review/src/` (opencode d21b079, codex 8c0f701, hermes c152ba5a).

- **opencode**(package 35): package를 도메인이 아니라 층으로 나눈다. `schema`(type, 의존 없음) → `protocol`(HTTP API 정의) → `client`. 도메인 로직은 `core` 하나(749 files) 안의 module(`session/`에 compaction·revert·title 등). `server`는 core를 protocol로 여는 adapter. UI(`app`, `desktop`)는 core를 import하지 않고 client만 쓴다.
- **codex**(crate 127, Rust compile 단위라 많다): 에이전트 도메인은 `core` crate 하나. `protocol`과 `app-server-protocol`이 따로 있고 UI는 `app-server`(JSON-RPC)로만 붙는다. `<x>`와 `<x>-protocol` 짝.
- **hermes**: 반면교사. root에 `hermes_state_*.py` 40여 개, `agent/`·`hermes_cli/`·`tools/`가 flat 폴더에 prefix로 묶임 — 우리 `apps/core`와 같은 병.
- 공통점: 도메인은 core 하나 안의 module, type·API 정의는 구현과 분리, UI는 protocol·client로만, entry는 얇다, package는 실행 환경이나 쓰는 쪽이 다를 때만.

## 6. 핑퐁 기록

#### 지적: harness 안에 있어야 할 것을 밖에 뺐다
lead가 lophn-agent 아래에 `conversation/ rewind/ questions/ commands/ extensions/ instructions/ handoff/ visuals/`를 두고 `harness/`를 따로 둠 → 사람(원문 그대로): "이게 왜 하네스 바깥에 있어야하는 지 이해가 안 간다니까? codex 조사 다시하라고 rewind가 저기 있을 그게 맞아? 그러면 compact도 /compact 해서 쓰니까 harness 바깥에 있을래?"
- codex 확인: thread·turn·compact(`core/compact.rs`)·AGENTS.md(`core/agents_md.rs`)·skill·MCP·질문(`request_user_input`)·승인·agent 사이 넘기기(`InterAgentCommunication`)·agent role 모두 `core`(harness) 안. `/` 명령 목록만 UI(`tui/src/slash_command.rs`).
- lophn에서는 role 분리도 "우리 하네스 도메인"이다(agent-review §4 "조사 거리를 잘못 정함"). → **lophn-agent 자체가 harness**이고 안에 `harness/` 폴더를 따로 두지 않는다.

#### 지적: rewind의 자리
사람(원문 그대로): "아니 rewind가 왜 저기 있냐고 좀;;;;"
- codex 확인: 되돌리기(`revert_thread`)는 `thread-store`의 연산이다. 같은 자리에 create·read·list·fork·archive·unarchive·delete가 있다. → rewind는 session 연산.

#### 결정: 명령과 연산은 따로 둔다
사람(원문 그대로): "rewind, compact 이런 건 커맨드거든 ? 하네스에서 쓰는 커맨드? 이런 건 누가 맡는데 rename도 커맨드가 될 수 있고 / 근데 그렇다고 archive는 커맨드는 아니거든? 그리고 role 별로 command도 다르고" → "아니 소스코드 좀 봐 codex랑 opencode 보고 와봐"
- codex: `/` 명령은 UI enum(`tui/src/slash_command.rs`)이고 실행은 harness 호출로 바꿔 보낸다(`/compact` → `thread/compact/start` → `core/compact.rs`). harness에는 "명령" 개념이 없고 연산만 있다. 참고로 codex TUI는 `/archive`·`/delete`도 명령으로 둔다.
- opencode: built-in 명령은 UI(`app/src/session/commands/use-session-commands.tsx`, `{id, title, slash, keybind, onSelect}`)에 있고 server API를 부를 뿐이다. 구현은 `core/session/{compaction,revert}.ts`. custom 명령은 core registry(`core/src/command.ts`, `name → execute`)에 있고 session 안에서 실행된다. composer `/` 메뉴(`app/src/composer/model.ts`)가 둘을 합친다.
- lophn에 옮기면:
  - compact·rewind·fork·rename·archive·delete는 `lophn-agent/session/`의 연산이다. run-loop의 자동 compact도 같은 구현을 부른다.
  - role 명령과 skill은 `lophn-agent/commands/registry.ts`(opencode custom 명령 자리)에 등록한다. 목록은 session의 role로 거른다.
  - built-in `/` 명령 정의(어떤 연산을 `/`로 보일지 — archive는 빼고 rename은 넣는 식)와 메뉴 합치기는 renderer `agent/session/commands/`.

#### 지적: documents가 최상위일 이유가 없다
사람(원문 그대로): "근데 document는 왤케 높이 올라와있어 ? 얘가 그럴만한 놈이야?"
- 지운 것(versions·file-tracking·series·자리 없는 문서·export·terms)을 빼면 남는 것은 project 등록, 형식 판별, 링크, 검색어 검색, 그리고 contexts(182 files)뿐이다. "문서 = project 폴더의 평범한 파일"이므로 documents는 얇은 층이다.
- lead 제안: 최상위는 **projects**(앱과 나란한 자리). 그 안에 `registry/`, `files/`(읽기·형식·링크·검색), `contexts/`. "문서"는 화면 말로만 남는다.

#### 지적: coding-agent가 core에 있을 이유가 없다
사람(원문 그대로): "coding-agent는 왜 core에 있어야해?"
- 지금 `packages/coding-agent/`의 하위: tickets(앱 작업 항목, 앱 하나에 묶임) → core/apps, connection의 credential → core의 server 인증, repair-context(읽기만 해서 묶음) → core 밖, harnesses(제품 catalog·감지·판정) → core 밖, sessions(터미널 탭에 TUI 띄우기·첫 prompt adapter) → core 밖(터미널은 shell), guides(skill·hook) → core 밖, mcp-server·cli → core 밖.
- lead 제안: `packages/coding-agent/`를 core 밖 package 하나로. protocol만 쓴다. shell main의 terminal host가 `coding-agent/harnesses`로 터미널 탭에 띄운다.

#### 조사: orca, paseo (바깥 coding agent를 다루는 게 본업인 제품)
사람(원문 그대로): "서드 파티 에이전트 하네스를 다루는 게 orca, paseo 이런 애들이거든? 걔네들 좀 보고와봐 근데 차이가 있다면 우리는 그게 주가 아닌데 걔네들은 그게 주야 그래서 그건 좀 감안하고 봐야돼"

받은 source: stablyai/orca 411d5c24, getpaseo/paseo 9b92b2e (lead scratchpad, 실행 안 함).
- **paseo**: `protocol`(의존 없음) · `client` · `server`(daemon) · `app`(Expo UI) · `desktop`(Electron wrapper) · `cli` · `relay` · `plugin`. 바깥 harness는 provider로 다룬다 — 공통 `AgentClient`/`AgentSession`(`server/src/server/agent/agent-sdk-types.ts`), vendor adapter는 `server/agent/providers/`(claude Agent SDK, codex app-server, opencode, pi, omp 직접; copilot·cursor·kimi·kiro는 ACP 기반 클래스; 나머지는 plugin). 실행 파일 찾기는 daemon. tool은 transport-neutral catalog(`agent/tools/`)이고 MCP는 얇은 adapter(`mcp-server.ts`).
- **orca**: Electron 하나(main 6457 · renderer 7044 · shared 1989 files). 두 방식 — TUI(PTY에 띄우고 agent 설정에 hook을 설치해 상태를 받음, `main/agent-hooks/`, `main/agent-launch/`)와 구조화(Claude Agent SDK, Codex app-server, ACP). vendor마다 폴더(`main/claude`, `codex`, `opencode` …), 계정·사용량도 vendor별. `src/shared/`에 `agent-session-*`·`agent-status-*` prefix 파일 수백 개 — 같은 병.
- lophn에 가져올 것: core 밖 adapter, 공통 interface + vendor별 폴더(Claude Code·Codex 먼저), 터미널 탭(PTY)은 shell main, tool catalog 하나를 MCP와 CLI가 같이 쓰기. 안 가져올 것: 구조화 session, 계정·사용량, worktree, 여러 agent 지휘(본업이 아니라서).

#### 설명: api server와 통신 경로
사람: "platform은 뭐하는 애야?" / "api-server는 뭔데?" / "json-rpc 아니고 HTTP Server야?" / "그럼 저걸 통해서 사용자(데스크탑 앱) , lophn agent (harness) , lophn process ( app, document 등등) 이렇게 통신하는거야?"
- api server(`packages/platform/api/`)는 core daemon의 입구다. loopback HTTP(기본 port 7431), 모든 호출이 `POST /v1/<resource>/<method>`(JSON body → JSON 응답, JSON-RPC envelope 아님), route 400개쯤, 종류 command·read·file·upload·worker·memory. server → client는 WebSocket `/v1/events/subscribe`로 확정 event만. 부르는 쪽마다 Bearer token.
- `workspace.ts`(사람이 지금 보는 화면 relay)는 입구의 일이 아니다. lophn-agent I10("내가 지금 보는 문서와 앱 화면을 안다")을 위한 것이라 lophn-agent 쪽으로 간다.
- "document process"는 없다. projects·contexts·problems·agent 기록은 core daemon 안의 코드다. 따로 도는 process는 shell, agent-runtime, app-supervisor와 앱들, worker, 바깥 coding agent.
- 통신 경로(코드 확인):
  - 데스크탑 앱: renderer → IPC(`apps/shell/ipc`) → shell main → HTTP. 사람 token은 main 메모리에만.
  - lophn agent: HTTP(machine credential, run마다 agent credential) + core 감독 pipe(hello, blob 준비, credential).
  - 앱: core에 닿지 못하게 막혀 있고 앱마다 app-supervisor의 broker socket으로 capability를 청한다. supervisor가 HTTP + pipe로 core와 이야기한다.
  - worker: core가 종류별로 띄우고 stdin/stdout frame. 일부는 HTTP도.
  - coding agent: MCP·CLI가 HTTP. 앱 기능 호출은 `apps/connect` 뒤 core를 지나지 않고 앱 direct socket으로.

#### 생각: 공통 event를 잘 추상화해야 한다
사람(원문 그대로): "내가 좀 공통 event를 잘 추상화해야겠다는 생각을 했는데 그럼 그 책임이 저 core daemon그 api server 뭐 이런 쪽이야?"
- lead: api server가 아니다. 층이 넷이다 — 정의(protocol, 공통 envelope `{seq, actor, run, at, type, subject, payload}`와 이름 `<Entity><과거형 동사>`), 기록(상태를 바꾸는 transaction 안에서 append, seq), 배달(구독·cursor·공개 정책 — 정책 없으면 숨김), 운반(WebSocket). 받는 쪽이 바깥 client만이 아니라 알림·worker 반응기·core 안 구독자도 있으니 공통 추상화의 주인은 core의 `events/` module이고 server는 운반만. opencode도 `core/bus.ts`가 bus이고 `server/event-feed.ts`는 흘려보내기만 한다.
- 정할 것: 오래 남는 event와 흘려보내는 event(agent 답 stream 등)를 나눌지(opencode durable manifest, paseo "live는 빠르게, 기준은 fetch"), child pipe frame·앱 invocation 기록 전달을 공통 event에 넣을지.

#### 결정 방향: platform을 풀어 버린다
사람(원문 그대로): "근데 platform이 너무 애매한 거 아니야 / approvals도 harness랑 섞여 있는 것 같고 / notifiaction도 아까 말한 event 추상화의 책임 + shell/renderer 아닌가 / 굳이 core와 platform을 구분할 필요가 있어?"
- lead 확인: approvals는 harness(tool-judgment)와 앱(`apps/permissions`, `apps/core/apps-confirm.ts`)이 같이 쓰고 결정은 shell main의 확인 창이 받는다. "언제 물을지"는 묻는 쪽마다, "요청 → 확인 창 결정 → 기록 → 이어 가기" 장치는 공통 → core의 작은 `approvals/`.
- notifications는 사람 말대로 event + shell. 따로 store가 있는 이유는 Things to confirm(보류)의 지난 알림 목록뿐. toast만 남기면 "어떤 event를 toast로, [Ask <agent>]는 누구에게" 표는 renderer `notices/`, OS 알림은 shell main.
- 나머지(lead 제안):

| platform 하위 | 갈 곳 |
|---|---|
| ledger, backup-and-migration(schema migration만), blob-store | `core/storage/` |
| ledger의 event 부분 | `core/events/` |
| api, identity | `core/server/` |
| responsiveness, security | `core/supervision/` |
| settings | `core/config/` (층 병합·검증 장치, 각 domain이 항목 등록. opencode `core/config/`, codex `config` crate) |
| secrets | `core/secrets/` |
| approvals | `core/approvals/` |
| diagnostics | `core/diagnostics/` |
| notifications | `core/events` + renderer `notices/` |
| install-and-update | shell main |
| redaction | `packages/base/` (shell·cli·mcp·app-supervisor도 씀, 12자리) |

#### 결정: UI 부품은 세 층
사람: "근데 design, sdk는 왜 구분한거야" … "그러면 lophn이 깎은 그런 컴포넌트들을 사용자 앱에서 가져다 쓸 수 있는 건 맞아??" … 그리고(원문 그대로):

```text
그냥 내가 딱 원하는 것들을 말해볼게
shell에서만 쓰는 것
- 예시: model picker, project workspace 이러한 컴포넌트, 레이아웃
- 넘겨줄 필요 없음, lophn에서만 쓰고 lophn에서만 유지보수함
lophn desktop app에서 쓰지만 넘겨줘야하는 것들
- 예시 : 스크롤바, 인풋 등등의 primitive 한 컴포넌트 , page navigation, tab 이런 컴포넌트들 이나 lucide icon
- 사용자가 자신의 앱을 만들 때, 쉽게 가져다 쓰고 재사용 가능함
- lophn shell과 사용자 앱의 일관성을 갖추고 컴포넌트 구현, 유지보수 비용 절감
- 다만, 사용자가 수정 가능하게 할 지는 미정이지만 모르겠음 lophn이 안 깨지는 한에서는 가능하게 둘 것 같기도 하지만 모르겠음 근데 design token 같은 것들은 바꿀 수 있을 것 같긴하지만 lophn의 책임이 커질 것 같음
app에서 쓰는 컴포넌트들
- 예를 들어서 캘린더 앱에서 사용자가 DatePicker 컴포넌트를 만듬 가계부에서 해당 DatePicker 컴포넌트를 가져와서 쓸 수 있음
```

lead가 확인한 지금 코드:
- 앱 release는 lophn이 설치한 sdk 사본(`<data root>/sdk/<name>/<version>/`, 각 package는 design 코드까지 안에 묶은 자기 완결 byte)을 bundle 안 `sdk/<name>/<version>/`에 넣고 seal한다(파일 0444·폴더 0555, `packages/apps/releases/bundle/{lock,seal}.ts`). 앱 process는 자기 bundle 폴더만 읽는다. → lophn이 design을 고쳐도 이미 만든 앱은 안 깨지고, 앱 쪽에서 lophn의 design을 고칠 길도 없다.
- 앱은 `packages/sdk/*` 이름만 import할 수 있다(`packages/apps/sdk/install.ts`). design 부품 53개 중 40개를 sdk가 "lophn 화면과 같은 component"로 다시 내보낸다. 안 넘기는 13개는 lophn 전용 표시(AuthorMark·DiffMark·StatusMark·STATUS_ICONS), lophn 화면 틀(LauncherFrame·OverviewFrame), 날것 Table(대신 `ui-table`), 내부 장치, 그리고 이유가 안 보이는 Chip·Sheet·Tree.
- 반대 방향이 문제다: sdk에서 기능을 더한 부품(`ui-table` 정렬·page, `ui-filter`, `ui-chart`)은 shell이 sdk를 import하지 않아 lophn 화면이 못 쓴다. context Search 탭은 바로 이것으로 그리기로 했다.

세 층의 자리(lead 제안):
- 1층 lophn 전용 → `shell/renderer`. 지금 `design`에 섞인 화면별 icon 묶음·page-frames·lophn 화면 글(wording)도 이리로.
- 2층 lophn과 앱 공용 → `design` 하나(tokens · icons(lucide) · primitives · widgets). sdk의 기능 있는 부품도 design으로 내린다. 앱은 `sdk/ui.ts`로 받는다.
- 3층 앱이 만든 부품 → 아래 결정.

#### 결정: 앱이 만든 부품은 App Engineer가 사용자 컴퓨터의 sdk에 올린다
사람(원문 그대로): "사용자에게 배포된 sdk에 app engineer가 upload 하는 방식은 안 돼?" → (lead가 "새 버전은 (a) 처음 올린 앱의 App Engineer만 (b) 아무 App Engineer나"를 물음) → "b로 하고 각 앱 app engineer가 버전 보고 올릴 지 말지 결정하면 되는 거 아님?"
- 결정: App Engineer가 사용자 컴퓨터의 sdk 목록에 `@me/<이름>`으로 package를 올린다. 새 버전은 **어느 앱의 App Engineer든** 올릴 수 있다. 쓰는 쪽은 **각 앱의 App Engineer가 버전을 보고 올릴지 말지 정한다**(자동 최신 없음).
- 지금 코드에 있는 장치: `package.register_version`(지금은 lophn 설치만), 같은 이름·버전 덮어쓰기 금지와 버전 쌓기(R8·R11), 자동 최신 없음, 버전별 사용처 찾기, `@me/` 자리(지금은 등록 거절, R6).
- lead 정리(사람 확인 전):
  - 이름 칸: `@lophn/*`는 lophn 설치만, `@me/*`는 App Engineer만. lophn 업데이트는 `@me/*`를 건드리지 않는다.
  - 올릴 때 sdk 설치와 같은 검사 + 앱 release 같은 build·test. source도 같이 올려 만든 앱을 지워도 고칠 수 있게 한다.
  - 버전마다 어떤 design·sdk 버전으로 만들었는지와 바뀐 점을 남긴다(판단 재료).
  - 앱의 design 버전과 package의 design 버전이 어긋나면 앱을 만드는 단계에서 이유와 함께 실패시킨다(한 앱에 design 두 벌 금지). 고르는 것은 App Engineer.

## 7. 지금 정리된 src 구조 (lead 제안, 사람 확인 중)

```
lophn/
├── AGENTS.md
├── deno.json
├── project-docs/
├── packages/
│   ├── protocol/
│   ├── base/
│   ├── core/
│   ├── shell/
│   ├── coding-agent/
│   ├── design/
│   └── sdk/
├── e2e/
├── fixtures/
└── tools/
```

```
packages/protocol/
├── mod.ts
├── base/
│   ├── id.ts
│   ├── result.ts
│   ├── errors.ts
│   └── event.ts
├── projects/
│   ├── schema.ts
│   ├── routes.ts
│   └── events.ts
├── lophn-agent/
├── apps/
├── problems/
├── child/
│   ├── frames.ts
│   └── supervision.ts
└── client/
    ├── http.ts
    └── socket.ts

packages/base/
├── redaction/
├── markdown-outline/
├── hash.ts
└── canonical-json.ts
```

```
packages/core/
├── projects/
│   ├── register.ts
│   ├── registry/
│   ├── files/
│   │   ├── read.ts
│   │   ├── formats/
│   │   ├── links.ts
│   │   └── search.ts
│   ├── contexts/
│   │   ├── contracts/
│   │   ├── releases/
│   │   ├── search/
│   │   ├── violations/
│   │   └── glossary/
│   └── agent-tools.ts
├── apps/
│   ├── register.ts
│   ├── registration/
│   ├── blueprint/
│   ├── releases/
│   ├── preview/
│   ├── runtime/
│   ├── automations/
│   ├── data/
│   ├── invocations/
│   ├── permissions/
│   ├── connections/
│   ├── agent-state/
│   ├── tickets/
│   ├── packages/
│   └── agent-tools.ts
├── problems/
│   ├── register.ts
│   ├── reporting/
│   ├── snapshots/
│   ├── grouping/
│   ├── tests/
│   ├── repairs/
│   ├── closing/
│   └── agent-tools.ts
├── lophn-agent/
│   ├── register.ts
│   ├── session/
│   │   ├── create.ts
│   │   ├── read.ts
│   │   ├── list.ts
│   │   ├── rename.ts
│   │   ├── archive.ts
│   │   ├── delete.ts
│   │   ├── fork.ts
│   │   ├── compaction.ts
│   │   └── rewind.ts
│   ├── commands/
│   │   ├── registry.ts
│   │   └── execute.ts
│   ├── run-loop/
│   ├── prompt-assembly/
│   ├── instructions/
│   ├── skills/
│   ├── mcp/
│   ├── tools/
│   │   ├── registry.ts
│   │   ├── questions/
│   │   ├── handoff/
│   │   └── visuals/
│   ├── tool-judgment/
│   ├── current-view/
│   ├── agents/
│   ├── roles/
│   │   ├── lophn/
│   │   │   ├── prompt.md
│   │   │   ├── tool-scope.ts
│   │   │   └── commands.ts
│   │   ├── context-engineer/
│   │   ├── app-engineer/
│   │   └── operator/
│   ├── models/
│   ├── providers/
│   │   └── adapters/
│   │       ├── anthropic/
│   │       ├── openai/
│   │       └── openai-compatible/
│   └── observability/
├── approvals/
├── config/
├── secrets/
├── events/
│   ├── append.ts
│   ├── subscribe.ts
│   ├── cursor.ts
│   └── visibility.ts
├── storage/
│   ├── ledger/
│   ├── migration/
│   └── blobs/
├── server/
│   ├── routes.ts
│   ├── auth.ts
│   └── event-socket.ts
├── supervision/
├── diagnostics/
└── main/
    ├── daemon.ts
    ├── agent-runtime.ts
    ├── worker.ts
    └── app-supervisor.ts
```

```
packages/shell/
├── main/
│   ├── entry.ts
│   ├── windows/
│   ├── daemon/
│   ├── confirmation/
│   ├── terminal-host/
│   ├── update/
│   └── packaging/
├── preload/
├── ipc/
└── renderer/
    ├── entry.tsx
    ├── icons/
    ├── page-frames/
    ├── wording/
    ├── lophn-workspace/
    │   ├── launcher/
    │   ├── things-to-confirm/
    │   └── settings/
    │       ├── providers/
    │       ├── agents/
    │       └── general/
    ├── project/
    │   ├── layout/
    │   ├── sidebar/
    │   ├── rail/
    │   └── tabs/
    ├── app-space/
    │   ├── frame/
    │   ├── ops-panel/
    │   └── agent-select/
    ├── agent/
    │   ├── session/
    │   │   ├── header/
    │   │   ├── messages/
    │   │   ├── composer/
    │   │   ├── model-picker/
    │   │   ├── commands/
    │   │   │   ├── session-commands.ts
    │   │   │   └── slash-menu.ts
    │   │   └── cards/
    │   └── management/
    │       ├── agent-list/
    │       └── operator-editor/
    ├── contexts/
    │   ├── list/
    │   ├── overview/
    │   ├── search/
    │   ├── violations/
    │   ├── glossary/
    │   └── contract/
    ├── editor/
    ├── terminal/
    ├── notices/
    └── confirmation/
```

```
packages/coding-agent/
├── harnesses/
│   ├── harness.ts
│   ├── claude-code/
│   └── codex/
├── tools/
├── repair-context/
├── connection/
├── skills/
├── mcp-server/
│   └── main.ts
└── cli/
    └── main.ts

packages/design/
├── tokens/
├── icons/
├── primitives/
└── widgets/

packages/sdk/
├── blueprint/
├── capabilities/
└── ui.ts
```

규칙(lead 제안):
- package는 실행 환경이나 쓰는 쪽이 다를 때만 만든다. `protocol`은 정의만(구현 없음), `base`는 여러 package가 쓰는 순수 구현.
- 의존: `base` → 없음. `protocol` → `base`. `core` → `protocol`·`base`. `coding-agent` → `protocol`·`base`. `design` → 없음. `sdk` → `protocol`·`design`. `shell` → `protocol`·`base`·`design`, main의 terminal host만 `coding-agent/harnesses`. (2026-10-12 고침: 처음엔 "`protocol` → 없음, `base` → `protocol`"이라 적었는데 코드와 반대다. 지금 contracts가 base를 38곳 import하고 base는 아무것도 import하지 않는다.)
- shell·coding-agent·sdk는 core를 import하지 않는다.
- core 안 module끼리는 각 module의 `mod.ts`로만. `lophn-agent`는 다른 domain을 import하지 않고, 각 domain이 자기 `agent-tools.ts`로 `lophn-agent/tools/registry.ts`에 tool을 등록한다(codex `codex-extension-api`와 같은 방향).
- ledger 쓰기는 `main/daemon.ts` process만. 다른 process는 protocol로 부탁한다.
- module 안 파일 모양: `mod.ts`(공개 면), `model.ts`(순수 type·규칙), `commands.ts`(상태 바꾸기), `reads.ts`(조회), `store.ts`(ledger 표), `work.ts`(부수 효과). 필요 없는 파일은 만들지 않는다. test는 같은 폴더 `<파일>_test.ts`. 폴더·파일 이름에 task·plan 번호를 넣지 않는다.
- `lophn-agent/mcp/`는 lophn agent가 붙는 MCP server(client 쪽), `coding-agent/mcp-server/`는 lophn이 coding agent에게 여는 server.

## 8a. values.yaml

사람(원문 그대로): "다음에는 values.yaml 작성해볼건데 / 일단 형식 먼저 제안해줘" → lead가 "가치 ID 목록, values와 catalog는 서로 가리키지 않음"을 제안 → 사람: "가치를 누가 책임지는 지, 아까 boundary catalog id 하고 연결하는 거 어떻게 생각해" → lead가 `owners` 칸을 제안 → 사람: "그 형식대로 values.yaml 작성해줘"

- 결정(형식): `project-docs/values.yaml`은 여러 문서가 같이 가리키는 가치 ID 목록이다. 칸은 `id`·`statement`·`children`(values만)·`owners`. 두 층(큰 가치 → 구체 약속), `non_goals` 따로. 사람이 정하고 agent는 제안만 한다. 지켜지는지 재는 신호는 eval, 가치를 위한 요구는 requirements.
- 결정(연결): `owners`는 그 가치가 깨졌을 때 먼저 고칠 catalog 경계(1~3개, 좁게, core·actor·extension 금지). children이 있는 항목은 owners를 적지 않는다. values → catalog 한 방향. lead 근거: 옛 intent는 concern마다 파일이라 구조가 바뀌자 가치가 엉뚱한 파일에 남았다(documents I4~I6은 지금 contexts 몫). 칸으로 가리키면 owners만 고치면 된다.
- 작성(lead): 재료는 intent 8개(사람이 고친 것). intent의 "왜"를 한 문장으로 합쳐 큰 가치 8개, "무엇을 약속하나"를 그 아래 47개, "하지 않는 것"을 non_goals 14개로. 검사 통과(오류 0).
  - lophn-agent I1은 그 "왜"와 같은 문장이라 아래 항목으로 두지 않았다. documents I2(버림)는 넣지 않았다.
  - documents I4의 예시 "최근 바뀐 문서"는 일반 조건 saved view를 없앤 결정(context-review)과 부딪혀 뺐다 → "자주 보는 묶음을 저장해 두고 바로 연다."
  - 겹친 "하지 않는 것"을 합쳤다: 코드를 짜는 도구(apps·shell·coding-agent) → `no-coding-tool`, 채팅 중심(shell·lophn-agent) → `no-chat-first`, 고쳤다는 말만으로(problems·lophn-agent) → `no-fix-by-claim`. platform의 "모든 일을 결재받게 하지 않는다"는 `ask-only-serious`와 같아서 뺐다.
  - 보고서: 어떤 가치의 주인도 아닌 경계는 `protocol`, `core`, `config`, `coding-agent-mcp`, `coding-agent-cli`(바닥과 입구). `shell`이 12개로 가장 많이 맡는다.
- 지적: 사람(원문 그대로): "대체적으로는 괜찮은데 역시나 기능에 좀 초점이 맞춰진 것들이 많아 / values는 가치야 어떠한 효용을 얻는 지 혹은 어떠한 리스크/비용을 줄이는 지로 말해야해"
  - 결정: values의 statement는 사람이 얻는 효용이나 줄어드는 위험·비용으로 쓴다. 기능·화면·구현·동작 방식은 requirements와 flow 몫이다. header 3절과 5절(ID는 가치를 이름으로)에 넣었다.
  - 다시 씀(lead): 모든 statement를 효용·위험·비용으로 바꾸고, 기능 이름이던 ID를 가치 이름으로 바꿨다(아직 가리키는 문서가 없어서). 큰 가치 8·구체 약속 46·non_goals 14, 검사 통과.
    - 나눔: 옛 documents I1 → `decisions-kept`(정한 것이 사라지지 않음) + `no-lock-in`(lophn에 갇히지 않음).
    - 합침: 옛 shell I2·I4 → `everything-at-hand`(보던 것을 잃지 않음), 옛 problems I1의 증거와 I2 → `explain-problems-once`, 옛 coding-agent I2·I3 → `hand-off-without-retelling`.
    - non_goals는 하지 않는 일(범위)이라 그대로 뒀다.
- 결정: 사람(원문 그대로): "일단 values.yaml은 보류해야겠다, 어떻게 써야할 지 나도 잘 모르겠음" → values는 보류. requirements는 당분간 value ID를 가리키지 않는다.

## 8b. 결정: 문서화 보류, src 구조 리팩터링이 먼저

사람(원문 그대로): "문서화도 보류하자 그냥 일단 소스 코드 구조 리팩터링이 최우선이 맞는 거 같다"

- requirements 나누기는 제안 단계에서 멈췄다(lead 제안: 파일 하나 = catalog 요소 하나의 subtree, 크기를 보고 한 층 내려 끊기, interface 요구는 `defined_by` 요소의 파일로).
- 리팩터링의 목표 모양은 7장 src 구조와 `boundary-catalog.yaml`이다.
- 확인한 상태(2026-10-12 15:30쯤): track/context는 main에 다 들어갔다(#813). track/agent는 main과 갈라져 있다 — track/agent에만 104 commit, main에만 118 commit, 바뀐 파일 1,062개(packages/lophn-agent 380, apps/shell 228, apps/core 95, packages/contracts 89). 파일을 대거 옮기는 리팩터링은 이 차이와 정면으로 부딪힌다.
- 결정(사람이 고름): 리팩터링은 agent track이 하던 task를 마치고 main에 합쳐진 뒤, 모든 작업을 멈춘 상태에서 시작한다. 그 동안 이 session은 단계별 계획과 옮기기 script를 준비한다.
- 리팩터링 계획을 사람이 승인했다(2026-10-12). 계획 파일은 `~/.claude/plans/eventual-mixing-duckling.md`이고 요지는 다음과 같다.
  - 옮기기는 동작을 바꾸지 않는다. 지우기로 정한 기능(versions·file-tracking·series registry·backup·export 등)도 옮기기만 하고, 지우기는 그 부분을 다시 볼 때 한다.
  - 기계적인 일은 `tools/move-files.ts`(mapping YAML을 받아 `git mv`와 import·설정 경로 고치기)로 한다. 사람은 diff가 아니라 mapping 표를 본다.
  - 7장에서 고친 점:
    - 의존 방향(위 규칙 줄).
    - `core/main`은 process마다 폴더로 둔다.
    - notifications는 일단 core module로 둔다.
    - `coding-agent/connection/credential`은 coding-agent에 남긴다(cli·mcp만 쓴다).
    - `platform/install-and-update`는 core와 cli가 같이 쓰므로 파일별로 base와 core에 나눈다.
- 사람(원문 그대로): "그리고 다른 세션에서 문서화 작업을 할건데 그 세션이 알아야하는 정보를 담아서 HANDOFF.md 남겨줘 / 루트에 작성하면 돼"
  - 문서화는 다른 session이 한다. 인계는 root의 `HANDOFF.md`(commit 안 함)에 있다.
  - 이 파일의 7장은 리팩터링 session 몫이다. 문서화 session의 기록은 새 파일에 남기기를 추천했다.
  - catalog의 base/protocol 방향을 고치는 일은 문서화 session에 넘겼다.
- 사람(원문 그대로): "야 그리고 계획 수정해서 test 이름에 요구 ID 박는 거 하지말고 / src 너무 더러워진다 AGENTS.md도 수정해야하고 / sub agent (mimo v2.6 pro or mimo v2.6 flash) 워커로 구성해서 병렬로 처리되게끔 / 계획 수정해줘"
  - 결정: test 이름과 코드 주석에 요구 ID와 작업 번호를 넣지 않는다. 있는 것은 리팩터링 정리 단계에서 지운다. AGENTS.md(`docs/dev/tasks.md`·`team-brief.md`의 같은 규칙 포함)를 고친다.
  - 결정: 리팩터링의 worker는 sub agent `mimo-v2.6-pro`(판단이 필요한 일)와 `mimo-v2.6-flash`(기계적인 일)로 짜고, 겹치지 않는 범위로 나눠 병렬로 돌린다. 계획 파일에 반영했다.
- 사람: "AGENTS.md 수정은 지금 main에 넣어" → main에 넣었다(#834). 같은 규칙이 있던 `docs/dev/tasks.md`·`team-brief.md`도 함께 고쳤다.
- 사람: "agent 쪽 끝났음" → track/agent가 main에 합쳐졌다(#836). 리팩터링을 시작했다(2026-10-12).
- 사람(원문 그대로): "#529는 그냥 버리고 #711~744는 대충 내용이 뭔데 니가 판단해"
  - #529(10-10 lead 인계 문서)는 닫고 branch를 지웠다.
  - #711~#744(agent-S16a~f, 화면 spec의 뼈대와 실패하는 test)도 닫았다. I task branch의 바탕으로 쓰여 내용이 이미 main에 더 발전한 모양으로 있어서다(lead 판단).
- 사람(원문 그대로): "근데 테스트도 이번에 줄인 기능들이 너무 많아서 / 소스 코드 리팩터링 후에 테스트 코드도 요구사항 문서화 짝 한 번 하고 / 테스트 코드도 리팩터링 대규모로 할거라서 크게 신경 쓸 필요 없을 거 같은데 / 왜냐면 agent review, context review에서 덜어낸 기능들도 너무 많기도하고"
  - 결정: src 리팩터링에서는 옮기기 때문에 새로 깨진 test만 고친다. 원래 깨진 test, 지우기로 한 기능의 test, test 이름의 요구 ID 정리는 요구사항 문서화 뒤 test 리팩터링 때 한다. 제품 코드 주석의 요구 ID·작업 번호는 이번에 지운다.

## 8. 남은 것

- `project-docs/boundary-catalog.yaml`을 다시 썼다. 처음엔 7장 구조를 화면 부품·연산까지 쪼개(요소 123) 세부를 설명에 담았다 → 사람(원문 그대로): "너무 잘게 짜르긴 했어, boundary-catalog는 이 프로젝트가 추상화가 어떻게 나뉘었는가를 보기 위함인데 세부 구현을 너무 노출했어" / "그니까 굳이 세부도 설명하지 않아도 돼 / 왜냐하면 이거는 뭐랄까 여러 문서들이 공통으로 참조하는 id란 말이야 / 뭔 느낌인지 이해돼? / 이후에 다른 문서들을 작성할 거라고 각 문서 종류의 관심사에 맞게끔"
  - 결정: catalog는 여러 문서(requirements, flow, eval, products 등)가 같이 가리키는 ID 목록이다. 요소는 추상화 단위로만 두고, description은 무엇인지 한 문장. 규칙·세부 동작은 각 문서가 자기 관심사에 맞게 쓴다. header 2·3·6절에 이 규칙을 넣었다.
  - 지금 모양: 요소 35·interface 13(검사 통과). 최상위 `protocol`·`base`·`core`·`shell`·`coding-agent`·`design`·`sdk`·`app`·`user-package`와 actor 둘. `core` 아래 `projects`(`contexts`), `apps`(`app-releases`·`app-runtime`·`app-data`·`app-packages`), `problems`, `lophn-agent`(`agents`·`agent-roles`·`agent-sessions`·`run-loop`·`agent-tools`·`models`), `events`·`storage`·`server`·`supervision`·`approvals`·`config`·`secrets`. `coding-agent` 아래 `coding-agent-mcp`·`coding-agent-cli`.
  - process entry(`core/main/`)는 조립만 해서 요소로 두지 않았다. `apps/connections`는 코드 확인 결과 앱이 다른 앱 command를 부르는 연결이다(바깥 서비스 연결이 아님).
- 정할 것:
  1. 사용자가 2층(design)을 고칠 수 있게 할지 — 사람: 미정. lead 추천: lophn의 design 자체는 못 고치게, 대신 앱 안에서만 token 바꾸기와 "부품을 복사해 `@me/` package로 만들어 고치기"를 연다. lophn 화면 전체 token(테마)은 미룬다.
  2. 오래 남는 event와 흘려보내는 event를 나눌지, pipe frame·invocation 기록을 공통 event에 넣을지.
  3. ticket의 자리(`apps/tickets/`로 두었음, problems 리뷰 때 다시).
  4. Chip·Sheet·Tree를 앱에 넘길지, sdk 버전을 이름마다 따로 둘지 하나로 둘지(지금 20여 개 package, catalog, `SDK_WITHHELD_NAMES`) — apps 리뷰 때.
  5. 추측으로 채운 이름: shell `main/` 하위, Settings 구역, provider adapter 셋, coding agent harness 둘, `lophn-agent/current-view/`.
- 3층 결정 중 lead 정리 부분(이름 칸, 올릴 때 검사, source 같이 올리기, design 버전 어긋남 막기)은 사람 확인 전이다.

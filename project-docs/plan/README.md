# 리팩터링·구현 계획

상태: **착수 준비 끝** (2026-10-16). 오케스트레이터(lead session)가 `orchestrator.md`대로 돌린다. 남은 일은 5장이다.

## 0. 한눈에

목표: 지금 코드(제품 약 40만 줄, core 22만, shell 9.6만)를 spec S1~S9, inventory, wireframe대로 바꾼다.

뼈대는 **계약을 먼저 고정하고, worker 여럿이 file 소유를 나눠 병렬로 짓는 것**이다. task는 140개이고, 하나마다 worker에게 그대로 넘기는 brief가 있다.

| wave | 하는 일 | task | 바로 시작 | 가장 긴 사슬 | 열리는 조건 |
|---|---|---|---|---|---|
| 0 바닥 | 빠른 check, core 조립과 shell main 조립 쪼개기, wording 쪼개기 | 5 | 4 | 2 | 바로 |
| 1 덜어내기 | 대체 없이 없어지는 기능을 지운다 | 14 | 3 | 6 | wave 0이 모두 merge됨 |
| 2 계약 | protocol, port, shell IPC, preload, design 공용 부품을 고정한다 | 23 | 12 | 4 | wave 1이 모두 merge됨 |
| 3 구현 | backend와 화면을 짓는다. 화면은 wireframe 코드를 옮긴다 | 95 | 38 | 7 | wave 2가 모두 merge되고 계약 고정 commit이 있음 |
| 4 통합 | 청소 셋 | 3 | 1 | 3 | wave 3이 모두 merge되고 통합 확인(2.7)을 마침 |

- 동시에 도는 worker는 최대 8이다. model은 `sonnet-high`다.
- wave 3은 계약 고정 뒤라, 단위끼리 다른 단위의 구현을 기다리지 않고 port와 fake로 짓는다.

### file 안내

| file | 쓰임 |
|---|---|
| `orchestrator.md` | 오케스트레이터 절차: 고르기, worktree, worker prompt, review, merge, gate, 막힘 |
| `status.md` | task 140개의 wave, 선행, 상태. `tools/status.py`가 만든다 |
| `tasks/<id>.md` | worker에게 넘기는 brief. 꼴은 `tasks/README.md` |
| `ownership.md` | 단위마다 고칠 수 있는 path와 공용 file 규칙 |
| `assignment.md` | inventory 줄(`I…#…`, `U…#…`)을 맡은 단위 |
| `tools/` | `status.py`(상태, 띄울 task 고르기), `owned.py`(소유 밖 file 검사), `coverage.py`(빠진 줄, 겹친 소유, 꼴) |

재료:
- 무엇을 할지: `../tmp/implementation-inventory.md`(UI 밖), `../tmp/ui-inventory.md`(UI, 6장 wireframe 결정)
- 어떻게 동작할지: `../tmp/specs/`(S1~S9)
- 순서 제약: implementation-inventory 6장, ui-inventory 5장. task의 선행에 들어 있다.
- 규칙: `../dev/`(코드, code map, test, workflow)

확인(2026-10-16): `coverage.py`가 통과한다. inventory 809줄이 모두 어느 brief에 들어 있다. 같은 wave에서 소유가 겹치는 task가 없고, 선행에 순환이 없다.

## 1. 병렬로 가는 규칙

`../dev/workflow.md`를 따르고, 이 계획에서는 다음을 더한다.

1. **계약은 고정이다.** 2단계가 끝나면 protocol, port, shell IPC, design 공용 부품은 lead만 고친다.
   - worker는 바꿀 것을 보고하고, lead가 작은 commit으로 고친 뒤 영향받는 단위에 알린다.
2. **파일 소유를 나눈다.** 단위마다 "소유" 칸의 폴더와 파일만 고친다.
   - 남의 파일은 import만 한다.
   - 공용 등록 파일(아래)은 lead가 합친다.
3. **옛것과 새것이 잠시 같이 있어도 된다.**
   - 단위는 자기 영역에서 옛 계약을 그만 쓰고 지운다.
   - 여러 영역이 쓰던 옛 계약은 마지막에 4단계 청소가 지운다.
   - 호환 장치(옛 이름 읽기, 옛 경로)는 만들지 않는다.
4. **main은 늘 빠른 check가 통과한다.**
   - test를 지웠으니 통과의 뜻은 fmt, lint, deps, type check와 그 단위의 위험 test다.
   - 기능이 잠시 끊기는 것(예: 옛 확인 창을 지운 뒤 새 대기 목록이 오기 전)은 괜찮다.
5. **동시에 도는 worker는 최대 8이다.**
   - core의 type check 하나가 약 2.6GB다(이 기계 RAM 29GB). full check는 동시에 2개까지다.
   - worker의 model은 `sonnet-high`다. `mimo-v2.6-flash`는 쓰지 않는다(사람, 2026-10-16).
7. **wave는 차례로 연다.** 앞 wave가 모두 merge된 뒤 다음 wave를 연다. wave 1 덜어내기는 지운 것을 쓰던 곳을 저장소 어디서든 고치므로 다른 wave와 같이 돌지 않는다.
6. **lead가 맡는 공용 등록 파일**
   - `deno.json`과 workspace 설정
   - `packages/protocol/mod.ts`와 각 최상위 `mod.ts`의 목록(ALL_ROUTES, ALL_EVENTS)
   - core 조립 파일(0단계에서 module별 wiring 파일로 쪼갠 뒤에는 조립 목록 한 파일만)
   - wording 생성 파일(쪼갠 뒤 생성 결과)

## 2. 단계별 작업

이 장의 표는 처음 나눈 줄기다. 실제 일, 소유, 선행은 `tasks/`, `ownership.md`, `status.md`가 정한다. 둘이 다르면 그쪽을 따른다.

### 2.1 0단계: 바닥

| 작업 | 내용 | 누가 |
|---|---|---|
| test 삭제 | 끝남(commit `13a7365e`). test file 1,503개, `e2e/` 61개, test만 쓰던 helper·data 420개를 지웠다. tracked file 1,934개, 약 49.7만 줄이다. 설정(`deno.json`의 test 설정과 e2e task, shell main check script의 `node --test`·e2e·`deno test`, `happy-dom`·`playwright`·`js-tiktoken`)도 뺐다. 지운 test를 가리키는 주석 약 30곳, test만 쓰던 export와 file(fake keychain, fake quota, test credential front와 `core.ts`의 그 분기, `createLedgerTestRegistration`, harness 선택, fake provider fixture)도 치웠다 | worker(끝남) |
| 빠른 check | `../dev/testing.md` "check 파이프라인"대로 만든다. 빠른 check와 full check를 나누고, 바뀐 package만 돈다. 독립 단계는 동시에 돌고 첫 실패에서 멈춘다. `deno test --parallel`은 `DENO_JOBS` 제한을 둔다. shell main의 두 번째 check는 줄인다. test가 돌리던 구조 검사 둘을 check 단계로 옮긴다: `packages/design/style-check`(CSS 검사)와 화면 코드 wording 검사(`../dev/code.md`의 wording key 규칙). wording 검사 file(`design/wording/testing/repo-check.ts`)은 test와 함께 지웠으니 commit `d71e31d8`에서 되살린다. 지금 상태: 옛 docs를 읽던 coverage와 docs 단계는 지웠다. `deno.json` exclude에 `project-docs`가 있다. `deno task check`는 type check cache가 있으면 3초다. worktree 준비: 새 worktree에는 shell main의 `node_modules`(708MB, Electron과 node-pty rebuild)가 없어서 check가 `npm ci`부터 돈다. main checkout의 `node_modules`를 symlink로 잇는 worktree 준비 script를 둔다 | worker 1 |
| hotspot 쪼개기 | `packages/core/main/daemon/core.ts`(3,628줄)를 module별 wiring 파일로 쪼갠다(`core/main/daemon/wiring/<module>.ts`, 조립 목록 한 파일). `packages/design/wording/en.ts`(3,176줄)를 영역별 파일로 쪼개고, 생성물(`placeholders.ts`)도 영역별로 만들거나 lead만 다시 만든다. 쪼개기 전에 test가 끼우던 `CoreOptions`(`spawn`, `superviseIo`, `appRevertCaller`, `contextWorker` 등), 선언만 남은 `CoreOptions.notePrepared`, 부르는 곳이 없는 `trackedSessions`를 지운다(`runtime.notePrepared`는 blob relay가 쓴다). 위험 test가 seam을 쓰게 되면 그때 다시 만든다. task: `core-wiring-trim`, `core-wiring-split`, `wording-split` | worker |
| shell main 조립 쪼개기 | `packages/shell/main/desktop/main.ts`(1,688줄)의 IPC 등록을 영역별 wiring file로 쪼갠다. wave 3의 여러 단위가 같은 file에서 부딪치지 않게 한다. task: `shell-wiring` | worker |
| 옛 worktree와 branch | 지우기로 했다(사람, 2026-10-16). 등록된 worktree 165개와 남은 폴더, main 밖 branch 843개다. 백업은 `.git/lophn-cleanup-2026-10-16/`에 있다(main에 없는 branch 631개의 bundle, commit 안 된 변경이 있던 worktree 6곳). 지우기는 권한 분류기가 막아 사람이 돌린다 | 사람 |
| AGENTS.md | 끝남. "문서" 절과 "코드" 절이 project-docs를 가리킨다(사람 확인, 2026-10-16) | lead |

### 2.2 1단계: 덜어내기

대체 없이 없어지는 것만 지운다. 바꿔 짓는 것(handoff → call, assignment → place, 확인 창 → 대기 목록, 옛 rewind → 새 rewind, 앱 직접 통로)은 3단계의 그 단위가 지운다.

| 단위 | 지우는 것(inventory 1장과 ui-inventory 1장) | 먼저 옮길 것(implementation-inventory 6장) |
|---|---|---|
| R1 문서 옛 체계 | core `projects/{file-tracking, versions, series, addressing, formats, outline-and-search}`, protocol의 같은 부분. renderer `editor/{compare, versions, problems-gutter, link-picker}`, `workspace/tracking`, `desktop/lophn-space/{documents, series, organize}`. shell main `editor/{restore, create, place}` | `DocumentsChannel`, `createProductRedactor`(→ `base/redaction`), `formatForMediaType`, `.gitignore` 일치, `versions/guides.ts`, `exactBytes` |
| R2 보류한 platform | core `notifications`, `install-and-update`(단일 instance lock과 data root 검사는 남김), `storage/migration/{backup, backup-reads, restore}`, `main/worker/restore-entry.ts`, secret export·import. renderer `desktop/lophn-space/{things-to-confirm, settings/backup, settings/update}`, notifications panel, `notification-chip`(pill `space-decisions.tsx`는 남김). shell main `desktop/os-notification.ts`, restore IPC | notifications가 묶은 event 정의, blob GC의 backup 연결, `ledger-id.ts`의 쓰임 확인 |
| R3 앱 쪽 옛 기능 | core `apps/{automations, agent-context}`, `problems/problem-codes`와 그 쓰임(보고 `code`, SDK `cap-problem` guard). SDK `cap-schedule/screen-context.ts`. renderer `app-frame/app-detail/{automations, tasks, data}`. lophn-agent의 `series-next-tool.ts`, `tool-documents.ts`, `visuals`(앱 카드 외) | `tools/visuals/work.ts`의 `app.screen_context` 사용 정리 |

### 2.3 2단계: 계약

새 모양을 코드로 고정한다. 구현은 넣지 않고 type, schema, 상수, type-only port만 둔다.

예외 하나: design 공용 부품(K6)은 모든 화면이 쓰므로 이 단계에서 구현까지 한다. wireframe의 `chrome/`과 `vendors/` 코드를 그대로 옮긴다.

| 단위 | spec | 고정할 것 | 소유 |
|---|---|---|---|
| K1 event | S1 | domain event 10개의 union과 payload. agent event union. 남지 않는 event(`ApprovalRequested`, `AppViewChanged`, `SettingsChanged`). Gateway 구독 frame(조건, snapshot, 끊김). shell main이 renderer로 넘기는 event IPC. Reactor handler 등록 port | `protocol/events`, `protocol/server`의 구독 부분, `shell/ipc`의 event 부분, `core/events/ports.ts` |
| K2 approval | S2 | grant 셋(앱, agent, reaction)과 효과별 기본값. turn 안 권한 request와 보류 request. 결정과 결과 상태(접수, 적용, 거절, cancelled). `PermissionRequested`·`PermissionResolved` payload. Gate 입력(intent)과 판정. "이 session 동안" 허락 | `protocol/approvals`, `protocol/apps`의 grant 부분, `core/approvals/ports.ts` |
| K3a call·session·place | S3, S8 | call 봉투(`to` 셋, `reply`, `refs`, coding 실행 옵션), call 상태와 실패 이유. `agent_calls` 행. place 모델(lophn, Project Manager, App Engineer, Operator). session 상태(열림, archive, 지움), fork, session rewind의 앱 고르기. `operator.create`·`operator.update` 입력. role 이름 `project_manager` | `protocol/lophn-agent`의 call·session·place·agents 파일, `core/lophn-agent/ports.ts` |
| K3b tool·명령 | S4 | role별 tool 목록과 입력 schema(S4 4장). wire 이름 규칙(정할 것 3의 #41). 질문 tool과 `QuestionAsked`·`QuestionResolved`. 명령 목록(`recap`, `permissions`). context 글 꼴. 입력 tag 상수(`lophn-call`, `lophn-reply`, `lophn-reaction`, `lophn-notice`, `lophn-steer`, `lophn-attached`, `lophn-annotation`, `lophn-untrusted`). 내장 skill `context-init`·`context-update` 선언 | `protocol/lophn-agent`의 tool·command·question 파일 |
| K4a 앱 호출 | S5, S9 | core를 거치는 app-api 호출 route. invocation 기록(호출자 종류, project, 효과, 결과 모름). changeset과 rewind의 요청, 계획, 결과. project 범위 app-api. `cap-project` client. blueprint 칸(이름 `app-api`로, `confirm`·`revert`·`automatic_tasks`·`documents`·`agent_context`·`annotation_targets`·`problem_codes`를 뺌). 앱 view 열기에 project. annotation 값과 보내기 route, 고르기와 capture IPC | `protocol/apps`의 호출·blueprint·annotation 파일, `protocol/shell`의 app-frame 부분, `sdk/blueprint` |
| K4b release·문제 | S7 | `TicketVerified`, activation 상태와 줄. 선언 비교(늘어난 선언, migration 손실 단계). migration의 손실 선언과 PRIMARY KEY 규칙. 문제 상태(열림, 해결됨, 무시)와 재발. 제보(글, 기존 문제 고르기) | `protocol/apps`의 release 파일, `protocol/problems` |
| K5 coding | S6 | CLI 명령 목록(`hook` 포함). coding token과 principal. adapter의 순수 값(실행 계획, hook → agent event 표, turn 끝 신호 표). shell main 터미널에 여는·넣는·focus 요청. 앱별 맡기기 줄. ticket(`verify`, claim, 완료 보고, 근거 kind에 annotation) | `protocol/coding-agent`, `protocol/apps`의 ticket 파일 |
| K6 platform·UI 바닥 | S2 일부, ui-inventory 6장 | **platform 쪽**: 설정 선언 모델(type과 기본값)과 설정 파일, secret 보호 입력 IPC, 진단 상태 route. **UI 쪽(구현까지)**: `TabStrip`, design `Toast`(단추 오른쪽), `FileIcon`·`VendorIcon`과 아이콘 자료, 글 넣는 칸 focus 모양, 위쪽 바 36px와 창 단추(닫기 빨간색), palette 단추(⌘), SDK component 표시(`data-lophn-component`, annotation용) | `protocol/{config, secrets, diagnostics}`, `packages/design`, `shell/renderer/desktop/top-bar` |

끝: lead가 여덟 단위를 한꺼번에 읽고 이름과 모양을 맞춘다. 그 뒤 "계약 고정" commit을 한다.

### 2.4 wave 사이

- wave는 차례로 연다(1장 규칙 7). 처음 줄기에서는 1단계와 2단계를 같이 돌리려 했다. 그러나 덜어내기가 지운 것을 쓰던 곳을 저장소 곳곳에서 고쳐야 해서 나눴다.
- wave 사이에 lead가 할 일은 `orchestrator.md` 3.1에 있다. 예를 들어 wave 2 전에 `protocol/base/ids.ts`에 id 접두사를 더한다.

### 2.5 3단계: 구현 단위

단위마다 그 spec의 장, inventory의 덜어낼 것·고칠 것·새로 만들 것, ui-inventory의 화면 줄을 모두 다룬다. 위험 test는 `../dev/testing.md` 기준이다.

**백엔드**

| 단위 | 범위 | 소유(대략, 시작 때 lead가 파일 목록으로 확정) | 위험 test |
|---|---|---|---|
| B1 event | S1, inventory 01 | `core/events`(Bus, Reactor, Gateway), `core/storage/ledger`의 event 쓰기와 type 정리, `core/server`의 구독. 옛 `events/list`, visibility, 구독 저장, internal subscription을 지운다 | domain event가 상태와 같은 tx에 쓰인다. 꺼졌다 켜지면 Reactor가 cursor 뒤부터 잇는다. 느린 구독자는 끊기고 snapshot으로 맞춘다 |
| B2 approval | S2, 02 | `core/approvals`(Gate, grant, request), `core/apps/permissions`의 grant 부분, `core/lophn-agent/tool-judgment`(Gate로 바꿈) | approval 없이 grant가 생기지 않는다. 효과별 기본값대로 판정한다. "이 session 동안" 허락은 재시작에 남지 않는다 |
| B3 call·Router | S3, 03 | 새 Router(core), `agent_calls`, `lophn-agent/tools/handoff`를 call tool로, `lophn-agent/run-loop`의 입력함·순서·steer, `waiting-and-recovery` | 닫힌 session으로 보낸 call은 `closed`로 실패한다. 늦은 답은 받은 agent에게 돌아간다. 앱마다 coding 맡기기 줄 |
| B4a agent tool | S4 3·4장, 04 | `lophn-agent/tools`(handoff 제외), 질문 tool, file·shell·web·pdf·image tool, agent runtime의 Deno 권한 | file tool은 place 폴더 밖과 밖으로 나가는 symlink를 거절한다. web 결과만 untrusted로 감싼다 |
| B4b agent 정의 | S4 2·5·6·7장 | `lophn-agent/{prompt-assembly, roles, agents, extensions, models, providers, usage, observability}`, 내장 skill 자산 | context 글이 같은 판에서 같다. 읽을 자격 없는 context는 prompt에 없다 |
| B5 앱 호출·rewind | S5, 05 | `core/apps/{runtime, invocations, revert → rewind, connections(지움), preview, registration, blueprint, permissions/broker}`, SDK `cap-*`와 `ui-action`, shell main `app-frame`의 연결 파일(`binding`, `app-call`, `app-connection`, `app-invoke`, `app-protocol`, `blueprint-source`) | rewind가 changeset으로 DB를 되돌린다. external은 되돌리지 않는다. 결과 모르는 write는 되돌릴 수 없다고 표시한다. PRIMARY KEY 없는 표를 만드는 migration은 실패한다. sandbox 경계(옛 `fs-boundary` 모양) |
| B6 coding agent | S6, 06 | `packages/coding-agent`(`mcp-server`는 지움), `core/apps/tickets`, coding session 줄, shell main `terminal`과 `desktop/coding-*` | coding token은 앱 하나만 연다. hook CLI는 token 없이 거절된다 |
| B7 release·문제 | S7, 07 | `core/apps/{releases, data, packages}`, `core/problems` | activation이 실패하면 복구본으로 되돌리고 이전 release가 남는다. 손실을 선언하면 묻는다. 무시한 문제는 재발해도 열지 않는다 |
| B8 place·session·project·context | S8, 08, 10 | `lophn-agent/{session, assignments → place}`, `core/projects/{registry, contexts}`, 새 project 키워드 검색 | 보관한 place의 session은 새 입력을 받지 않는다. fork는 이력만 복사한다. session rewind가 앱 rewind와 이어진다. 하위 폴더는 연결 폴더 밖을 거절한다 |
| B9 platform | 11 | `core/{config, secrets, diagnostics, storage(blobs, migration 틀), supervision}`, `base`, shell main `desktop`(단일 instance, 창) | secret 파일은 0600이고 log와 오류에 값이 없다. 틀린 설정 값은 이유와 함께 거절된다 |
| B10 annotation | S9 | 새 `core/apps/annotations`, shell main app-frame의 annotate·capture 파일(새로), 앱 view preload의 고르기 script(새로) | annotation이 저장되고 ticket 근거로 이어진다 |

**화면**

wireframe 코드(`tools/wireframes/frames/`, 123 file, 약 2.8만 줄)를 그대로 옮겨 쓴다. 보고 다시 그리지 않는다(사람, 2026-10-16).
- 화면 component를 renderer로 옮긴다. gallery는 옮긴 component를 fake source로 그린다. 같은 UI 코드는 한 벌만 둔다.
- 더할 것은 셋이다.
  - 가짜 data(data file 11개)를 renderer의 source(`source.ts`, `core-source.ts`, fake source)로 바꾼다.
  - 동작(IPC, 상태, 저장)을 넣는다.
  - 박아 둔 영어 글을 wording key로 바꾼다.
- look-alike로 다시 짠 sidebar, tab strip, menu(14 file)가 옛 renderer 것을 대신한다. 옛 것은 지운다.
- backend가 오기 전에는 fake source로 짓고, backend가 merge되면 core source를 잇는다.

| 단위 | 범위 | 소유 |
|---|---|---|
| F1 data 층·대기·toast | ui-inventory 3.1, 2.1, 6.1 | renderer `desktop/connection`(event client, store, 반응 층), `overlay`, 대기 pill과 panel, shell main event 중계, secret 보호 입력 창. 옛 확인 창(renderer `confirmation`, shell main `confirmation`)은 secret 보호 입력을 떼어 낸 뒤 지운다 |
| F2 대화 | 1.2, 2.2, 3.2, 6.5 | renderer `conversation` |
| F3 project 창 | 1.3, 2.3, 3.3, 6.4(context 제외) | renderer `workspace`(contexts·agents 제외), `editor`, `terminal`, shell main `editor`(파일 읽고 쓰기), `workspace` |
| F4 context 화면 | 2.3, 3.3의 context 줄, 6.4 용어집 | renderer `workspace/contexts` |
| F5 agent 설정 | 2.3의 Agents 줄, 3.3 grant, 2.5 Settings › Agents | renderer `workspace/agents`, `desktop/lophn-space/settings/{agents, providers, extensions}` |
| F6 앱 공간 | 1.4, 2.4, 3.4, 6.6 | renderer `app-frame`, shell main `app-frame`(B5·B10 파일 제외) |
| F7 Workspace·런처 | 1.5, 2.5, 2.6, 3.5, 6.7 | renderer `desktop/{launcher, lophn-space(F5 몫 제외), palette, router.ts, main.tsx}` |

### 2.6 넣는 순서

- `tools/status.py ready`가 지금 띄울 수 있는 task를 낸다. 낮은 wave, 뒤에 기다리는 task가 많은 것 순이다.
- wave 3의 가장 긴 사슬은 7이다. 끝은 `screens-workspace-space`다. 조립 task(`screens-workspace-space`, `screens-conversation-view`, `screens-project-window`, `app-calls-assembly`, `agent-definition-register`)는 늦게 열리니 앞 task를 먼저 채운다.

통합 순서(실제로 잇는 순서): event → approval → platform → place·session → Router → agent tool·정의 → 앱 호출 → coding → release·문제 → annotation. 화면은 그 backend가 이어진 뒤 core source로 바꾼다.

### 2.7 4단계: 통합

- **조립:** lead가 merge된 단위를 core 조립 목록에 잇는다. 단위가 자기 wiring 파일을 가졌으면 목록 한 줄이다.
- **spec별 확인:** `deno task dev`로 lophn을 띄우고 spec마다 핵심 흐름을 손으로 돌린다. 화면은 `LOPHN_SHELL_HEADLESS=1`과 `LOPHN_SHELL_SHOT_DIR`로 찍어 wireframe과 견준다.

| spec | 확인할 흐름 |
|---|---|
| S1 | 사람 메시지 → turn → agent event가 화면에 온다 |
| S2 | 권한 요청 카드와 대기 목록에서 허락, 거절, 이유 |
| S3 | agent 사이 call, 답, 취소 |
| S4 | prompt 조립(context 글, place 정보), 질문 카드 |
| S5 | app-api 호출과 rewind |
| S6 | App Engineer가 Claude Code에 맡기기, hook, 완료 |
| S7 | activation과 실패 |
| S8 | archive, fork, session rewind |
| S9 | annotate → App Engineer → ticket |

- **청소:** 어디서도 쓰지 않는 옛 protocol, 옛 이름, wording key를 지운다. 4단계 worker 하나가 맡는다.
- **문서:** 동작이 바뀐 요구의 `impl` 칸과 spec의 "지금 코드" 칸을 맞춘다.
- **full check** 한 번.

E2E는 새로 만들기 전에 사람에게 묻는다(AGENTS.md). 4단계 끝에 둘지 정할 것 4로 묻는다.

## 3. 계약 단계에서 정할 것 (lead 추천)

00-decisions C(refactor 몫 58개) 가운데 계약 모양을 바꾸는 것만 골랐다. 나머지는 그 구현 단위가 정하고 보고한다.

| # | 물음 | 추천 |
|---|---|---|
| 1 | Router가 사는 process | core. 입력(사람 메시지 API, call tool, Reactor)이 모두 core에서 생긴다. agent runtime에는 지금 쓰는 감독 pipe로 넣는다 |
| 2 | agent runtime의 agent event를 core Bus로 | 감독 pipe |
| 3 | Gate를 부르는 곳 | core 한 곳. agent runtime은 Gate가 걸리는 tool(app-api, MCP, agent 부르기, 설정 고치기)을 실행하기 전에 core에 묻는다. file·shell·web은 Gate가 없다 |
| 4 | session 입력함 | 메모리. 사람 메시지는 접수할 때 session 기록에 쓴다. 기다리던 call은 재시작하면 `failed`(이유: lophn 재시작)다 |
| 5 | file·shell·web tool의 process | agent runtime. Deno 권한을 그 session의 place 폴더로 넓힌다. shell 명령은 token과 secret이 없는 환경으로 띄운다 |
| 6 | PTY에 넣는 길 | core → shell main terminal host. shell main이 Gateway로 "터미널 열기·넣기" 요청을 받아 실행한다 |
| 7 | core → 앱 process transport | 지금 supervisor 제어 pipe의 op |
| 8 | 앱 화면 byte(`/screens`) | core가 release의 UI bundle 사본을 내준다. 앱 process 직접 통로는 지운다 |
| 9 | secret 파일 process | core가 직접 읽고 쓴다(파일 0600) |
| 11 | event 구독 | shell main이 중계한다. token은 main에만 있다 |
| 12 | Gateway에 붙는 쪽 | shell main 하나(사람 token). 자격은 연결 때 본다 |
| 17 | 앱 view를 다시 그리는 신호 | 남지 않는 event `AppViewChanged{app, reason: activation, grant, rewind}` |
| 18, 23, 57 | 이름 | `run` → turn, `correction` → steer(보내기는 `next_turn`과 `steer`), `command` → app-api(blueprint JSON 칸까지). protocol과 코드에서 끝까지 바꾼다. Context Engineer → `project_manager` |
| 41 | tool 이름 철자 | 정본은 `context.get`처럼 쓰고, model에 보내는 이름은 `.`을 `_`로 바꾼다(provider API가 tool 이름에 `.`을 받지 않는다). 거꾸로 찾기는 registry 표로 한다 |
| 51 | changeset 저장 | blob store에 두고 index 행은 앱 data 쪽 표에 둔다. release마다 크기 한도를 둔다(수치는 B5) |
| 60 | coding adapter 위치 | 실행 계획, hook 변환 표, turn 끝 신호 표 같은 순수 값은 `protocol/coding-agent`에 둔다. PTY는 shell main에 둔다. 설치 감지도 shell main이 하고 core에 알린다 |
| 66, 67 | coding token과 hook | 환경 변수 `LOPHN_CODING_TOKEN`, principal `coding_agent:<session>`. `lophn hook <harness> <event>`가 stdin JSON을 받는다 |
| 69 | CLI 명령 | `ticket show / claim / renew / report`, `message send`, `release prepare`, `problem show`, `package …`, `hook`. `app list`와 `app path`는 뺀다(token이 앱 하나다) |
| 74 | coding 실행 옵션 | call 봉투의 `options`(coding 대상일 때만) |
| 75 | 손실 선언 위치 | migration 단계마다 `loss: [...]`를 SDK migration API로 선언한다 |
| 93 | 편집기의 파일 읽고 쓰기 | shell main이 직접 한다. 충돌은 내용 hash로 안다 |
| 112 | annotation의 source 위치 | release의 source map으로 푼다 |
| 117, 118 | 설정 파일 | `<data root>/settings.json`. core가 파일을 보고 바뀌면 `SettingsChanged`를 낸다. 화면 이름과 설명은 설정 key로 정한 wording key다 |

## 4. 정할 것과 볼 것

### 4.1 사람이 정할 것

답이 없으면 "기본"대로 간다. **굵은** 둘은 그 wave가 열리기 전에 답이 필요하다.

| # | 물음 | 기본 | 언제까지 |
|---|---|---|---|
| 1 | 3장의 lead 추천대로 계약을 고정할지 | 그대로 고정한다 | wave 2 전 |
| 2 | **turn 도중 model 응답 글을 화면에 흘려 보낼지.** S1 6장에는 그런 agent event가 없어서, 지금은 turn이 끝난 뒤 기록에서 읽는다 | 추천은 남지 않는 event `MessageDelta`를 더하는 것. 답이 없으면 spec대로 더하지 않는다 | **wave 2 전**(contract-events) |
| 3 | **sandbox 경계 test 하나를 subprocess로 만들지**(app-calls-supervisor). AGENTS.md상 사람 확인 대상이다 | 만든다(옛 `fs-boundary` 꼴로 한 번 띄워 표로 본다) | **wave 3 전** |
| 4 | `lophn://` 링크와 URL scheme 등록을 지울지. `--open-app`과 `--quit`는 남긴다. 결정 123~126과 답이 갈렸다 | 지운다 | wave 3 전(platform-desktop) |
| 5 | project에 slug `name`과 `title`을 둘 다 둘지 | 둘 다 둔다 | wave 2 전 |
| 6 | 편집 카드의 [Undo]와 rewind의 Redo. wireframe에는 있고 S8에는 없다 | spec대로 뺀다 | wave 3 전 |
| 7 | 앱 공간 위쪽 바의 "새 창 열기"와 "OS 앱 바로가기"를 어디에 둘지 | 뺀다 | wave 3 전 |
| 8 | place 없는 lophn session을 어느 창에서 열지 | 마지막으로 연 project 창 | wave 3 전 |
| 9 | 앱의 `secret.use` 요청 모양(I2.5#15) | 바꾸지 않는다 | wave 3 전 |
| 10 | project-docs를 저장소에 넣을지 | 넣었다(2026-10-16, 사람 결정. `tmp/`도 같이 넣고 남의 빌드 file만 뺐다). worker에게는 여전히 절대 경로를 준다 | 끝남 |
| 11 | E2E. 통합이 안정된 뒤 S6(coding 맡기기)와 S5(rewind) 둘만 만들지 | 4단계 끝에 묻는다 | wave 4 |
| 12 | git. task branch는 오케스트레이터가 main에 local로 merge하고, push는 wave 끝에 묻는다 | 그대로 | 착수 전 |

### 4.2 계약 고정 때 볼 것 (lead)

writer들이 brief를 쓰며 서로 맞춰야 한다고 적은 것이다.

- **이름과 칸**
  - `ticket.*` 입력의 칸 이름: contract-agent-tools-catalog와 contract-coding-routes가 같은가
  - call, reply, cancel 입력: contract-agent-tools-catalog가 contract-calls-places-calls의 것을 그대로 쓰는가
  - `Rewind` route 이름: session rewind와 앱 rewind가 겹치지 않는가
  - `refs`의 annotation id: contract-app-calls-annotation의 `ann` 접두사와 맞는가
  - turn id: 모두 `trn` 접두사를 쓰는가(contract-app-calls-api는 `run`을 썼다)
  - `TurnEnded.outcome`과 `turnOutcomeSchema`의 값이 같은가
  - `ALL_EVENTS`: 새 `DOMAIN_EVENTS`와 옛 정의의 이름이 겹친다. 옛것이 빠지는 대로 바꿔 끼운다.
- **lead가 맞추며 더한 것이 들어갔는가**
  - S2 8장의 창 없는 결정 handle IPC(contract-approvals)
  - Gate intent origin `app`(contract-approvals)
  - `TicketCompletionReported`와 `TicketClaimExpired`의 `session`, Gateway의 `coding_terminal` frame(contract-events)
  - `TerminalApi.onRuntime`과 runtime의 `title`, `product`(contract-coding-routes)
  - launch spec의 `net_any`(contract-platform)
  - provider와 MCP의 `credential: { secret }`(contract-agent-tools-config)
  - 사람용 file route가 없음(#93, contract-calls-places-projects)
- **writer들이 모자라다고 한 것**
  - 제보의 `existing_problem` 칸과 기존 문제 목록(contract-releases-problems-feedback)
  - `HarnessSettingsView`의 skill 설치 칸(contract-coding)
  - problems view 오류 보고의 `binding` 칸: 서명 연결을 걷으면 뺀다.
  - `placeNameReservation`: remove-documents-protocol이 지운 결과와 contract-calls-places-projects가 맞는가
  - `coding_agent_sources.diff`가 contract-releases-problems와 겹치지 않는가
- **판정이 같아야 하는 것:** approvals-app-grants의 `compareDeclarations`와 contract-releases-problems의 `ActivationComparison`

### 4.3 통합 때 볼 것

- tag escape가 두 곳에 있다(agent-definition-input-tags, annotation-core). 결과가 같아야 한다.
- annotation 보내기 port(`AnnotationDelivery`)를 router와 places-sessions 조각으로 잇는다(lead).
- `TOP_BAR_HEIGHT` 36이 shell main 창, renderer, app view overlay에서 같은가
- module(apps, problems, projects, storage)이 `main/daemon/*`를 import하는 code-map 위반이 남는다. 이번 계획은 path만 지킨다. 고치는 일은 cleanup 뒤 새 task다.

## 5. 착수 전 남은 일

1. ~~옛 worktree 165개와 branch 843개 지우기~~ 끝남(사람이 돌림, 2026-10-16).
   - `git worktree list`에는 main checkout만 있고, branch는 `main` 하나다.
   - 백업은 `.git/lophn-cleanup-2026-10-16/`에 있다. 지우기 전 branch 844개의 tip 목록(`branches.txt`), main에 없는 branch 631개의 bundle(`git bundle verify` 통과), worktree 6곳의 patch다.
   - 되살리는 법: `git fetch .git/lophn-cleanup-2026-10-16/branches.bundle 'refs/heads/<branch>:refs/heads/<branch>'`
2. 4.1의 2번과 3번에 답한다(답이 없으면 기본).
3. 오케스트레이터 session에 착수 메시지를 보낸다(사람에게 준 보고 끝에 있다).

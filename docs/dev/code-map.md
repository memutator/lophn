---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---
# code map

concern 하나는 코드 자리 하나를 가진다. 이 표가 코드 자리의 정본이다. architecture 문서의 모듈 이름과 다르면 이 표를 따르고 architecture를 고친다. 새 leaf concern이 생기면 이 표에 줄을 먼저 더한다(`node tools/check-docs.ts`가 빠진 줄을 잡는다).

## 저장소 모양

```
packages/
  protocol/       package 사이 정의(type, schema, route, command, event)와 client. protocol/base는 모두가 쓰는 정의
  base/           여러 package가 같이 쓰는 순수 구현(id, clock, Result와 오류 코드, canonical JSON, log, redaction/, install/)
  core/           core process(daemon, agent-runtime, worker, app-supervisor) 코드 전부. package 하나
    projects/ apps/ problems/ lophn-agent/             domain module
    server/ events/ storage/ supervision/ approvals/ config/ secrets/ diagnostics/ notifications/ install-and-update/
    main/{daemon,agent-runtime,worker,app-supervisor}/  process entry와 조립. 업무 규칙을 두지 않는다
    testing/                                           core test harness
  shell/          desktop app(main, preload, ipc, renderer, terminal-host)
  coding-agent/   coding agent 연결(cli, mcp-server, harnesses, ...)
  design/         lophn 화면과 사용자 앱이 같이 쓰는 UI kit(token, 컴포넌트, wording catalog)
  sdk/            사용자 앱이 import하는 입구(ui-*, cap-*, format-*, blueprint)
e2e/flows/        flow 하나에 E2E 하나: <flow 이름>_test.ts
tools/            check-docs, fake-provider 같은 개발 도구
fixtures/         예시 project 폴더, 예시 앱, 녹화한 model 응답
```

## concern → 코드 자리

| concern | 자리 |
|---|---|
| platform/ledger | packages/core/storage/ledger/ · event 구독·목록은 packages/core/events/ |
| platform/api | packages/core/server/ |
| platform/blob-store | packages/core/storage/blobs/ |
| platform/identity | packages/core/server/identity/ |
| platform/secrets | packages/core/secrets/ |
| platform/redaction | packages/base/redaction/ |
| platform/responsiveness | packages/core/supervision/responsiveness/ |
| platform/security | packages/core/supervision/security/ |
| platform/backup-and-migration | packages/core/storage/migration/ |
| platform/settings | packages/core/config/ |
| platform/diagnostics | packages/core/diagnostics/ |
| platform/approvals | packages/core/approvals/ |
| platform/notifications | packages/core/notifications/ |
| platform/install-and-update | packages/core/install-and-update/ · 공통 부분은 packages/base/install/ |
| documents/projects | packages/core/projects/registry/ |
| documents/file-tracking | packages/core/projects/file-tracking/ |
| documents/versions | packages/core/projects/versions/ |
| documents/formats | packages/core/projects/formats/ |
| documents/outline-and-search | packages/core/projects/outline-and-search/ · md outline parser는 packages/protocol/projects/outline-markdown.ts (아래 "여러 package가 같이 쓰는 순수 함수") |
| documents/series | packages/core/projects/series/ |
| documents/addressing | packages/core/projects/addressing/ |
| documents/contexts | packages/core/projects/contexts/ (세부 자리는 아래 "documents/contexts 안") · worker job packages/core/projects/contexts/worker/ |
| documents/terms | packages/core/projects/contexts/api/ (`commands-glossary*.ts`)와 ledger/ (용어집 표·command·read는 context API와 ledger adapter가 함께 한다) |
| apps/registration | packages/core/apps/registration/ |
| apps/blueprint | packages/core/apps/blueprint/ |
| apps/releases | packages/core/apps/releases/ |
| apps/runtime | packages/core/apps/runtime/ |
| apps/agent-context | packages/core/apps/agent-context/ |
| apps/connections | packages/core/apps/connections/ |
| apps/permissions | packages/core/apps/permissions/ |
| apps/automations | packages/core/apps/automations/ |
| apps/invocations | packages/core/apps/invocations/ |
| apps/data | packages/core/apps/data/ |
| apps/preview | packages/core/apps/preview/ |
| apps/sdk | packages/core/apps/packages/ (catalog, template) · packages/sdk/ (앱이 import하는 공개 SDK. cap-problem은 problems 팀, ui-*는 shell 팀이 쓴다) |
| problems/problem-codes | packages/core/problems/problem-codes/ |
| problems/reporting | packages/core/problems/reporting/ |
| problems/feedback | packages/core/problems/feedback/ |
| problems/grouping | packages/core/problems/grouping/ |
| problems/snapshots | packages/core/problems/snapshots/ |
| problems/tests | packages/core/problems/tests/ |
| problems/repairs | packages/core/problems/repairs/ |
| problems/closing | packages/core/problems/closing/ |
| lophn-agent/roles/common | packages/core/lophn-agent/roles/common/ |
| lophn-agent/roles/lophn | packages/core/lophn-agent/roles/lophn/ |
| lophn-agent/roles/app-engineer | packages/core/lophn-agent/roles/app-engineer/ |
| lophn-agent/roles/context-engineer | packages/core/lophn-agent/roles/context-engineer/ |
| lophn-agent/roles/operator | packages/core/lophn-agent/roles/operator/ |
| lophn-agent/agents | packages/core/lophn-agent/agents/ (역할별 tool 상한 `role-caps.ts` 포함) |
| lophn-agent/instructions | packages/core/lophn-agent/instructions/ |
| lophn-agent/assignments | packages/core/lophn-agent/assignments/ |
| lophn-agent/scheduling | 보류 — 코드 자리 없음. 다시 할 때 agent 정의 위에 새로 정한다 |
| lophn-agent/conversation | packages/core/lophn-agent/session/ |
| lophn-agent/handoff | packages/core/lophn-agent/tools/handoff/ |
| lophn-agent/harness/run-loop | packages/core/lophn-agent/run-loop/ |
| lophn-agent/harness/waiting-and-recovery | packages/core/lophn-agent/waiting-and-recovery/ |
| lophn-agent/harness/provider | packages/core/lophn-agent/providers/ |
| lophn-agent/harness/model | packages/core/lophn-agent/models/ |
| lophn-agent/harness/prompt-assemble | packages/core/lophn-agent/prompt-assembly/ |
| lophn-agent/harness/tools | packages/core/lophn-agent/tools/ |
| lophn-agent/harness/tool-judgment | packages/core/lophn-agent/tool-judgment/ |
| lophn-agent/harness/safety | packages/core/lophn-agent/safety/ |
| lophn-agent/harness/usage | packages/core/lophn-agent/usage/ |
| lophn-agent/questions | packages/core/lophn-agent/tools/questions/ |
| lophn-agent/revert | packages/core/lophn-agent/session/rewind/ |
| lophn-agent/visuals | packages/core/lophn-agent/tools/visuals/ |
| lophn-agent/extensions | packages/core/lophn-agent/extensions/ |
| lophn-agent/commands | packages/core/lophn-agent/commands/ |
| lophn-agent/observability | packages/core/lophn-agent/observability/ |
| lophn-agent/evaluation | packages/core/lophn-agent/evaluation/ |
| coding-agent/connection | packages/coding-agent/connection/ |
| coding-agent/harnesses | packages/coding-agent/harnesses/ |
| coding-agent/sessions | packages/coding-agent/sessions/ |
| coding-agent/mcp-server | packages/coding-agent/mcp-server/ (실행 entry는 `main.ts`) |
| coding-agent/cli | packages/coding-agent/cli/ (실행 entry는 `main.ts`) |
| coding-agent/guides | packages/coding-agent/guides/ |
| coding-agent/repair-context | packages/coding-agent/repair-context/ |
| coding-agent/tickets | packages/core/apps/tickets/ |
| shell/desktop | packages/shell/main/desktop/ · packages/shell/renderer/desktop/ · packages/shell/renderer/conversation/ (Agent component — project Agent 탭과 앱 공간이 같이 씀) |
| shell/workspace | packages/shell/main/workspace/ · packages/shell/renderer/workspace/ |
| shell/terminal | packages/shell/main/terminal/ · packages/shell/terminal-host/ · packages/shell/renderer/terminal/ |
| shell/confirmation-window | packages/shell/main/confirmation/ · packages/shell/renderer/confirmation/ |
| shell/app-frame | packages/shell/main/app-frame/ · packages/shell/renderer/app-frame/ · packages/shell/renderer/overlay/ |
| shell/editor | packages/shell/main/editor/ · packages/shell/renderer/editor/ |
| shell/wording | packages/design/wording/ (en catalog, key 타입) |
| shell/design-system | packages/design/ (token, 컴포넌트; shell renderer와 SDK UI가 함께 씀) |

process entry는 `packages/core/main/`(daemon, agent-runtime, worker, app-supervisor), `packages/shell/main/entry.ts`, `packages/coding-agent/{cli,mcp-server}/main.ts`다. worker는 kind로 일을 고르고, kind마다의 일은 그 module의 `worker/`에 있다.

## documents/contexts 안

순수 함수 묶음(IO 없음, 입력과 기대 출력을 고정한 fixture로 시험한다)과 IO를 가진 층을 나눈다. 모양은 [architecture.md](architecture.md)의 concern 모듈을 따른다. node:sqlite와 동기 file API를 쓰는 `index/`는 `mod.ts` barrel에 두지 않고, core 밖(writer·reader Worker)에서만 올리는 `ledger/deps.ts`가 `index/mod.ts`를 직접 연다.

| 자리 | 무엇 |
|---|---|
| packages/core/projects/contexts/validate/ | 계약(Bundle) 의미 검사. field·관계·선언 검색·Source를 따로 본다(`fields`, `relations`, `searches*`, `sources`). 다른 context의 type 목록(`ExternalType`)과 앱 command 효과는 환경으로 받는다 |
| packages/core/projects/contexts/extract/ | 계약(kind·field)으로 Project 파일에서 개체를 뽑는다. kind별 파일(`folder`, `docs`, `series`, `index`, `section`, `outline`, `app-data`), 파일 하나를 읽는 `document.ts`(제목은 protocol의 outline parser, frontmatter·YAML은 `@std/yaml`, [stack.md](stack.md)), field별 `fields/`(frontmatter, section-body, path-capture), 링크를 푸는 `links.ts`, 전체를 도는 `run.ts`. `app-data`는 port(`AppDataReader`)만 부른다 |
| packages/core/projects/contexts/checks/ | 개체 집합과 계약의 check 규칙에서 위반 목록을 계산한다(`run.ts`, 규칙별 `run-rules.ts`) |
| packages/core/projects/contexts/search/ | 선언 검색 실행기. inputs·where·relations·sort·page·board를 개체 집합에 적용하는 순수 함수. core의 context reader가 부른다 |
| packages/core/projects/contexts/check/ | 판 check runner. 임시 snapshot에서 계약 검증·extract·checks·예시·saved view를 돌려 결정적 report를 낸다 |
| packages/core/projects/contexts/preview/ | 만드는 중인 판(draft)을 지금 파일에 돌려 개체 수와 위반을 보기만 한다(`run.ts`). 임시 snapshot 위에서 도는 `context.preview` 일(`job.ts`)과 page 변환(`page.ts`)이 있다. index·ledger를 쓰지 않는다 |
| packages/core/projects/contexts/series/ | series kind의 pattern에서 다음 경로를 계산한다(순수) |
| packages/core/projects/contexts/api/ | context API의 순수 handler. command(`commands-*.ts`: lifecycle, bundle, views, glossary, violations), 읽기(`reads-*.ts`), 상태 모양(`state.ts`), 위반 문구(`violation-message.ts`). ledger를 모르고 `state.ts`의 모양만 본다 |
| packages/core/projects/contexts/ledger/ | context API를 core ledger 위에 올린다. ledger 표(`schema.ts`), 표별 행 읽기·쓰기(`rows*.ts`), `api/`의 handler를 `CommandDefinition`·`ReadDefinition`으로 감싸는 adapter(`adapter*.ts`: 행 적재, actor 변환, `tx.emit` 연결, 달라진 행만 쓰기), content blob 참조(`content-blobs.ts`), 상태 조회(`status.ts`), 앱에 묶인 agent의 읽기 길(`app-bound.ts`), worker 일감을 싣는 내부 read(`work-input.ts`, `work-environment.ts`). derived 개체·위반은 `ContextIndexPort`로만 읽는다 |
| packages/core/projects/contexts/index/ | context index(derived sqlite)의 표(`schema.ts`), 읽기·쓰기(`store.ts`, `scan-write.ts`), 계약 폴더의 파일을 (경로, size, mtime)으로 훑어 바뀐 것이 있으면 개체·위반을 다시 계산하는 `scan.ts`. 순수 계산은 `extract`·`checks`가 한다 |
| packages/core/projects/contexts/watch/ | 활성 context의 계약 폴더 집합(`folders.ts`), 신호를 context로 바꾸고 500ms 동안 합치는 순수 core(`detector.ts`), 얇은 `Deno.watchFs` 어댑터(`fs.ts`). 변화 이력·event를 남기지 않는다 |
| packages/core/projects/contexts/work-*.ts | worker 일 `context.index`(`work-index.ts`), `context.check`(`work-check.ts`), context별 직렬화·합치기(`work-jobs.ts`). 파일 시스템·core 제출 port는 `work-types.ts`, 시험 fake는 `work-testing.ts` |
| packages/core/projects/contexts/testdata/ | fixture Project와 정답(`expected/`). extract·checks·search·check 시험이 함께 읽는다. byte 단위로 같아야 하므로 `deno fmt`에서 뺀다(`deno.json`) |
| packages/core/projects/contexts/worker/ | worker kind `documents/contexts`의 entry. `run.ts`는 IPC 등록만 하고 일은 `work-*.ts`와 `preview/`가 한다. `files.ts`는 Project 폴더의 파일 보기와 `context.check`의 임시 snapshot(IO adapter) |
| packages/core/projects/register.ts | route 등록과 조립. app-data adapter(`packages/protocol/apps`의 read command로 port를 채운다)도 여기서 꽂는다 |
| packages/core/projects/contexts/register.ts · ledger/deps.ts | `register.ts`는 context API(ledger 표, command, read, content blob field)를 core 등록으로 묶는다. core module graph에 들어가므로 node:sqlite와 동기 file API를 쓰지 않는다. `ledger/deps.ts`는 content blob 파일, derived index 읽기 전용 연결, 선언 검색 실행기, hash, Context Engineer 판별의 실제 구현이고 writer·reader Worker 안에서만 동적으로 올린다 |
| packages/core/projects/contexts/connection.ts · watch/service.ts | `connection.ts`는 context worker를 감독으로 띄우고 index·check·preview 일을 보낸다(읽기 전 따라잡기, 중복 요청 합치기). `watch/service.ts`는 활성 context의 계약 폴더를 `Deno.watchFs`로 보고 바뀌면 그 context를 따라잡게 한다 |
| packages/core/projects/contexts/blob.ts · handoff.ts | `blob.ts`는 command 앞에서 context blob(초안 content, 위반 넘김 근거)을 준비하는 core 쪽 길. `handoff.ts`는 `context.hand_off_violations`가 Context Engineer에게 보내는 요청 글을 만드는 순수 함수 |
| packages/core/projects/contexts/testing.ts | context worker를 실제로 띄우는 core 시험이 같이 쓰는 환경 조립(제품 코드는 import하지 않는다) |

## 여러 package가 같이 쓰는 순수 함수

두 package가 같은 결정적 순수 함수를 써야 하면(예: shell editor의 Outline 탭과 `documents/contexts`가 같은 md 목차 parser를 써서 같은 입력에 같은 tree를 얻는다) 그 함수를 한 곳에 두고 `packages/protocol`로 내보낸다. shell은 core를 import할 수 없고 protocol은 import할 수 있기 때문이다.

- md outline parser: `packages/protocol/projects/outline-markdown.ts`의 `parseOutline(mediaType, text)`. 의존성·시각·무작위·IO가 없는 순수 TS이고 `packages/protocol/projects/mod.ts`로 내보낸다. [stack.md](stack.md)가 적은 blueprint 검증기(`packages/protocol/apps/blueprint.ts`)와 같은 예외다. 형식마다 parser를 붙일 자리만 두고 지금은 md만 해석한다.
- 이 예외는 함수가 순수하고 의존성이 없을 때만 쓴다. IO나 외부 라이브러리가 필요한 것은 protocol에 두지 않는다.

## 의존 규칙

package 사이:

| package | import해도 되는 것 |
|---|---|
| base | 없음 |
| protocol | base |
| core | protocol, base |
| coding-agent | protocol, base |
| design | 없음 (자기 wording 포함) |
| sdk | protocol, design |
| shell | protocol, base, design. shell main의 terminal host만 coding-agent를 더 쓸 수 있다 |

- core를 import하는 것은 core뿐이다. 다른 package의 test가 core를 띄워야 하면 그 test는 core나 `e2e/`에 둔다.
- core 안 module 사이의 목표는 셋이다. 아직 어기는 곳이 있고(옛 `apps/core` 조립 코드에서 온 약 90곳), `tools/check-deps.ts`는 검사하지 않는다. 각 domain을 다시 볼 때 고친다.
  - domain module(`projects`, `apps`, `problems`, `lophn-agent`)끼리, 그리고 바닥 module이 domain을 직접 import하지 않는다.
  - 다른 module은 그 module의 `mod.ts`로만 import한다.
  - `packages/core/main/*`는 module을 조립만 하고, module이 `main`을 import하지 않는다. 업무 규칙은 module에 둔다.
- 테스트용 core 통합 harness는 `packages/core/testing/`이고 `*_test.ts`에서만 import한다. 제품 코드는 import하지 않는다.
- module의 테스트 전용 fixture는 그 module의 `testing/mod.ts`에 둔다. 다른 module의 `*_test.ts`는 그것을 import할 수 있고, 제품 코드와 `mod.ts`는 import하지 않는다(테스트 SQLite·동기 파일 API가 core module graph에 들어가지 않게).
- 한 concern의 ledger 표는 그 concern의 코드만 읽고 쓴다. 다른 concern의 표가 필요하면 그 concern의 read contract를 쓴다.

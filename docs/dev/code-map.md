---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---
# code map

concern 하나는 코드 자리 하나를 가진다. 이 표가 코드 자리의 정본이다. architecture 문서의 모듈 이름과 다르면 이 표를 따르고 architecture를 고친다. 새 leaf concern이 생기면 이 표에 줄을 먼저 더한다(`node tools/check-docs.ts`가 빠진 줄을 잡는다).

## 저장소 모양

```
apps/                 실행 entry. 조립만 하고 업무 규칙을 두지 않는다
  shell/              Electron (main: npm, preload, renderer, terminal-host)
  core/               Deno core daemon: API, command, read, event를 조립
  agent-runtime/      lophn agent run loop 프로세스
  app-supervisor/     앱 프로세스 감독
  worker/             무거운 일(platform I/O, release, data, report 수집, test runner, coding-agent worker). kind로 고른다
  cli/                lophn CLI
  mcp/                lophn-mcp (stdio MCP server)
packages/
  contracts/mod.ts    contract 모음(다시 내보내기만)
  contracts/<최상위>/ 최상위 사이 contract(type과 schema). contracts 팀만 고친다
  base/               id, clock, Result와 오류 코드, canonical JSON, log. contracts 팀만 고친다
  design/             token, 컴포넌트, wording catalog
  sdk/                앱이 import하는 공개 SDK(ui-*, cap-*, format-*, blueprint)
  <최상위>/<leaf 경로>/  concern 하나의 코드
e2e/flows/            flow 하나에 E2E 하나: <flow 이름>_test.ts
tools/                check-docs, fake-provider 같은 개발 도구
fixtures/             예시 project 폴더, 예시 앱, 녹화한 model 응답
```

## concern → 코드 자리

| concern | 자리 |
|---|---|
| platform/ledger | packages/platform/ledger/ |
| platform/api | packages/platform/api/ |
| platform/blob-store | packages/platform/blob-store/ |
| platform/identity | packages/platform/identity/ |
| platform/secrets | packages/platform/secrets/ |
| platform/redaction | packages/platform/redaction/ |
| platform/responsiveness | packages/platform/responsiveness/ |
| platform/security | packages/platform/security/ |
| platform/backup-and-migration | packages/platform/backup-and-migration/ |
| platform/settings | packages/platform/settings/ |
| platform/diagnostics | packages/platform/diagnostics/ |
| platform/approvals | packages/platform/approvals/ |
| platform/notifications | packages/platform/notifications/ |
| platform/install-and-update | packages/platform/install-and-update/ |
| documents/projects | packages/documents/projects/ |
| documents/file-tracking | packages/documents/file-tracking/ |
| documents/versions | packages/documents/versions/ |
| documents/formats | packages/documents/formats/ |
| documents/outline-and-search | packages/documents/outline-and-search/ · md outline parser는 packages/contracts/documents/outline-markdown.ts (아래 "여러 최상위가 같이 쓰는 순수 함수") |
| documents/series | packages/documents/series/ |
| documents/addressing | packages/documents/addressing/ |
| documents/contexts | packages/documents/contexts/ (세부 자리는 아래 "documents/contexts 안") · worker job apps/worker/documents/contexts.ts·contexts-files.ts |
| documents/terms | packages/documents/contexts/api/ (`commands-glossary*.ts`)와 ledger/ (용어집 표·command·read는 context API와 ledger adapter가 함께 한다) |
| apps/registration | packages/apps/registration/ |
| apps/blueprint | packages/apps/blueprint/ |
| apps/releases | packages/apps/releases/ |
| apps/runtime | packages/apps/runtime/ |
| apps/agent-context | packages/apps/agent-context/ |
| apps/connections | packages/apps/connections/ |
| apps/permissions | packages/apps/permissions/ |
| apps/automations | packages/apps/automations/ |
| apps/invocations | packages/apps/invocations/ |
| apps/data | packages/apps/data/ |
| apps/preview | packages/apps/preview/ |
| apps/sdk | packages/apps/sdk/ (catalog) · packages/sdk/ (앱이 import하는 공개 SDK. cap-problem은 problems 팀, ui-*는 shell 팀이 쓴다) |
| problems/problem-codes | packages/problems/problem-codes/ |
| problems/reporting | packages/problems/reporting/ |
| problems/feedback | packages/problems/feedback/ |
| problems/grouping | packages/problems/grouping/ |
| problems/snapshots | packages/problems/snapshots/ |
| problems/tests | packages/problems/tests/ |
| problems/repairs | packages/problems/repairs/ |
| problems/closing | packages/problems/closing/ |
| lophn-agent/roles/common | packages/lophn-agent/roles/common/ |
| lophn-agent/roles/lophn | packages/lophn-agent/roles/lophn/ |
| lophn-agent/roles/app-engineer | packages/lophn-agent/roles/app-engineer/ |
| lophn-agent/roles/context-engineer | packages/lophn-agent/roles/context-engineer/ |
| lophn-agent/roles/operator | packages/lophn-agent/roles/operator/ |
| lophn-agent/presets | packages/lophn-agent/presets/ |
| lophn-agent/instructions | packages/lophn-agent/instructions/ |
| lophn-agent/assignments | packages/lophn-agent/assignments/ |
| lophn-agent/scheduling | packages/lophn-agent/scheduling/ |
| lophn-agent/conversation | packages/lophn-agent/conversation/ |
| lophn-agent/handoff | packages/lophn-agent/handoff/ |
| lophn-agent/harness/run-loop | packages/lophn-agent/harness/run-loop/ |
| lophn-agent/harness/waiting-and-recovery | packages/lophn-agent/harness/waiting-and-recovery/ |
| lophn-agent/harness/provider | packages/lophn-agent/harness/provider/ |
| lophn-agent/harness/model | packages/lophn-agent/harness/model/ |
| lophn-agent/harness/prompt-assemble | packages/lophn-agent/harness/prompt-assemble/ |
| lophn-agent/harness/tools | packages/lophn-agent/harness/tools/ |
| lophn-agent/harness/tool-judgment | packages/lophn-agent/harness/tool-judgment/ |
| lophn-agent/harness/safety | packages/lophn-agent/harness/safety/ |
| lophn-agent/harness/usage | packages/lophn-agent/harness/usage/ |
| lophn-agent/questions | packages/lophn-agent/questions/ |
| lophn-agent/revert | packages/lophn-agent/revert/ |
| lophn-agent/visuals | packages/lophn-agent/visuals/ |
| lophn-agent/extensions | packages/lophn-agent/extensions/ |
| lophn-agent/observability | packages/lophn-agent/observability/ |
| lophn-agent/evaluation | packages/lophn-agent/evaluation/ |
| coding-agent/connection | packages/coding-agent/connection/ |
| coding-agent/harnesses | packages/coding-agent/harnesses/ |
| coding-agent/sessions | packages/coding-agent/sessions/ |
| coding-agent/mcp-server | packages/coding-agent/mcp-server/ · 실행 entry apps/mcp/ |
| coding-agent/cli | packages/coding-agent/cli/ · 실행 entry apps/cli/ |
| coding-agent/guides | packages/coding-agent/guides/ |
| coding-agent/repair-context | packages/coding-agent/repair-context/ |
| coding-agent/tickets | packages/coding-agent/tickets/ |
| shell/desktop | apps/shell/main/desktop/ · apps/shell/renderer/desktop/ |
| shell/workspace | apps/shell/main/workspace/ · apps/shell/renderer/workspace/ |
| shell/terminal | apps/shell/main/terminal/ · apps/shell/terminal-host/ · apps/shell/renderer/terminal/ |
| shell/confirmation-window | apps/shell/main/confirmation/ · apps/shell/renderer/confirmation/ |
| shell/app-frame | apps/shell/main/app-frame/ · apps/shell/renderer/app-frame/ · apps/shell/renderer/overlay/ |
| shell/editor | apps/shell/main/editor/ · apps/shell/renderer/editor/ |
| shell/wording | packages/design/wording/ (en catalog, key 타입) |
| shell/design-system | packages/design/ (token, 컴포넌트; shell renderer와 SDK UI가 함께 씀) |

## documents/contexts 안

순수 함수 묶음(IO 없음, 입력과 기대 출력을 고정한 fixture로 시험한다)과 IO를 가진 층을 나눈다. 모양은 [architecture.md](architecture.md)의 concern 모듈을 따른다. node:sqlite와 동기 file API를 쓰는 `index/`는 `mod.ts` barrel에 두지 않고, core 밖(writer·reader Worker)에서만 올리는 `apps/core/contexts-ledger-deps.ts`가 `index/mod.ts`를 직접 연다.

| 자리 | 무엇 |
|---|---|
| packages/documents/contexts/validate/ | 계약(Bundle) 의미 검사. field·관계·선언 검색·Source를 따로 본다(`fields`, `relations`, `searches*`, `sources`). 다른 context의 type 목록(`ExternalType`)과 앱 command 효과는 환경으로 받는다 |
| packages/documents/contexts/extract/ | 계약(kind·field)으로 Project 파일에서 개체를 뽑는다. kind별 파일(`folder`, `docs`, `series`, `index`, `section`, `outline`, `app-data`), 파일 하나를 읽는 `document.ts`(제목은 contracts의 outline parser, frontmatter·YAML은 `@std/yaml`, [stack.md](stack.md)), field별 `fields/`(frontmatter, section-body, path-capture), 링크를 푸는 `links.ts`, 전체를 도는 `run.ts`. `app-data`는 port(`AppDataReader`)만 부른다 |
| packages/documents/contexts/checks/ | 개체 집합과 계약의 check 규칙에서 위반 목록을 계산한다(`run.ts`, 규칙별 `run-rules.ts`) |
| packages/documents/contexts/search/ | 선언 검색 실행기. inputs·where·relations·sort·page·board를 개체 집합에 적용하는 순수 함수. core의 context reader가 부른다 |
| packages/documents/contexts/check/ | 판 check runner. 임시 snapshot에서 계약 검증·extract·checks·예시·saved view를 돌려 결정적 report를 낸다 |
| packages/documents/contexts/preview/ | 만드는 중인 판(draft)을 지금 파일에 돌려 개체 수와 위반을 보기만 한다(`run.ts`). 임시 snapshot 위에서 도는 `context.preview` 일(`job.ts`)과 page 변환(`page.ts`)이 있다. index·ledger를 쓰지 않는다 |
| packages/documents/contexts/series/ | series kind의 pattern에서 다음 경로를 계산한다(순수) |
| packages/documents/contexts/api/ | context API의 순수 handler. command(`commands-*.ts`: lifecycle, bundle, views, glossary, violations), 읽기(`reads-*.ts`), 상태 모양(`state.ts`), 위반 문구(`violation-message.ts`). ledger를 모르고 `state.ts`의 모양만 본다 |
| packages/documents/contexts/ledger/ | context API를 platform ledger 위에 올린다. ledger 표(`schema.ts`), 표별 행 읽기·쓰기(`rows*.ts`), `api/`의 handler를 `CommandDefinition`·`ReadDefinition`으로 감싸는 adapter(`adapter*.ts`: 행 적재, actor 변환, `tx.emit` 연결, 달라진 행만 쓰기), content blob 참조(`content-blobs.ts`), 상태 조회(`status.ts`), 앱에 묶인 agent의 읽기 길(`app-bound.ts`), worker 일감을 싣는 내부 read(`work-input.ts`, `work-environment.ts`). derived 개체·위반은 `ContextIndexPort`로만 읽는다 |
| packages/documents/contexts/index/ | context index(derived sqlite)의 표(`schema.ts`), 읽기·쓰기(`store.ts`, `scan-write.ts`), 계약 폴더의 파일을 (경로, size, mtime)으로 훑어 바뀐 것이 있으면 개체·위반을 다시 계산하는 `scan.ts`. 순수 계산은 `extract`·`checks`가 한다 |
| packages/documents/contexts/watch/ | 활성 context의 계약 폴더 집합(`folders.ts`), 신호를 context로 바꾸고 500ms 동안 합치는 순수 core(`detector.ts`), 얇은 `Deno.watchFs` 어댑터(`fs.ts`). 변화 이력·event를 남기지 않는다 |
| packages/documents/contexts/work-*.ts | worker 일 `context.index`(`work-index.ts`), `context.check`(`work-check.ts`), context별 직렬화·합치기(`work-jobs.ts`). 파일 시스템·core 제출 port는 `work-types.ts`, 시험 fake는 `work-testing.ts` |
| packages/documents/contexts/testdata/ | fixture Project와 정답(`expected/`). extract·checks·search·check 시험이 함께 읽는다. byte 단위로 같아야 하므로 `deno fmt`에서 뺀다(`deno.json`) |
| apps/worker/documents/contexts.ts · contexts-files.ts | worker kind `documents/contexts`의 entry. `contexts.ts`는 IPC 등록만 하고 일은 `work-*.ts`와 `preview/`가 한다. `contexts-files.ts`는 Project 폴더의 파일 보기와 `context.check`의 임시 snapshot(IO adapter) |
| apps/core/documents.ts | route 등록과 팀 조립. app-data adapter(`packages/contracts/apps`의 read command로 port를 채운다)도 여기서 꽂는다 |
| apps/core/contexts-api.ts · contexts-ledger-deps.ts | `contexts-api.ts`는 context API(ledger 표, command, read, content blob field)를 core 등록으로 묶는다. core module graph에 들어가므로 node:sqlite와 동기 file API를 쓰지 않는다. `contexts-ledger-deps.ts`는 content blob 파일, derived index 읽기 전용 연결, 선언 검색 실행기, hash, Context Engineer 판별의 실제 구현이고 writer·reader Worker 안에서만 동적으로 올린다 |
| apps/core/contexts-worker.ts · contexts-watch.ts | `contexts-worker.ts`는 context worker를 감독으로 띄우고 index·check·preview 일을 보낸다(읽기 전 따라잡기, 중복 요청 합치기). `contexts-watch.ts`는 활성 context의 계약 폴더를 `Deno.watchFs`로 보고 바뀌면 그 context를 따라잡게 한다 |
| apps/core/contexts-blob.ts · contexts-handoff.ts | `contexts-blob.ts`는 command 앞에서 context blob(초안 content, 위반 넘김 근거)을 준비하는 core 쪽 길. `contexts-handoff.ts`는 `context.hand_off_violations`가 Context Engineer에게 보내는 요청 글을 만드는 순수 함수 |
| apps/core/contexts-testing.ts | context worker를 실제로 띄우는 core 시험이 같이 쓰는 환경 조립(제품 코드는 import하지 않는다) |

## 여러 최상위가 같이 쓰는 순수 함수

최상위 사이는 `packages/contracts`로만 부른다. 두 최상위가 같은 결정적 순수 함수를 써야 하면(예: shell editor의 Outline 탭과 `documents/contexts`가 같은 md 목차 parser를 써서 같은 입력에 같은 tree를 얻는다) 그 함수를 한 곳에 두고 contracts로 내보낸다. shell은 contracts·design·sdk만 import할 수 있고 documents는 자기 최상위의 contracts를 import할 수 있기 때문이다.

- md outline parser: `packages/contracts/documents/outline-markdown.ts`의 `parseOutline(mediaType, text)`. 의존성·시각·무작위·IO가 없는 순수 TS이고 `packages/contracts/documents/mod.ts`로 내보낸다. [stack.md](stack.md)가 적은 blueprint 검증기(`packages/contracts/apps/blueprint.ts`)와 같은 예외다. 형식마다 parser를 붙일 자리만 두고 지금은 md만 해석한다.
- 이 예외는 함수가 순수하고 의존성이 없을 때만 쓴다. IO나 외부 라이브러리가 필요한 것은 contracts에 두지 않는다.

## 의존 규칙

- `packages/<최상위>/...`는 자기 최상위 안의 다른 leaf를 그 leaf의 `mod.ts`로만 import한다. 다른 최상위는 `packages/contracts/<그 최상위>/`로만 부른다.
- `packages/base`는 다른 어떤 package도 import하지 않는다. `packages/contracts`는 `packages/base`만 import한다.
- `apps/shell`은 core package를 import하지 않는다. contracts, design, sdk만 쓴다.
- `apps/*` entry는 package를 조립만 한다. 업무 규칙은 package에 둔다.
- 다른 팀의 테스트는 `apps/core/testing/`(platform이 만드는 통합 테스트 harness)를 `*_test.ts`에서만 import할 수 있다. 제품 코드는 import하지 않는다.
- leaf의 테스트 전용 fixture는 그 leaf의 `testing/mod.ts`에 둔다. 다른 leaf의 `*_test.ts`는 그것을 import할 수 있고, 제품 코드와 `mod.ts`는 import하지 않는다(테스트 SQLite·동기 파일 API가 core module graph에 들어가지 않게).
- 여러 팀이 같은 entry에 붙는 곳(`apps/core`의 route, `apps/worker`의 kind)은 platform 팀이 registry를 만들고, 각 팀은 자기 등록 파일(`apps/core/<팀>.ts`, `apps/worker/<팀>/`)만 고친다.
- 한 concern의 ledger 표는 그 concern의 코드만 읽고 쓴다. 다른 concern의 표가 필요하면 그 concern의 read contract를 쓴다.

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
| documents/contexts | packages/documents/contexts/ (세부 자리는 아래 "documents/contexts 안") · worker job apps/worker/documents/contexts.ts |
| documents/terms | packages/documents/terms/ |
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
| lophn-agent/commands | packages/lophn-agent/commands/ |
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
| shell/desktop | apps/shell/main/desktop/ · apps/shell/renderer/desktop/ · apps/shell/renderer/conversation/ (Agent component — project Agent 탭과 앱 공간이 같이 씀) |
| shell/workspace | apps/shell/main/workspace/ · apps/shell/renderer/workspace/ |
| shell/terminal | apps/shell/main/terminal/ · apps/shell/terminal-host/ · apps/shell/renderer/terminal/ |
| shell/confirmation-window | apps/shell/main/confirmation/ · apps/shell/renderer/confirmation/ |
| shell/app-frame | apps/shell/main/app-frame/ · apps/shell/renderer/app-frame/ · apps/shell/renderer/overlay/ |
| shell/editor | apps/shell/main/editor/ · apps/shell/renderer/editor/ |
| shell/wording | packages/design/wording/ (en catalog, key 타입) |
| shell/design-system | packages/design/ (token, 컴포넌트; shell renderer와 SDK UI가 함께 씀) |

## documents/contexts 안

순수 함수 묶음(IO 없음, 입력과 기대 출력을 고정한 fixture로 시험한다)과 IO를 가진 층을 나눈다. 모양은 [architecture.md](architecture.md)의 concern 모듈을 따르고, 아래 폴더는 `commands.ts`·`reads.ts`·`work.ts` 옆에 둔다.

| 자리 | 무엇 |
|---|---|
| packages/documents/contexts/extract/ | 계약(kind·field)으로 Project 파일에서 개체를 뽑는다. kind별 파일(`folder`, `docs`, `series`, `index`, `section`, `outline`, `app-data`), field별 `fields/`(frontmatter, yaml-key, section-body, path-capture, title, links), 전체를 도는 `run.ts`. YAML은 `@std/yaml`([stack.md](stack.md)). `outline`·`section`은 contracts의 outline parser를 부른다. `app-data`는 port(`AppDataReader`)만 부른다 |
| packages/documents/contexts/checks/ | 개체 집합과 계약의 check 규칙에서 위반 목록을 계산한다(`run.ts`) |
| packages/documents/contexts/search/ | 선언 검색 실행기. inputs·where·relations·sort·page·board를 개체 집합에 적용하는 순수 함수. core의 context reader가 부른다 |
| packages/documents/contexts/check/ | 판 check runner. 임시 snapshot에서 계약 검증·extract·checks·예시·saved view를 돌려 결정적 report를 낸다 |
| packages/documents/contexts/series/ | series kind의 pattern에서 다음 경로를 계산한다(순수) |
| packages/documents/contexts/testdata/ | fixture Project와 정답(`expected/`). extract·checks·search·check 시험이 함께 읽는다 |
| packages/documents/contexts/work.ts · adapters/ | `context.index`·`context.check`의 일(stat scan, snapshot 복사, derived sqlite 읽기·쓰기). 순수 폴더를 부른다 |
| apps/worker/documents/contexts.ts | worker kind `documents/contexts`의 entry. 등록만 하고 일은 `work.ts`가 한다 |
| apps/core/documents.ts | route 등록, context reader, app-data adapter(`packages/contracts/apps`의 read command로 port를 채운다) 조립 |

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

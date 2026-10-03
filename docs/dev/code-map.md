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
  contracts/<최상위>/ 최상위 사이 contract(type과 schema). integrator만 고친다
  base/               id, clock, Result와 오류 코드, canonical JSON, log. integrator만 고친다
  design/             token, 컴포넌트, wording catalog
  sdk/                앱이 import하는 공개 SDK(ui-*, cap-*, format-*, blueprint)
  <최상위>/<leaf 경로>/  concern 하나의 코드
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
| documents/outline-and-search | packages/documents/outline-and-search/ |
| documents/series | packages/documents/series/ |
| documents/addressing | packages/documents/addressing/ |
| documents/contexts | packages/documents/contexts/ |
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
| apps/sdk | packages/apps/sdk/ (catalog) · packages/sdk/ (앱이 import하는 공개 SDK) |
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

## 의존 규칙

- `packages/<최상위>/...`는 자기 최상위 안의 다른 leaf를 그 leaf의 `mod.ts`로만 import한다. 다른 최상위는 `packages/contracts/<그 최상위>/`로만 부른다.
- `packages/contracts`와 `packages/base`는 다른 어떤 package도 import하지 않는다.
- `apps/shell`은 core package를 import하지 않는다. contracts, design, sdk만 쓴다.
- `apps/*` entry는 package를 조립만 한다. 업무 규칙은 package에 둔다.
- 한 concern의 ledger 표는 그 concern의 코드만 읽고 쓴다. 다른 concern의 표가 필요하면 그 concern의 read contract를 쓴다.

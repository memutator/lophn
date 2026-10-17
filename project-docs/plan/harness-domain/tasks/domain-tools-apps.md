# domain-tools-apps

apps 쪽 agent tool(ticket, app, package, release, visual)을 `packages/core/apps`로, problem tool을 `packages/core/problems`로 옮긴다. 둘을 한 task로 합친 이유: problem bundle이 79줄, tool 셋이라 따로 task를 열기엔 너무 작고, 옮기는 일이 똑같다(둘 다 `defineTool`과 protocol route만 쓰는 file을 module 안으로 옮기고 `main/agent-tools.ts`의 import 경로를 고친다).

- 단위: domain-tools (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/bundles/{ticket,app,package,release,visual,problem}.ts`
  - `packages/core/lophn-agent/tools/domain/app-card.ts`
  - `packages/core/apps/agent-tools/`
  - `packages/core/problems/agent-tools.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/layers.md`("규칙과 그 이유", "실행 때 import가 뜻하는 것", "harness와 lophn domain")
  - roadmap: `project-docs/products/roadmap/harness-domain-split.md`("domain tool은 port가 아니라 core route를 부른다", "단계" 2번)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tool-spi`, `apps`, `problems`, `project-docs/module-catalog.yaml`의 `packages/core/apps`, `packages/core/problems`
- 계약:
  - 쓰는 것: `packages/core/lophn-agent/tools/spi.ts`(`defineTool`, `readOf`, `commandOf`, `fitted`, `readBody`, `countSummary`, `notFound`, `invalid`…)와 protocol. 새로 harness에 기대지 않는다.
  - 내놓는 것: `packages/core/apps/agent-tools/mod.ts`가 `APPS_AGENT_TOOLS: readonly ToolDefinition[]`(ticket 6, app 5, package 3, release 2, visual 1 = 17개), `packages/core/problems/agent-tools.ts`가 `PROBLEMS_AGENT_TOOLS`(3개). tool 이름, 설명, 입력, 순서는 그대로다. `main/agent-tools.ts`가 두 목록을 import한다.

## 할 일

근거: README "정한 것" 1(domain은 `<domain>/agent-tools` 하나에서 tool 목록을 낸다. 이 file은 protocol과 harness의 tool type만 import한다), roadmap "단계" 2번.

1. `tools/move-files.ts`로 옮긴다(`--dry-run --report` 먼저. mapping은 commit하지 않는다).
   - `lophn-agent/tools/bundles/ticket.ts` → `core/apps/agent-tools/ticket.ts`, `app.ts` → `app.ts`, `package.ts` → `package.ts`, `release.ts` → `release.ts`, `visual.ts` → `visual.ts`
   - `lophn-agent/tools/domain/app-card.ts` → `core/apps/agent-tools/app-card.ts`
   - `lophn-agent/tools/bundles/problem.ts` → `core/problems/agent-tools.ts`
2. `core/apps/agent-tools/mod.ts`를 만들어 다섯 목록을 `APPS_AGENT_TOOLS`로 이어 붙인다(순서는 옛 `main/agent-tools.ts`가 이어 붙이던 순서와 상관없다. 최종 순서는 `main/agent-tools.ts`가 `TOOL_ORDER`로 정렬한다). `problems/agent-tools.ts`는 `PROBLEMS_AGENT_TOOLS`로 이름을 바꿔 내보낸다.
3. 옮긴 file의 import를 정리한다. 허용: `packages/base`, `packages/protocol`, `zod`, `node:path`(app.ts가 쓴다), `packages/core/lophn-agent/tools/spi.ts`(와 type 하나가 필요하면 `tools/registry.ts`, `tools/tool-context.ts`). 금지: apps·problems의 store, sqlite, ledger, `core/storage`. 허용 목록 밖 import가 남으면 file:line을 "넘길 줄"에 적는다. (이전 task가 `spi.ts`로 모았으므로 없어야 한다.)
4. `main/agent-tools.ts`가 `ticket.ts` 등을 import하던 줄을 `APPS_AGENT_TOOLS`, `PROBLEMS_AGENT_TOOLS` 두 줄로 바꾼다. 소유 목록 밖 file이지만 이 import 줄만 고친다(공용 등록 file, lead가 rebase에서 두 쪽을 합친다).
5. `app.link_source`가 쓰는 `ctx.scope.read[0]`(app.ts)는 그대로 둔다. `ToolContext.scope`는 harness 칸이다.

## 끝남

- `deno task check`가 통과한다.
- 동작 비교: 시작 전에 `packages/core/.tmp-probe/dump.ts`(이전 task들이 쓴 것과 같은 script. 없으면 `listRoleTools`·`selectTools`로 role 4개 × model 입력 둘의 `{name, description, JSON schema}` 목록을 순서대로 JSON으로 찍는 것)로 before를 뜨고 끝에 after와 `diff`가 없다. 끝낼 때 script를 지운다. `main/agent-tools_test.ts`와 `tools/registry_test.ts`가 통과한다.
- 위험 test: 없음 (옮기기뿐이다. 목록 일치는 `main/agent-tools_test.ts`가 본다)
- 남지 않음:
  - `ls packages/core/lophn-agent/tools/bundles/`에 `ticket.ts app.ts package.ts release.ts visual.ts problem.ts`가 없다.
  - `packages/core/lophn-agent/tools/domain/app-card.ts`가 없다.
  - `grep -rnE "from \"[^\"]*(store|sqlite|ledger|storage)[^\"]*\"" packages/core/apps/agent-tools packages/core/problems/agent-tools.ts`가 0줄이다.
  - `grep -rnE "lophn-agent/(run-loop|prompt-assembly|roles|agents)" packages/core/apps/agent-tools packages/core/problems/agent-tools.ts`가 0줄이다.

## 지켜야 할 것(계획 README)

- 동작을 바꾸지 않는다. agent가 보는 tool 목록과 입력이 role마다 나누기 전과 같아야 한다(`tools/registry_test.ts`가 role별 목록을 본다).
- tool 정의 file은 agent runtime child에서 실린다. domain의 store나 DB 코드를 import하지 않는다(`layers.md` "실행 때 import가 뜻하는 것").
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `main/agent-tools.ts`의 import 두 줄(이 task가 고친 것). module-catalog·boundary-catalog의 `agent-tool-spi`는 lead
- 안 쓰게 된 export: 없음
- 정한 것: `apps/agent-tools/`를 폴더로 한 이유(file 5개를 합치지 않고 옮겨 diff를 작게)
- 넘길 줄: `main/agent-tools.ts` import 줄. 3번에서 못 지운 import
- 계약 바꾸기 요청: 없음이 기본
- **무겁게 짠 것**: 없음이 기본. 있으면 `무엇 / 왜 / 줄인다면 / 어디`
- **알려진 미완 동작**: 없음이 기본. 동적 app-api tool(`tools/app-tools.ts`, `app-toolkit.ts`, `tools/app-api/`)은 이 계획 범위 밖이라 harness에 남는다(`protocol/apps` import가 남는다)고 적는다

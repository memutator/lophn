# contract-app-calls-blueprint

blueprint를 새 모양으로 고정한다: command 칸을 `app_api`로 바꾸고, `confirm`·`revert`·`automatic_tasks`·`documents`·`agent_context`·`problem_codes`를 빼고, app-api마다 project 범위를 선언하게 한다. 새 검증기는 `protocol/apps/blueprint/` 폴더에 옛 파일 옆에 두고, 공개 SDK `sdk/blueprint`만 새것으로 바꾼다.

- 단위: contract-app-calls (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/blueprint/` (새 폴더)
  - `packages/sdk/blueprint/` (`mod.ts`, `define.ts`, `guide.md`, `judge.ts` 지움)
- 읽을 것:
  - spec: S5 3·9장, S2 3장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`, `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`): `I1.5#20`, `I2.5#16`, `I2.5#17`. 문맥으로 `I1.5#9`(`revert`·`confirm` 칸), `I1.5#11`(automation), `I1.5#12`(agent-context), `I2.5#18`(이름)
  - 결정: `/home/pyosechang/projects/lophn/project-docs/plan/README.md` 3장 #18(command → app-api, blueprint JSON 칸까지)
  - 지금 코드: `packages/protocol/apps/blueprint*.ts`(types, schema, json, scope, commands, uses, value, read), `packages/sdk/blueprint/`
- 계약:
  - 쓰는 것: 없음. 새 폴더는 옛 `blueprint-*.ts`처럼 zod·Deno·IO 없이 순수하다(`core/apps/blueprint/extract-child.ts`가 권한 없는 자식에서 읽는다). route 정의(`blueprint/read.ts`)만 zod를 쓴다.
  - 내놓는 것: `Blueprint`(새 모양), `AppApiDeclaration`, `validateBlueprint`, `validateInput`, `canonicalInputHash`, `canonicalJson`, 읽기 route `appAppApi`. wave 3에서 app-calls-assembly, app-calls-shell(`ui-action`, `blueprint-source`), releases-problems(release 준비, template), agent-tools, coding-agent가 이 폴더로 옮겨 간다.

## 할 일

새 폴더 `packages/protocol/apps/blueprint/`를 옛 `blueprint-*.ts`를 옮겨 적는 것으로 만든다. 옛 파일은 그대로 둔다(쓰는 곳이 남아 있다). 새 폴더는 `protocol/apps/mod.ts`로 내보내지 않는다(옛 이름과 겹친다). 옮겨 쓰는 곳은 폴더의 `mod.ts`를 직접 import한다.

1. `types.ts` — 옛 `blueprint-types.ts`에서 아래를 바꾼다.
   - `Blueprint` = `{name, description, screens, app_api, permissions, app_connections, sdk_dependencies}`. 빠지는 칸: `commands`(이름이 `app_api`로), `automatic_tasks`, `problem_codes`, `documents`, `agent_context` (`I1.5#20`, `I2.5#17`).
   - `AppApiDeclaration` = `{key, label, description, effect, input, project_scope: boolean}`. `confirm`과 `revert`가 없다. `project_scope`는 필수 boolean이다(S5 4장: project 범위 app-api).
   - `AppApiUseDeclaration` = `{app, app_api: string[], reason}` (옛 `AppCommandUseDeclaration`의 `commands`가 `app_api`로). `app_connections` 칸 이름은 그대로 둔다.
   - 지우는 type: `CommandRevertDeclaration`, `AutomationDeclaration`, `AutomationWhen`, `DocumentDeclaration`, `FormatRef`, `AgentContextDeclaration`, `AnnotationTargetDeclaration`, `ProblemCodeDeclaration`. `CommandEffect`는 `AppApiEffect`로.
   - `PermissionKind`에서 `document.save`를 뺀다(문서 저장이 없어졌다). 이 목록은 contract-approvals의 `protocol/apps/permissions.ts`와 따로 있는 사본이므로 어긋나면 보고한다.
   - `BLUEPRINT_KEYS`는 위 칸으로 맞춘다. `MESSAGE_KEY`·`PROBLEM_CODE` 상수는 문제 code가 없으니 뺀다.
2. `schema.ts`(옛 `blueprint-schema.ts`), `json.ts`(옛 `blueprint-json.ts`)는 이름만 새 type에 맞춘다. 입력 schema 검사와 `canonicalInputHash` 규칙은 바꾸지 않는다.
3. `scope.ts`(옛 `blueprint-scope.ts`) — `problemCode`, `formatRef`와 그것만 쓰는 상수를 뺀다. 나머지(permission scope, screen path, host·port)는 그대로.
4. `app-api.ts`(옛 `blueprint-commands.ts`) — `validateScreensAndApis`. `revert` 검사(80~170줄)와 `confirm` 검사를 뺀다. `project_scope`가 boolean인지 본다. key 규칙(와일드카드·제어 문자 금지)은 그대로.
5. `uses.ts`(옛 `blueprint-uses.ts`) — `app_api` 이름 목록을 검사한다. 자기 앱을 대상으로 못 한다는 규칙은 그대로.
6. `value.ts`(옛 `blueprint-value.ts`) — `validateBlueprint`. automation·documents·agent_context·problem_codes 검사(246~334줄 포함)를 모두 뺀다. 알 수 없는 칸은 거절하는 `exactKeys` 규칙은 그대로라 옛 칸을 가진 JSON은 거절된다.
7. `read.ts`(옛 `blueprint-read.ts`) — 읽기 route를 새 이름으로 둔다: `appAppApi = defineRead({resource: "apps", method: "app_api", name: "app.app_api"})`. 입력은 옛 `appBlueprint`와 같다(`{app, release?}`). 출력은 `{app, release, blueprint_hash, name, description, app_api: [{key, label, description, effect, input, project_scope}], screens, declarations: {permissions, app_connections: [{app, app_api}], app_api: string[]}, evidence}`. 옛 출력에서 `automations`, `agent_context`, `declarations.automations`·`problem_codes`·`documents`, command의 `confirm`·`revert`를 뺀다. `evidence`는 그대로 둔다(release 준비가 쓴다). 이 route는 `registry.ts`에 등록하지 않는다(소유 밖). 보고의 "등록할 것"에 적는다.
8. `mod.ts` — 위 파일의 공개 export를 내보낸다. 옛 `blueprint.ts`와 같은 모양의 정본 진입점이다.
9. `packages/sdk/blueprint/` — 새 폴더로 바꾼다.
   - `mod.ts`: 새 폴더의 type과 `validateBlueprint`·`validateInput`·`canonicalInputHash`, `defineBlueprint`를 내보낸다. `defineAgentContext`와 옛 칸 type 내보내기를 뺀다(`I2.5#16`). 같은 기준으로 검사하는 것은 유지한다.
   - 단 `sdk/ui-action/use-command.ts`가 옛 `CommandDeclaration` type을 `@lophn/blueprint`에서 import하므로(wave 3의 app-calls-shell이 옮긴다) `export type { CommandDeclaration } from "../../protocol/apps/blueprint.ts"` 한 줄을 임시로 남기고 보고한다.
   - `define.ts`: `defineBlueprint`만 남긴다(새 `Blueprint`로). `defineAgentContext`를 지운다.
   - `guide.md`: `commands` → `app_api`, `project_scope` 설명, 없어진 칸의 설명을 맞춘다.
   - `judge.ts`: test만 쓰던 helper다. 지운다.
   - `deno.json`은 lead 소유다. 고치지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 옛 칸(`commands`, `confirm`, `revert` 등)을 가진 JSON을 거절하는 것은 `exactKeys`가 이미 보장한다.
- 남지 않음: `grep -rniE "confirm|revert|automat|problem_code|agent_context|documents|\bcommand" packages/protocol/apps/blueprint packages/sdk/blueprint`가 0줄이다(임시로 남긴 `CommandDeclaration` 한 줄과 그 주석 제외).

## 보고

- 바꾼 file
- 등록할 것: `blueprint/read.ts`의 `appAppApi`를 `protocol/apps/registry.ts`의 `ROUTES`에(lead). `deno.json`은 변경 없음.
- 안 쓰게 된 export: 옛 `protocol/apps/blueprint*.ts` 전부와 `agent-context.ts`의 blueprint 관련 export. 옛 `appBlueprint` route. 임시로 남긴 `CommandDeclaration` 재내보내기. cleanup이 지운다.
- 정한 것: JSON 칸 이름(`app_api`, 안쪽 `app_api`, `project_scope`), `project_scope`를 필수로 한 것, `app.app_api` route 이름
- 계약 바꾸기 요청: 옛 소비자(release 준비, 템플릿, agent tool, coding agent)가 새 폴더로 옮겨 가는 순서에서 막히는 것. `PermissionKind` 사본이 contract-approvals와 어긋나는 것.

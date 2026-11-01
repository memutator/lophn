# cmd-apps

앱 관리 tool 열을 명령으로 옮긴다: `app.read`, `app.tools`, `app.create`, `app.link_source`, `declaration.check`, `app.status`, `app.logs`, `app.invocations`, `package.read`, `package.publish`.

- 단위: cli (wave 2)
- 선행: app-layers. 새 선언과 호출 대상 모양을 쓴다.
- 소유(이 task만 고친다):
  - `packages/core/apps/agent-tools/{app.ts,app_test.ts,runtime.ts,runtime_test.ts,package.ts,package_test.ts,app-card.ts}`
  - `packages/core/apps/declaration/**`
  - `packages/cli/commands/{app.ts,app_test.ts,package.ts,package_test.ts}`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/command-surface.md`의 "정한 것" 2~9
  - 본보기: `packages/cli/commands/`의 job 명령(cs-foundation이 옮긴 것)과 그 등록
  - architecture: `project-docs/architecture/domain.md`(다른 domain의 비공개 tool을 숨기는 규칙)
- 계약:
  - 쓰는 것: cs-foundation의 명령 모양, app-layers의 선언(command) 모양

## 할 일

1. 열 tool을 `packages/cli/commands/`의 명령으로 옮기고 agent-tools 쪽 정의를 지운다. place 종류는 지금 `packages/core/agent-places/tool-lists.ts`에서 그 tool이 든 목록을 그대로 옮긴다.
2. 부른 쪽에 따라 하던 판단을 core route로 옮긴다. 같은 명령을 binary가 user token으로도 부르기 때문이다.
   - `app.tools`가 `ctx.domains`로 다른 domain의 비공개 command를 숨기는 것은 `appToolIndex` route가 부른 쪽 credential로 거른다. agent의 맡은 domain 셈은 `packages/core/main/daemon/agent-domains.ts`에 이미 있다. 사람(user)은 다 본다.
   - `app.link_source`의 상대 path는 명령 context의 기준 폴더로 푼다. binary는 cwd이고, `lophn` tool은 place의 첫 폴더다. 기준 폴더가 context에 없으면 lead에게 계약 바꾸기 요청을 낸다.
3. 명령 help(description)는 영어이고, 지금 tool 설명의 다른 tool 이름(`app_tools` 같은 것)은 명령 꼴(`lophn app tools`)로 쓴다.

## 끝남

- `npm run check:full`이 통과하고 `boot.sh`가 두 번 `exit 0`이다.
- 위험 test: "agent가 `app tools`를 부르면 다른 domain의 비공개 command가 결과에 없다"(지금 `app_test.ts`가 보는 것을 route 쪽으로 옮긴다)
- 남지 않음: 옮긴 tool 이름이 `packages/core/apps/agent-tools/`에 정의로 남지 않는다.

## 보고

- 바꾼 file, 통과한 check
- 등록할 것: 명령 등록 목록, `TOOL_ORDER`·place 목록에서 뺄 이름, `packages/core/apps/agent-tools/mod.ts`에서 뺄 것
- 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

## lead가 더함 (cs-foundation merge 뒤)

- 명령 모양: `packages/cli/commands/types.ts`의 `defineCommand({...})`. 칸은 `name`(점 이름), `summary`, `description`, `input`(zod strict object), `positional`(칸 이름), `effect`, `routes: [{name}]`, `places`(`PlaceKind[]`, 빈 목록이면 binary만, 전부면 `PLACE_KINDS`), `run(input, ctx)`. 명령 file은 `JOB_COMMANDS` 같은 배열을 export한다. 본보기는 `packages/cli/commands/job.ts`다.
- `ctx`: `core.read(route, input)`, `core.command(route, input, {key, compare?})`(key는 `lophn` tool에서 tool call id, binary에서 `--idempotency-key`나 무작위), `place`(binary는 undefined, home은 null), `clock`, `signal`. 결과는 `{summary, content, arrayKeys?, text?, failed?, note?}`(`CommandResult`).
- 함정: 내장 tool을 명령으로 옮기면 같은 변경에서 옛 tool 정의와 `packages/core/agent-places/tool-lists.ts`의 그 이름을 지운다. wire 이름이 겹치면 `buildWireTable`이 실패해 그 session의 모든 tool이 "not available"이 된다(`packages/core/main/agent-tools_test.ts`가 잡는다).
- 추가 소유(등록 줄만): `packages/cli/commands/mod.ts`에 이 task의 명령 배열 한 줄, `packages/core/agent-places/tool-lists.ts`에서 옮긴 tool 이름 지우기, `packages/core/main/agent-tools.ts`에서 옮긴 bundle 지우기. 다른 task도 같은 줄을 고치므로 merge 충돌은 lead가 푼다.
- 추가 소유(`app.link_source` 기준 폴더): `CommandContext`에 선택 칸 `cwd`를 더한다(`packages/cli/commands/types.ts`). binary는 process cwd(`packages/cli/main.ts`), `lophn` tool은 place의 `scope.base ?? scope.read[0]`(`packages/core/lophn-agent/tools/lophn/command-tool.ts`). 이 칸만 고친다.

## lead가 더함 (app-layers merge 뒤)

- 선언: `operations[]` `{name, title, effect}`, `commands[]` `{name, description, inputSchema|null, effect, public, domain}`, `app_connections[]` `{app, commands[], reason}`. type은 `OperationDeclaration`, `CommandDeclaration`, `AppCommandUseDeclaration`이고 `handlerNames(declaration)`이 있다.
- core 호출 route는 이름 그대로 `app.call_tool`(`appCallTool`)이고 입력은 `{target, kind: "operation"|"command", name, input?, caller}`다. 출력 type 이름(`ToolCallOutput` 등)도 그대로다. person이 아닌 쪽의 operation 호출은 `denied(gate_blocked)`다.
- 앱 process wire는 `{invocation, kind, name, input?, context}`, 앱→앱 broker는 `{target_app, command, input?, parent_invocation}`, invocation 기록의 `operation`은 `{kind: "operation"|"command", name}`이다.
- `apps/tools` 읽기의 `tools`는 command 목록이고 `operations`가 따로 있다. `app.tool_index`는 command만 싣는다. 저장된 칸 이름(`removed_tools`, grant의 `app_tools`, `facts.tools`)은 그대로이고 안에 command 이름이 든다.
- 화면 bridge는 `lophnApp.callOperation(operation, input)`, IPC `app:call-operation`이다. SDK: `@lophn/cap-tool` 2.0.0(`handle`, `connectCommands`), `@lophn/app-ui` 2.0.0(`OperationButton`, `useOperation`), `@lophn/declaration` 2.0.0.
- `preview.call` 입력은 `{app, kind, name, input?}`다.
- `apps/tools` route가 agent credential에게도 `operations`를 준다. agent caller에게는 operations를 빼고, 그 앱 place의 session만 본다(preview에서 부를 수 있으니까). 2의 route 거르기와 같은 자리에서 한다.

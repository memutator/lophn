# agent-tools-app-api

agent가 쓰는 앱 app-api tool을 새 호출 경로에 맞게 다시 짓는다. 이름은 `app__<앱>__<api>`, 호출은 core의 호출 경로 route 하나로 보내고, revert와 confirm 분기는 지운다. project 범위 app-api는 project에 놓인 agent의 입력에서 project 칸을 뺀다.

- 단위: agent-tools (wave 3)
- 선행: agent-tools-registry (`ToolDefinition`, `ToolContext`, `toolForWireName`)
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/app-tools.ts`
  - `packages/core/lophn-agent/tools/app-toolkit.ts`
  - `packages/core/lophn-agent/tools/app-api/` (새 폴더: `name.ts`, `input.ts`, `missing.ts`)
  - 예외: 이름을 바꾼 export(`createAppToolkit` 등)를 부르는 `tools/mod.ts`와 `tools/toolkit.ts`의 import·export 줄만 고친다
- 읽을 것:
  - spec: S4 4장 "app-api tool" — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S5 4장(core를 거치는 호출 경로, project 범위 app-api, 결과 모름) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`
  - spec: S2 3·4·5장(Gate, agent grant) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - inventory: `I1.5#10`, `I2.2#17`, `I2.4#12`, `I2.5#19`, `I3.4#12`
  - 결정: `../README.md` 3장 #3, #41
- 계약:
  - 쓰는 것: contract-app-calls의 core 호출 경로 route와 invocation 값, blueprint의 app-api 선언과 project 범위 선언(`protocol/apps`). 이름은 그 file에서 찾는다. agent grant 모양은 contract-approvals(`protocol/approvals`, `core/approvals/ports.ts`)다. `APP_API_TOOL_PREFIX`, `TOOL_NAME_MAX`(contract-agent-tools-catalog), `ToolContext`(agent-tools-registry).
  - 내놓는 것: `buildAppApiTools(source)`(session을 시작할 때 부르는 순수에 가까운 빌더), `appApiMissingReason(name, state)`, 옛 `createAppToolkit`을 대신하는 `createAppApiToolkit(...)`

## 할 일

1. `app-api/name.ts` (`I2.4#12`): `appApiToolName(app, api)`는 `app__<앱>__<api>`를 만든다. 64자(`TOOL_NAME_MAX`)를 넘으면 앞부분을 자르고 전체 이름의 hash 앞 8자를 붙인다. 같은 입력이면 같은 이름이다. 옛 `app_<appHash8>_<command slug>_<hash6>`와 `APP_TOOL_PREFIX = "app_"`는 지운다. 이름을 parse하지 않는다. 이름 → (앱, api) 표는 정의 목록에서 만들고 registry의 `toolForWireName`이 쓴다. "command" 용어는 "app-api"로 바꾼다.
2. `app-tools.ts` (`I1.5#10`, `I2.5#19`):
   - `AppCommandPorts.invoke/status`와 앱 direct socket으로 부르던 길(`apps/connect`)을 지우고 `ToolContext.core`로 contract-app-calls의 호출 경로 route를 부른다. 결과 모양에서 `revert`를 뺀다.
   - `revertCounterpart`, `reversible`, `revertCommand`, `AppTool.confirm`, `appDefinitionHash`의 `confirm`·`reversible`을 지운다.
   - 결과를 잃었을 때 invocation 목록으로 찾는 `findInvocation` 재시도는 지운다. core가 결과 모름을 직접 다루므로(S5) tool은 core가 돌려준 상태(성공, 실패, 결과 모름)를 그대로 `ToolResult`로 옮긴다.
3. `app-toolkit.ts` (`I2.2#17`): 활성 release의 app-api 선언과 agent grant(앱 단위 할당 + app-api별 빼기·묻는지)를 읽어 session에 보일 app-api 목록을 만든다. 앱 blueprint의 `confirm`, `revert_supported`, 앱의 `agent.commands` 허락을 읽던 연결, `AgentAppScope`의 `confirm_allowed`·`revert_required`·`AppOffer.granted`는 쓰지 않는다. Gate 판정은 core의 호출 경로가 한다. 이 tool은 judgment 입력을 만들지 않는다.
4. `app-api/input.ts` (`I3.4#12`): project 범위 app-api의 입력 schema를 만든다. project에 놓인 agent(`ToolContext.place`가 project)에게는 schema에서 `project` 칸을 빼고(strict라 보내면 거절된다), 부를 때 core가 그 agent의 project를 넣게 호출에 아무것도 싣지 않는다. lophn과 앱 place의 agent에게는 `project` 칸을 보인다.
5. `app-api/missing.ts`: 없는 tool을 불렀을 때 구별하는 이유를 `appApiMissingReason(name, state)`로 돌려준다: `removed_from_grant`(grant에서 뺌), `removed_from_release`(release에서 빠짐), `denied`(거절). agent-tools-registry의 "없는 tool" 오류 네 코드를 쓴다.
6. effect는 활성 release의 blueprint 선언에서 읽은 값(read, write, external)을 `ToolDefinition.effect`에 둔다. model에 보이는 정의에는 넣지 않는다 (registry가 뺀다).
7. 옛 이름 정리: `grep -rn "APP_TOOL_PREFIX\|revertCounterpart\|AppInvokeOutcome\|appConnect" packages/core/lophn-agent`가 0줄이어야 한다. 밖에서 쓰는 곳(run-loop, tool-judgment, waiting-and-recovery)은 다른 단위 몫이다. 지우지 못한 이름은 보고에 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "project에 놓인 agent의 app-api tool 입력에는 project 칸이 없어 다른 project를 지정할 수 없다" — `app-api/input_test.ts`가 project 범위 app-api 하나로 place 종류별 schema를 만들어 `project`를 보낸 입력의 거절과 lophn의 허용을 본다.
- 남지 않음: 7번의 grep이 0줄이다(지우지 못한 곳 제외).

## 보고

- 바꾼 file
- 등록할 것: 없음
- 안 쓰게 된 export: 7번에서 남긴 이름
- 정한 것: 이름 자르는 규칙, hash 입력, `ToolResult`에 옮기는 상태 모양
- 계약 바꾸기 요청: contract-app-calls의 호출 경로 route에 모자란 칸(예: 호출자 project, tool call ID)

- (lead가 더함, approvals-tool-judgment가 넘긴 것) `tools/app-toolkit.ts`가 쓰는 `createAppBinding`·`AppJudgmentPorts`(`tool-judgment/app-judgment.ts`)는 새 `ToolGate`로 옮기면 안 쓰인다. 옮기고 보고한다.

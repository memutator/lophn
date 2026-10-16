# agent-tools-context

context와 목차 tool을 S4 4장 표대로 새로 짓는다: `context.list`, `context.get`, `context.search`, `context.draft`, `context.test`, `context.submit`, `context.violations`, `glossary.set`, `outline.get`, `outline.set`, `outline.delete`. 선언 검색 tool을 context마다 동적으로 만들던 길과 JSON 선언으로 초안을 저장하던 길은 지운다.

- 단위: agent-tools (wave 3)
- 선행:
  - agent-tools-registry (`ToolDefinition`, `defineBuiltin`, `ToolContext`, 껍데기 `bundles/context.ts`·`bundles/outline.ts`)
  - agent-definition-prompt (`context.get`이 prompt와 같은 context 글을 돌려주려고 `prompt-assembly/mod.ts`의 `buildContextText`, `renderContextText`를 import한다)
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/bundles/context.ts`, `bundles/outline.ts`
  - `packages/core/lophn-agent/tools/context/` (새 폴더: `visible.ts`, `search.ts`, `draft.ts`)
  - 지울 것: `tools/context-engineer-tools.ts`, `tools/context-lookup-tools.ts`, `tools/context-search-tools.ts`, `tools/context-search.ts`, `tools/context-route-shapes.ts` (agent-tools-registry가 import를 끊은 뒤)
  - 예외: `tools/mod.ts`에서 이 task가 지운 file의 export 줄만 지운다
- 읽을 것:
  - spec: S4 4장(context, 용어집, 목차 줄과 "context 검색은 `context.search` 하나"), 6장 "context 글", 11장 2·14 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - 제품: Project Manager의 책임 C1~C8 — `/home/pyosechang/projects/lophn/project-docs/products/AGENT-ROLE.md`
  - inventory: `I1.4#10`, `I1.4#11`, `I1.10#18`, `I2.4#20`, `I3.4#19`, `I3.10#2`(tool 쪽. 목차 저장과 route는 places-sessions)
  - 결정: `../README.md` 3장 #41
  - 같이 읽는 줄(다른 단위 몫): `I2.4#21`(context 쓰기 tool의 이름과 입력. contract-calls-places 몫으로 배정돼 있지만 이 task가 tool을 짓는다)
- 계약:
  - 쓰는 것: `TOOL_INPUTS`와 `contextGetOutputSchema`(contract-agent-tools-catalog), contract-calls-places의 `protocol/projects/context-api.ts`(초안 열기, test, 제출, 위반 읽기, 용어집 쓰기, 목차 읽기·쓰기·지우기와 context 목록·읽기 route. 이름은 그 file에서 찾는다), agent-definition-prompt의 `buildContextText`
  - 내놓는 것: `CONTEXT_TOOLS`, `OUTLINE_TOOLS`, 순수 함수 `contextVisible(role, place, attachedContexts, target)`

## 할 일

각 tool은 `defineBuiltin`으로 정의하고 입력 schema는 `TOOL_INPUTS[이름]`을 쓴다. route 호출은 `ToolContext.core`(agent 자격)로 한다.

1. `context/visible.ts` (`I2.4#20`): `contextVisible`은 읽을 수 있는 context를 role과 place로 정한다. lophn은 등록된 모든 project의 context, Project Manager는 자기 project의 context, Operator는 자기 정의에 붙은 context, App Engineer는 자기 앱 source가 속한 project의 context다. 읽기 tool(`context.list`, `context.get`, `context.search`, `context.violations`, `outline.get`)은 이 판정을 route 호출 전에 적용하고, 범위 밖 대상은 없는 대상과 같은 `not_found`로 답한다.
2. 읽기 tool (`bundles/context.ts`):
   - `context.list`(read): 보이는 context의 이름과 한 줄 설명.
   - `context.get`(read): `buildContextText`로 만든 context 글과 적용된 판 번호(`contextGetOutputSchema`). 계약 원문은 주지 않는다. `glossary.get`, `context.overview`, `context.read_contract`, `context.read_entity`, `context.containing`은 두지 않는다 (`I1.4#10`, `I1.4#11`).
   - `context.search`(read): `context`, `search`, `input`을 받아 검색 하나를 부른다. context마다 동적으로 `ctx_<ULID>_<slug>_<hash8>` tool을 만들던 길(`buildContextReadTools`, `CONTEXT_TOOL_PREFIX`)은 없앤다. 입력은 그 context 판의 검색 선언으로 검사한다.
   - `context.violations`(read): 계약 위반 목록.
   - `context.test`(read): 초안 판을 격리 test로 돌린다.
3. 쓰기 tool (`bundles/context.ts`, `context/draft.ts`): `context.draft`(write), `context.submit`(write), `glossary.set`(write)는 Project Manager만 갖는다 (목록은 `builtinToolNames`가 이미 정한다).
   - `context.draft`는 새 판의 초안 폴더를 열고 `{ draft, folder }`를 돌려준다. `context`가 없으면 새 context를 첫 판과 함께 만든다(옛 `context.create`가 이것으로 합쳐진다, `I1.10#18`). 계약과 검색 script는 이 폴더에 `file.write`로 쓴다. 이 폴더는 lophn data 안에 있으므로 Project Manager의 file 범위에 들어가야 한다. 범위 계산은 agent-tools-file의 `PlaceScope`가 하므로 이 task는 `folder`를 돌려주기만 하고, `PlaceScope`가 폴더를 알아내는 읽기 route가 contract에 없으면 보고한다.
   - `context.submit`은 초안 판을 낸다. 통과하면 자동 적용되고 그동안 다른 agent는 지금 판을 쓴다 (AGENT-ROLE C3). 계약을 JSON 선언으로 tool 입력에 넣던 `draftContentSchema` 길은 지운다.
   - `glossary.set`은 용어의 뜻을 정하고 고친다. `remove`가 참이면 지운다. 읽기는 context 글에 들어 있다.
4. 목차 tool (`bundles/outline.ts`, `I3.10#2`): `outline.get`(read, 모든 role. 보이는 context만), `outline.set`, `outline.delete`(write, Project Manager만). 저장은 contexts의 route가 한다. 원본이 바뀐 것을 감지하지 않는다 (AGENT-ROLE C5).
5. 지울 file을 지우고 `grep -rn "context-engineer-tools\|context-lookup-tools\|context-search-tools\|CONTEXT_TOOL_PREFIX\|buildContextReadTools" packages`가 0줄인지 본다. 밖에서 import하는 곳이 남아 있으면(예: `run-loop/prepare.ts`, `toolkit.ts`) 그 file은 router나 agent-tools-registry가 고치는 중이므로 지우지 않고 보고한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "Operator는 정의에 붙지 않은 context를 읽거나 검색하지 못한다" — `context/visible_test.ts`가 role과 place, 붙은 context, 대상 조합을 표로 돌려 허용과 `not_found`를 본다.
- 남지 않음: 5번의 grep이 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음
- 안 쓰게 된 export: 5번에서 남긴 것
- 정한 것: 검색 입력 검사 방법, `context.draft`의 출력 칸, 초안 폴더를 file 범위에 넣는 방법
- 계약 바꾸기 요청: `protocol/projects/context-api.ts`에 route가 없는 tool(목차 route, 초안 폴더 읽기 등)의 이름

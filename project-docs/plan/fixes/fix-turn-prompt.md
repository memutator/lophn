# fix-turn-prompt

run-loop가 아직 옛 prompt 조립(`assemblePrompt`, `buildTurnContext`, `loadContextMaterials`, 매 model call 직전 `resolveInstructions`)을 쓴다. agent-definition-prompt(`8d99ad5c`)가 새 `assembleTurnPrompt`를, agent-definition-instructions가 `readTurnInstructions`를 내놓았다. run-loop를 새 함수로 옮기는 줄이 router 단위에 없어서 lead가 fix로 돌린다. agent-definition-agents, agent-definition-instructions가 merge된 뒤에 띄운다.

- 단위: router (wave 3 계약 고침)
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/` 가운데 prompt 조립을 부르는 줄(`prepare.ts`, `turn.ts` 등)
  - `packages/core/lophn-agent/prompt-assembly/`의 옛 file 지우기(`turn-context.ts`, `material.ts`, `context-overview.ts`, 옛 `assemblePrompt` 계열)
  - `SeenBasis` 저장에 필요한 session 기록 칸(places-sessions의 turn 기록 줄만)
- 읽을 것:
  - spec: `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md` 5·6장
  - `prompt-assembly/{turn-prompt,place-info,context-text,basis,skill-list}.ts`, `instructions/`의 `readTurnInstructions`
  - 공통 규칙: `/home/pyosechang/projects/lophn/project-docs/plan/fixes/README.md`
- 계약: 바꾸지 않는다. route가 모자라면 보고한다.

## 할 일

1. turn 시작에 `readTurnInstructions(deps, session)`를 한 번 부르고, 실패면 turn을 시작하지 않는다. 그 결과를 turn 끝까지 쓴다.
2. `assembleTurnPrompt(input, {pack})`로 prompt를 만든다. `PlaceData`(project 이름·목적·폴더·하위 폴더, 앱 이름·목적·source·blueprint 경로, 활성 release의 app-api 이름, grant 안의 agent 목록)와 `ContextRead`(적용된 판, type·field·relation, 검색, 용어집)를 core 읽기로 채운다. 없는 읽기는 기존 ledger 표에서 바로 읽고 보고에 적는다.
3. `SeenBasis`(JSON 한 덩어리)를 turn마다 session 기록에 남기고 다음 turn의 `seen`으로 넘긴다. compact 뒤 첫 turn은 `seen` 없이 부른다.
4. 옛 조립 file과 export를 지운다(`turn-context.ts`, `TurnContextBasis`, `withTurnContext`, `buildTurnContext`, `material.ts`, `context-overview.ts`, `assemblePrompt`, `PromptDeps`, `systemBlocks`, `workMessages`, `normalizeTools`, `instructionsText`, 옛 `resolveInstructions` 호출 경로). `summary.ts`는 `session/compactor`가 쓰면 둔다.
5. 확인: 개발 data를 새로 만들어 core를 띄우고 사람 메시지 하나로 turn이 시작해 끝나는지 본다(provider가 없으면 `configuration_unavailable`). 확인용 script는 commit하지 않는다. core는 띄운 PID만 끈다.

## 끝남

- `deno task check:full`이 통과한다. core가 기동 오류 없이 뜬다.
- 위험 test: 새로 쓰지 않는다.

## 보고

- 바꾼 file, 확인 결과, 채우지 못한 `PlaceData` 칸과 이유, 계약 바꾸기 요청(없으면 "없음")

- (lead가 더함, agent-definition-instructions가 넘긴 것) `readTurnInstructions(deps, {role})`는 `{status:"ready", layers}` 또는 `{status:"blocked", layer, reason, message}`를 돌려준다. blocked면 turn을 시작하지 않는다. 옮긴 뒤 `instructions/`의 옛 `resolveInstructions`, `instructionPlace`, `instructionLayers`, `resolveLayers`, `InstructionLayer`, `InstructionResolution`, `INSTRUCTION_TOTAL_MAX_BYTES`를 지운다(추가 소유).
- (lead가 더함, agent-definition-models가 넘긴 것) model 층은 전역 기본 → project(`readOf(machine, projectModelRead, {project})`) → agent 정의 → session 순서다. `projectModelRead`를 machine route 목록(`run-loop/runtime-access.ts`)에 더한다. 지금 `agents/layers.ts`는 정의 읽기의 `effective.model`에 session을 얹는다(project 층 빠짐).
- (lead가 더함, agent-tools-file이 넘긴 것) file tool의 `PlaceScope`(`read`/`write` 폴더 목록)를 turn 준비에서 채운다(lophn은 `write: []`). rewind 기록 `recordBeforeWrite`의 path는 허용 폴더 기준 상대 경로라 폴더가 여럿이면 어느 폴더인지 같이 넘겨야 한다. 이 줄은 places-sessions-rewind와 맞춘다.
- (lead가 더함, agent-tools-shell-web이 넘긴 것) `run-loop/runtime.ts`가 runtime 권한에 `placeFolders`(절대 경로, write는 read 안)를 넘긴다. `shell.run`의 cwd는 `ctx.scope.read[0]`이다.
- (lead가 더함, agent-definition-extensions가 넘긴 것) `run-loop/prepare.ts`가 아직 옛 `createMcpToolkit`·`buildMcpTools`·`createMcpToolHandlers`·`McpSelection`·`EXTERNAL_TOOL_CONTRACT`를 쓴다. 새 모양(`createSkillSnapshot`, 정의가 handler를 든 `buildMcpTools(source, selection, call)`)으로 옮길 수 있으면 옮기고, 아니면 보고한다. `configuration_revision: 0`으로 둔 줄이 있다.

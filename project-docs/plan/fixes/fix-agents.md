# fix-agents

계약 고정 전 고침. 사람이 agent 정의를 읽고 저장하는 route를 새 모델로 바꾸고, model·skill·MCP·instructions 계약의 옛 이름을 걷고, tool catalog의 ticket 입력을 정본에서 가져오고, provider·MCP의 credential을 `{secret}` 이름 참조로 바꾼다.

- 단위: contract-agent-tools (계약 고정 전 고침)
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{agents,agent-values,operators,scope,models,skill-settings,mcp-settings,instructions,provider-inputs,providers,tool-catalog,commands}.ts`와 새 file
  - 이름을 바꾼 것을 쓰는 줄(core, shell, renderer, tools 어디든. 그 줄만)
- 읽을 것:
  - spec: `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md` 2·5·11장, `place-session.md` 2장
  - 원래 brief: `/home/pyosechang/projects/lophn/project-docs/plan/tasks/contract-agent-tools-{config,catalog}.md`, `contract-calls-places-places.md`, `agent-definition-agents.md`(wave 3이 쓸 `agentsRead` 등)
  - 공통 규칙: `/home/pyosechang/projects/lophn/project-docs/plan/fixes/README.md`
- 계약: 아래 할 일이 정하는 모양을 내놓는다.

## 할 일

1. **agent 정의 읽기·저장 route를 새 모델로.** 지금 `agents.ts`의 `ListAgents`, `ReadAgent`, `SaveAgent`, `DeleteAgent`, 프로필 route, `ReadPlaceAgentSettings`·`ChangePlaceAgentSettings`는 옛 모델이다(`asg` assignment로 가리키고, `context_engineer` role, `permissions`·`safe_tools`·`app_reads` 칸, role별 model). S4 2장과 11장 9대로 새 route를 둔다:
   - 정체성은 `AgentRef`(`places.ts`). 내장 role(lophn, project_manager, app_engineer)은 정의를 읽기만 하고 사람이 고치는 것은 지침·model·contexts·skill·MCP 끄기다(spec 2장). Operator는 `operatorDefinitionSchema`로 만들고 고치고 지운다.
   - 사람이 tool 목록을 바꾸지 않는다. role별 기본 model은 없다(model 기본값은 `models.ts`의 하나).
   - grant는 `approvals/grants.ts`의 `agentGrantsGet`·`agentGrantsSet`이 맡는다. 여기 두지 않는다.
   - `agent-definition-agents.md` brief가 말하는 `agentsRead` 등 이름과 맞춘다. 새 route 이름이 옛것과 겹치면 옛것을 지울 수 있으면 바꿔 끼우고, 아니면 다른 이름을 쓰고 보고한다.
2. **models.ts 이름.** `runBasisModelSchema`·`runBasisModelOutputSchema`를 `turnBasisModel...`로, `context_engineer` slot 넷을 `project_manager`로 바꾼다. 주석의 "Workspace"는 지금 말로 고친다.
3. **적용 시점 이름.** `skill-settings.ts`·`mcp-settings.ts`의 `apply_at: "next_run"`을 `"next_turn"`으로 바꾼다(core `lophn-agent/register.ts`와 renderer `ApplyAt` 등 쓰는 줄도).
4. **instructions.ts 정리.** 같은 file의 옛 `instructionRead` route(`run: idSchema("run")`)와 `ASSIGNMENT_STATES`를 지운다. `INSTRUCTION_ROUTES`에서도 뺀다. 쓰는 곳이 남아 지울 수 없으면 보고한다.
5. **skill 출처 말 한 벌.** `commands.ts`의 `COMMAND_SKILL_ORIGINS = ["place","workspace"]`와 `skill-settings.ts`의 `SKILL_SOURCE_KINDS`(place/registered/personal/bundled)·`SKILL_SOURCES`(builtin/global/project)를 `SKILL_SOURCES` 한 벌로 맞춘다. 옛 것은 쓰는 곳이 없으면 지운다.
6. **tool catalog의 ticket 입력.** `tool-catalog.ts`의 ticket 입력 사본을 지우고 `protocol/coding-agent/ticket/`의 정본을 import한다(lophn-agent → coding-agent는 순환이 없다. fix-sessions가 같은 방향 edge를 만든다). `ticket.create`·`update`·`cancel`은 route 입력을 그대로, `ticket.verify`는 `ticketVerifyInputSchema.pick({ticket, result, note})`로 한다(`base_revision`·`completion_seq`는 core가 ticket에서 채운다는 주석을 단다). `ticketStateSchema`와 check schema도 import한다. 주석의 "순환이라 사본" 문장을 고친다.
7. **credential은 secret 이름 참조.** provider 입력의 `credential: { kind, preparation }`(`provider-inputs.ts`)과 MCP의 `secret_ref: "sec:..."`(`mcp-settings.ts`)를 `credential: { secret: secretNameSchema }`(`protocol/secrets/secrets.ts`)로 바꾼다. secret 값은 보호 입력 창 → `secrets/put`으로만 들어간다(contract-platform).

## 끝남

- `deno task check`가 통과한다. `deno run -A tools/check-deps.ts`가 통과한다.
- 소유의 새 계약에 `context_engineer`, `next_run`, `runBasis`, `secret_ref`가 남지 않는다. `tool-catalog.ts`에 ticket 입력 사본이 없다.
- 위험 test: 없음.

## 보고

- 바꾼 file
- 등록할 것: 새 route와 그 목록, 옛 route와 이름이 겹치는 것
- 이름을 바꾸며 고친 core·shell·renderer 줄
- 정한 것
- 계약 바꾸기 요청: 없으면 "없음"

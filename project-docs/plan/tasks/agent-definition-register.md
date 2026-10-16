# agent-definition-register

`lophn-agent/register.ts`에서 agent 정의 쪽 줄을 새 모양으로 잇는다. agent runtime의 launch spec이 place 폴더 권한을 쓰게 하고, 내장 skill 위치를 맞추고, 설정 선언을 새 모양으로 옮기고, 새 route handler(`GetInstructions`, `ReadSkills`, 프로젝트 MCP 설정, 전역 model 기본)를 걸고 지운 구현의 옛 handler를 내린다. 정의 단위의 마지막 task다.

- 단위: agent-definition (wave 3)
- 선행: `router-calls`(그 task가 보고한 `register.ts` 줄을 모아 넣는다), `router-run-loop-turn`(그 task가 보고한 `register.ts` 줄을 모아 넣는다), `places-sessions-session`(그 task가 보고한 `register.ts` 줄을 모아 넣는다), `approvals-tool-judgment`(그 task가 보고한 `register.ts` 줄을 모아 넣는다), 
  - agent-tools-shell-web (`agentRuntimePermissions`)
  - agent-tools-call (`tools/questions/` 삭제)
  - agent-definition-instructions, agent-definition-extensions, agent-definition-models, agent-definition-agents (새 handler와 함수)
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/register.ts` — 아래 "고치는 줄"만. 이 file은 lophn-agent module 전체의 등록이라 router(handoff, run), places-sessions(session), approvals, events의 줄도 들어 있다. 그 줄은 건드리지 않는다.
- 읽을 것:
  - spec: S4 8장(부품과 소유), 9장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - inventory: `I2.4#39`, `I2.11#2`(core 쪽: `register.ts`의 선언 넷. protocol 쪽 `mcp-settings.ts`·`skill-settings.ts`는 contract-agent-tools-config)
  - 결정: `../README.md` 3장 #5, #117·118
  - 지금 코드: `packages/core/main/daemon/wiring/` (core-wiring이 만든 module별 wiring file. 조립 목록은 lead 것이라 고치지 않는다)
- 계약:
  - 쓰는 것: `agentRuntimePermissions`(agent-tools-shell-web), `BUNDLED_SKILLS_ROOT`(agent-definition-extensions), 새 handler 함수들(위 선행 task가 내놓은 것), contract-platform의 설정 선언 모양(`protocol/config`)
  - 내놓는 것: `agentRuntimeLaunchSpec(input)`(입력에 `placeFolders` 추가), 새 route 정의 목록

## 할 일

1. `agentRuntimeLaunchSpec` (`I2.4#39`): `allow_read`, `allow_write`, `allow_net`, `allow_run`, `allow_env` 계산을 `agentRuntimePermissions(...)`로 바꾼다. 입력에 `placeFolders: { read: string[]; write: string[] }`를 더한다(호출하는 쪽 `run-loop/runtime.ts`는 router가 고친다. 그 전에는 빈 값으로 호출돼도 type check가 통과해야 하므로 `placeFolders`는 필수로 두되 지금 호출부는 이 task가 `{ read: [], write: [] }`를 넘기게 한 줄 고친다). 권한 목록의 의미는 agent-tools-shell-web 보고를 따른다.
2. 동봉 skill 위치: `register.ts`의 `BUNDLED_SKILLS_ROOT`와 `readBundledSkillRoots`를 지우고 `extensions`의 `BUNDLED_SKILLS_ROOT`를 쓴다. 폴더가 항상 있으므로 존재 확인 함수는 필요 없다. 호출부(`run-loop/runtime.ts`)에 걸린 이름이 있으면 지우지 않고 얇게 남겨 보고한다.
3. 설정 선언 (`I2.11#2`): `catalogAutoUpdateSetting`과 run 한도 셋(`runModelAttemptsSetting`, `runStallSetting`, `runActiveSetting`)을 contract-platform의 새 선언 모양(타입 + 기본값, key는 요소 이름 아래)으로 옮긴다. key는 `agents.`로 시작한다. 새 모양이 main에 없으면 건드리지 않고 보고한다. run을 turn으로 바꾸는 이름 변경은 contract-calls-places가 정한 이름을 따른다.
4. route 정의 목록 `lophnAgentDefinitions`: 새 handler를 건다 — `GetInstructions`, `ReadSkills`, `ReadProjectExtensionSettings`, `ChangeProjectExtensionSettings`, `ReadModelDefault`, `ChangeModelDefault`, 그리고 agent 정의의 Operator 만들기·고치기·지우기. 구현을 지운 옛 handler를 내린다 — `instructionReadRoute`(`ReadInstructionFile`), place extension 둘, 전역 skill 읽기, model defaults 둘, `ExportAgentTrace`. protocol의 옛 route는 contract 소유라 남아 있다. handler 없는 route 때문에 등록 검사가 깨지면 그 route를 `protocol/lophn-agent/registry.ts`에서 내려 달라고 "등록할 것"에 적는다.
5. 질문 묶음 연결: `bindQuestionOptionOwners`와 `questionOption` port 연결(`tools/questions`가 쓰던 것)을 지운다. 이 연결은 agent-tools-call이 `tools/questions/`를 지운 뒤에 죽는다. `tools/questions/`가 아직 남아 있으면 그 사용처를 이 줄에서 끊고 남은 folder를 보고한다.
6. agent 연결 정리: `agentLookups`, `agentProfileHandlers`, `operatorAssignmentWriter`, `agentAssignmentRef`, `skillsOffOf`, `registeredSkillFolders`, `registeredSkillsOff`, `globalSkillSources`, `extensionRegistry`처럼 agent 정의와 skill·MCP를 읽던 연결을 agent-definition-agents와 agent-definition-extensions의 새 함수 모양에 맞춘다. assignment id를 쓰던 칸은 place와 role로 바꾼다. assignment 상태 machine 쪽 줄은 places-sessions 몫이라 건드리지 않는다.
7. 건드리지 않는 줄: handoff 배선(129~132, 432~445, 941, 992~993, 1191~1192줄 부근, router 몫), session·rewind(`deleteSessionRecords` 등, places-sessions 몫), tool 판정(`tool-judgment`, approvals 몫), event visibility(events 몫). 이 줄이 위 고침 때문에 깨지면 고치지 말고 보고한다.
8. (lead가 맞추며 더함) 선행 task(router, places-sessions, approvals)의 보고에 적힌 `core/lophn-agent/register.ts`의 넣고 뺄 줄을 모아 넣는다. 이 module의 register file은 이 task만 고친다.

- (lead가 더함, router-run-loop-turn이 넘긴 것) `register.ts`: `createRunCommands({ hasUnappliedSteering })`에 `publish: ctx.bus.publish`를 더하고 별칭(`createRunCommands`, `createRunReads`, `deleteSessionRuns`, `RUN_LIMIT_SETTING_KEYS`, `runBodyFields`, `runSchemaSteps`)을 새 이름으로 바꾼다. `createLophnInputTransport({..., publish: bus.publish})`. 켤 때 writer tx 안에서 `interruptRunningTurns(tx, bus.publish, "restarted")`(router-calls의 `failLostOnStart`와 같은 곳). places `EndDeps`에 `(tx, s) => interruptRunningTurns(tx, bus.publish, "session_ended", s)`. agent runtime의 `toolPorts`는 지금 `UNWIRED_TOOL_PORTS`(닫힌 채 실패)다. 진짜 Gate·Router·questions·scope·rewind·skills를 끼운다. fix-turn-wiring(`b9030efc`)이 `runAdmissionPort`, 별칭 이름 바꾸기, `EndDeps.interruptRunningTurns`(publish 없이), `startAgentRuntimeChild`의 `turns`·`publish`를 이미 넣었다. publish·입력함 길과 켤 때 interrupt는 router-calls가 짓는다. 이 task에 남은 것은 `UNWIRED_TOOL_PORTS`를 진짜로 바꾸는 일이다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(등록 연결이다).
- 남지 않음: `grep -rn "readBundledSkillRoots\|instructionReadRoute\|bindQuestionOptionOwners" packages/core`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `protocol/lophn-agent/registry.ts`의 `ROUTES`에서 내릴 옛 route와 올릴 새 route(contract-agent-tools-config 보고와 맞춘다). core 조립 목록에서 `lophnAgentDefinitions`를 부르는 줄이 바뀌면 그 내용
- 안 쓰게 된 export: 2번과 5번에서 남긴 이름
- 정한 것: launch spec 입력 모양, 설정 key 이름
- 계약 바꾸기 요청: contract-platform의 설정 선언 모양이 모자라면 그 칸
- (lead가 더함, router-calls가 넘긴 것) `createTurnCommands`의 `publish`·`calls`, session 끝날 때 `failReceivedCalls`는 router-calls가 넣었다. 켤 때 `interruptRunningTurns("restarted")`는 `RecoverCalls` 안에서 같은 tx로 돈다. 위 항목 가운데 이 셋은 빼도 된다. 남은 것: `EndDeps.clearInbox(session)`은 tx가 없어 Worker에서 main의 입력함에 못 닿는다. `(tx, session)`으로 바꿔 `INBOX_CLEAR_TOPIC` after-commit 할 일을 넣는다. session 열기 deps(`UNWIRED_OPEN_DEPS`: project·앱·Operator 조회, `SessionStarted` publish)를 잇는다. 이게 없어 place가 있는 session은 Router directory에서 `accepting: false`로 읽힌다.
- (lead가 더함, agent-definition-roles가 넘긴 것) `register.ts`의 `skillsOffOf`와 `commandReads`가 옛 `{assignment, role: AgentRole, work_place}` 모양을 쓴다. skills callback 타입을 `role: Role`로 바꾸고 `assignment`를 뺀 뒤, `commands/reads.ts`의 `placeOf`를 `sessions` 표(`role`, `place_kind`, `place_id`)로 고친다(없는 `assignments` 표를 join해서 지금은 not_found가 난다). 그러면 `reads.ts:75`의 `context_engineer` → `project_manager` 변환 shim을 지운다(추가 소유, lead 승인: `commands/reads.ts`의 그 줄).
- (lead가 더함, approvals-tool-judgment가 넘긴 것) `register.ts`의 `approvalRunLineage` port를 채운다.
- (lead가 더함, places-sessions-contexts-authority가 넘긴 것. 추가 소유, lead 승인: `wiring/projects.ts`의 그 port 줄) contexts가 `ContextAuthority`를 tx port로 받는다. wiring이 `defineTxPort(contextAuthorityPort, (tx) => ({ canWrite }))`를 writer 등록에 건다. `canWrite(actor, project)`는 `tx.sql`로 sessions를 읽어 actor(`agent:ses_…`)가 그 project의 Project Manager session인지 본다. 없으면 agent의 context 쓰기가 internal로 거절된다.
- (lead가 더함, agent-definition-instructions가 넘긴 것) `register.ts`에 `instructionsGet` route를 올린다(옛 `instructionReadRoute()`와 같은 placeholder. 실제 처리는 reader Worker의 `instructions/files.ts`의 `instructionsGetHandler`). 옛 `instructionReadRoute`를 내리고 `files.ts`의 `instructionReadHandler` wrapper도 지운다(추가 소유, lead 승인). protocol의 옛 `instructionRead`·`INSTRUCTION_READ_LAYERS`도 지운다.
- (lead가 더함, agent-definition-models가 넘긴 것) models 등록(`modelCommands.changeDefault/changeProject/changeFavorites`, `modelReads.modelDefault/projectModel/favorites/catalog`)은 models task가 register.ts에 최소로 걸어 두었다. 정리한다. `machineOnlyVisibility(providerDisconnected)`(register.ts)는 쓸 곳이 없다. `agentLookups.modelDefault`는 lead가 `loadChoice(sql, GLOBAL_SCOPE)`로 맞췄다. `loadWorkspaceModels`가 안 쓰이면 지운다.
- (lead가 더함, agent-definition-agents가 넘긴 것) `lophnAgentDefinitions`의 agents 줄(`agentCommands.create/change/delete/changeBuiltin`, `agentReads.list/read`, `uploadRoutes: [profileImageUpload]`, `files: [profileImageRead]`)을 정리한다. `skillsOffOf`의 `agentRefOf` 변환은 `commands/reads.ts`가 새 session 모양을 읽으면 지운다(위 roles 항목과 같이). `OperatorDirectory`(places/ports.ts)를 `listOperators(context)`·`loadAgent`로 채우는 wiring을 넣는다. 앱 등록 commit 뒤 `ensureAppEngineer`를 부르는 줄도 넣는다(추가 소유, lead 승인: 앱 등록 wiring의 그 줄).
- (lead가 더함, agent-definition-extensions가 넘긴 것) 새 handler 셋을 건다: `createSkillsRead({ files: placeFiles, skillFiles, lookups(sql): { skillSources(), skillsOff(), projectExists(id) }, dataRoot? })`, `createProjectExtensionReads`·`createProjectExtensionCommands({ files, lookups(sql): { projectExists(id) }, dataRoot? })`. 그 뒤 옛 `createGlobalSkillReads`, `createPlaceExtensionCommands`, `createPlaceExtensionReads`를 내리고 `global-skills.ts`, `place-settings.ts`, `place-store.ts`의 옛 부분과 옛 route(`globalSkillsRead`, `placeExtensionSettingsRead/Change/Changed`)를 지운다(추가 소유, lead 승인). `commandSkillsOf`에 role을 넘겨 내장 skill이 선언한 role의 `/` 메뉴에만 보이게 한다.
- (lead가 더함, agent-tools-shell-web이 넘긴 것) `agentRuntimeLaunchSpec`에서 `agentRuntimePermissions({ dataRoot, apiPort, socketRoot, mcpServers, hosts, skillRoots, bundledSkillRoots, placeFolders: {read, write} })`를 불러 `...p`로 싣는다(`allow_sys: []`, policy, memory limit은 register가 둔다).
- (lead가 더함) lead가 `register.ts`에 `instructionsGetRoute()` placeholder를 넣었다(`90847c6d`). 옛 `instructionReadRoute`와 `instructions/files.ts`의 `instructionReadHandler`, protocol `instructionRead`는 runtime이 더 안 쓴다. 지운다.
- (lead가 더함, agent-tools-call이 넘긴 것) `register.ts`가 `tools/questions/`의 `createQuestionCommands`·`createQuestionReads`·`createApplyQuestionOption`·`chosenOptionCall`·`deleteSessionQuestions`·`OPTION_ACTION_OWNERS`·`questionBodyFields`·`questionSchemaSteps`·`questionTextRead`를 쓴다. 새 질문 흐름(`ask`, `QuestionWait`)으로 옮길 수 있는 것은 옮긴다. 나머지 사용처(`waiting-and-recovery/commands.ts`, `run-loop/runtime-access.ts`, `session/rewind/effects.ts`, `wiring/lophn-agent.ts`)는 router-waiting과 cleanup이 본다.

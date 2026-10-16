# router-run-loop-turn

turn이 시작된 뒤의 run-loop를 새 설계로 맞춘다. `Run*` 이름을 `Turn*`으로 바꾸고, agent event를 ledger가 아니라 Bus에 내고, lophn을 켤 때 돌던 turn을 interrupted로 닫고, tool 목록을 session을 시작할 때 고정하고, tool 결과 포장을 web 결과만으로 줄이고, agent 식별을 assignment에서 role과 place로 바꾼다.

- 단위: router (wave 3)
- 선행: router-run-loop-input (같은 `run-loop/` 폴더의 `schema`·`commands`·`model`·`core-ports`·`ports`를 먼저 `turns` 표와 입력함으로 바꾼다)
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/` 중 router-run-loop-input이 고치지 않은 file 전부(`turn.ts`, `prepare.ts`, `limits.ts`, `status.ts`, `loop.ts`, `driver.ts`, `runtime*.ts`, `startup.ts`, `credentials.ts`, `agent-credentials.ts`, `tool-batch.ts`, `retry.ts`, `history.ts`, `scope.ts`, `redact-link.ts`, `blobs.ts`, `core-call.ts`, `mod.ts`)
  - 앞 task가 고친 file(`schema`, `commands`, `model`, `core-ports`, `ports`)의 남은 `run` 이름
- 읽을 것:
  - spec: S1 3·4·6·9·10장(Run-loop, agent event, 꺼졌다 켜질 때) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - spec: S4 3·6장(tool 목록 고정, 입력 꼴, tool 결과 포장) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S8 2·3장(role과 place, 꺼졌다 켜져도 session은 열린 채) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - inventory: `I1.1#6`, `I2.4#9`, `I2.4#13`, `I2.4#23`, `I2.8#6`, `I2.11#5`, `I3.1#3`
  - 결정: `../README.md` 3장 #2(agent event는 감독 pipe로 core Bus에), #5(file·shell·web tool은 agent runtime), #18·23·57
  - 지금 코드: `packages/core/lophn-agent/run-loop/*.ts`, `packages/core/main/agent-runtime/`(읽기만. 소유는 agent-tools)
- 계약:
  - 쓰는 것: `protocol/lophn-agent/{turns,turn-values,turn-reads,turn-blobs,places,agent-sessions}.ts`, `core/events/ports.ts`(contract-events가 만든 Bus port), `core/approvals/ports.ts`(Gate), 입력 tag 상수(contract-agent-tools). agent event(`TurnStarted`, `TurnEnded`, `ToolCallStarted`, `ToolCallEnded`, `CompactStarted`, `CompactEnded`, `MessageReceived`, `SessionStarted`/`SessionEnded`)의 이름과 payload는 S1 6장이고 contract-events가 `protocol/events`에 둔다.
  - 내놓는 것: `run-loop/mod.ts`가 내놓는 `Turn*` 이름 전부(이름 바꾼 것). 옛 `Run*` 이름은 다른 단위가 아직 import하므로 `mod.ts` 맨 아래 한 블록에 별칭으로 남기고 보고에 적는다.

## 모양

### 이름 바꾸기 (`run` → turn)

- 폴더 이름 `run-loop`은 S1이 "Run-loop"라는 부품 이름으로 쓰므로 그대로 둔다. 식별자와 file 이름만 turn으로 바꾼다. 예: `RunPorts` → `TurnPorts`, `RunInput` → `TurnInput`, `RunLoopHandle` → `TurnLoopHandle`, `startRunLoop` → `startTurnLoop`, `createRunCommands` → `createTurnCommands`, `RunLimiter`·`resolveRunLimits`·`RUN_LIMIT_SETTING_KEYS` → `Turn…`, `beginRun`·`createRunCredentials`·`AgentRunCredential` → `beginTurn`·`createTurnCredentials`·`AgentTurnCredential`, `runStatus`·`RunPhase`·`RunActivity` → `turnStatus` 등.
- 주석과 오류 문구의 "run"도 turn으로 바꾼다(`RunLoop`은 부품 이름이라 남긴다).
- 소유 밖에서 `run-loop/mod.ts`로 import하는 곳이 많다(`main/agent-runtime/`, `tools/`, `waiting-and-recovery/`, `register.ts`, `projects/contexts/ledger/deps.ts` 등). 그 쪽은 각 단위가 고친다. 그때까지 깨지지 않게 `mod.ts` 맨 아래에 `export { startTurnLoop as startRunLoop, … }` 식의 별칭 블록을 둔다. 새 코드는 별칭을 쓰지 않는다.

### agent event를 Bus에 내기 (`I3.1#3`, `I1.1#6`)

- 대화 기록(message, tool call과 결과, compact 경계)은 session 기록에 쓰고 ledger에 `Run*`·`ToolCall*`·`ModelCall*`·`Message*`·`Session*` event를 쓰지 않는다(S1 12장). run-loop가 이 기록을 쓰는 command들(`commands.ts`, `tools/commands.ts`, `session/*`)에서 ledger event emit을 걷어낸다. 이 task는 run-loop 쪽 emit만 걷는다. `tools/commands.ts`의 `ToolCall*`은 agent-tools, `session/*`은 places-sessions-session·conversation이 걷는다.
- agent event는 메모리 Bus에만 낸다: turn 시작과 끝(`TurnStarted`, `TurnEnded`: completed, failed, interrupted), tool call 시작과 끝, compact 시작과 끝, 사람 메시지(steer면 도는 turn 안의 `MessageReceived`. 그래서 turn 하나에 `MessageReceived`가 여럿일 수 있다), 대기 물음(`PermissionRequested`·`QuestionAsked`는 approvals와 agent-tools가 낸다. run-loop는 Gate가 묻는다고 답하면 turn을 멈춰 기다린다).
- runtime(child)에서 생기는 agent event는 감독 pipe로 core Bus에 넘긴다(#2). 이미 있는 pipe 메시지 종류(`protocol/supervision`)에 맞는 것이 없으면 모양을 새로 만들지 말고 "계약 바꾸기 요청"에 적는다.

### 켤 때 (`I3.1#3`, S1 10장)

- `startup.ts`/`loop.ts`: 켤 때 `state = running`인 turn은 모두 `finishTurn`으로 `interrupted`(이유 `restarted`)로 닫고 `TurnEnded`를 낸다. 다시 잇지 않는다(복구는 없다). 이어 하기에 쓰던 `ResumeState`, `LoopDeps.resume` 등을 지운다. 대기 권한 요청과 질문의 `cancelled` 처리는 approvals와 agent-tools 몫이다. 이 task는 그쪽이 부를 수 있게 interrupt 함수 `interruptRunningTurns(tx, reason)`만 내놓는다.
- session을 archive하거나 지울 때 도는 turn을 interrupted(이유 `session_ended`)로 닫고 진행한다(S8 3장). places-sessions-session이 부를 수 있게 같은 함수에 `session` 인자를 둔다.

### session을 시작할 때 고정 (`I2.4#13`, `I2.4#9`)

- `prepare.ts`의 `createRunPreparer`(`createTurnPreparer`): tool 목록을 turn마다 만들지 않고 session을 시작할 때 만든 것을 쓴다. 도중에 activation이나 grant로 tool이 바뀌면 `tools[]`는 그대로 두고 대화 끝에 `<lophn-notice kind="tools">`를 붙인다(S4 4장·6장). 목록 계산 자체(app-api tool 이름 표, deferred 문턱)는 agent-tools가 맡는다. 이 task는 "고정"과 "바뀌었을 때 notice를 붙이는 위치"만 만든다.
- skill 목록 위치(`turn.ts`의 `skillInstructionText`를 role 지시에 합치던 것): prompt 순서 4번(지침 층 뒤, place 정보 앞)에 넣는 일은 prompt-assembly(agent-definition)가 한다. 이 task는 `turn.ts`에서 skill 목록을 role 지시에 합치는 줄을 지우고, assembled prompt를 prompt-assembly에서 받는 입구를 한 곳으로 정리한다. prompt-assembly가 순서를 아직 지원하지 않으면 `skillInstructionText` 호출을 그대로 두고 보고 "정한 것"에 적는다.

### tool 결과 포장 (`I2.4#23`)

- `history.ts`의 `historyResultPart`가 모든 tool 결과를 `wireData`(`~~~data` 감싸기)로 포장하던 것을 바꾼다. web search·fetch 결과만 `<lophn-untrusted source="…">`로 감싸고 닫는 tag를 무력화한다. 파일, shell, app-api, 외부 MCP 결과는 감싸지 않는다(S4 6장 tool 결과 표).
- 포장 함수는 `run-loop/untrusted.ts`에 새로 둔다. `safety/fence.ts`(approvals 소유)는 고치지 않는다. `safety/`를 import하는 줄은 지운다. `wireData`·`DATA_START_MARKER`는 approvals가 안 쓰게 되면 cleanup이 지운다.

### agent 식별 (`I2.8#6`, run-loop 쪽)

- `agent-credentials.ts`, `credentials.ts`, `scope.ts`, `status.ts`: assignment ID(`agent:asg_…`)로 agent를 가리키던 것을 session ID로 바꾼다. 접근 판정 actor는 `agent:ses_…`이고 role과 place는 session 기록에서 얻는다(`AgentRef`, `Place`). `agentConditions`의 `assignment` 조건은 `session`으로, `source.kind === "handoff"`로 증거 판을 고정하던 `evidence`는 없앤다(문서 판 근거 자체가 없다).
- `scope.ts`(`computeAgentAppScope`, `AppOffer`)는 app command 범위를 정하던 것이다. 이제 app-api 호출은 grant와 tool 목록이 정하므로(S2, S4 4장) 이 계산은 agent-tools·approvals 쪽 입력이 된다. 지우지 말고 쓰는 곳을 센 뒤, 쓰는 곳이 소유 밖에만 남으면 그대로 두고 보고에 적는다.

### 필수 선택이 비었을 때 (`I2.11#5`)

- `limits.ts`의 `resolveRunLimits`(`resolveTurnLimits`)가 설정이 비면 거절하던 것을 "필수 선택이 비면 그 기능만 시작하지 않고 다른 기능은 그대로"로 바꾼다. 필수 선택(provider·model)이 비었을 때 turn 시작이 `configuration_unavailable`로 failed가 되고 session은 입력을 계속 받는다. 설정 값의 정의(`core/config/registry.ts`)는 platform 단위가 맡는다. 이 task는 turn 시작 쪽 처리만 한다.

## 할 일

1. 위 이름 바꾸기를 `run-loop/` 안에서 끝낸다. file 이름도 필요하면 바꾼다(`run-*`로 시작하는 것).
2. ledger event emit을 걷어내고 Bus port로 agent event를 낸다. Bus port가 아직 없으면(contract-events가 `core/events/ports.ts`에 내놓은 이름을 쓴다) 멈추고 보고한다.
3. `interruptRunningTurns`를 만들고 켜는 길(`startup.ts`)에서 부른다.
4. `prepare.ts`, `turn.ts`, `history.ts`(`untrusted.ts`)를 고친다.
5. 식별을 role과 place로 바꾼다.
6. `mod.ts`를 새 이름으로 정리하고 별칭 블록을 둔다.
7. test는 `untrusted_test.ts` 하나: "web 결과의 닫는 tag는 무력화되고 파일·shell 결과는 감싸지지 않는다". 나머지는 만들지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "web 결과만 untrusted로 감싸이고 본문 안의 닫는 tag는 무력화된다"
- 남지 않음: `grep -rn "\bRun[A-Z]\|\brunId\|assignment" packages/core/lophn-agent/run-loop`가 `mod.ts`의 별칭 블록 밖에서 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `main/agent-runtime/`, `register.ts`, `core.ts`, `tools/`, `waiting-and-recovery/`가 import하는 `Run*`이 별칭으로 남아 있다. 각 단위의 목록으로 적는다. 감독 pipe 메시지가 필요하면 `protocol/supervision`에 더할 것
- 안 쓰게 된 export: 별칭 블록 전체, `safety`의 `wireData`/`DATA_START_MARKER` 사용
- 정한 것: 폴더 이름 `run-loop`을 유지한 것, `interruptRunningTurns`의 모양, skill 목록 위치를 prompt-assembly에 넘긴 방식, 필수 선택이 빈 turn의 실패 이유
- 계약 바꾸기 요청(wave 3): 감독 pipe의 agent event 메시지, Bus port에 모자란 것

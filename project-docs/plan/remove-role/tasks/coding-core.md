# coding-core

core와 protocol에서 coding session 층을 지운다: `packages/core/apps/coding`(표 `coding_sessions`·`coding_lines`·`coding_inputs`, transport, 줄, relay, 끝 알림, 기본 harness·model 설정), coding token 발급과 인증, coding MCP endpoint, Router의 coding transport와 coding 맡기기 줄, protocol의 coding session 파일. 터미널 agent 층(hook 신호 표, harness 감지와 설치)은 남긴다.

- 단위: coding (wave 1)
- 선행: coding-shell, coding-cli. shell과 CLI가 지울 protocol 파일을 먼저 놓아야 한다.
- 소유(이 task만 고친다):
  - `packages/core/apps/coding` (지운다. harness 감지 목록을 남기면 그 부분만 남긴다)
  - `packages/core/apps/mcp` (지운다)
  - `packages/core/apps/annotations/{register,reads}.ts` (coding session 찾기 port)
  - `packages/core/server/{mcp,server,dispatch,routes}.ts`
  - `packages/core/server/identity/{coding-token,coding-token_test,mod,registry,registry_test}.ts`
  - `packages/core/router/{model,ports,router,reads,registration,router_test}.ts`
  - `packages/core/main/daemon/assembly.ts`
  - `packages/core/main/daemon/wiring/{coding-mcp,coding-sessions,router-registration,server,session-snapshots,setting-declarations}.ts`
  - `packages/protocol/coding-agent/{message,token,transport,mcp,mcp-launch,launch-plan,terminal-requests,harness-adapter,harness-report}.ts`
  - `packages/protocol/events/gateway.ts`
- 추가 소유(뼈대 검토, planner): 살 단계가 "소유 줄 밖"으로 적은 file을 소유로 옮긴다. 그 step의 "넘길 줄"/"lead가 소유에 더한다" 표시는 이제 이 task의 일이다.
  - `packages/core/server/mod.ts`
  - `packages/core/main/daemon/wiring/context.ts`
  - `packages/core/main/daemon/core.ts`
  - `packages/protocol/coding-agent/cli-commands.ts`
  - `packages/base/install/linux-install.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/coding-agent.md` 전부. 지울 층(앱마다 session 하나, 맡기기 줄, 실행 계획, token, MCP endpoint, hook을 session 상태로 세기, 끝 알림, 켤 때 복구)의 흐름이다.
  - architecture: `project-docs/architecture/terminal-agent.md`. 남는 것이다. core에는 이 층이 없다(core는 사람 터미널을 모른다). protocol에 남는 표는 `hook-signal.ts`, `harnesses.ts`, `harness-id.ts`, `harness-hooks.ts`, `harness-process.ts`, `terminal-hook.ts`, `cli-commands.ts`와 `HARNESS_ADAPTERS`의 감지·설치·끊기 key 칸이다.
  - architecture: `project-docs/architecture/agent-call.md`의 "받는 곳이 role `coding_agent`로 풀리면" 줄과 `queued_coding` 줄, `project-docs/architecture/app-call.md`의 coding agent MCP 줄, `project-docs/architecture/event.md`의 session snapshot 줄.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `coding-agent-mcp`, `coding-agent-cli-interface`, `core-api`, `router`, `server`, `apps`, `events`. `project-docs/module-catalog.yaml`의 `packages/core/apps`(apps), `packages/core/router`(router), `packages/core/server`(server), `packages/core/main`(core), `packages/protocol`(protocol).
  - 계획: `project-docs/plan/remove-role/README.md`의 "저장과 test"의 schema 줄("coding 표 셋은 지운다…")과 "뼈대 검토"의 `coding_agent` actor 줄·coding 갈래 줄. `project-docs/plan/remove-role/tasks/coding-shell.md`, `project-docs/plan/remove-role/tasks/coding-cli.md`의 "계약"(이 task가 기대는 것).
  - 코드: `packages/core/apps/coding/{register,schema,mod,transport,relay,close-call}.ts`, `packages/core/main/daemon/assembly.ts`, `packages/core/main/daemon/wiring/{coding-sessions,coding-mcp,router-registration,session-snapshots,setting-declarations,server,context}.ts`, `packages/core/main/daemon/core.ts`, `packages/core/router/{ports,router,model,reads,store,commands}.ts`, `packages/core/lophn-agent/run-loop/work.ts`(`createLophnInputTransport`), `packages/core/server/{server,mcp,mod}.ts`, `packages/core/server/identity/{registry,registry_test,coding-token}.ts`, `packages/core/apps/annotations/{register,reads}.ts`, `packages/core/storage/ledger/reads.ts`(`ReaderRegistration`), `packages/core/storage/migration/migrations.ts`(schema 이력), `packages/protocol/coding-agent/*.ts`, `packages/protocol/events/gateway.ts`.
- 계약:
  - 쓰는 것: `coding-shell`, `coding-cli`가 끊은 import.
  - 내놓는 것:
    - Router는 coding session으로 배달하지 않고 coding 맡기기 줄이 없다. 받는 곳이 옛 주소용 `coding_agent`로 풀리면 지금처럼 `invalid_input`이다(그 가지는 `router-core`가 새 주소로 옮기며 없어진다).
    - core에 coding token principal이 없다. `coding_agent` actor 종류와 route의 actors 목록, `CallFrom`의 `coding_agent`, `codingOptionsSchema`(`harness-id.ts`), `messages.from_kind`의 `coding_agent`는 protocol·표에 남는다(wave 4 `cleanup-protocol`·`cleanup-core`가 지운다).
    - 표 셋의 schema step을 지운다. 개발 data는 지우고 새로 만든다.
    - 등록할 것(lead): `packages/protocol/coding-agent/mod.ts`·`registry.ts`, `packages/protocol/mod.ts`의 지운 file 줄.

## 할 일

선: lophn이 띄운 coding session 층을 core·protocol에서 통째로 지운다. core에는 터미널 agent 층이 없으므로 `packages/core/apps/coding`은 남길 것이 없다. 감지 목록(`harnesses.ts`, route `coding_agent_harnesses/list`)도 coding 맡기기의 `not_connected`·`cannot_launch` 판정에만 썼다. Settings › Coding agents는 shell main이 `lophn harness detect`로 직접 읽는다(`terminal-agent.md`).

‡ 표시 file은 뼈대 소유에 없다. lead에게 보고했고, lead가 소유에 더한 뒤 고친다. 소유에 없는 채로 띄워졌으면 그 단계는 하지 말고, 할 수 있는 데까지 한 뒤 보고에 적는다.

0. 시작 전에 선행 task가 import를 끊었는지 본다. `grep -rn "coding-agent/\(message\|token\|transport\|mcp\|mcp-launch\|launch-plan\|terminal-requests\|harness-report\)\.ts\|codingTerminalFrameSchema\|canLaunch\|CODING_TOKEN_ENV\|coding_agent_terminals\|coding_agent_harnesses" packages/shell packages/coding-agent tools`와 `grep -n "CODING_ROUTES\|MESSAGE_ROUTES\|HARNESS_ROUTES\|TERMINAL_ROUTES" packages/protocol/coding-agent/cli-commands.ts packages/protocol/coding-agent/registry.ts`가 둘 다 0줄이어야 한다. 아니면 고치지 말고 보고한다.

### A. DB 표와 coding module

1. `packages/core/apps/coding/`를 통째로 지운다(`coding_test.ts`, `store_test.ts` 포함).
   - schema step: `apps/coding/schema.ts`의 `codingSchemaSteps`에 든 step 하나 `coding-agent.sessions.tables`다. 표 `coding_sessions`, `coding_lines`, `coding_inputs`와 index `coding_sessions_active`, `coding_sessions_call`, `coding_lines_app`, `coding_inputs_session`을 만든다.
   - 등록 길: `apps/coding/register.ts`의 `codingDefinitions.schemaSteps` → `packages/core/main/daemon/assembly.ts`의 `TEAMS` 줄 `{ createCoreRegistration: createCodingRegistration }`, 그리고 writer·reader Worker가 싣는 `TEAM_MODULES`의 `new URL("../../apps/coding/register.ts", import.meta.url).href`. 두 줄과 `createCodingRegistration` import를 지운다.
   - 같이 사라지는 것: command `ApplyCodingSignal`, port `CodingTransport`·`CodingSessionLookup`의 구현, memory route 여섯(`coding_agent_sessions/send_message`, `coding_agent_harnesses/report`·`list`, `coding_agent_terminals/result`·`exited`·`hook`), after-commit topic `coding_terminal`·`coding_revoke`, 켤 때 복구 `recoverCoding`, 설정 `coding-agent.default_harness`·`coding-agent.default_model`.
   - schema 이력은 step의 순번과 SQL hash로 맞춘다(`packages/core/storage/migration/migrations.ts`의 `checkHistory`). step 하나가 빠지면 옛 data root는 기동을 거절한다. migration을 만들지 않는다(AGENTS.md "호환성"). worktree의 `.dev-data/`에 옛 ledger가 있으면 `chmod -R u+w` 뒤 지우고 새로 만든다. `~/.lophn`은 건드리지 않는다.
   - `messages.from_kind`의 `coding_agent`는 남긴다(계약, `cleanup-core`).
2. `packages/core/apps/mcp/`(mod, serve, serve_test)를 지운다. `main/daemon/wiring/coding-mcp.ts`, `main/daemon/wiring/coding-sessions.ts`를 지우고, `assembly.ts`의 두 import와 `WIRINGS`의 `codingMcpWiring`·`codingSessionsWiring`을 뺀다.
3. `main/daemon/wiring/setting-declarations.ts`: `codingDefaultHarness`·`codingDefaultModel`과 import를 뺀다.
4. `main/daemon/wiring/session-snapshots.ts`:
   - coding snapshot을 싣는 덩어리(`liveSessions`, `loadCodingSession`, `codingPlace`, `stateOf`, `harness: row.harness`)와 `apps/coding/store.ts` import를 지운다.
   - Bus 구독 `send`의 "lophn session 행이 없는 `TurnStarted`" 가지(`liveTurns.apply(event, false)`)를 지운다. 그런 event는 coding session만 냈다.
   - 머리 주석의 "coding session"을 뺀다.

### B. Router

5. `main/daemon/wiring/router-registration.ts`:
   - `withCodingSessions`, `transport`의 `CodingTransport` 가지(`deliver`·`cancel`), `queued`의 `codingLines`, `describe`의 coding session 가지를 지운다.
   - import(`CodingTransport`, `HARNESS_ADAPTERS`, `codingLines`, `apps/coding/store.ts`)를 지운다.
   - transport는 `createLophnInputTransport`가 만든 것을 그대로 쓴다. 그 `queued()`는 빈 목록이다. directory는 `createSessionDirectory` 그대로다.
6. `router/ports.ts`:
   - `TargetSession.transport`를 `"lophn"`만으로 좁히고 "harness는 coding agent PTY다" 주석을 지운다.
   - `InputTransport.deliver`의 넷째 인자 `options`와 `CodingOptions` import를 지운다.
   - `cancel` 주석의 "줄에 서 있던 coding 맡기기는 줄에서 뺀다"를 지운다.
   - `InputTransport.queued()`와 `CallStore.setReceiver`는 남긴다(정한 것). 주석은 "늘 빈 목록이다"처럼 지금 동작에 맞춘다.
7. `router/router.ts`:
   - `transport.deliver` 세 곳의 넷째 인자(`input.options`, `null`)를 지운다.
   - `Router.close`(interface, 구현, return 칸)를 지운다. 쓰던 곳은 `apps/coding/close-call.ts`뿐이다.
   - `notCoding`과 거절 가지 셋은 남긴다(계약).
   - "사람, program, agent, coding agent" 주석에서 coding agent를 뺀다.
8. `router/model.ts`: `RouteInput.options`는 남긴다. `router/commands.ts`(소유 밖)가 옛 envelope에서 채운다. 주석을 "Router는 쓰지 않는다"로 고친다. "coding agent가 모두 이 모양으로" 주석을 고친다.
9. `router/reads.ts`: `queued_coding: [...transport.queued()]`는 옛 `callSendable` output이 요구해 그대로 둔다. "waiting은 coding session만 낸다" 주석을 고친다.
10. `router/router_test.ts`, `router/registration.ts`: type이 맞으면 고칠 것이 없다. test fake의 `deliver`는 이미 인자 셋이다.

### C. MCP endpoint와 coding token

11. `server/server.ts`: `/mcp` 가지, 옵션 `mcp?: McpEndpoint`, `CODING_MCP_PATH`·`McpEndpoint` import를 지운다. `server/mcp.ts`를 지운다. 같이 고칠 소유 밖 file:
    - ‡ `packages/core/server/mod.ts`: `./mcp.ts` export 덩어리(`createMcpEndpoint`, `McpCallResult`, `McpEndpoint`, `McpTools`). 지운 file을 가리키는 등록 줄이다.
    - ‡ `packages/core/main/daemon/wiring/context.ts`: `McpEndpoint` import와 wiring build 결과의 `mcp?` 칸. 같은 file의 `gateway`·`appCallPath` 주석의 coding 말을 고친다(`appCallPath`는 runs wiring도 쓰니 칸은 남는다).
    - ‡ `packages/core/main/daemon/core.ts`: server를 열 때 넘기는 `mcp: builts.find(…)?.mcp` 줄.
12. `server/identity/`:
    - `coding-token.ts`, `coding-token_test.ts`를 지우고 `mod.ts`의 `createCodingTokens` export를 뺀다.
    - `registry.ts`: `CredentialIssue.actor`의 `` `coding_agent:${string}` ``, `issue`가 받는 kind 목록의 `coding_agent`(이제 그 kind 발급은 `invalid`다), "coding token은 session 하나가 받은 앱 하나에 묶인다" 검사 덩어리를 지운다.
    - 같은 file에서 coding token을 말하는 주석 넷을 고친다: `CredentialIssue` 주석, "발급은 동기여야 해서(CodingTokens port)", 위 검사 주석, `endBy` 주석("같은 앱 조건을 가진 coding token 같은 다른 종류는 남는다" → agent credential).
13. `server/identity/registry_test.ts`: "ending an app's credentials leaves its coding token alive"를 같은 앱 조건의 agent credential로 옮긴다(정한 것).
    - 이름: "앱 credential을 끝내도 같은 앱 조건의 agent credential은 남는다".
    - agent credential은 `actor`·`principal` `agent:<ses>`, `scope: { operations: ["ticket.show"], targets: { session, turn } }`, `conditions: { app, session, turn }`이다(`issue`의 agent 검사가 session·turn을 요구한다). 같은 file의 첫 test("an agent credential reaches only its own session and turn")가 만드는 방법을 따른다. 정책 `ticket.show`의 actors는 `["app", "agent"]`다.
    - 판정: `keys.endBy("app", app, "app")`가 1이고, app credential은 `revalidate`가 실패하고, agent credential은 `revalidate`가 된다.
14. `main/daemon/wiring/server.ts`: `codingAgentOperationPolicies` 호출과 import, `platform/status`·`platform/health` actors의 `"coding_agent"`를 지운다. 주석 "coding_agent 상한은 route가 선언한 actors를 따른다"를 지운다.
15. `server/dispatch.ts`, `server/routes.ts`: `actorKind`의 `coding_agent`는 protocol actor 종류가 남는 동안 둔다(계약). 고칠 것이 없다.

### D. annotation

16. `apps/annotations/register.ts`: reader 등록에서 `CodingSessionLookup` port를 빼고 `ports: new Map()`로 둔다(`ReaderRegistration.ports`는 필수 칸이다). `CodingSessionLookup`·`codingSessionLookup` import를 지운다.
17. `apps/annotations/reads.ts`: `callerScope`의 coding session 가지와 `CodingSessionLookup` import를 지운다. 범위는 user·machine이면 전체(null), agent면 자격 조건의 앱·project, 그 밖이면 `forbidden`이다(정한 것). 머리의 "호출자 범위" 주석을 맞춘다.

### E. protocol

18. 지운다: `packages/protocol/coding-agent/{message,token,transport,mcp,mcp-launch,launch-plan,terminal-requests,harness-report}.ts`.
19. `packages/protocol/coding-agent/harness-adapter.ts`:
    - `HarnessAdapter`의 `model_flag`, `prompt`, `mcp` 칸과 모든 항목의 그 값, 그 값에 붙은 "확인함" 주석(`--mcp-config`, `-c mcp_servers…`, `OPENCODE_CONFIG_CONTENT`, prompt 전달 조사)을 지운다. `canLaunch`를 지운다.
    - 남긴다: `id`, `label`, `commands`, `process`, `version_probe`, `interrupt_keys`, `skill_dir`, hook 위치 주석, `canDeliverMessages`(정한 것).
    - 머리 주석의 "첫 prompt 전달 방법"을 뺀다.
20. `packages/protocol/events/gateway.ts`: `codingTerminalFrameSchema` import와 `GATEWAY_SERVER_FRAMES`의 그 줄을 지우고, "터미널 요청 같은 shell main 전용 frame은 이 목록에 따로 더하고" 주석을 고친다.
21. `packages/protocol/coding-agent/mod.ts`(lead 등록 file): 지운 file을 가리키는 export 줄(`./launch-plan.ts`, `./mcp-launch.ts`, `./token.ts`, `./message.ts`, `./harness-report.ts`, `./terminal-requests.ts`, `./transport.ts`, `./mcp.ts`)과 `canLaunch`만 뺀다. orchestrate review의 "지운 것을 가리키던 등록 줄만 뺀 것"이다. 보고의 "등록할 것"에 적는다. `packages/protocol/mod.ts`와 `registry.ts`는 고칠 것이 없다(`coding-cli`가 `ROUTES`를 비웠다).

### F. 이름 grep

22. 지운 이름을 `packages tools tests`에서 문자열로도 찾는다(route는 resource·method 문자열로: `coding_agent_sessions`, `coding_agent_harnesses`, `coding_agent_terminals`). 소유 안의 주석과 오류 글을 고친다. 소유 밖에 남는 것은 고치지 않고 보고에 적는다. 알려진 것은 아래다.
    - 쓰는 곳이 없어지는 export: `packages/core/apps/connections/operations.ts`의 `codingAgentOperationPolicies`, `packages/core/events/gateway.ts`의 `GatewayFrames.send`, `packages/core/router/store.ts`의 `setReceiver`, `packages/core/lophn-agent/run-loop/live-turns.ts`의 `apply`의 `trackTime` 인자.
    - 낡는 주석: `packages/core/main/daemon/wiring/apps.ts`(다른 topic의 coding applier, coding credential과 blobs), `packages/core/server/identity/app-credential.ts`(같은 앱의 coding token), `packages/core/apps/agent-tools/runtime.ts`(coding agent CLI), `packages/core/storage/ledger/writer-assembly.ts`(coding-agent 모양).
    - 낡는 제품 글: `packages/core/agent-roles/skills/guide-questions-and-decisions/SKILL.md`의 "The questions a coding agent asks in its own terminal also show in the waiting list"(coding session의 harness 물음만 대기 목록에 왔다).
    - wave 4가 지우는 `coding_agent` actor 가지(`target-authorization.ts`, `command-outcome.ts`, `projects/registry/reads.ts`, `apps/preview/service.ts`, `apps/registration/commands.ts`, `apps/control.ts`, `lophn-agent/run-loop/input-text.ts`, `wiring/approvals.ts`, `wiring/jobs-registration.ts`, `runs/service.ts`)는 그대로 둔다.

### 정한 것

- **`packages/core/apps/coding`은 harness 감지 목록까지 통째로 지운다.** core의 감지 사본은 coding 맡기기의 판정과 renderer가 부르지 않는 `harness.list`에만 쓰였다. 남길 감지는 shell main과 CLI에 있다.
- **`canDeliverMessages`는 남긴다.** shell의 Settings Turn-end 칸이 쓴다(`coding-shell`). `canLaunch`와 `prompt`·`mcp`·`model_flag`는 coding session 실행 계획(`launch-plan.ts`, `mcp-launch.ts`)만 읽었다.
- **`InputTransport.queued()`와 `CallStore.setReceiver`는 남긴다.** 구현이 소유 밖(`packages/core/lophn-agent/run-loop/work.ts`, `packages/core/router/store.ts`)의 object literal이라 interface에서 빼면 type check가 깨진다. 옛 `callSendable`의 `queued_coding`도 아직 칸을 요구한다. `router-core`(wave 2)가 새 route로 옮길 때 지운다.
- **annotation 읽기 범위를 "agent가 아니면 전체"에서 "user·machine만 전체, 그 밖은 `forbidden`"으로 바꾼다.** coding 가지만 지우면 옛 규칙에서 `coding_agent` actor(protocol과 route의 actors에 남는다)가 전체를 읽는 길이 된다. 닫힌 쪽으로 둔다.
- **`codingAgentOperationPolicies`를 더 부르지 않는다.** coding token을 발급하는 곳이 없고 `issue`가 그 kind를 거절한다. 정의와 `apps/control.ts`의 coding_agent 정책은 소유 밖이라 남기고 보고한다(wave 4).
- **registry_test의 그 test는 지우지 않고 agent credential로 옮긴다.** `endApp`(`endBy("app", app, "app")`)의 kind 거르기가 남은 이유는 앱 place agent의 turn credential(`conditions.app`)을 지키는 것이다. coding token이 없어졌다고 kind 인자를 지우면 앱 process가 다시 뜰 때 그 앱 place의 turn이 자격을 잃는다.

## 끝남

- `npm run check`가 통과한다. protocol을 고쳐서 core·shell·coding-agent type check와 test가 다 돈다.
- `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다. core 기동이 memory route와 handler를 대조한다(`packages/core/main/daemon/core.ts`의 `memoryRouteMismatch`).
- 위험 test: "앱 credential을 끝내도 같은 앱 조건의 agent credential은 남는다"(`packages/core/server/identity/registry_test.ts`, 옮겨 고친 것).
- 남지 않음:
  - `grep -rn "apps/coding\|apps/mcp\|coding_sessions\|coding_lines\|coding_inputs\|CodingTransport\|CodingSessionLookup\|CodingTokens\|createCodingTokens\|codingPrincipal\|codingMessageSend\|coding_agent_sessions\|coding_agent_terminals\|coding_agent_harnesses\|codingTerminal\|coding_terminal\|coding_revoke\|harnessReport\|CODING_MCP\|createMcpEndpoint\|McpEndpoint\|withCodingMcp\|launchPlanOf\|firstPromptOf\|codingLaunchPlanSchema\|PASTE_AFTER_HOOK\|canLaunch\|model_flag\|codingDefaultHarness\|codingDefaultModel\|coding-agent.default_\|CODING_TOKEN_ENV" packages tools tests --exclude-dir=runs --exclude-dir=experiments --exclude-dir=materials`가 0줄이다. ‡ file이 소유에 더해지지 않았으면 `McpEndpoint`·`createMcpEndpoint`가 그 file에 남는다. 그때는 보고에 적는다.
  - `grep -rn "codingAgentOperationPolicies" packages`는 정의 한 줄(`packages/core/apps/connections/operations.ts`)만 나온다.
  - `test ! -e packages/core/apps/coding && test ! -e packages/core/apps/mcp && test ! -e packages/core/server/mcp.ts && test ! -e packages/core/server/identity/coding-token.ts`가 성공한다.
  - `ls packages/protocol/coding-agent`에 `message.ts`, `token.ts`, `transport.ts`, `mcp.ts`, `mcp-launch.ts`, `launch-plan.ts`, `terminal-requests.ts`, `harness-report.ts`가 없다.
- 남는 것(지우지 않는다): `coding_agent` actor 종류, `CallAgent`·`CallFrom`·`NamedAgent`의 `coding_agent`, `codingOptionsSchema`, `messages.from_kind`의 `coding_agent`, `callSendable`의 `queued_coding`, Router의 `notCoding`.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

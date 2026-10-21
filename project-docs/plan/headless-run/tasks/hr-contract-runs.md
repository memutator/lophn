# hr-contract-runs

approval-simplify가 land한 뒤의 call 봉투(unattended 표시) 위에서, run의 protocol(run 기록, run route, 내부 command)을 `packages/protocol/runs/`에 새로 두고 run이 기대는 작은 계약 셋(`run` id 접두사, `namedAgentSchema` export, `SendMessage`의 unattended 칸)을 더한다. 그 계획이 사람 메시지에 unattended를 이미 열었으면 `inputs.ts`는 고치지 않는다.

- 단위: contract (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/runs/runs.ts`
  - `packages/protocol/runs/mod.ts`
  - `packages/protocol/base/ids.ts`
  - `packages/protocol/lophn-agent/calls.ts`
  - `packages/protocol/lophn-agent/inputs.ts`
- 읽을 것:
  - 제품 결정: `project-docs/plan/headless-run/README.md`의 "정한 것"과 "뼈대 검토에서 정한 것"(`--agent`의 짧은 꼴, code fence 하나 벗기기, `--schema`는 JSON 글, `invalid_output`은 run의 실패 이유, tool run 취소, run 입력은 켤 때 다시 줄 세우지 않음, `operator:<x>/<이름>`은 project 먼저이고 `StartRun`은 이름을 다 푼 뒤 session을 연다, CLI의 결과와 종료 코드). roadmap `project-docs/products/roadmap/headless-schedule.md`의 "모양"(agent 호출은 비결정적 함수다, run·job·flow 표)과 "정한 것 (agent)", `project-docs/products/roadmap/approval.md`의 "turn mode"(unattended는 call을 따라 간다)
  - architecture: `project-docs/architecture/agent-call.md` "지키는 것"(받는 쪽 이름은 정확히 맞아야 풀린다, 여럿이면 invalid_input, 자동 재시도가 없다), `project-docs/architecture/place-session.md` "지키는 것"(session은 저절로 끝나지 않는다, 꺼졌다 켜지면 돌던 turn은 interrupted), `project-docs/architecture/event.md`(Bus는 놓칠 수 있고 정본은 표다), `project-docs/architecture/layers.md`(`packages/protocol`은 경계 사이의 약속)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `protocol`, `core-api`, `runs`(lead가 먼저 둔다); `project-docs/module-catalog.yaml`의 `packages/protocol`
  - 코드(본보기와 이어 붙일 곳)
    - `packages/protocol/base/route.ts`(`defineMemory`, `defineRead`, `defineCommand`의 `compare`, 필수 `errors`와 공통 오류 코드 일곱), `packages/protocol/base/envelope.ts`(`withReadCommon`), `packages/protocol/base/values.ts`(`atSchema`, `seqSchema`, `readCursorSchema`), `packages/protocol/base/ids.ts`(`ID_PREFIXES`, `idSchema`)
    - `packages/protocol/lophn-agent/calls.ts`(`namedAgentSchema`, 지금은 export가 아니다), `packages/protocol/lophn-agent/places.ts`(`agentRefSchema`, `agentRefOutputSchema`), `packages/protocol/lophn-agent/inputs.ts`(`sendMessageInputSchema`)
    - `packages/protocol/apps/channel-values.ts`(`toolNameSchema`, `invocationIdSchema`, `../base/json-values.ts`의 `jsonValueSchema`를 다시 내보낸다), `packages/protocol/projects/values.ts`(`appIdSchema`)
    - 본보기: `packages/protocol/lophn-agent/turn-reads.ts`(read route와 `readErrors`·`readActors`), `packages/protocol/lophn-agent/inputs.ts`의 `removeQueued`(memory route), `packages/protocol/lophn-agent/turns.ts`의 `stopTurn`(compare가 있는 command), `packages/protocol/lophn-agent/turn-values.ts`(`turnRecordSchema`의 refine), `packages/protocol/domains/mod.ts`(`ROUTES` 내보내기)
    - approval-simplify가 call 봉투와 `SendMessage`에 둔 unattended 표시(앞 계획 land 뒤 path 확인)
- 계약:
  - 쓰는 것: `packages/protocol/base/{route,ids,values,envelope}.ts`(`defineMemory`·`defineRead`·`defineCommand`, `idSchema`, `atSchema`·`seqSchema`·`readCursorSchema`, `withReadCommon`), `packages/protocol/lophn-agent/places.ts`(`agentRefOutputSchema`), `packages/protocol/apps/channel-values.ts`(`toolNameSchema`, `invocationIdSchema`, `jsonValueSchema`), `packages/protocol/projects/values.ts`(`appIdSchema`), approval-simplify가 call 봉투에 둔 unattended 표시
  - 내놓는 것(다른 task가 이 이름과 모양에 기댄다. 이 task만 바꾼다):
    - `ids.ts`: 접두사 `run`("Run")을 `ID_PREFIXES`에 더한다.
    - `calls.ts`: `namedAgentSchema`를 export만 한다(모양은 그대로, type `NamedAgent`는 이미 export다). run의 받는 agent가 Router와 같은 이름 풀기를 쓴다.
    - `inputs.ts`: `sendMessage` 입력에 `unattended: z.literal(true).optional()`를 더한다(approval-simplify의 표시 이름이 다르면 그 이름). 사람 화면은 싣지 않고 run만 싣는다.
    - run 기록(`runs.ts`):

      ```ts
      export const RUN_KINDS = ["agent", "tool"] as const;
      export const RUN_STATES = ["running", "done", "failed", "cancelled"] as const;
      // run이 실패한 이유. 경계의 오류 코드(일곱)가 아니라 run 기록의 칸이다.
      export const RUN_FAIL_REASONS = [
        "invalid_output", // schema를 주었는데 답이 JSON이 아니거나 schema에 맞지 않는다
        "no_answer", // turn이 completed로 끝났는데 그 turn의 답 글이 없다
        "turn_failed", // turn outcome이 failed다. message에 outcome reason
        "turn_interrupted", // turn이 user_stopped·session_ended로 끝났다
        "start_failed", // session을 열거나 메시지를 넣지 못했다. message에 오류 code
        "tool_failed", // 앱 handler 오류. message에 앱 오류 code와 글
        "tool_denied", // handler까지 가지 못했다. message에 denial code
        "tool_unknown", // 결과를 모른다. message에 unknown reason
        "lophn_restarted", // 끝나기 전에 lophn이 꺼졌다 켜졌다(turn이 restarted로 끝남 포함)
      ] as const;

      export const runRecordSchema = z.object({
        id: idSchema("run"),
        kind: z.enum(RUN_KINDS),
        // agent: 이름을 푼 agent. tool: 앱과 tool 이름.
        target: z.union([
          z.object({ agent: agentRefOutputSchema }),
          z.object({ app: appIdSchema, tool: toolNameSchema }),
        ]),
        session: idSchema("ses").nullable(), // agent만. run이 연 session 또는 --session
        session_opened: z.boolean(), // run이 session을 열었다. 화면은 이것만 run 아래에 묶는다
        input_message: idSchema("msg").nullable(), // agent만. run이 넣은 메시지
        turn: idSchema("trn").nullable(), // agent만. 그 메시지가 연 turn. 끝을 안 뒤에 채운다
        invocation: invocationIdSchema.nullable(), // tool만. 기록이 없는 성공한 읽기면 null
        schema: z.json().nullable(), // agent만. 출력 JSON Schema
        state: z.enum(RUN_STATES),
        // done의 값. agent: 답 글(string), schema가 있으면 읽은 JSON 값. tool: tool 결과.
        result: z.json().nullable(),
        error: z.object({
          reason: z.enum(RUN_FAIL_REASONS),
          message: z.string(),
        }).nullable(), // failed만
        created_at: atSchema,
        finished_at: atSchema.nullable(), // running이 아니면 있다
        state_seq: seqSchema,
      }); // refine: kind와 target·칸이 맞다, error ⇔ failed, finished_at ⇔ running이 아님
      ```

    - route(`RUN_ROUTES = [runStart, runRead, runList, runWait, runCancel, runCreate, runSettle] as const`). memory route 셋은 팀 등록의 `memoryRoutes`에도 오른다(hr-runs-core).

      | 이름 | resource/method | 종류 | actors | 입력 | 출력 |
      |---|---|---|---|---|---|
      | `StartRun` | `runs/start` | memory | user | 아래 | `{ run }` |
      | `ReadRun` | `runs/read` | read | user | `{ run }` | `withReadCommon({ run })` |
      | `ListRuns` | `runs/list` | read | user | `{ session?, agent?, app?, state?, cursor? }`. `agent`(AgentRef)는 `target.agent`가 그 agent인 agent run, `app`(app id)은 `target.app`이 그 앱인 tool run. 준 칸은 모두 맞아야 한다 | `withReadCommon({ runs })`, 새것이 앞 |
      | `WaitRun` | `runs/wait` | memory | user | `{ run, timeout_ms: 1..60000 }` | `{ run }`. 끝났거나 `timeout_ms`가 지나면 돌려준다(그때는 running) |
      | `CancelRun` | `runs/cancel` | memory | user | `{ run }` | `{ run }`(cancelled). 이미 끝났으면 `conflict` |
      | `CreateRun` | `runs/create` | command | machine | `{ id, kind, target, session, session_opened, input_message, schema }` | `{ run }`(running) |
      | `SettleRun` | `runs/settle` | command | machine | `{ run, state: "done"\|"failed"\|"cancelled", turn?, invocation?, result?, error? }`, compare `{ state: "running" }` | `{ run }`. running이 아니면 `conflict` |

      `StartRun` 입력(strict, zod `.default()` 없음):

      ```ts
      z.discriminatedUnion("kind", [
        z.strictObject({
          kind: z.literal("agent"),
          agent: namedAgentSchema.optional(), // session과 정확히 하나. role coding_agent는 invalid_input
          session: idSchema("ses").optional(), // 이어 쓰는 열린 session
          prompt: z.string().min(1),
          input: jsonValueSchema.optional(), // agent에게 보이는 입력 JSON
          schema: z.record(z.string(), z.json()).optional(), // 출력 JSON Schema 객체
        }),
        z.strictObject({
          kind: z.literal("tool"),
          app: z.string().min(1), // app id 또는 정확한 slug·이름
          tool: toolNameSchema,
          input: jsonValueSchema.optional(),
        }),
      ]);
      ```

      `StartRun` 오류: `invalid_input`(agent·session이 둘 다이거나 둘 다 없음, coding_agent, `z.fromJSONSchema`가 못 읽는 schema, 이름이 여럿에 맞음, 크기 초과), `not_found`(agent·session·앱·tool), `conflict`(session이 새 입력을 받지 않음), `forbidden`, `unauthorized`, `unavailable`.

      `StartRun`의 순서: 입력 검사와 agent 이름 풀기(또는 `--session`의 session 확인)를 다 끝낸 뒤에 session을 연다. 이름이 안 풀리면 session을 열지 않고 run도 만들지 않은 채 그 오류를 돌려준다. CLI가 `operator:<x>/<이름>`을 project로 먼저 풀고 `not_found`면 앱으로 한 번 더 부르므로, 첫 시도가 아무것도 남기지 않아야 한다.
    - "끝"을 정하는 규칙(구현은 hr-runs-core, hr-runs-wiring):
      - agent run: `input_message` → 그 메시지를 가져간 turn(`ReadReceivedMessage`의 `turn`. 그 turn 행의 `input_message`가 이 메시지다) → 그 turn의 끝(`TurnEnded`, payload `messages`에 `input_message`가 있다. 정본은 turn 행의 `state: finished`). eval처럼 조용함으로 짐작하지 않는다.
      - outcome completed: 답은 그 turn에서 그 session의 agent가 `RecordMessage`로 남긴 마지막 메시지의 글이다. 없으면 `no_answer`. schema가 있으면 답 글(trim)이 code fence 하나로 통째로 감싸여 있을 때(첫 줄이 `` ``` ``나 `` ```json `` 같은 여는 줄, 끝 줄이 `` ``` ``) 그 fence만 벗기고, 남은 글 전체를 JSON으로 읽어 `z.fromJSONSchema(schema)`로 검사한다. 그 밖에는 글을 고치지 않는다. 못 읽거나 맞지 않으면 `invalid_output`, 맞으면 `result`는 읽은 값이다. schema가 없으면 `result`는 답 글이다.
      - outcome failed → `turn_failed`. interrupted(user_stopped, session_ended) → `turn_interrupted`, interrupted(restarted) → `lophn_restarted`.
      - 같은 session에 다른 입력이 연 turn의 끝은 이 run을 끝내지 않는다. turn이 끝난 뒤 온 call의 답은 session에만 남는다.
      - tool run: `app.call_tool` outcome이 succeeded면 done(`result`는 결과), failed → `tool_failed`, denied → `tool_denied`, unknown → `tool_unknown`.
      - `CancelRun`은 먼저 cancelled로 settle하고 그 뒤 turn을 멈추거나 입력함에서 뺀다. 그 뒤 오는 끝은 아무것도 바꾸지 않는다.
      - 켤 때 running인 run: agent run은 turn을 다시 보고 위 규칙으로 settle하고, 아무 turn도 메시지를 가져가지 않았으면 `lophn_restarted`다. run이 넣은 메시지는 켤 때 입력함에 다시 들어가지 않는다(hr-session-input). 그래서 그 메시지를 가져갈 turn은 끝내 없다. tool run은 `lophn_restarted`다.
      - 자동 재시도는 없다.
    - CLI 모양(표와 구현은 hr-cli-commands):

      ```
      lophn agent run <prompt> [--agent <ref>] [--session <ses_…>] [--input <json> | --input-file <path>] [--schema <json>] [--async] [--json]
      lophn tool call <app> <tool> [--input <json> | --input-file <path>] [--async] [--json]
      lophn run wait <run> [--json]
      lophn run show <run> [--json]
      lophn run cancel <run> [--json]
      ```

      - `--agent`: 짧은 꼴 `lophn`, `pm:<project>`, `ae:<app>`, `operator:<이름>`, `operator:<project 또는 app>/<이름>`이거나 `namedAgentSchema` 모양의 JSON. 이름은 지금처럼 정확히 맞아야 풀린다. `operator:<x>/<이름>`의 `<x>`는 project(`place: { project: x }`)로 먼저 풀고, `StartRun`이 `not_found`면 앱(`place: { app: x }`)으로 한 번 더 부른다. `--session`과 같이 쓰지 않고, 둘 다 없으면 `lophn`이다.
      - `--input`·`--input-file`: 이 다섯 명령에서는 run의 입력 JSON이다(agent에게 보이는 입력, tool의 입력). `--schema`는 JSON Schema 글이다.
      - stdout: done이면 `result`(글이면 그대로, 아니면 JSON 하나). 실패하거나 취소된 run은 `--json`이 없으면 stdout을 비우고 stderr에 한 줄을 쓴다. `--json`이면 run 기록 전체. `--async`는 run id(`--json`이면 run 기록)를 내고 바로 끝난다. `run show`는 run 기록을 줄로 푼다.
      - exit: done 0, failed·cancelled 4(`failed`), 입력 오류 2, 자격 3, lophn이 꺼져 있으면 `unavailable` 5. `--async`, `run show`, `run cancel`은 명령 자체가 되면 run의 상태와 상관없이 0이다.
      - 자격: `LOPHN_CODING_TOKEN`이 있으면 그것, 없으면 `<data root>/run/user-token`(hr-token-file). data root는 `LOPHN_HOME`, 없으면 `$HOME/.lophn`. token file이 없으면 `unavailable`이다.

## 할 일

추가(planner, 살 단계 뒤): `ListRuns`의 `app` filter 대신 `place` filter(`{project}` | `{app}`)를 둔다. run은 만들 때 그 place를 기록한다: agent run은 그 agent의 place(lophn은 null), tool run은 그 앱이다. 그래서 `place: {app}` 하나로 그 앱의 App Engineer run, 앱 place Operator run, tool run을 같이 읽는다. core는 `tool_app` 칸 대신 `place_key` 칸(`project:<id>` | `app:<id>` | null)에 index를 둔다. `agent` filter는 그대로다. 아래 계약이나 할 일에 `app` filter와 `tool_app`이 남아 있으면 이 모양으로 읽는다.

새 이름만 더한다. 지우는 것은 없다. 근거는 README "정한 것"·"뼈대 검토에서 정한 것"과 위 계약이다. 이 task는 코드 동작을 만들지 않는다("끝" 규칙과 CLI 모양은 뒤 task가 이 brief를 읽고 구현한다).

1. `packages/protocol/base/ids.ts`: `ID_PREFIXES` 끝에 `run: "Run"`을 더한다. 다른 접두사와 겹치지 않는다.
2. `packages/protocol/lophn-agent/calls.ts`: `const namedAgentSchema`를 `export const namedAgentSchema`로만 바꾼다. 모양과 주석은 그대로다. `packages/protocol/lophn-agent/mod.ts`가 `export * from "./calls.ts"`라 따로 등록할 것이 없다.
3. `packages/protocol/lophn-agent/inputs.ts`: `sendMessageInputSchema`에 `unattended: z.literal(true).optional()`을 더한다. 주석(왜): 사람 화면은 싣지 않고 run만 싣는다, 이 메시지가 연 turn은 unattended다(`approval.md` "turn mode").
   - 앞 계획 land 뒤 path 확인: approval-simplify가 `SendMessage`에 같은 뜻의 칸을 이미 열었으면 이 단계는 하지 않고, 그 칸 이름을 보고의 "정한 것"에 적는다(hr-session-input, hr-runs-wiring이 그 이름을 쓴다).
4. `packages/protocol/runs/runs.ts`를 새로 만든다. import는 `zod`, `../base/route.ts`, `../base/ids.ts`, `../base/values.ts`, `../base/envelope.ts`, `../lophn-agent/places.ts`, `../lophn-agent/calls.ts`, `../apps/channel-values.ts`, `../projects/values.ts`뿐이다.
   1. 계약의 `RUN_KINDS`, `RUN_STATES`, `RUN_FAIL_REASONS`와 type `RunKind`, `RunState`, `RunFailReason`.
   2. `runRecordSchema`와 `type RunRecord`. refine은 계약 코드 끝 주석의 셋이다.
      - kind와 칸: agent면 `target`에 `agent`, `invocation`은 null. tool이면 `target`에 `app`·`tool`, `session`·`input_message`·`turn`·`schema`는 null이고 `session_opened`는 false다.
      - `error !== null` ⇔ `state === "failed"`, `finished_at !== null` ⇔ `state !== "running"`.
      - refine 함수 하나를 만들어 `CreateRun` 입력의 kind 검사와 같이 쓴다.
   3. route 일곱을 계약의 표대로 만든다. resource는 `runs`, method는 `start`·`read`·`list`·`wait`·`cancel`·`create`·`settle`, 이름은 표의 이름, 상수는 `runStart`·`runRead`·`runList`·`runWait`·`runCancel`·`runCreate`·`runSettle`이다. 입력은 모두 `z.strictObject`(`.default()` 없음)이고 출력은 `z.object`다.
      - `StartRun` 입력은 계약 코드 그대로다. agent·session이 정확히 하나인지, coding_agent, schema를 읽을 수 있는지는 core(hr-runs-core)가 본다.
        - 정한 것: 입력 schema에 refine을 두지 않는다. 이유: 계약이 이 셋을 `StartRun` 오류로 적었고 core가 같은 `invalid_input`으로 돌려준다. 판정을 두 곳에 두지 않는다.
      - `ReadRun` 입력 `{ run: idSchema("run") }`, 출력 `withReadCommon(z.object({ run: runRecordSchema }))`.
      - `ListRuns` 입력 `{ session: idSchema("ses").optional(), agent: agentRefSchema.optional(), app: appIdSchema.optional(), state: z.enum(RUN_STATES).optional(), cursor: readCursorSchema.optional() }`, 출력 `withReadCommon(z.object({ runs: z.array(runRecordSchema) }))`. 주석(왜): 새것이 앞이다. 화면이 project sidebar와 앱 공간마다 session event 때 읽고 job이 run을 많이 만들어서, 거르기를 core에서 해 읽기를 작게 둔다. `agent`는 agent run의 `target.agent`와 정확히 같은 것, `app`은 tool run의 `target.app`이고, 준 칸은 모두 맞아야 한다(AND).
      - `WaitRun` 입력 `{ run, timeout_ms: z.number().int().min(1).max(60_000) }`. 상한은 `RUN_WAIT_MAX_MS = 60_000`으로 export한다(hr-cli-commands가 같은 값으로 되풀이한다).
      - `CancelRun` 입력 `{ run }`.
      - `CreateRun` 입력 `{ id: idSchema("run"), kind, target, session: idSchema("ses").nullable(), session_opened: z.boolean(), input_message: idSchema("msg").nullable(), schema: z.record(z.string(), z.json()).nullable() }`와 위 kind refine.
        - 정한 것: `CreateRun` 입력의 `target`은 strict 꼴(`agentRefSchema`, `z.strictObject({ app, tool })`)이다. 이유: command 입력은 모두 strict다(`packages/protocol/lophn-agent/agent-sessions.ts`의 `openAgentSessionInputSchema`).
      - `SettleRun` 입력 `{ run: idSchema("run"), state: z.enum(["done", "failed", "cancelled"]), turn: idSchema("trn").optional(), invocation: invocationIdSchema.nullable().optional(), result: z.json().optional(), error: z.strictObject({ reason: z.enum(RUN_FAIL_REASONS), message: z.string() }).optional() }`, refine: `error`가 있다 ⇔ `state === "failed"`, `result`는 done일 때만. compare는 `z.strictObject({ state: z.literal("running") })`.
      - `errors`(공통 일곱 안에서)
        - `StartRun`: 계약의 `StartRun` 오류 그대로.
        - `ReadRun`·`ListRuns`: `invalid_input`, `unauthorized`, `forbidden`, `not_found`, `unavailable`(`turn-reads.ts`의 `readErrors`와 같다).
        - `WaitRun`: `invalid_input`, `unauthorized`, `forbidden`, `not_found`, `unavailable`. `CancelRun`: 그것에 `conflict`.
        - `CreateRun`: `invalid_input`, `unauthorized`, `forbidden`, `conflict`(같은 id). `SettleRun`: `invalid_input`, `unauthorized`, `forbidden`, `not_found`, `conflict`.
   4. `export const RUN_ROUTES = [runStart, runRead, runList, runWait, runCancel, runCreate, runSettle] as const;`
5. `packages/protocol/runs/mod.ts`를 새로 만든다: `export * from "./runs.ts";`와 `export const ROUTES = [...RUN_ROUTES] as const;`(`packages/protocol/domains/mod.ts`와 같은 꼴).
6. `packages/protocol/mod.ts`는 고치지 않는다. lead가 등록한다(보고).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 모양은 schema가 지킨다(`.claude/skills/write-test/SKILL.md` "쓰지 않는 test").
- `grep -n "export const namedAgentSchema" packages/protocol/lophn-agent/calls.ts`가 한 줄이다.
- `grep -n 'run: "Run"' packages/protocol/base/ids.ts`가 한 줄이다.
- `grep -rn "packages/core\|\.\./\.\./core" packages/protocol/runs`가 0줄이다(protocol은 core를 모른다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 `RUN_ROUTES`를 `packages/protocol/mod.ts`의 `ALL_ROUTES`에 등록한다(`export * as runs from "./runs/mod.ts"`와 `import { ROUTES as runsRoutes } from "./runs/mod.ts"`, `...runsRoutes`). shell allowlist가 그 목록을 읽는다. renderer의 `ListRuns`(hr-screen-data)는 `packages/shell/main/desktop/core/routes.ts`가 `ALL_ROUTES`로 만든 allowlist에 있어야 부를 수 있다. 그 밖에 lead가 고칠 목록 file
- 안 쓰게 된 export: 없음이면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것" 둘을 그대로 했는지, approval-simplify의 unattended 칸 이름 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

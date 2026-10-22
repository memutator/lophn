# sj-jobs-tools

job tool 넷(`job.create`, `job.update`, `job.delete`, `job.list`)을 정의하고 lophn, Project Manager, App Engineer의 tool 목록에 더한다. Operator는 job이 부르는 쪽이라 받지 않는다. tool은 `gate`가 없다(`architecture/approval.md`: 시킨 것이 승낙이고 효과는 판정에 쓰지 않는다).

- 단위: roles (wave 2)
- 선행: `sj-jobs-contract`
- 소유(이 task만 고친다):
  - `packages/core/jobs/agent-tools.ts` (새 file)
  - `packages/core/agent-roles/tool-lists.ts`
  - `packages/core/agent-roles/tool-lists_test.ts`
  - `packages/core/main/agent-tools.ts`
  - `tests/eval/versions/files.ts`
- 읽을 것:
  - 계획: `project-docs/plan/schedule-job/README.md`의 "정한 것" 중 "누가"(job tool은 lophn, Project Manager, App Engineer가 받고 Operator는 job이 부르는 쪽, agent는 자기가 만든 job만 고치고 지운다)와 "할 일"(세 가지 할 일), `tasks/sj-jobs-contract.md`의 "route" 표와 `jobActionInputSchema`
  - architecture
    - `project-docs/architecture/agent-definition.md`의 "지키는 것": "role의 tool 목록은 코드가 고정하고, 목록 밖 tool은 정의에도 실행에도 없다", "agent credential의 operation 상한은 tool이 core에 부르는 route 이름이다", "tool은 자원 하나에 동사 하나", "tool 목록은 session을 시작할 때 고정한다"
    - `project-docs/architecture/layers.md`의 "harness와 lophn feature module"(tool 정의 file은 agent runtime child에서 실려 protocol, base, `lophn-agent/tools/spi.ts`만 import한다. feature module tool 하나를 더할 때 고치는 곳)
    - `project-docs/architecture/approval.md`의 첫 문단과 "판정"(gate 없는 tool은 판정을 거치지 않는다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tool-spi`(`provided_by`에 `jobs`는 lead가 더한다), `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`
  - 본보기(같은 모양의 tool file)
    - `packages/core/workflows/agent-tools.ts`: `defineTool`, route를 부르는 `readOf`, 목록을 끝까지 모으는 `workflow.get`의 cursor 반복, `fitted`·`countSummary`
    - `packages/core/domains/agent-tools.ts`의 `domain.create`: `commandOf(ctx.core, route, input, {}, ctx.tool_call)`
  - 목록과 순서: `packages/core/agent-roles/tool-lists.ts`(`builtinToolNames`, `APP_TOOL_NAMES`가 role로 갈리는 모양, `TOOL_ORDER`), `packages/core/agent-roles/tool-lists_test.ts`, `packages/core/main/agent-tools.ts`, `packages/core/main/agent-tools_test.ts`(목록의 이름과 정의가 일대일인지, 모든 입력이 JSON Schema가 되는지)
  - credential 상한: `packages/core/agent-roles/credentials.ts`의 `roleOperations`(tool의 `routes`가 상한이 된다). 바꾸지 않는다.
  - eval: `tests/eval/versions/files.ts`의 `TOOL_FILES`·`toolFileTable`(정규식 `defineTool\(\{\s*name:\s*"…"`로 tool 이름을 찾는다), `tests/eval/versions/versions_test.ts`의 "role이 받는 agent tool은 모두 TOOL_FILES의 source file에 정의돼 있다"
- 계약:
  - 쓰는 것: `sj-jobs-contract`의 route `job.create`·`job.update`·`job.delete`·`job.list`, `JobActionInput`, `JobRecord`. `packages/core/lophn-agent/tools/spi.ts`(`defineTool`, `commandOf`, `readOf`, `fitted`)
  - 내놓는 것: `JOB_AGENT_TOOLS`. tool 입력은 route 입력과 같다.
    - `job.create {title, every, at?, action, missed_policy, enabled?}` → 만든 `JobRecord`
    - `job.update {job, title?, every?, at?, action?, missed_policy?, enabled?}` → `JobRecord`
    - `job.delete {job}` → `{job}`
    - `job.list {}` → `{jobs}`(부른 agent가 만든 것만, route가 거른다)
    - `action`의 받는 agent는 call tool과 같은 `{role, place?, name?}`이고 core route가 AgentRef로 푼다. tool file은 풀지 않는다.
    - 효과는 `write`(목록은 `read`), role 목록에서 lophn·Project Manager·App Engineer만 받는다. `TOOL_ORDER` 끝에 넷을 더한다.

## 정한 것

- tool description(영어)에 적을 것: `every`는 `<수><m|h|d>`, `at`은 `d` 단위에만 쓰는 이 컴퓨터의 local `HH:MM`, `missed_policy`는 lophn이 꺼져 놓친 차례를 켜질 때 한 번 돌릴지(`run`) 사람에게 묻는 card로 남길지(`hold`), 차례마다 사람 없이 도는 새 session이나 앱 tool 호출 하나나 workflow instance 시작이라는 것, 앱 tool은 부를 때 만든 agent의 할당 안에서만 돈다는 것.
- 입력 schema의 `schema?: Record<string, json>`이 JSON Schema로 안 바뀌어 `packages/core/main/agent-tools_test.ts`가 떨어지면 계약 바꾸기 요청으로 보고한다.
- `action`은 `sj-jobs-contract`의 `jobActionInputSchema`를 그대로 쓴다. 다시 선언하지 않고 `input`에 `z.unknown()`도 두지 않는다. 계약이 자유 JSON 칸(`agent_run.input`, `schema`의 값, `tool_run.input`)을 `z.json()`으로 정해 `z.toJSONSchema`가 던지지 않는다(`jsonValueSchema`는 `z.custom`이라 던진다). `packages/core/main/agent-tools_test.ts`의 "모든 내장 tool의 입력이 JSON Schema로 바뀐다"가 고치지 않고 통과해야 한다. 안 바뀌면 계약 바꾸기 요청으로 보고한다. `z.json()`은 재귀라 JSON Schema에 `$defs`/`$ref`가 생긴다. 지금 tool 입력 가운데 이런 것은 처음이고 실제 provider가 받는지는 test로 볼 수 없다(진짜 provider 호출은 사람에게 묻는다). 보고에 적는다.
- 나머지 칸(`title`, `every`, `at`, `missed_policy`)도 `sj-jobs-contract`의 `protocol/jobs/values.ts`가 내놓는 schema를 쓴다. route 상수는 계약이 정한 export 이름 `jobCreate`, `jobUpdate`, `jobDelete`, `jobList`를 `protocol/jobs/jobs.ts`에서 import한다.
- **job을 부른 agent도 job tool을 가진다.** job run으로 도는 agent(`job.create`를 받는 role)가 job을 만들 수 있다. 막지 않는다. 이유: program은 약하게 두고(앱 호출은 만든 agent의 할당 안에서만), 고치기·지우기는 만든 agent만 하며, 사람은 모든 job을 화면에서 본다(README "누가"). tool file에 "job run 안에서는 만들지 못한다" 같은 거름을 두지 않는다.
- `job.update`의 `at`은 `null`을 받아 시각을 지운다(route와 같다). tool description에 "omit a field to keep it; `at: null` clears the time of day; `action` replaces the whole action"을 적는다.
- `job.list`는 route의 cursor(50개씩)를 `workflow.get`처럼 끝까지 따라 모은다. 만든 agent 하나의 job이 50개를 넘는 일은 드물고 tool 입력에 filter를 더하는 것보다 단순하다.
- 한 경계의 둘째 겹은 이 task 밖에 있다. job tool을 Operator에게 안 주는 것(이 task)과 `job.create`가 role이 lophn·Project Manager·App Engineer가 아닌 session을 `forbidden`으로 거절하는 것(`sj-jobs-store`의 command)이다. 이 task의 test는 앞의 것만 본다.
- tool 정의는 literal `defineTool({ name: "job.create", ...` 꼴로 쓴다. 이름을 helper로 만들면 eval의 `toolFileTable` 정규식이 찾지 못한다.

## 할 일

1. `packages/core/jobs/agent-tools.ts`(새 file)에 `JOB_AGENT_TOOLS: readonly ToolDefinition[]`를 둔다. import는 base, protocol(`protocol/jobs/mod.ts` 등), 같은 폴더, `lophn-agent/tools/spi.ts`만이다(`tools/check-deps.ts`의 rule `tool-file`이 막는다. `FEATURE_TOOL_PLACES`에 이 file을 넣는 일은 `sj-jobs-contract`가 했는지 확인만 한다). 이유: 이 file은 agent runtime child에서 실려 store나 DB 코드를 끌어오면 sqlite가 딸려 간다(layers.md).
   - `job.create`: 입력은 `z.strictObject({ title, every, at: optional, action: jobActionInputSchema, missed_policy, enabled: z.boolean().optional() })`. `effect: "write"`, `routes: [jobCreate]`. handler는 `commandOf(ctx.core, jobCreate, input, {}, ctx.tool_call)` → `fitted(\`created job ${title}\`, { job })`.
   - `job.update`: 입력은 `job`(`idSchema("job")`)과 나머지 칸 전부 optional(`at`은 `.nullable().optional()`, `action`은 `jobActionInputSchema.optional()`). `effect: "write"`. `undefined` 칸은 body에서 뺀다(`workflow.edit` handler가 하는 것). 결과는 `{ job }`.
   - `job.delete`: `effect: "write"`. description에 "deletes the job and its history; a run or workflow instance already running goes on"을 적는다.
   - `job.list`: 입력 `z.strictObject({})`, `effect: "read"`, `routes: [jobList]`. cursor를 끝까지 따라 모아 `fitted(countSummary("jobs", jobs.length, false), { jobs }, ["jobs"])`.
   - description은 영어이고 "정한 것"의 항목을 모두 싣는다. 추가로 "changing `every` or `at`, or turning a job back on, restarts the count from now" (`sj-jobs-store`의 규칙)와 "you can change or delete only jobs you created"를 적는다.
2. `packages/core/agent-roles/tool-lists.ts`: `JOB_TOOL_NAMES = ["job.create", "job.update", "job.delete", "job.list"] as const`를 두고 `builtinToolNames`에 `...(role === "operator" ? [] : JOB_TOOL_NAMES)`를 더한다(`APP_TOOL_NAMES`가 role로 갈리는 줄 옆). `TOOL_ORDER` 끝(`workflow.edit` 뒤)에 넷을 더한다. 이유: model에 보이는 순서가 바뀌면 같은 재료가 같은 bytes가 아니게 되므로(agent-definition.md) 중간에 끼우지 않는다.
3. `packages/core/main/agent-tools.ts`: `JOB_AGENT_TOOLS`를 import해 `agentTools`의 `all`에 펼친다. 순서는 `TOOL_ORDER`가 정한다. 이름과 정의가 일대일이어야 `agent-tools_test.ts`가 통과하므로 2와 같이 한다.
4. `tests/eval/versions/files.ts`: `TOOL_FILES`에 `"packages/core/jobs/agent-tools.ts"`를 더한다. 빼면 `TOOL_ORDER`에 든 이름이 `toolFileTable`에 없어 `seenComponents`가 돈을 쓴 trial을 기록 단계에서 멈춘다(domain tool이 그랬다).
5. test(아래 "끝남"의 위험 test): `tool-lists_test.ts`.
6. 돌린다: `deno test --no-check packages/core/agent-roles/tool-lists_test.ts packages/core/main/agent-tools_test.ts tests/eval/versions/versions_test.ts`.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(배정됨): "job tool은 lophn, Project Manager, App Engineer의 목록에만 있다. Operator는 받지 않는다"(`packages/core/agent-roles/tool-lists_test.ts`. 있는 앱 진단 tool test를 표로 넓힌 것이고 새 test file은 없다)
  - 있는 test "app.tools and the app status, log and invocation reads are only in the lophn and App Engineer lists"를 `[이름들, 받는 role들]` 표로 바꾼다. 줄 둘: `["app.tools", "app.status", "app.logs", "app.invocations"]`는 `["lophn", "app_engineer"]`, `["job.create", "job.update", "job.delete", "job.list"]`는 `["lophn", "project_manager", "app_engineer"]`.
  - 판정은 `ROLES` 전부와 줄의 이름 전부에 대해 `builtinToolNames(role).includes(name) === 받는 role들.includes(role)`이다. 이 한 줄이 지키는 것은 "Operator의 목록에 job tool 넷이 하나도 없다"이다. Operator의 credential 상한이 tool의 route에서 나오므로(`roleOperations`) 목록에 없으면 job route에도 닿지 못한다.
  - 이름은 두 줄을 한 문장으로 말한다. 예: "앱 진단 tool은 lophn과 App Engineer 목록에만, job tool은 lophn·Project Manager·App Engineer 목록에만 있고 Operator는 job tool을 받지 않는다".
- `packages/core/main/agent-tools_test.ts`(이름과 정의 일대일, 입력의 JSON Schema 변환)와 `tests/eval/versions/versions_test.ts`가 고치지 않고 통과한다.
- 남지 않음
  - `grep -rn "job.create" packages --include=*.ts`가 `jobs/agent-tools.ts`, `agent-roles/tool-lists.ts`(`_test` 포함), protocol의 route 정의와 그 사용처뿐이다. 다른 role 목록이나 prompt에 새 이름이 없다.
  - `packages/core/jobs/agent-tools.ts`에 `jsonValueSchema` import와 `z.unknown()`이 없다(`grep -n "jsonValueSchema\|z.unknown"`가 0줄). `action`을 다시 선언하지 않았다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 예상(`FEATURE_TOOL_PLACES`는 `sj-jobs-contract`가 하는 일이다. 안 되어 있으면 어디가 비었는지 적는다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): 없음 예상
- 정한 것: 문서에 답이 없어 worker가 정한 것(tool description의 문장, `job.list`가 cursor를 따라가는 것)
- 넘길 줄: 없음
- 계약 바꾸기 요청: `jobActionInputSchema`가 `agent-tools_test.ts`의 JSON Schema 변환을 통과하지 않았는지. `$defs`/`$ref`가 생기는 것(위 "정한 것")
- 고치지 않은 문서(lead가 끝에 고친다): `project-docs/products/AGENT-ROLE.md`, `architecture/layers.md`, `boundary-catalog.yaml`의 `agent-tool-spi.provided_by`
- eval: `TOOL_ORDER`에 tool 넷이 더해져 eval 버전의 tool component 목록이 늘고 role의 model 요청 `tools[]`가 바뀐다. eval은 돌리지 않았다(진짜 provider 호출은 사람에게 묻는다).
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

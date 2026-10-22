# wf-agent-tools

agent tool 넷(`workflow.list`, `workflow.get`, `workflow.report`, `workflow.edit`)을 정의하고 모든 role의 목록에 넣는다.

- 단위: roles (wave 2)
- 선행: wf-contract
- 소유(이 task만 고친다):
  - `packages/core/workflows/agent-tools.ts`(새 file)
  - `packages/core/agent-roles/tool-lists.ts`
  - `packages/core/agent-roles/tool-lists_test.ts`
  - `packages/core/main/agent-tools.ts`
  - `packages/core/main/agent-tools_test.ts`
  - `tests/eval/versions/files.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`(tool 목록은 session 시작 때 고정, 같은 재료는 같은 bytes), `project-docs/architecture/agent-call.md`("부르는 것 자체에는 묻지도 막지도 않는다"). 이 tool들도 Gate를 걸지 않는다.
  - 제품 결정: `project-docs/products/roadmap/workflow.md`의 "instance 고치기", "agent가 아는 것 (캡슐화)"
  - 본보기 코드: `packages/core/domains/agent-tools.ts`(`defineTool`, `readOf`, `commandOf`, `fitted`, `countSummary`), `packages/core/apps/agent-tools/app.ts`의 `blueprint.check`(memory route를 `readOf`로 부르는 tool), `packages/core/lophn-agent/tools/bundles/call.ts`(route 입력 schema를 `omit`해 tool 입력으로 쓰는 법), `packages/core/lophn-agent/tools/result.ts`의 `fitJson`(결과 상한 24KB, 배열 키의 뒤쪽 항목부터 덜어 낸다), `packages/core/lophn-agent/run-loop/retry.ts`(effect가 `read`인 tool만 자동 재시도)
  - 등록 점검: `tests/eval/versions/files.ts`의 `toolFileTable`(`defineTool\(\{\s*name:\s*"..."` 꼴 정규식으로 tool 이름을 찾는다)
- 계약:
  - 쓰는 것: `wf-contract`의 route와 tool 표(이름, route, effect, 입력). 본보기는 `packages/core/domains/agent-tools.ts`(`defineTool`, `readOf`, `commandOf`, `fitted`)
  - 내놓는 것:
    - `WORKFLOW_AGENT_TOOLS: readonly ToolDefinition[]`(네 tool). `routes`는 부르는 memory·read route 전부다(빠지면 credential 상한에서 `forbidden`).
    - `tool-lists.ts`: 네 이름을 `COMMON_TOOLS`에 두는 한 묶음으로 넣어 lophn, Project Manager, App Engineer, Operator가 모두 받게 하고, `TOOL_ORDER`에도 넣는다. `main/agent-tools.ts`의 `all`에 `WORKFLOW_AGENT_TOOLS`를 더한다. `tests/eval/versions/files.ts`의 `TOOL_FILES`에 한 줄을 더한다.
    - 결과 글: `workflow.get`은 instance 상태, steps, current, `last_reports`, 마지막 줄 20개를 담는다. 결과 상한을 넘으면 `lines`와 `last_reports` 둘 다 뒤쪽부터 덜어 내고 결과를 null로 만들지 않는다. `workflow.list`는 오류가 있는 workflow의 `problem`을 그대로 싣는다. `workflow.edit`의 입력이 JSON Schema로 안 바뀌면(합 type) 평평한 객체(`op`와 optional 칸들)로 바꾸고 보고에 적는다.
    - Gate는 걸지 않는다(`gate` 없음).

## 할 일

1. **정의 file.** `packages/core/workflows/agent-tools.ts`(새 file)에 `WORKFLOW_AGENT_TOOLS`를 만든다. import는 `../lophn-agent/tools/spi.ts`(`defineTool`, `readOf`, `fitted`, `countSummary`, `readBody`)와 `../../protocol/workflows/mod.ts`뿐이다. store, service, DB를 import하지 않는다: tool 정의 file은 agent runtime child에서 실린다(`spi.ts` 머리 주석). 네 tool 모두 `defineTool({ name: "workflow.…"`로 `name`을 첫 칸에 쓴다(`toolFileTable`의 정규식이 그 꼴을 찾는다). 모두 `gate` 없음이고, `routes`에는 그 tool이 부르는 route 하나를 넣는다(빠지면 credential 상한에서 `forbidden`). route 값의 변수 이름은 `wf-contract`가 `packages/protocol/workflows/routes.ts`에서 내는 것을 본다.
   - `workflow.list`: 입력은 `ListWorkflows`의 입력 schema 그대로(`{ project? }`). effect `read`. `readOf`로 부르고 `fitted(countSummary("workflows", n, false), { workflows }, ["workflows"])`. `problem`을 가린 채 다듬지 않는다(고치는 것은 agent의 일이라 이유를 그대로 본다). description에 project를 이름이나 id로 주고, project place에서는 생략해도 된다는 것을 쓴다.
   - `workflow.get`: 입력은 `{ instance }`(`ReadWorkflowInstance` 입력에서 `cursor`를 뺀다. `call.ts`가 `omit`하는 것과 같다). effect `read`. `cursor`를 따라 `next_cursor`가 null일 때까지 읽고(줄은 seq 오름차순 200개씩) 마지막 20줄만 둔다. 결과 content는 `{ instance, last_reports, lines }`이고 `lines`는 새것이 앞이다. `last_reports`는 route의 step 이름 map을 배열 `{ step, …ReportLine }[]`(seq가 큰 것이 앞)로 바꿔 싣는다. 이유: `fitted`는 배열 key만 덜어 내므로 map인 채로는 `last_reports`가 줄지 않아 큰 report 여럿이 결과 상한을 넘으면 content가 null이 된다. `fitted(..., ["lines", "last_reports"])`가 둘의 뒤쪽부터 덜어 내므로 오래된 줄과 report가 먼저 빠진다(정한 것). `instance`에 steps, current, participants가 들어 있으므로 따로 다시 만들지 않는다.
   - **description(세 tool 공통으로 agent가 알아야 할 것).** 영어 짧은 문장으로 쓴다.
     - `workflow.get`: `lines`에 `lophn_restarted`가 있으면 lophn이 꺼졌다 켜지며 그 step 메시지가 turn에 닿지 않았을 수 있다는 뜻이다. 다시 넣지 않으므로 필요하면 `workflow.edit`의 `hand_now`로 다시 넘긴다.
     - `workflow.report`·`workflow.edit`: `stopped`(사람이 멈춤)인 instance만 `workflow.edit`이 `conflict`다(report는 줄로 남되 넘기지 않는다). `end`로 `ended`가 된 instance도 report나 `hand_now`가 실제로 넘기면 `running`으로 되살아난다.
     - `workflow.report`·`workflow.edit`(`hand_now`): `text`는 짧은 메모이고 8 KiB(UTF-8) 이하다. 더 긴 내용은 file에 두고 경로를 적는다.
   - `workflow.report`: 입력은 `ReportWorkflow` 입력 그대로. effect `write`(자동 재시도를 막아야 한다. 재시도가 report를 두 번 남기고 같은 step을 두 번 넘긴다). 결과 summary는 `handed`로 가른다: `null`(`next` 없음)은 `reported (line N)`, `outcome: "handed"`는 `reported; step X handed`, `not_handed`는 `reported; step X was not handed: <reason>`. 기록은 이미 남았으므로 `not_handed`도 오류가 아니라 success다. 이유를 알아야 agent가 `workflow.edit`으로 고친다.
   - `workflow.edit`: effect `write`. 입력과 결과는 아래 "정한 것"의 평평한 모양. 결과 summary는 report와 같은 꼴이다.
2. **role 목록.** `packages/core/agent-roles/tool-lists.ts`: 네 이름을 `COMMON_TOOLS` 끝에 붙이고(모든 role이 받는다), `TOOL_ORDER` 끝에 붙인다. 끝에 붙이면 앞 tool의 bytes는 그대로고, 어느 자리든 tool 블록이 바뀌어 cache가 한 번 깨진다는 점은 같다(보고에 적는다). 이름 순서는 `workflow.list`, `workflow.get`, `workflow.report`, `workflow.edit`.
3. **조립.** `packages/core/main/agent-tools.ts`의 `all`에 `...WORKFLOW_AGENT_TOOLS`를 더한다(`DOMAIN_AGENT_TOOLS` 옆). `../workflows/agent-tools.ts`를 직접 import한다(`workflows/mod.ts`가 아니다. `domains`와 같다).
4. **eval 버전 표.** `tests/eval/versions/files.ts`의 `TOOL_FILES`에 `"packages/core/workflows/agent-tools.ts"` 한 줄을 더한다(`domains/agent-tools.ts` 줄 뒤). 안 더하면 `currentVersions`가 "tool … is not defined in any TOOL_FILES file"로 던지고 eval이 멈춘다(`versions_test.ts`가 잡는다).
5. **test.** 새 test는 만들지 않는다. `agent-tools_test.ts`의 "role 목록의 모든 이름에 정의가 있고 모든 정의가 어느 role 목록에 있다"가 정의와 목록의 어긋남을, "모든 내장 tool의 입력이 model에 보낼 JSON Schema로 바뀐다"가 입력 schema를 본다. 두 test가 새 tool로 통과하는지만 확인한다.

## 정한 것

- **`workflow.edit` 입력은 처음부터 평평한 객체다.** `z.strictObject({ instance, op: z.enum([...5]), … })`이고 나머지 칸은 모두 optional이다: `step`, `after`, `name`, `patch`, `text`, `session`. 근거: `z.toJSONSchema`는 `op`로 가르는 합을 top-level `anyOf`로 내고 `type: "object"`가 없다. 변환은 던지지 않으므로 "JSON Schema로 바뀐다" test는 통과하지만, tool 입력 schema의 top-level이 object여야 하는 provider가 있어 turn이 거절된다. 그래서 계약 skeleton의 "안 바뀌면 평평하게" 조건을 기다리지 않는다.
  - 칸의 뜻은 `EditWorkflow`의 `op`별 입력을 따른다: `add_step`은 `step`(객체 `{ name, by, with?, prompt, in?, out?, next? }`)과 `after?`, `update_step`은 `name`과 `patch`, `remove_step`은 `name`, `end`는 칸 없음, `hand_now`는 `step`(이름)과 `text?`, `session?`. `step`이 `add_step`에서는 객체고 `hand_now`에서는 이름이라, `step: z.union([stepNameSchema, addStepObject]).optional()`로 둔다.
  - handler는 입력을 그대로 route에 넘기고(undefined인 칸은 뺀다) 칸이 `op`에 안 맞는 경우는 route의 schema 검사가 `invalid_input`으로 돌려주게 둔다. description에 op마다 필요한 칸을 한 줄씩 쓴다.
  - 계약 바꾸기가 아니다: route와 service는 `wf-contract`의 합 그대로다. 평평한 모양은 tool 입력에만 있다.
- **`workflow.get`의 `lines`는 새것이 앞이고 `last_reports`는 배열이다.** 계약의 "마지막 줄 20개"를 그대로 따르되 `fitted`가 배열의 뒤쪽부터 덜어 내는 규칙 때문에 순서를 뒤집었고, map인 `last_reports`는 배열로 바꿨다. description에 "newest first"를 쓴다. 이 모양은 tool 결과에만 있다(route 출력은 map 그대로).
- **`workflow.report`와 `workflow.edit`는 effect `write`다.** `call`은 dedup이 있어 `read`로 두지만 이 route들은 `tool_call` dedup을 받지 않는다(계약 입력에 없다). 자동 재시도가 없는 `write`로 두면 중복이 생길 길이 없다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(기존 `agent-tools_test.ts`의 "role 목록의 모든 이름에 정의가 있고 모든 정의가 어느 role 목록에 있다", "모든 내장 tool의 입력이 model에 보낼 JSON Schema로 바뀐다"가 새 tool도 본다. 위 평평한 `workflow.edit` 입력도 같은 test가 본다).
- 남지 않음: 없음(옛 이름을 지우는 task가 아니다).

## 보고

- 바꾼 file, 통과한 check.
- 등록할 것: 없음(`main/agent-tools.ts`와 `TOOL_FILES`는 이 task가 고친다). `schedule-job`의 `sj-jobs-tools`와 겹치는 file(`tool-lists.ts`, `main/agent-tools.ts`와 그 test, `files.ts`)은 README의 "lead가 할 일"대로 rebase 때 두 쪽을 다 남긴다.
- 안 쓰게 된 export: 없음.
- 정한 것: 위 "정한 것" 밖에 worker가 정한 것. 특히 `workflow.edit` 평평한 입력의 최종 칸 이름.
- 넘길 줄: 없음이 기본. route 변수 이름이 `wf-contract`와 달라 맞춘 곳이 있으면 적는다.
- 계약 바꾸기 요청: 있으면 적는다.
- cache: 모든 role의 tool 블록이 바뀌어 cache가 한 번 깨지고 eval의 tool 버전이 새로 매겨진다고 적는다.
- **무겁게 짠 것**, **알려진 미완 동작**: 없으면 "없음".

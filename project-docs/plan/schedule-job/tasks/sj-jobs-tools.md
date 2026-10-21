# sj-jobs-tools

job tool 넷(`job.create`, `job.update`, `job.delete`, `job.list`)을 정의하고 lophn, Project Manager, App Engineer의 tool 목록에 더한다. Operator에게는 주지 않는다. job tool은 `gate`가 없어 Gate를 거치지 않는다(`architecture/approval.md`: 실행 때 묻는 것은 shell 규칙이 `ask`인 명령뿐이고 효과는 판정에 쓰지 않는다). 효과는 `write`(목록은 `read`)이고 기록에만 쓰인다. 사람이 시킨 것이 승낙이라 job을 만들고 켜는 데 묻지 않는다.

- 단위: roles (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/jobs/agent-tools.ts`(새 file)
  - `packages/core/agent-roles/tool-lists.ts`
  - `packages/core/agent-roles/tool-lists_test.ts`
  - `packages/core/main/agent-tools.ts`
  - `packages/core/main/agent-tools_test.ts`
  - `tests/eval/versions/files.ts`(`TOOL_FILES` 한 줄)
- 읽을 것:
  - architecture: `project-docs/architecture/layers.md`의 "harness와 lophn feature module"(tool 정의 file은 protocol, base, `spi.ts`만 import한다. tool 하나를 더할 때 고치는 곳), `project-docs/architecture/approval.md`의 "흐름"(gate 없는 tool은 판정을 거치지 않는다, 효과는 판정에 쓰지 않는다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tool-spi`, `agent-roles`, `jobs`(lead가 더한다). `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`, `packages/core/jobs`
  - 본보기: `packages/core/domains/agent-tools.ts`(`defineTool`, `readOf`, `commandOf`, `fitted`, `countSummary`, `readBody`), `packages/core/agent-roles/tool-lists.ts`(`builtinToolNames`, `TOOL_ORDER`), `packages/core/main/agent-tools.ts`(모으기), `packages/core/agent-roles/tool-lists_test.ts`의 test "app.tools and the app status, log and invocation reads are only in the lophn and App Engineer lists", `tests/eval/versions/files.ts`의 `TOOL_FILES`와 그것을 보는 `tests/eval/versions/versions_test.ts`의 "role이 받는 agent tool은 모두 TOOL_FILES의 source file에 정의돼 있다"
  - 제품 결정: `project-docs/plan/schedule-job/README.md`의 "이 계획에서 더 정한 것"(job tool을 받는 role)과 "뼈대 검토에서 정한 것"(받는 agent는 call tool과 같은 꼴, core route가 푼다. 할당은 부를 때만 확인한다), `project-docs/products/AGENT-ROLE.md`의 "5.2 받는 agent 고르기"
- 계약:
  - 쓰는 것: `sj-jobs-contract`의 route `jobCreate`, `jobUpdate`, `jobDelete`, `jobList`와 `JobRecord`, `JobActionInput`. `packages/core/lophn-agent/tools/spi.ts`(`defineTool`, `commandOf`, `readOf`)
  - 내놓는 것: `JOB_AGENT_TOOLS`. tool 입력은 route 입력과 같다(`job.create {title, every, at?, action, missed_policy, enabled?}`, `job.update {job, ...}`, `job.delete {job}`, `job.list {}`). `action`의 받는 agent는 call tool과 같은 `{role, place?, name?}`이고, AgentRef로 푸는 것은 core route다. tool file은 풀지 않는다. 결과는 `JobRecord`(목록은 `jobs`). `TOOL_ORDER`에 넷을 더한다.

## 할 일

1. `packages/core/jobs/agent-tools.ts`(새 file): `JOB_AGENT_TOOLS: readonly ToolDefinition[]`. import는 `packages/protocol/jobs/`, `packages/base`, `packages/core/lophn-agent/tools/spi.ts`와 `zod`뿐이다(rule `tool-file`. 이 file은 agent runtime child에 실린다).
   - `job.list`: 입력 `z.strictObject({})`, `routes: [jobList]`, effect `read`. `readOf(ctx.core, jobList, {})`. 자기가 만든 job만 오는 것은 route가 정한다. 결과는 `fitted(countSummary("jobs", ...), body, ["jobs"])`(`domain.list` 꼴).
   - `job.create`: 입력은 `jobCreate.input` 그대로, `routes: [jobCreate]`, effect `write`. `commandOf(ctx.core, jobCreate, input, {}, ctx.tool_call)`. 결과는 만든 `JobRecord`.
   - `job.update`: 입력 `jobUpdate.input`, `routes: [jobUpdate]`, effect `write`. 결과는 `JobRecord`.
   - `job.delete`: 입력 `jobDelete.input`, `routes: [jobDelete]`, effect `write`. 결과는 `{job}`.
   - `gate`는 두지 않는다. 묻지 않는다(사람이 시킨 것이 승낙이다).
   - creator, place, 받는 agent 풀기는 tool이 하지 않는다. 다 route가 자격의 session으로 한다.
   - description(영어, model이 읽는다)에 한두 문장씩 적는다: `every`는 `<수><m|h|d>`, `at`은 `d` 단위에만 쓰는 이 컴퓨터의 local `HH:MM`, `missed_policy`는 lophn이 꺼져 놓친 차례를 켜질 때 한 번 돌릴지(`run`) 사람에게 묻는 card로 남길지(`hold`), 차례마다 사람 없이(unattended) 새 session이나 앱 tool 호출 하나가 돈다는 것, 받는 agent는 `call`과 같은 이름 꼴이라는 것, 앱 tool은 부를 때 만든 agent의 할당 안에서만 돈다는 것.
2. `packages/core/agent-roles/tool-lists.ts`: `const JOB_TOOLS = ["job.list", "job.create", "job.update", "job.delete"] as const`를 두고 `builtinToolNames`가 Operator가 아닌 role에 더한다. `TOOL_ORDER`에는 끝(`operator.update` 뒤)에 넷을 더한다(앞 tool의 순서와 bytes가 그대로다). 위의 role 주석에 "job tool은 lophn, Project Manager, App Engineer만. Operator는 job이 부르는 쪽이다"를 단다.
3. `packages/core/main/agent-tools.ts`: `JOB_AGENT_TOOLS`(`../jobs/agent-tools.ts`)를 import해 `all`에 더한다.
4. `packages/core/agent-roles/tool-lists_test.ts`: 있는 test "app.tools and the app status, log and invocation reads are only in the lophn and App Engineer lists"(앱 진단 tool 넷)를 표로 바꿔 job tool 넷도 본다. 이름은 "app.tools와 job tool은 정해진 role의 목록에만 있다". 앱 진단 tool 넷(`app.tools`, `app.status`, `app.logs`, `app.invocations`)은 lophn과 App Engineer, job tool은 lophn, Project Manager, App Engineer다. 근거: role 목록이 agent 자격의 상한(route 이름)을 정한다. Operator가 job tool을 가지면 자기가 사람 없이 도는 run을 걸 수 있다.
5. `packages/core/main/agent-tools_test.ts`는 고치지 않는다. 정의와 목록 대조, 입력의 JSON Schema 변환 test가 이미 새 tool을 본다. `action.schema`의 `z.json()`이 JSON Schema로 바뀌지 않아 이 test가 떨어지면 계약 바꾸기 요청으로 보고한다.
6. `tests/eval/versions/files.ts`: `TOOL_FILES`에 `"packages/core/jobs/agent-tools.ts"`를 더한다(`packages/core/domains/agent-tools.ts` 줄 옆). 빠지면 `tests/eval/versions/versions_test.ts`의 "role이 받는 agent tool은 모두 TOOL_FILES의 source file에 정의돼 있다"가 떨어진다. `deno task check`가 `tests/eval`의 test를 돈다. `tests/eval/registry/tool/`의 새 tool 판 기록은 eval을 돌릴 때 생기므로 만들지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "app.tools와 job tool은 정해진 role의 목록에만 있다"(있는 test를 표로 바꾼 것. 새 test file 없음)
- `grep -c '"job\.' packages/core/agent-roles/tool-lists.ts`가 8이다(목록 넷, `TOOL_ORDER` 넷).
- `grep -n "packages/core/jobs/agent-tools.ts" tests/eval/versions/files.ts`가 한 줄이다.
- `grep -rn "jobCreatorPort\|resolveNamed\|SessionDirectory" packages/core/jobs/agent-tools.ts`가 0줄이다(이름은 route가 푼다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file. 없을 것이다(`packages/core/main/agent-tools.ts`는 이 task의 소유다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

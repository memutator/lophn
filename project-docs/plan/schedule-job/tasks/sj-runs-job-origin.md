# sj-runs-job-origin

`headless-run`의 "core의 run 연산"이 job에서 시작한 run을 받게 한다. `headless-run`은 "tool run의 부른 쪽은 사람이다"로 정했고, 여기에 job이 연 tool run은 부른 쪽이 program인 길을 더한다. agent run은 그대로 새 session을 열고 그 session을 돌려준다.

- 단위: runs (wave 2)
- 선행: sj-apps-program-caller. program caller 모양이 있어야 tool run이 부를 수 있다.
- 소유(이 task만 고친다):
  - `packages/protocol/runs/`(run 기록과 `CreateRun` 입력의 `job` 칸만)
  - `packages/core/runs/`(`headless-run`이 만든 run module)
  - `packages/core/main/daemon/wiring/runs.ts`
- 읽을 것:
  - 계획: `project-docs/plan/schedule-job/README.md`의 "정한 것"(job의 원샷 run이 부를 수 있는 것은 `headless-run`의 run과 같다)과 "뼈대 검토에서 정한 것"(job이 부를 agent는 만들 때 AgentRef로 풀어 저장한다. 할당은 부를 때만 확인한다)
  - architecture: `headless-run`이 계획 끝에 쓰는 run 문서(`project-docs/architecture/` 아래)의 run 시작, "끝"을 정하는 규칙(tool run outcome `denied` → `tool_denied`), tool run의 부른 쪽. 문서가 아직 없으면 `project-docs/plan/headless-run/tasks/hr-contract-runs.md`, `hr-runs-core.md`, `hr-runs-wiring.md`를 본다. `project-docs/architecture/app-call.md`의 "지키는 것"(부른 쪽 확인). `project-docs/architecture/approval.md`의 "turn mode"(unattended)
  - 제품 결정: `project-docs/products/AGENT-ROLE.md`의 T5, T6(받은 agent는 자기 할당으로 일하고 보낸 쪽 권한은 넘어가지 않는다)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/runs`(`headless-run`이 더한 줄), `project-docs/boundary-catalog.yaml`의 `core-api`
  - 계약: `project-docs/plan/schedule-job/tasks/sj-jobs-contract.md`(`JobAction`, `JobRunStarter`), `project-docs/plan/schedule-job/tasks/sj-apps-program-caller.md`(`CallAuth` program, wire caller program), `project-docs/plan/schedule-job/tasks/sj-jobs-scheduler.md`(이 시작을 감싸는 adapter)
  - 코드: `packages/core/runs/service.ts`(run service와 port `agents`·`tools`), `packages/core/main/daemon/wiring/runs.ts`(tools port 구현과 사람 caller), `packages/core/main/daemon/wiring/context.ts`(wiring 사이에 나누는 값), `packages/core/apps/calls/caller.ts`(`CallAuth`)
  - skill: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `headless-run`의 run 연산(시작, 기다리기, 읽기, 취소)과 "run의 모양". `sj-apps-program-caller`의 `CallAuth`(actor `program`)와 wire caller `program`. `sj-jobs-contract`의 `JobAction`, `JobRunStarter`
  - 내놓는 것: core 안 run 시작에 `by?: {job, job_run, creator: AgentRef, place: Place | null}`를 더한다. `by`가 있는 tool run은 caller `program`으로 부른다. 시작 결과는 `{run, session: Id<"ses"> | null}`(agent run이면 연 session)이다. `sj-jobs-scheduler`의 `JobRunStarter` adapter가 이것을 감싼다. 할당은 부를 때만 확인한다. `by`가 있는 tool run의 호출이 할당 밖으로 막히면(outcome `denied`) 그 run은 `headless-run`의 규칙대로 `failed`(`tool_denied`)로 끝나고, 기다리기가 그 끝을 돌려주어 job run이 실패로 남는다.

## 할 일

`packages/core/runs/`, `packages/protocol/runs/`, `packages/core/main/daemon/wiring/runs.ts`의 이름(`createRunService`, `start`, `wait`, port `agents`(`resolve`가 `{agent, place}`를 준다)·`tools`, `CreateRun`(`place` 칸), `RunPlace`, `RunStore.create`)은 `headless-run` brief의 것이다. 시작 전에 그 file을 열어 land한 이름을 확인하고 그것을 쓴다. 다른 이름을 쓴 곳은 보고의 "정한 것"에 적는다.

1. `by` 모양을 둔다(`packages/core/runs/`의 service 입력 type 자리). 근거: 계약 "내놓는 것".
   - `{ job: Id<"job">; job_run: Id<"jbr">; creator: AgentRef; place: Place | null }`. `Id`는 `packages/protocol/base/ids.ts`, `AgentRef`·`Place`는 `packages/protocol/lophn-agent/places.ts`에서 온다. runs는 다른 feature module과 lophn-agent를 import하지 않는다(`tools/check-deps.ts`).
2. 시작이 `by`를 받게 한다: `start(input, by?)`.
   - 정한 것: `by`는 route 입력 칸이 아니라 core 안 인자다. route `StartRun`의 입력 schema(`packages/protocol/runs/`)와 그 handler는 고치지 않는다. (이유: 사람 자격이나 CLI가 program caller를 만들지 못하게 한다. `CallAuth` program은 core 안 run 연산만 만든다는 계약이다.)
3. 이미 푼 agent로 시작하는 agent run을 둔다. 근거: README "뼈대 검토에서 정한 것"(이름은 job을 만들 때 core가 AgentRef로 풀어 저장한다).
   - core 안 시작 입력의 agent run에 `AgentRef`를 그대로 받는 갈래를 더한다. 이 갈래는 이름 풀기(port `agents.resolve`)를 건너뛰고, 늘 새 session을 연다(`session` 칸이 없다). route `StartRun` 입력에는 더하지 않는다.
   - 이 갈래도 run의 place(`CreateRun`의 `place`, `headless-run` README "run은 만들 때 place를 기록한다")를 싣는다. 갈래의 입력은 `agents.resolve`가 내는 것과 같은 `{agent: AgentRef, place: RunPlace | null}`이고, place는 job에 저장된 `JobAction.agent_place`(`Place`를 `RunPlace`로 옮긴다)다. run 때 Operator를 다시 찾지 않는다(planner, 2026-10-22: job을 만들 때 이름과 같이 푼 place를 저장해 넘긴다. Operator의 `AgentRef`에는 place가 없다). 그 사이 Operator 정의가 없어졌으면 `agents.open`이 실패해 run이 `start_failed`로 끝나고 job run도 실패로 남는다. run의 place는 부른 agent의 place다. `by.place`(job을 만든 agent의 place)가 아니다.
   - 정한 것: 차례마다 이름을 다시 풀지 않는다. (이유: job은 만들 때 푼 AgentRef를 저장한다. 다시 풀면 그 사이 이름이 바뀐 다른 agent를 부를 수 있다.)
   - `JobAction`을 시작 입력으로 옮기는 작은 함수를 `packages/core/runs/`에 둔다(예: `runStartOfJobAction(action)`). `agent_run {agent, agent_place, prompt, input?, schema?}`는 위 갈래로, `tool_run {app, tool, input?}`는 tool run 입력으로 옮긴다. `sj-jobs-scheduler`의 adapter가 `start(<옮긴 입력>, by)`로 쓴다.
   - `by`는 agent run의 동작을 바꾸지 않는다. 그 turn은 `headless-run`의 run처럼 unattended이고, 받은 agent는 자기 할당으로 일한다(AGENT-ROLE T5, T6). creator의 할당은 tool run에만 쓴다.
4. `by`가 있는 tool run은 program caller로 부른다. 근거: 계약 "내놓는 것", `sj-apps-program-caller`의 `CallAuth`와 wire caller.
   - run service의 port `tools.call(run, app, tool, input)`에 `by?`를 더하고, `start`가 받은 `by`를 그대로 넘긴다.
   - port 구현(`packages/core/main/daemon/wiring/runs.ts`)을 고친다. `by`가 없으면 지금처럼 사람 caller(`{ kind: "person", view_session: <run id> }`, 자격 `{ actor: "user" }`)다. `by`가 있으면 target `{ mode: "live", app, release: null }`, caller `{ kind: "program", job: by.job, job_run: by.job_run }`, 자격 `{ actor: "program", program: { job: by.job, job_run: by.job_run, agent: by.creator, place: by.place } }`로 `ctx.appCallPath.call`을 부른다.
   - run의 끝은 `headless-run`의 규칙 그대로다: outcome `succeeded` → `done`, `failed` → `tool_failed`, `denied` → `tool_denied`(message에 denial code. 할당 밖이면 `gate_blocked`), `unknown` → `tool_unknown`. 이 규칙은 고치지 않는다.
5. 시작 결과에서 run과 session을 바로 준다. 근거: 계약 "내놓는 것", `sj-jobs-contract`의 `JobRunStarter.start`.
   - `start`의 결과에서 run id와 session(agent run이면 연 session, tool run이면 null)을 끝을 기다리지 않고 얻을 수 있어야 한다. session은 run 기록을 만들 때 이미 정해진다. `job.run_started`가 이 session을 기록한다.
   - 지금 `start`가 run 기록을 돌려주면 기록의 `id`와 `session`이 그것이니 모양을 바꾸지 않는다. id만 돌려주면 `{ run, session }`을 돌려주게 바꾼다. route `StartRun`의 출력은 바꾸지 않는다.
6. run service를 jobs wiring이 부를 수 있게 낸다.
   - `sj-jobs-scheduler`의 `packages/core/main/daemon/wiring/jobs.ts`가 시작과 기다리기를 부르려면 run service가 runs wiring 밖으로 나와야 한다. `headless-run`의 runs wiring이 아직 내지 않으면 `packages/core/main/daemon/wiring/context.ts`의 `Late`에 slot(예: `runs`)을 두고 `runs.ts`가 `ctx.provide`한다. module-catalog의 `packages/core/main` 줄대로 wiring file끼리 import하지 않는다.
   - `context.ts`는 소유 밖이다(README "run service를 jobs wiring에 넘기는 자리는 lead가 등록한다"). slot은 보고의 "등록할 것"에 적고, `runs.ts`의 provide 한 줄은 4와 같이 한다.
7. run 기록에 그 run을 연 job을 남긴다. 근거: README "살 단계 검토에서 정한 것"(run 기록에 `job` 칸을 둔다. sidebar가 job이 연 run에 job의 `title`을 보인다, `sj-shell-job-screen`).
   - `packages/protocol/runs/runs.ts`의 `runRecordSchema`와 `CreateRun` 입력에 `job: idSchema("job").nullable()`을 더한다. job이 연 run이면 그 job id, 아니면 null이다. `ListRuns`와 `ReadRun`의 출력에 그대로 실린다.
   - `packages/core/runs/`의 `runs` 표(schema step `runs.tables`)에 `job` 칸을 더하고 `start`가 `by.job`(없으면 null)으로 채운다. schema step은 그 자리에서 고치고 migration은 두지 않는다(AGENTS.md "호환성"). 개발 data는 지우고 새로 만든다.
   - `tests/`에서 run 기록을 만들거나 단정하는 곳이 있으면(`grep -rn "runs/create\|runRecordSchema\|runCreate" tests`) 같이 고친다. 지금 main에는 없다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 할당 밖 호출이 막히는 것은 `sj-apps-program-caller`의 test "job이 부르는 앱 tool은 그 job을 만든 agent의 할당 밖이면 실행되지 않는다"가 core 호출 경로에서 본다. 이 task는 `by`를 넘기기만 하고, 넘긴 인자를 세는 test는 쓰지 않는다(write-test "쓰지 않는 test").
- 남지 않음:
  - `grep -n 'kind: "program"' packages/core/main/daemon/wiring/runs.ts`가 1줄 이상이다(job의 tool run이 사람 caller로 가지 않는다).
  - `packages/protocol/runs`에서 바뀐 것은 run 기록과 `CreateRun` 입력의 `job` 칸뿐이다. `StartRun`의 입력 schema는 그대로다(`by`와 이미 푼 agent 갈래는 route 입력에 없다).
  - `packages/core/runs/`에 `TODO`·`FIXME`가 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: run service를 다른 wiring에 내는 `packages/core/main/daemon/wiring/context.ts`의 slot(6에서 더해야 했다면)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것. 앞 계획 land 뒤 이름이 brief와 달랐던 곳
- 넘길 줄: 소유 밖에서 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

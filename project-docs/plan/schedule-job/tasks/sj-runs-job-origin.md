# sj-runs-job-origin

run 기록에 그 run을 연 job을 남기고, core 안 run 시작이 job의 시작(이미 푼 agent, program caller로 부르는 tool run)을 받게 한다. `StartRun` route와 CLI는 바꾸지 않는다.

- 단위: runs (wave 3)
- 선행: `sj-apps-program-caller`
- 소유(이 task만 고친다):
  - `packages/protocol/runs/runs.ts`
  - `packages/core/runs/`
  - `packages/core/main/daemon/wiring/runs.ts`
- 읽을 것:
  - 계획: `project-docs/plan/schedule-job/README.md`의 "정한 것" 중 "할 일"(agent 호출, 앱 tool 호출, run 기록과 instance에 job을 단다), `tasks/sj-jobs-contract.md`의 "접점 › run의 `job` 칸"
  - architecture
    - `project-docs/architecture/run.md`: "지키는 것"의 "시작"(이름을 다 푼 뒤에 session을 열고 run을 만든다), "tool run"(부른 쪽은 사람이다), "끝을 아는 법", "켤 때와 session 끝", "읽기"(`ListRuns`는 core에서 거른다)
    - `project-docs/architecture/app-call.md`의 "부른 쪽은 호출 본문이 주장하는 대로 믿지 않고 core가 확인한다"(program caller는 core 안 연산만 만든다)
    - `project-docs/architecture/approval.md`의 "turn mode"(run 입력은 `unattended: true`)
    - `project-docs/architecture/layers.md`: `runs`는 lophn-agent와 다른 feature module을 import하지 않고 `ports.ts`의 port를 wiring이 끼운다
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `runs`(와 `core-api`), `project-docs/module-catalog.yaml`의 `packages/core/runs`
  - 코드
    - `packages/protocol/runs/runs.ts`: `runRecordSchema`, `startRunInputSchema`(route 입력), `runCreate`(`placeFits`, `kindFits`)
    - `packages/core/runs/`: `schema.ts`(`runsSchemaSteps`), `store.ts`(`runFromRow`, `insertRun`), `commands.ts`(`create`가 `insertRun`에 입력을 펼쳐 넘긴다), `ports.ts`(`RunTools`, `ResolvedAgent`), `service.ts`(`start`, `startAgent`, `startTool`, `callTool`), `text.ts`(`runMessageText`), `mod.ts`, `service_test.ts`, `store_test.ts`
    - `packages/core/main/daemon/wiring/runs.ts`: `tools.call`(지금 사람 caller), `agents`, `build`의 service 조립
    - 이 task가 부르는 쪽의 자격 모양: `packages/core/apps/calls/caller.ts`의 `CallAuth`(program 갈래, `sj-apps-program-caller`가 만든 것)
  - 읽기만 한다(바꾸지 않는다): `packages/coding-agent/cli/commands/run.ts`(run 기록을 그대로 낸다), `packages/shell/renderer/workspace/core-source.ts`의 `runs`(칸을 하나씩 골라 옮긴다. `job`을 싣는 일은 `sj-shell-job-labels`)
- 계약:
  - 쓰는 것: `idSchema("job")`·`idSchema("jbr")`(`sj-jobs-contract`), `sj-apps-program-caller`의 `CallAuth` program 갈래와 wire caller `program`
  - 내놓는 것(`sj-jobs-contract`의 "run의 `job` 칸"이 정한 모양 그대로)
    - `runRecordSchema`와 `CreateRun` 입력에 `job: Id<"job"> | null`. `runs` 표에 `job` 칸(schema step을 그 자리에서 고친다). `ListRuns`·`ReadRun`이 그대로 싣는다.
    - `RunService.start(input, origin?)`: `origin = {job, job_run, creator: AgentRef, creator_place: Place | null}`. 입력에 이미 푼 agent로 부르는 갈래 `{kind: "agent_resolved", agent: AgentRef, place: RunPlace | null, prompt, input?, schema?}`를 더한다(이름 풀기를 건너뛰고 늘 새 session을 연다). route `StartRun`의 입력 schema에는 더하지 않는다.
    - `RunTools.call(run, app, tool, input, origin?)`. `origin`이 있으면 wiring이 caller `{kind: "program", job, job_run}`과 자격 `{actor: "program", program: {job, job_run, agent: creator, place: creator_place}}`로 `appCallPath.call`을 부른다. 없으면 지금처럼 사람 caller다.
    - runs wiring이 service를 `ctx.provide("runService", ...)`로 낸다. `Late` 칸은 lead가 계약 wave와 함께 등록한다(wave 2 전).

## 정한 것

- `origin`은 route 입력이 아니라 core 안 인자다(사람 자격이나 CLI가 program caller를 만들지 못하게 한다).
- run의 끝을 아는 법과 실패 이유는 바꾸지 않는다. 할당 밖 tool 호출은 outcome `denied`이므로 run이 `failed`(`tool_denied`)로 끝난다.
- run의 place는 부른 agent의 place(`agent_resolved`의 `place`)다. creator의 place가 아니다. Operator의 place는 `AgentRef`에 없어 job이 만들 때 푼 `agent_place`를 그대로 받는다.
- 차례마다 이름을 다시 풀지 않는다. 그 사이 Operator 정의가 없어졌으면 session을 열지 못해 run이 `start_failed`로 끝난다.
- `origin`은 메모리에만 있다. tool run은 켤 때 `lophn_restarted`로 닫히므로 다시 쓸 일이 없다.
- tool run의 `app`은 job이 저장한 `Id<"app">`를 그대로 `StartRun`의 `app` 칸(`kind: "tool"`)으로 넘긴다. `resolveApp`이 id, slug, 이름을 모두 받으므로(`appByName`) 새 입력 갈래를 만들지 않는다. 앱이 없어졌으면 `not_found`로 `start`가 `err`를 돌려주고 job run을 닫는 것은 scheduler의 일이다.
- `agent_resolved`는 `RunService.start`의 입력 type에만 더하고 route 입력 schema(`runStart`)에는 더하지 않는다. route의 discriminated union이 `agent`·`tool`만 받으므로 사람이 `agent_resolved`를 보내면 `invalid_input`이다. `origin` 없는 `agent_resolved`를 따로 막지 않는다(부르는 곳이 core 안 wiring 하나다).
- `runs.job`은 FK가 없다. job을 지워도 run 기록은 남고 `job`은 없는 id를 가리킨다(README "job 지우기는 job과 그 기록을 지운다. 도는 run은 끝까지 돈다"). 화면은 제목을 못 찾으면 원래 이름으로 보인다.
- `ListRuns`에 job으로 거르는 칸과 `runs.job` index를 더하지 않는다. 읽는 쪽이 없다(job 화면은 job run 줄의 `run` id로 `ReadRun`을 부른다).
- DDL은 그 자리에서 고친다(`runs.tables`에 `job TEXT` 칸). migration, 새 schema step을 만들지 않는다(AGENTS.md "호환성"). 옛 data root(`.dev-data` 포함)는 `history_mismatch`로 뜨지 않으니 지우고 새로 만든다. changelog 줄은 lead가 쓴다. 사람의 `~/.lophn`은 건드리지 않는다.

## 할 일

1. protocol `runs.ts`: `runRecordSchema`에 `job: idSchema("job").nullable()`(주석: job이 연 run만 값이 있다). `runCreate` 입력에 `job: idSchema("job").nullable()`. `startRunInputSchema`와 `runStart`는 건드리지 않는다. 이유: 화면과 CLI가 읽는 `RunRecord`가 이 schema 하나다(`ReadRun`, `ListRuns`, `WaitRun`, `CancelRun`이 모두 싣는다).
2. 표: `core/runs/schema.ts`의 `runs.tables`에 `job TEXT` 칸을 더한다(step id 그대로). `store.ts`: `runFromRow`가 `job: row.job`을 싣고, `insertRun`의 입력에 `job: string | null`을 더해 INSERT 칸과 값에 넣는다. `commands.ts`의 `create`는 `{ ...input, created_at }`를 넘기므로 고칠 것이 없다(확인만).
3. `store_test.ts`: `insertRun` 호출에 `job: null`을 더한다(type이 요구한다). 다른 test를 더하지 않는다.
4. `core/runs/ports.ts`: `RunOrigin = { job: Id<"job">; job_run: Id<"jbr">; creator: AgentRef; creator_place: Place | null }`를 export한다. `RunTools.call`에 마지막 인자 `origin?: RunOrigin`. `mod.ts`가 `RunOrigin`을 export한다. 이유: wiring이 같은 type으로 받고, 뒤의 scheduler task가 wiring을 통해 이 모양을 채운다(jobs module은 runs를 import하지 않는다).
5. `core/runs/service.ts`
   - 입력 type: `ResolvedAgentStart = { kind: "agent_resolved"; agent: AgentRef; place: RunPlace | null; prompt: string; input?: JsonValue; schema?: Record<string, JsonValue> }`를 만들고 `start(input: StartInput | ResolvedAgentStart, origin?: RunOrigin)`로 한다.
   - `startAgent`: 앞의 검사(`agent`·`session` 정확히 하나, `coding_agent`, schema 읽기, prompt 크기)는 `kind: "agent"`일 때만 하고, schema 읽기와 prompt 크기 검사는 두 갈래가 같이 쓴다. `resolved`는 `agent_resolved`면 입력의 `{agent, place}`를 그대로, 아니면 지금처럼 `resolve`/`agentOf`다. `opened`는 `agent_resolved`이면 늘 true(새 session)다. `store.create`에 `job: origin?.job ?? null`.
   - `startTool`: `store.create`에 `job: origin?.job ?? null`, `callTool(run, app, tool, input, origin)`이 `tools.call(run, app, tool, input, origin)`을 부른다.
   - 끝을 아는 법(`settleFromTurn`, `callTool`의 outcome 분기), `cancel`, `reconcile`은 고치지 않는다.
6. `wiring/runs.ts`
   - `tools.call(run, app, tool, input, origin?)`: `origin === undefined`면 지금 그대로. 있으면 `appCallPath.call({ target, tool, input?, caller: { kind: "program", job: origin.job, job_run: origin.job_run } }, { actor: "program", program: { job: origin.job, job_run: origin.job_run, agent: origin.creator, place: origin.creator_place } })`.
   - `build`에서 `service = built` 다음에 `ctx.provide("runService", built)`. `Late` 칸은 lead가 계약 wave와 함께 이미 등록했다. 칸이 없어 type check가 막히면 고치지 말고 멈춰서 보고한다.
7. 읽는 쪽 확인(바꾸지 않는다): CLI `run show|wait`과 `agent run --json`은 기록을 그대로 내므로 `job`이 저절로 실린다. renderer의 run 읽기는 칸을 골라 옮겨서 `job`이 빠진다. 이를 싣는 일은 `sj-shell-job-labels`의 몫이다(`RunRecordView.job`).
8. 확인: `deno test --no-check packages/core/runs`.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(할당 밖 호출이 막히는 것은 `sj-apps-program-caller`의 test가 호출 경로에서 본다).
- 남지 않음
  - program caller를 만드는 곳은 `wiring/runs.ts`의 `tools.call` 하나다: `grep -rn 'kind: "program", job' packages --include=*.ts`가 그 한 곳과 `sj-apps-program-caller`의 test뿐이다.
  - `grep -rn "agent_resolved" packages/protocol`이 0줄이다(route 입력에 더하지 않았다).
  - `grep -n "insertRun(" -r packages`의 호출이 모두 `job`을 넘긴다(type이 강제한다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `Late`의 `runService: RunService`(`packages/core/runs/mod.ts`의 type)와 `LATE_KEYS` 줄은 lead가 계약 wave와 함께 이미 더했다. 칸의 type이 이 task가 낸 `RunService`와 다르면 어디가 다른지 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): 없음 예상
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 고치지 않은 문서(lead가 끝에 고친다): `architecture/run.md`(job 칸, `agent_resolved`, program caller로 부르는 tool run)
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

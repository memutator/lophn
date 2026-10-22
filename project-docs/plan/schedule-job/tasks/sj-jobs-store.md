# sj-jobs-store

core module `jobs`의 표(`jobs`, `job_runs`), 주기 셈(서머타임 규칙), agent와 사람이 부르는 command(`job.create`, `job.update`, `job.delete`)와 읽기(`job.list`, `job_run.list`, `job.holds`, `job_run.open`), 등록을 만든다. 차례를 판정하고 job run 줄을 만드는 command는 `sj-jobs-due`가 한다.

- 단위: jobs (wave 2)
- 선행: `sj-jobs-contract`
- 소유(이 task만 고친다):
  - `packages/core/jobs/{schema,rows,store,schedule,schedule_test,commands,commands_test,reads,register}.ts` (새 file)
  - `packages/core/main/daemon/wiring/jobs-registration.ts` (새 file)
- 읽을 것:
  - architecture: `project-docs/architecture/event.md`(뒤에 움직일 일은 command가 같은 tx에서 한다. `afterCommit`으로 싣는 것은 commit 뒤 Bus로 나간다), `project-docs/architecture/layers.md`(feature module은 lophn-agent와 다른 feature module을 import하지 않는다. Worker가 싣는 file의 import), `project-docs/architecture/run.md`("켤 때와 session 끝": job이 같은 일을 하는 `sj-jobs-due`와 구분), `project-docs/architecture/approval.md`("시킨 것이 승낙이고 할당이 허락이다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `jobs`, `project-docs/module-catalog.yaml`의 `packages/core/jobs`(lead가 먼저 등록한다)
  - 본보기 코드:
    - 표·행·command·read·등록 꼴: `packages/core/runs/{schema,store,commands,reads,register}.ts`. `packages/core/runs/store_test.ts`는 `createSql`이 INTEGER를 bigint로 줘서 flag를 잘못 읽은 버그의 test다(`rows.ts`에서 `Number()`로 읽는 이유).
    - test 준비(in-memory SQLite와 `Tx` 대역): `packages/core/workflows/commands_test.ts`, `packages/core/runs/store_test.ts`
    - tx port와 reader `snapshotPort`: `packages/core/domains/register.ts`, `packages/core/main/daemon/wiring/domains-registration.ts`, `packages/core/main/daemon/wiring/apps-usage.ts`(wiring 쪽 등록 file의 `createCoreRegistration`·`createReaderRegistration`)
    - 이름 풀기: `packages/core/main/daemon/wiring/runs.ts`의 `agents.resolve`(Operator의 place까지)와 `tools.resolveApp`, `packages/core/main/daemon/wiring/workflows.ts`의 `projects.resolve`. session에서 agent 얻기: `packages/core/lophn-agent/session/model.ts`의 `loadSession`·`agentRefOf`
    - `packages/core/storage/ledger/after-commit.ts`(`afterCommit` port)
  - 제품 결정: 계획 README의 "정한 것"의 "주기", "서머타임", "놓친 차례 정책", "누가"
- 계약:
  - 쓰는 것: `sj-jobs-contract`의 protocol `jobs`(record, route, 값. route의 TS export 이름은 계약이 정한 `jobCreate`·`jobUpdate`·`jobDelete`·`jobList`·`jobRunList`·`jobHolds`·`jobRunOpen`), `packages/core/jobs/ports.ts`(`jobZonePort`, `jobTargetsPort`, `JOBS_CHANGED_TOPIC`)
  - 내놓는 것
    - `schedule.ts`(순수 함수, 시각과 zone은 인자로만 받는다)
      - `JobSpec = {every: string; at: string | null; zone: string}`
      - `firstDue(spec, after): At`: `after` 뒤의 첫 차례. 만들 때, 다시 켤 때, 주기나 시각을 바꿀 때 쓴다(그때부터 새로 센다).
      - `dueTurns(spec, due, now): {count: number; last: At; next: At}`: `due`(이미 온 차례)부터 `now`까지 온 차례 수(`due` 포함), 그 가운데 마지막, `now` 뒤의 첫 차례.
    - `store.ts`: job과 job run 줄을 읽고 쓰는 함수(`loadJob`, `loadJobs`, `insertJob`, `replaceJob`, `setNextDue`, `deleteJob`, `loadJobRun`, `loadJobRuns`, `loadHolds`, `insertJobRun`, `replaceJobRun`). `sj-jobs-due`가 같은 tx에서 쓴다.
    - `register.ts`: `createLedgerRegistration(environment)`가 `schemaSteps`(`jobs.tables`)와 command 셋, read 넷을 낸다. `createReaderRegistration()`이 같은 read 넷을 낸다.
    - `wiring/jobs-registration.ts`: `jobTargetsPort`(writer tx port와 reader `snapshotPort`)와 `jobZonePort` 구현. 등록할 것(lead): `assembly.ts`의 `TEAMS`와 `TEAM_MODULES`.

## 정한 것

- 표와 칸은 `sj-jobs-contract`의 "표"가 정한다. unique index 둘은 `sj-jobs-due`의 규칙을 표가 한 겹 더 지킨다.
- 다음 차례(`next_due_at`): 켜진 job은 `firstDue(spec, now)`, 꺼진 job은 null이다. 꺼 둔 job을 다시 켜거나 `every`·`at`을 바꾸면 그 순간부터 새로 센다(놓친 것으로 치지 않는다. README "켤 때는 lophn을 켤 때다").
- `at`이 있는데 합친 `every`가 `d` 단위가 아니면 `invalid_input`이다.
- 서머타임(Temporal 사용, Deno 2.9 기본 global)
  - 그 시각이 없는 날(건너뛴 시각)은 시계가 건너뛴 직후 시각이다(`America/New_York` 2026-03-08에 02:30이 없으면 03:00).
  - 같은 시각이 두 번 오는 날은 첫 번째 한 번만 돈다(차례는 날짜마다 하나다).
  - `at` 없는 `Nd`는 고정 길이라 서머타임에 local 시각이 한 시간 밀린다. 시각을 지키려면 `at`을 준다.
- 권한
  - `job.create`: actor agent, `parseActor(ctx.actor).id`가 session. `jobTargetsPort.creatorOf`가 `undefined`거나 role이 lophn·Project Manager·App Engineer가 아니면 `forbidden`. `agent_run`이면 `resolveAgent`, `tool_run`이면 `resolveApp`, `workflow_start`면 `resolveProject`로 푼 값을 저장한다.
  - `job.update`·`job.delete`: agent는 creator(AgentRef)가 자기와 같은 job만, 아니면 `not_found`다. user는 어느 job이든 한다. 지우기는 job과 그 job run 줄을 지우고 도는 run이나 instance는 건드리지 않는다(끝나면 `job_run.ended`가 `not_found`를 받는다).
  - 모든 command는 바꾼 뒤 `JOBS_CHANGED_TOPIC`을 `afterCommit`으로 싣는다.
- 할당(앱, tool)과 부를 agent의 할당은 만들 때 보지 않는다. 부를 때만 확인한다(README).
- 서머타임의 "건너뛴 직후 시각"은 Temporal 기본값(`compatible`)이 아니다. `compatible`은 같은 폭만큼 밀어 `America/New_York` 2026-03-08 02:30을 03:30으로 푼다. README가 정한 03:00은 시계가 건너뛴 그 순간이다. 구현은 `ZonedDateTime.from({...날짜, hour, minute, timeZone}, {disambiguation: "compatible"})`로 풀고, 결과의 시와 분이 요청한 `at`과 다르면(없는 시각이다) `result.getTimeZoneTransition("previous")`의 시각을 쓴다. 이 값은 2026-03-08 03:00(-04:00)이다(Deno 2.9.7에서 확인).
- `claimed_at`은 `sj-jobs-due`만 읽고 쓴다. `store.ts`의 `insertJobRun`은 NULL로 넣고 `replaceJobRun`은 그 칸을 건드리지 않는다. due가 필요한 `claimed_at` 질의는 due.ts가 `rows.ts`의 `jobRunFromRow`와 raw SQL로 한다.
- `commands.ts`의 export 이름은 `createJobCommands(): {create, update, remove}`다(`delete`는 예약어라 `remove`).

## 할 일

1. **`schema.ts`: `jobsSchemaSteps`.** step id `jobs.tables` 하나. `sj-jobs-contract`의 "표"대로 `jobs`와 `job_runs`를 `STRICT`로 만든다(`runs/schema.ts` 꼴).
   - CHECK: `missed_policy`, `state`는 `MISSED_POLICIES`·`JOB_RUN_STATES`에서 만든 목록, `enabled`는 0|1, `action`은 `json_valid`, `creator_role`은 `lophn|project_manager|app_engineer`, `(creator_role = 'lophn') = (creator_id IS NULL)`.
   - index: `job_runs(job, id)`. unique index 둘: `CREATE UNIQUE INDEX job_runs_open ON job_runs(job) WHERE state IN ('queued', 'running')`, `CREATE UNIQUE INDEX job_runs_held ON job_runs(job) WHERE state = 'held'`. 이유: 겹침 규칙을 `sj-jobs-due`의 코드가 틀려도 표가 한 겹 더 막는다.
   - FK는 두지 않는다(contract). 지우기는 command가 두 표를 같이 지운다.
2. **`rows.ts`: `jobFromRow(row, lastRun)`, `jobRunFromRow(row)`.** `workflows/rows.ts` 꼴로 record schema에 `safeParse`해서 실패하면 `internal`이다. `enabled`·`missed_count` 같은 INTEGER는 `Number()`로 읽는다(bigint로 온다). `creator`는 `creator_role`·`creator_id`에서 `AgentRef`로 되돌린다(`creatorColumns(ref)`와 짝으로 둔다). `jobRunFromRow`는 `sj-jobs-due`도 import한다.
3. **`store.ts`.** contract의 이름 열한 개와 `loadOpenRuns`를 낸다. `Query = Pick<Sql, "get" | "all">`, `Write = Pick<Sql, "get" | "run">`(`runs/store.ts` 꼴).
   - `loadJob(sql, id): Result<JobRecord | null>`: `last_run`은 그 job의 `id`가 가장 큰 job run(`ORDER BY id DESC LIMIT 1`)으로 채운다.
   - `loadJobs(sql, {creator?, after?, limit})`: id 오름차순, `creator`는 `creator_role = ? AND creator_id IS ?`.
   - `insertJob`, `replaceJob(sql, id, fields)`(title, every, at, action, missed_policy, enabled, next_due_at, updated_at), `setNextDue(sql, id, next)`(claim이 쓴다. `updated_at`은 건드리지 않는다), `deleteJob`(`job_runs`의 그 job 줄과 `jobs` 줄).
   - `loadJobRun`, `loadJobRuns(sql, job, {after?, limit})`(id 내림차순, cursor는 page 마지막 id), `loadHolds(sql)`(`state = 'held'`, id 순), `loadOpenRuns(sql)`(`queued`·`running`, id 순), `insertJobRun(sql, {id, job, due_at, missed_count, state, reason, created_at})`, `replaceJobRun(sql, id, fields)`(state, due_at, missed_count, reason, run, instance, session, started_at, ended_at 가운데 준 칸만).
   - id 정렬이 곧 시간 순이다(`runs/store.ts`와 같다).
4. **`schedule.ts`: 순수 함수.** `Date.now`, `new Date()`, `Temporal.Now`를 쓰지 않는다. 시각과 zone은 인자로만 받는다.
   - 간격: `Nm`은 N×60,000ms, `Nh`는 N×3,600,000ms, `at`이 없는 `Nd`는 N×86,400,000ms인 고정 길이다.
   - `firstDue(spec, after)`: 고정 길이면 `after + 간격`. `at`이 있으면 `after`가 속한 local 날짜의 `at` 시각이 `after` 뒤면 그것, 아니면 다음 날의 `at` 시각이다(N일 뒤가 아니라 `at`이 처음 오는 때).
   - `dueTurns(spec, due, now)`(전제: `due <= now`): 고정 길이는 산수로 `count = floor((now - due) / 간격) + 1`, `last = due + (count - 1) × 간격`, `next = last + 간격`. `at`이 있으면 `due`부터 차례를 하나씩 세며 간다. 다음 차례는 "직전 차례의 local 날짜 + N일"의 `at` 시각이고, `now`를 넘는 첫 차례가 `next`다. 날짜는 달력으로 더한다(24시간 × N이 아니다).
   - local 시각 → 시각 변환 한 곳(`resolveLocal`)에 서머타임 규칙을 둔다. 위 "정한 것"의 건너뛴 시각, 그리고 같은 시각이 두 번 오는 날은 `compatible`이 첫 번째를 고르므로 한 번만 돈다(차례는 날짜마다 하나다).
   - `parseEvery`, `At` 형식 변환(`Temporal.Instant`의 `epochMilliseconds` ↔ `formatAt` from `packages/base/mod.ts`)은 이 file 안의 작은 함수다.
5. **`schedule_test.ts`: 위험 test 하나.** 아래 "끝남"을 본다. 순수 함수라 준비가 없다.
6. **`commands.ts`: `createJobCommands()`.** `{create, update, remove}`. 모두 `afterCommit`(`../storage/ledger/after-commit.ts`)로 `JOBS_CHANGED_TOPIC`을 `{job, job_run: null}`로 싣는다. 시각은 `tx.now()`, 시간대는 `tx.port(jobZonePort).zone()`, 풀기는 `tx.port(jobTargetsPort)`, id는 `tx.newId("job")`.
   - 공통: actor가 `agent`면 `parseActor(ctx.actor).id`를 session으로 `creatorOf`를 부른다. `undefined`면 `forbidden`.
   - `create`: creator role이 lophn·Project Manager·App Engineer가 아니면 `forbidden`. `every`·`at` 사이 검사(`at`은 `d` 단위만)는 `invalid_input`. `action`은 contract의 `JobAction`으로 푼다: `agent_run`이면 `resolveAgent`(`agent_place` 같이 저장), `schema`가 있으면 `z.fromJSONSchema`로 읽히는지 본다(못 읽으면 `invalid_input`. 안 보면 차례마다 run이 실패한다), `tool_run`이면 `resolveApp`, `workflow_start`면 `"<project>/<name>"`을 나누어 `resolveProject`로 project id를 얻고 name은 그대로 저장한다. `next_due_at = enabled ? firstDue(spec, now) : null`. 결과 `{job: loadJob(...)}`.
   - `update`: 줄이 없으면 `not_found`. agent는 `creator`가 자기와 같은 job(AgentRef가 같다)만 고친다. 다르면 `not_found`다(남의 job이 있는지도 알리지 않는다). user는 어느 job이든 한다. 준 칸만 덮는다(`at: null`은 비운다). 합친 값으로 `at` 검사를 다시 한다. `next_due_at`은 합친 `enabled`가 false면 null, 켜지는 순간(꺼져 있다가)이거나 `every`·`at`이 바뀌었으면 `firstDue(spec, now)`, 아니면 그대로다. `action`을 주면 다시 푼다.
   - `remove`: `update`와 같은 권한. `deleteJob`. 결과 `{job}`.
7. **`commands_test.ts`: 위험 test 하나.** 아래 "끝남"을 본다.
8. **`reads.ts`.** `createJobReads(): {list, runList, holds, open}`. 출력은 `as_of_seq: snapshot.as_of_seq`, `next_cursor`를 싣는다(`runs/reads.ts` 꼴).
   - `job.list`: actor가 agent면 `snapshot.port(jobTargetsPort).creatorOf(session)`로 그 creator의 job만, user면 전부. agent의 creator를 모르면 `forbidden`. 50개씩, cursor는 마지막 id.
   - `job_run.list`: job이 없으면 `not_found`. 50개씩.
   - `job.holds`: `loadHolds` 전부(job마다 하나라 쪽을 나누지 않는다). 각 줄에 job을 싣는다.
   - `job_run.open`: `loadOpenRuns`를 `{job, job_run}`으로. `claimed` 같은 안쪽 칸은 싣지 않는다.
9. **`register.ts`.** `runs/register.ts` 꼴. `createLedgerRegistration(_environment?)`는 `schemaSteps: jobsSchemaSteps`, `commands: [create, update, remove]`, `reads: [list, runList, holds, open]`. `createReaderRegistration(): ReaderRegistration`은 같은 read 넷과 빈 `ports`다. `scheduler.ts`·`service` 류를 import하지 않는다(Worker가 싣는 file이다). `sj-jobs-due`가 `commands`에 넷을 더한다.
10. **`wiring/jobs-registration.ts`.** `wiring/domains-registration.ts`·`apps-usage.ts` 꼴의 두 export.
    - `createCoreRegistration()`은 `{ports: [defineTxPort(jobTargetsPort, (tx) => targetsOf(tx.sql)), defineTxPort(jobZonePort, () => ({zone: () => Intl.DateTimeFormat().resolvedOptions().timeZone}))]}`다.
    - `createReaderRegistration()`은 `{reads: [], ports: new Map([[jobTargetsPort, snapshotPort((snapshot) => targetsOf(snapshot.sql))]])}`다. 이유: reader Worker의 port는 등록마다 모아 모든 read가 같이 쓰므로(같은 key를 두 곳에 두면 기동 때 던진다) read를 가진 `jobs/register.ts`와 따로 둘 수 있다.
    - `targetsOf(sql)`: `creatorOf(session)` = `loadSession({sql}, session)` → `agentRefOf`(없으면 undefined). `resolveAgent(named)` = `coding_agent`면 `invalid_input`, 아니면 `wiring/runs.ts`의 `agents.resolve`와 같은 `createSessionDirectory({...placeDepsOf(sql), publish: () => {}, sql: () => sql}).resolveAgent(named)`로 `AgentRef`를 얻고 `placeOfAgentRef(agent)`가 `undefined`(Operator)면 `placeDepsOf(sql).operators.operator(agent.agent)?.place ?? null`을 `agent_place`로 준다. `resolveApp`·`resolveProject` = `placeDepsOf(sql).apps.appByName(ref)`·`projects.projectByName(ref)`, 없으면 `not_found`.
    - `runs.ts`의 `agents.resolve`를 import하지 않고(wiring file끼리 import하지 않는다) 같은 호출을 여기서 한다. 이유: 그 함수는 `ledgerSnapshot`을 열지만 여기는 이미 tx나 snapshot의 `sql`을 받는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test 둘(`write-test`: 위험 하나에 test 하나. 둘 다 준비는 가볍게 file 안에서 한다).
  - "서머타임이 바뀌는 날에도 at job의 차례는 그날 하나다"(`packages/core/jobs/schedule_test.ts`). 표 하나로 `America/New_York`에서 본다. (1) `at: "02:30"`, `every: "1d"`: 2026-03-07 02:30 차례(07:30Z)에서 2026-03-08 12:00Z까지 `dueTurns`가 `count 2`, `last`가 2026-03-08T07:00:00.000Z(03:00 -04:00. 없는 02:30은 건너뛴 시각), `next`가 2026-03-09T06:30:00.000Z(02:30 -04:00)다. (2) `at: "01:30"`: 2026-10-31 01:30 차례(05:30Z)에서 2026-11-01T07:00Z까지 `count 2`(11-01의 01:30은 두 번 오지만 한 번), `last`가 2026-11-01T05:30:00.000Z(첫 번째)다. 같은 두 날에 `firstDue`가 하루 하나인지도 본다. 시각은 모두 인자이고 실제 시계를 쓰지 않는다.
  - "agent는 다른 agent가 만든 job을 고치거나 지우지 못한다. 사람(user)은 모든 job을 고치고 지운다"(`packages/core/jobs/commands_test.ts`). in-memory `DatabaseSync` + `jobsSchemaSteps` + `createSql`, `port(key)`를 key로 가르는 `Tx` 대역(`afterCommit`은 `{push() {}}`, `jobTargetsPort`는 session → AgentRef 표를 가진 가짜 `creatorOf`와 `resolveApp`, `jobZonePort`는 `{zone: () => "UTC"}`). 판정은 거절 code와 표의 줄로 한다: lophn이 `tool_run` job을 만든다 → Project Manager session의 `update`·`remove`는 `not_found`이고 job은 그대로다 → 같은 lophn의 다른 session은 고친다 → user는 고치고 지운다(그 job의 `job_runs` 줄도 같이 지워진다).
- 남지 않음: `grep -n "Date.now\|new Date(\|Temporal.Now\|setTimeout\|Intl.DateTimeFormat" packages/core/jobs/schedule.ts packages/core/jobs/commands.ts packages/core/jobs/store.ts`가 0줄이다(시간대 읽기는 `wiring/jobs-registration.ts`에만 있다). `grep -rn "TODO" packages/core/jobs packages/core/main/daemon/wiring/jobs-registration.ts`가 0줄이다.
- 돌리는 법: `deno test --no-check packages/core/jobs`.

## 보고

- 바꾼 file, 통과한 check.
- 등록할 것(lead): `packages/core/main/daemon/assembly.ts`.
  - `TEAMS`에 `{ createLedgerRegistration: createJobsRegistration }`(`../../jobs/register.ts`)와 `{ createCoreRegistration: createJobsCoreRegistration }`(`./wiring/jobs-registration.ts`)를 workflows 뒤에 더한다.
  - `TEAM_MODULES`에 `new URL("../../jobs/register.ts", ...)`와 `new URL("./wiring/jobs-registration.ts", ...)`를 workflows 뒤에 더한다. 이유: writer·reader Worker가 둘 다 import해야 `jobTargetsPort`와 read가 같은 Worker에 선다.
- 안 쓰게 된 export: 없음.
- 정한 것: 위 "정한 것" 밖에 worker가 정한 것.
- 넘길 줄: 남의 file을 최소로 맞춘 곳.
- 계약 바꾸기 요청: `schedule.ts`의 `JobSpec`·`firstDue`·`dueTurns`나 표를 바꿔야 하면 고치지 말고 여기 적는다.
- **무겁게 짠 것**, **알려진 미완 동작**: 없으면 "없음". 예: 시간대가 바뀐 컴퓨터(이사, 여행)에서 `next_due_at`을 다시 계산하지 않는 것, `Nd`(at 없음)가 서머타임에 local 시각이 밀리는 것.

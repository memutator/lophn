# sj-jobs-store

core module `jobs`의 표(`jobs`, `job_runs`), 주기 계산, agent command(`job.create`, `job.update`, `job.delete`), 읽기(`job.list`, `job_run.list`, `job.holds`), 등록을 만든다. job run 줄을 만들고 바꾸는 command는 `sj-jobs-due`가 한다.

- 단위: jobs (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/jobs/commands_test.ts` (새 file)
  - `packages/core/jobs/schema.ts`(새 file)
  - `packages/core/jobs/rows.ts`(새 file)
  - `packages/core/jobs/store.ts`(새 file)
  - `packages/core/jobs/schedule.ts`(새 file)
  - `packages/core/jobs/schedule_test.ts`(새 file)
  - `packages/core/jobs/commands.ts`(새 file)
  - `packages/core/jobs/reads.ts`(새 file)
  - `packages/core/jobs/lookups.ts`(새 file)
  - `packages/core/jobs/register.ts`(새 file)
  - `packages/core/main/daemon/wiring/jobs-registration.ts`(새 file)
- 읽을 것:
  - architecture: `project-docs/architecture/layers.md`(feature module은 다른 feature module과 `agent-roles`를 import하지 않는다. 둘을 다 아는 일은 `core/main`의 등록 file이 한다), `project-docs/architecture/event.md`(남지 않는 event는 commit 뒤에 낸다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `jobs`(lead가 더한다), `storage`, `agent-sessions`. `project-docs/module-catalog.yaml`의 `packages/core/jobs`
  - 본보기: `packages/core/domains/`(`schema.ts`, `rows.ts`, `store.ts`, `commands.ts`, `reads.ts`, `register.ts`가 같은 나눔이다), `packages/core/main/daemon/wiring/domains-registration.ts`(writer tx port), `packages/core/main/daemon/wiring/apps-usage.ts`(reader `snapshotPort`와 `loadSession`·`agentRefOf`), `packages/core/main/daemon/wiring/router-registration.ts`와 `packages/core/lophn-agent/places/directory.ts`(Router의 이름 풀기 `resolveAgent`가 `placeDepsOf(sql).roles.resolveNamed`다), `packages/core/agent-roles/place/session-directory.ts`(`createPlaceRoleRules`의 `resolveNamed`가 받는 이름의 규칙), `packages/core/projects/registry/model.ts`의 `nextRevision`(jobs는 projects를 import하지 않으니 같은 꼴을 jobs 안에 둔다), `packages/core/storage/ledger/after-commit.ts`(`afterCommit`)
  - 제품 결정: `project-docs/plan/schedule-job/README.md`의 "뼈대 검토에서 정한 것"(주기와 시각, "켤 때", job 지우기, 받는 agent 이름, 할당은 부를 때만)
- 계약:
  - 쓰는 것: `sj-jobs-contract`의 `packages/protocol/jobs/`(`JobRecord`, `JobRunRecord`, `JobHold`, `JobActionInput`, `jobCreate`, `jobUpdate`, `jobDelete`, `jobList`, `jobRunList`, `jobHolds`), `packages/core/jobs/ports.ts`(`jobCreatorPort`의 `creatorOf`·`resolveAgent`, `jobZonePort`, `JOBS_CHANGED_TOPIC`)
  - 내놓는 것:
    - `packages/core/jobs/schedule.ts`: `every`와 `at`과 zone으로 다음 차례를 셈하는 순수 함수(어느 시각 뒤의 첫 차례, 두 시각 사이에 놓친 차례 수). `every`의 단위는 `m|h|d`이고 `at`은 `d` 단위에만 쓴다. `at`은 그 zone(이 컴퓨터의 local 시간대)의 시각이다. 서머타임으로 그 시각이 없는 날은 그 뒤 첫 시각에, 같은 시각이 두 번 오는 날은 한 번만 돈다. `sj-jobs-due`가 쓴다.
    - `packages/core/jobs/store.ts`: job과 job run 줄을 읽고 쓰는 함수. `sj-jobs-due`가 같은 tx에서 쓴다.
    - `packages/core/jobs/register.ts`: `createLedgerRegistration(environment)`, `createReaderRegistration()`
    - `packages/core/main/daemon/wiring/jobs-registration.ts`: `jobCreatorPort`(`creatorOf`, `resolveAgent`)와 `jobZonePort` 구현. writer는 `createCoreRegistration`, reader는 `createReaderRegistration`(agent의 `job.list`가 자기 job을 거른다)
    - 등록할 것(lead): assembly `TEAMS`·`TEAM_MODULES`

## 할 일

1. `schema.ts`: `jobsSchemaSteps: readonly SchemaStep[]`, step id `jobs.tables` 하나(`packages/core/domains/schema.ts` 꼴, `STRICT`).
   - `jobs`: `id` PK, `title`(빈 글 아님), `creator_role`(네 role), `creator_id`(lophn은 NULL, 그 밖은 prj·app·agt id. `agentIdentityOf`(`packages/protocol/lophn-agent/places.ts`)가 정체성 열을 준다), `place_kind`·`place_id`(NULL이면 place 없음), `every`, `at`(NULL 가능), `action`(`JobAction` JSON 글), `missed_policy`(`run|hold`), `enabled`(0|1), `next_due_at`(NULL 가능), `revision`, `created_at`, `updated_at`. index `(creator_role, creator_id)`.
   - `job_runs`: `id` PK, `job`, `due_at`, `missed_count`(0 이상), `state`(여덟 상태), `reason`, `run`, `session`, `claimed_at`, `started_at`, `ended_at`, `created_at`. index `(job, id)`.
   - 같은 job에 도는 줄은 하나다: `CREATE UNIQUE INDEX job_runs_one_active ON job_runs(job) WHERE state IN ('queued', 'running')`. 기다리는 hold 줄도 하나다: `... job_runs_one_held ON job_runs(job) WHERE state = 'held'`. 근거: README 위험 "앞 차례가 도는 동안 같은 job이 또 돌지 않는다"와 "놓친 차례는 한 번으로 친다"를 표가 지킨다. 어기는 쓰기는 handler가 먼저 막아 `conflict`로 돌려주고, index는 그 아래 바닥이다.
   - 정한 것: `claimed_at`은 `JobRunRecord`에 없는 안쪽 칸이다. `sj-jobs-due`의 `job.claim_due`가 scheduler에 넘긴 `queued` 줄에 적어, 같은 줄을 두 번 넘기지 않는다(넘긴 줄이 두 번 시작되면 같은 job이 겹쳐 돈다).
   - FK는 두지 않는다. 지우기는 command가 `job_runs`부터 지운다.
2. `rows.ts`: `jobFromRow(row, lastRun)`과 `jobRunFromRow(row)`. contract의 schema로 `safeParse`하고, 틀리면 `internal`("invalid stored job")이다(`packages/core/domains/rows.ts` 꼴). creator는 `agentRefOfColumns`(`packages/protocol/lophn-agent/places.ts`)로, `action`은 `JSON.parse` 뒤 `jobActionSchema`로 읽는다.
3. `store.ts`(`sj-jobs-due`도 쓴다): `loadJob(sql, id)`, `loadJobs(sql, filter: {creator?, place?})`, `insertJob(tx, job)`, `replaceJob(tx, job)`(바뀌는 칸 전부), `setNextDue(tx, job, next_due_at)`, `deleteJob(tx, id)`(그 job의 `job_runs`를 먼저 지운다), `loadJobRun(sql, id)`, `loadJobRuns(sql, job, {before?, limit})`(새것부터), `loadHolds(sql)`, `insertJobRun(tx, run, claimed_at)`, `replaceJobRun(tx, run)`. `JobRecord.last_run`은 저장하지 않고 읽을 때 그 job의 가장 새 줄(`ORDER BY id DESC LIMIT 1`)로 채운다. `sj-jobs-due`의 특수 질의(차례가 된 job, 도는 줄)는 `due.ts`가 같은 module의 표에 직접 쓴다.
4. `schedule.ts`: 순수 함수. 시각과 zone은 인자로만 받는다(`Date.now`, `Temporal.Now`, `Intl`로 기본 zone을 읽지 않는다). 시각 글은 `formatAt`(`packages/base/clock.ts`) 꼴이다.
   - `type JobSpec = {every: string; at: string | null; zone: string}`
   - `firstDue(spec, after): string`: `after`보다 뒤의 첫 차례. job을 만들 때, 다시 켤 때, 주기나 시각을 바꿀 때 쓴다(그때부터 새로 센다).
   - `dueTurns(spec, due, now): {count, last, next}`: `due`(이미 온 차례)부터 `now`까지 온 차례 수(`due` 포함), 그 가운데 마지막 차례, `now`보다 뒤의 첫 차례.
   - `at`이 없으면 간격은 고정 길이다(`m` 60초, `h` 3600초, `d` 86400초 × 수). `dueTurns`는 나눗셈으로 센다(1분 job이 한 해 꺼져 있어도 돌지 않는다).
   - `at`이 있으면(`d` 단위뿐) 차례는 zone의 local 날짜 열이다: `due`의 local 날짜에서 N일씩 더한 날의 `HH:MM`. `firstDue`는 `after`의 local 날짜의 `HH:MM`이 `after` 뒤면 그날, 아니면 다음 날에서 시작한다. local 시각을 순간으로 풀 때 `Temporal`(Deno 2.9 기본 global)을 쓴다:
     - 그 시각이 없는 날(서머타임 시작): `toZonedDateTime(zone, {disambiguation: "later"})`의 벽시계가 원래 시각과 다르면 `getTimeZoneTransition("previous")`, 곧 시계가 건너뛴 직후의 시각이다(02:30이 없으면 03:00). 정한 것: README의 "그 뒤 첫 시각"을 시계가 건너뛴 직후로 읽었다.
     - 같은 시각이 두 번 오는 날(서머타임 끝): `disambiguation: "earlier"`, 첫 번째다. 차례는 날짜마다 하나라 그날 두 번째 시각은 차례가 아니다.
     - 정한 것: `at` 없는 `Nd`는 고정 길이라 서머타임에 local 시각이 한 시간 밀린다. 시각을 지키려면 `at`을 준다.
5. `schedule_test.ts`: 위험 test 하나. "서머타임이 바뀌는 날에도 at job의 차례는 그날 하나다". zone `America/New_York`, `every: "1d"`의 표:
   - `at: "02:30"`: `due` `2026-03-07T07:30:00.000Z` 다음은 `2026-03-08T07:00:00.000Z`(그 시각이 없는 날. 차례가 빠지지 않는다), 그 다음은 `2026-03-09T06:30:00.000Z`
   - `at: "01:30"`: `due` `2026-10-31T05:30:00.000Z` 다음은 `2026-11-01T05:30:00.000Z`, 그 다음은 `2026-11-02T06:30:00.000Z`(`2026-11-01T06:30:00.000Z`가 아니다. 같은 날 두 번 돌지 않는다)
   - `dueTurns(spec, due, due 1분 뒤).next`로 본다. 그 밖의 셈(간격, 놓친 수)은 `sj-jobs-due`의 위험 test가 본다.
6. `commands.ts`: `createJobCommands(): {create, update, delete}`. 모든 command는 job을 바꾼 뒤 `tx.port(afterCommit).push(JOBS_CHANGED_TOPIC, {job, job_run: null})`를 한다.
   - zone은 `tx.port(jobZonePort).zone()`이다(README "살 단계 검토에서 정한 것". writer Worker에는 환경 hook이 닿지 않는다).
   - `create`(actor agent): `ctx.conditions.session`이 없으면 `forbidden`. `tx.port(jobCreatorPort).creatorOf(session)`이 `undefined`면 `forbidden`. `action.kind === "agent_run"`이면 `resolveAgent(action.agent)`로 AgentRef와 그 agent의 place를 풀어 `action.agent`·`action.agent_place`로 저장하고, 오류(`invalid_input`, `not_found`)는 그대로 돌려준다. tool file이 아니라 이 route가 푼다. place는 차례마다 다시 찾지 않는다(계약 `JobAction`). `next_due_at = enabled ? firstDue(spec, tx.now()) : null`, `revision` `"1"`, id는 `tx.newId("job")`.
   - 정한 것: 할당(앱, tool)과 앱이 있는지는 만들 때 보지 않는다. 할당은 부를 때만 확인하고, 막히면 그 job run이 실패로 남는다(README).
   - `update`(actor agent·user): 없으면 `not_found`. agent는 `creator`가 자기(`creatorOf`)가 아니면 `not_found`다. user는 어느 job이든 고친다. `at: null`은 지우고 `undefined`는 그대로 둔다. 합친 값에서 `at`이 있는데 `every`가 `d`가 아니면 `invalid_input`. `action`이 오면 create처럼 푼다. `next_due_at`: 꺼지면 null, 꺼져 있다 켜지거나 `every`·`at`이 바뀌면 `firstDue(spec, now)`(그때부터 새로 센다. 놓친 것으로 치지 않는다), 그 밖은 그대로. `revision`은 하나 올린다(`nextRevision` 꼴), `updated_at`은 now.
   - `delete`(actor agent·user): 권한은 update와 같다. `deleteJob`으로 job과 그 job run 줄을 지우고 `{job}`을 돌려준다. 도는 run은 건드리지 않는다(끝까지 돈다. 끝을 적는 `job.run_ended`가 `not_found`를 받는다).
   - 정한 것: job command는 revision 비교를 하지 않는다(계약의 `compare`가 비어 있다).
7. `reads.ts`: `createJobReads(): {list, runList, holds}`.
   - `list`: agent는 `snapshot.port(jobCreatorPort).creatorOf(ctx.conditions.session)`의 agent가 만든 job만 읽고 거르기 칸은 무시한다(못 풀면 `forbidden`). user는 `creator`, `place`로 거른다. id 순이고 cursor는 마지막으로 본 id다. 기본 limit 50(`packages/core/domains/reads.ts` 꼴).
   - `runList`: job이 없으면 `not_found`. 새것부터(`id` 내림차순), cursor보다 작은 id.
   - `holds`: state `held`인 줄 전부를 그 job과 짝지어 `JobHold`로, `created_at` 순.
8. `register.ts`: `createLedgerRegistration(_environment?: unknown)`가 `{schemaSteps: jobsSchemaSteps, commands: [create, update, delete], reads: [list, runList, holds]}`, `createReaderRegistration()`가 같은 reads와 빈 `ports`를 낸다. `sj-jobs-due`가 같은 file의 `commands`에 넷을 더한다.
9. `packages/core/main/daemon/wiring/jobs-registration.ts`: jobs가 `lophn-agent`·`agent-roles`를 모르므로 조립이 port를 꽂는다(`domains-registration.ts` 꼴).
   - `creatorOf(session)`: `loadSession({sql}, session)`(`packages/core/lophn-agent/session/model.ts`)이 없으면 `undefined`, 있으면 `{agent: agentRefOf(row), place: placeOf(row)}`.
   - `resolveAgent(named)`: `placeDepsOf(sql).roles.resolveNamed(named)`(`packages/core/lophn-agent/places/mod.ts`. Router와 같은 이름 풀기). 결과가 `coding_agent`면 `invalid_input`. 같은 sql에서 place도 정한다: `placeOfAgentRef(agent)`(`packages/protocol/lophn-agent/places.ts`)가 undefined가 아니면 그것, Operator면 `placeDepsOf(sql).operators.operator(agent.agent)?.place`다(`headless-run`의 `hr-runs-wiring` `resolve`와 같은 셈). `{agent, place}`를 돌려준다.
   - `createCoreRegistration()`: `{ports: [defineTxPort(jobCreatorPort, (tx) => lookupOf(tx.sql)), defineTxPort(jobZonePort, () => ({zone: () => Intl.DateTimeFormat().resolvedOptions().timeZone}))]}`.
   - `createReaderRegistration()`: `{reads: [], ports: new Map([[jobCreatorPort, snapshotPort((snapshot) => lookupOf(snapshot.sql))]])}`(`apps-usage.ts` 꼴).
10. `lookups.ts`: 이 계획 안에서 jobs 표를 다른 module이나 조립이 읽을 일이 없다. 쓰는 곳이 없으면 만들지 않는다.
11. `commands_test.ts`: 위험 test 하나(README "살 단계 검토에서 정한 것"). 메모리 SQLite에 `jobsSchemaSteps`를 깔고 가짜 tx(`jobCreatorPort`는 session → 만든 agent 표, `jobZonePort`는 `"UTC"`, `afterCommit`은 모으기만)로 부른다(`packages/core/domains/commands_test.ts` 꼴). agent A가 만든 job을 agent B 자격으로 `update`·`delete`하면 둘 다 `not_found`이고 job은 그대로다. user 자격은 둘 다 된다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "서머타임이 바뀌는 날에도 at job의 차례는 그날 하나다"(`packages/core/jobs/schedule_test.ts`)
- 위험 test: "agent는 다른 agent가 만든 job을 고치거나 지우지 못한다"(`packages/core/jobs/commands_test.ts`, 할 일 11). 사람(user)은 모든 job을 고치고 지운다.
- `grep -rn "Date.now(\|new Date()\|Temporal.Now\|setTimeout(" packages/core/jobs`가 0줄이다(시각은 `tx.now()`와 인자로만 받는다).
- `grep -rln "Intl\." packages/core/jobs`가 0줄이다(zone은 port로 받는다).
- `grep -rn "\"\.\./\(agent-roles\|lophn-agent\|apps\|runs\)/" packages/core/jobs`가 0줄이다(protocol의 type만 쓴다. `check-deps`도 본다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file. `packages/core/main/daemon/assembly.ts`의 `TEAMS`에 `{createLedgerRegistration: <jobs register>}`와 `{createCoreRegistration: <jobs-registration>}`, `TEAM_MODULES`에 `packages/core/jobs/register.ts`와 `packages/core/main/daemon/wiring/jobs-registration.ts`. schema step `jobs.tables`는 `TEAMS` 끝에 둔다(순서가 migration 이력이다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

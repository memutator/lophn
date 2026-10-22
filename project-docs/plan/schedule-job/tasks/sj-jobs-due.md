# sj-jobs-due

차례 판정과 job run 줄을 만드는 command를 만든다: scheduler가 부르는 `job.claim_due`, `job_run.started`, `job_run.ended`와 사람이 부르는 `job.decide_hold`. README의 위험 test 둘(놓친 차례, 겹침)을 이 task가 쓴다.

- 단위: jobs (wave 3)
- 선행: `sj-jobs-store`
- 소유(이 task만 고친다):
  - `packages/core/jobs/due.ts` (새 file)
  - `packages/core/jobs/due_test.ts` (새 file)
  - `packages/core/jobs/register.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/run.md`("켤 때와 session 끝": 켤 때 running run이 `lophn_restarted`로 닫히는 것), `project-docs/architecture/workflow.md`("지키는 것"의 "켤 때와 멈춤", instance의 끝은 참가자가 말한 기록일 뿐이다), `project-docs/architecture/event.md`(scheduler를 Bus에 얹지 않는다. 뒤에 움직일 일은 같은 tx)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `jobs`, `project-docs/module-catalog.yaml`의 `packages/core/jobs`
  - 본보기 코드: `packages/core/runs/commands.ts`(machine만 받는 command, 상태 전이의 `conflict`), `packages/core/runs/store.ts`의 `settleRow`(`WHERE state = 'running'` 갱신), `packages/core/workflows/commands.ts`(한 command가 여러 줄을 고치는 꼴), `packages/core/workflows/commands_test.ts`(`Tx` 대역과 in-memory SQLite test), `sj-jobs-store`가 만든 `packages/core/jobs/{schema,rows,store,schedule}.ts`와 `commands_test.ts`(`Tx` 대역 준비를 이 file 안에 다시 쓴다)
  - 제품 결정: 계획 README의 "정한 것"의 "언제 도나", "놓친 차례 정책"
- 계약:
  - 쓰는 것: `sj-jobs-contract`의 `job.claim_due`·`job_run.started`·`job_run.ended`·`job.decide_hold`(TS export 이름 `jobClaimDue`·`jobRunStarted`·`jobRunEnded`·`jobDecideHold`), `JobTurn`, `JOB_RUN_STATES`, `JOBS_CHANGED_TOPIC`, `jobZonePort`. `sj-jobs-store`의 `schedule.ts`(`dueTurns`), `store.ts`, `schema.ts`의 표와 unique index
  - 내놓는 것: 네 command의 handler(`createDueCommands()`). `register.ts`의 `commands`에 더한다. 바꾼 job마다 `JOBS_CHANGED_TOPIC`을 `afterCommit`으로 싣는다.

## 정한 것

"도는 줄"은 state가 `queued`나 `running`인 줄이고 job마다 하나다(unique index). `now = tx.now()`, zone은 `tx.port(jobZonePort).zone()`이다. 모든 갱신은 `sj-jobs-store`의 `store.ts` 함수(`insertJobRun`, `replaceJobRun`, `setNextDue`)로 하고, `claimed_at`만 이 task의 raw SQL이다.

**무엇이 놓친 차례인가.** 놓친 차례를 세는 것은 `startup: true`인 claim뿐이다(lophn을 켤 때 한 번. README "켤 때는 lophn을 켤 때다").
- 센다
  - (a) 온 차례: 켜진 job의 `next_due_at <= now`인 차례 전부(`dueTurns(...).count`). lophn이 꺼져 있던 동안 온 차례다.
  - (b) 끊긴 차례: 1에서 `interrupted`로 닫은 줄이 있는 job마다 1. 닫는 줄은 두 가지다. action이 `agent_run`·`tool_run`인 `running` 줄(도는 중에 lophn이 꺼졌다. `run.md` "켤 때"에서 run이 `lophn_restarted`로 닫히는 것과 같은 사건이다), 그리고 넘겼으나 `started`를 적지 못한 `queued` 줄(`claimed_at`이 있다. action이 무엇이든 시작했는지 알 길이 없다).
- 세지 않는다
  - action이 `workflow_start`인 `running` 줄. instance는 lophn이 꺼져도 계속 돈다(`workflow.md`). 이 줄은 열린 채로 둔다. scheduler가 instance 상태를 읽어 닫는다(`sj-jobs-scheduler`). 이 줄이 열려 있는 동안 그 job의 온 차례 (a)는 정책과 상관없이 `skipped(overlap)` 한 줄로 접힌다.
  - `claimed_at`이 없는 `queued` 줄. 아직 scheduler에 넘기지 않은 줄이라 3이 넘긴다.
  - `startup`이 아닌 claim. 켜져 있는 동안 늦게 깬 차례는 제때 온 차례로 한 번 돈다. 그 사이 차례 수 `count - 1`은 `missed_count`에만 남는다(`hold` 정책도 이때는 card 없이 돈다).
- 수: `missed = startup ? count + (b) : max(count - 1, 0)`. 놓친 수가 0이면(`startup`인데 (a)도 (b)도 없다) 그 job은 아무것도 하지 않는다.

`job.claim_due {startup}`는 한 tx에서 이 순서로 한다.
1. `startup`이면 위 (b)의 두 종류 줄을 `interrupted`(ended_at now, reason null)로 닫고, 닫은 job을 모은다. 꺼진 job의 줄도 닫지만 (b)로 세지 않는다(켜진 job만 아래 2에 든다). workflow_start의 `queued`(claimed) 줄을 닫는 이유: `started`가 없어 instance id를 모르므로 scheduler가 닫을 수 없고, 그대로 두면 그 job은 영영 `overlap`이다. 그 사이 instance가 실제로 시작됐으면 다음 차례가 하나 더 시작할 수 있는데, 드문 경우라 받아들인다.
2. 켜진 job 가운데 `next_due_at <= now`이거나 1에서 닫은 줄이 있는 job마다(id 순)
   - `count`, `last`, `next` = `next_due_at <= now`면 `dueTurns(spec, next_due_at, now)`, 아니면 `count = 0`. `dueAt` = `count > 0`이면 `last`, 아니면 닫은 줄의 `due_at` 가운데 가장 큰 것.
   - 도는 줄이 있으면: `skipped` 줄 하나(reason `overlap`, `missed_count` = missed, ended_at now). 앞 차례가 돌면 이번 차례는 건너뛴다(run이든 workflow instance든 같다. 도는 줄의 state로만 본다).
   - 도는 줄이 없고 `startup`(놓친 차례)이면: 정책 `run`은 `queued` 줄 하나(`missed_count` = missed). `hold`는 `held` 줄이 있으면 그 줄의 `missed_count`에 missed를 더하고 `due_at`을 `dueAt`으로 옮기고, 없으면 `held` 줄 하나를 만든다(`missed_count` = missed).
   - 도는 줄이 없고 제때 온 차례(`startup`이 아님)면: `queued` 줄 하나(`missed_count` = missed).
   - `queued` 줄을 새로 만들 때마다(`startup`의 `run` 정책 포함) 그 job의 `held` 줄은 `skipped`(reason `superseded`, ended_at now)로 닫는다. job이 이미 돌게 되어 [Start now]를 기다릴 이유가 없다.
   - `count > 0`이면 `setNextDue(next)`로 옮긴다.
3. `claimed_at`이 없는 `queued` 줄 전부(2의 줄과 `decide_hold`의 `run_now`가 만든 줄)에 `claimed_at = now`를 적고 `start`로 돌려준다. 한 줄은 한 번만 넘긴다.
4. `next_due_at`은 켜진 job의 가장 이른 `next_due_at`(없으면 null)이다.

- 바뀐 job마다(줄을 만들거나 고치거나 `next_due_at`을 옮긴 job. 3에서 `claimed_at`만 적은 것은 제외) `JOBS_CHANGED_TOPIC`을 `{job, job_run}`으로 `afterCommit`에 한 번 싣는다. 아무것도 바꾸지 않은 claim은 아무것도 싣지 않는다. 이유: wiring이 이 topic으로 scheduler를 깨우므로, 빈 claim이 신호를 내면 깨움이 끝나지 않는다.
- `job_run.started`: 줄이 없으면 `not_found`(그 사이 job이 지워짐), `queued`가 아니면 `conflict`. `running`으로 바꾸고 `run`·`instance`·`session`·`started_at`을 적는다.
- `job_run.ended`: 줄이 없으면 `not_found`, `queued`·`running`이 아니면 `conflict`(켤 때 `interrupted`로 닫힌 줄에 늦게 온 끝). state, `ended_at`, `reason`을 적는다. `queued`에서도 받는다(시작하지 못한 차례를 `failed`로 닫는다).
- `job.decide_hold`: user만 받는다. 없으면 `not_found`, `held`가 아니면 `conflict`. `run_now`는 같은 job에 도는 줄이 있으면 `conflict`이고 줄은 `held`로 남는다(card가 남는다). 없으면 `queued`(`claimed_at` 없음)로 바꾸고 다음 claim이 받는다. `skip`은 `skipped`(reason `person`, ended_at now)다. 꺼 둔 job의 card도 [Start now]로 돈다(사람이 고른 것이다).
- 세 machine command(`claim_due`, `started`, `ended`)는 machine이 아니면 `forbidden`이다(`runs/commands.ts`의 `notMachine`).

## 할 일

1. **`due.ts`: `createDueCommands()`.** `{claimDue, started, ended, decideHold}`를 낸다(`runs/commands.ts` 꼴). 공통 helper(`fail`, `notMachine`)는 이 file 안에 둔다. `register.ts`가 부르므로 `scheduler.ts`나 service를 import하지 않는다.
2. **`claimDue`.** 위 "정한 것"의 1~4를 한 handler 안 함수로 나눈다: `closeLeftovers(tx, now)`(1), `turnFor(tx, job, ...)`(2의 한 job), `handOut(tx, now)`(3). 질의는 이 file의 raw SQL과 `store.ts`·`rows.ts` 함수를 섞는다.
   - 1의 대상: `SELECT * FROM job_runs WHERE state = 'running' OR (state = 'queued' AND claimed_at IS NOT NULL)`을 `jobRunFromRow`로 읽고, 그 job의 `action.kind`가 `workflow_start`이면서 `running`인 줄만 뺀다.
   - 2의 대상 job: `SELECT id FROM jobs WHERE enabled = 1 AND next_due_at IS NOT NULL AND next_due_at <= ?`에 1에서 닫은 job(켜진 것만)을 합쳐 id 순으로 `loadJob`한다.
   - 4: `SELECT min(next_due_at) FROM jobs WHERE enabled = 1`.
   - 결과 `{start: JobTurn[], next_due_at}`. `start`의 줄은 `loadJobRun`으로 읽은 최신 모양(`claimed_at`은 record에 없다).
3. **`started`, `ended`, `decideHold`.** 위 "정한 것"대로. 상태 전이는 `replaceJobRun`으로 하고, 전이 전에 지금 state를 읽어 거절한다(unique index 위반을 오류로 받지 않는다. 막는 것은 코드이고 index는 한 겹 더다).
4. **`register.ts`.** `commands`에 `createDueCommands()`의 넷을 더한다. 다른 줄은 고치지 않는다.
5. **`due_test.ts`: 위험 test 둘.** 아래 "끝남"을 본다. 준비: in-memory `DatabaseSync` + `jobsSchemaSteps` + `createSql`, 시각을 바꿀 수 있는 `Tx` 대역(`now: () => 변수`, `port(key)`로 `afterCommit`·`jobZonePort`(`{zone: () => "UTC"}`)를 준다), job은 `store.ts`의 `insertJob`으로 직접 넣는다(`every: "1h"`, `at: null`). 그 file 안에 20줄 안으로 다시 쓴다. `commands_test.ts`를 import하지 않는다(test file끼리 기대지 않는다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test 둘(`packages/core/jobs/due_test.ts`). 시각은 `Tx` 대역의 변수 하나이고 실제로 기다리지 않는다.
  - "놓친 차례가 여러 번이어도 job은 한 번만 돈다". 표 하나로 `startup` claim을 본다. (1) 1시간 job이 다섯 번 놓침, 정책 `run`: `start`에 그 job의 `queued` 줄이 하나이고 `missed_count`가 5이며 `next_due_at`이 `now` 뒤로 옮겨졌고, 같은 now로 `startup: false` claim을 다시 부르면 `start`가 비고 줄이 늘지 않는다. (2) 정책 `hold`: `held` 줄이 하나이고 `start`가 비며, 나중 `startup` claim이 놓친 수를 같은 줄에 더한다(`held` 줄이 여전히 하나). (3) 끊긴 차례: `agent_run` job의 `running` 줄이 `startup` claim에서 `interrupted`가 되고 그 차례가 놓친 수에 1로 더해져 정책대로 줄이 나온다.
  - "앞 차례가 도는 동안 같은 job이 또 돌지 않는다". 표로 `agent_run`(또는 `tool_run`)과 `workflow_start` 두 action을 같이 본다. 도는 줄(`running`)이 있는 job에 차례가 오면 claim은 `skipped(overlap)` 줄을 남기고 `start`에 그 job이 없다(`missed_count` 포함). `startup` claim에서는 `workflow_start`의 `running` 줄이 `interrupted`로 닫히지 않고 그대로 열려 있어 새 차례가 `skipped(overlap)`이 된다(같은 상황에서 `agent_run`의 `running` 줄은 닫힌다). `held` 줄의 `run_now`는 도는 줄이 있으면 `conflict`이고 줄이 `held`로 남는다.
- 남지 않음: `grep -n "Date.now\|new Date(\|setTimeout" packages/core/jobs/due.ts`가 0줄이다. `grep -rn "TODO" packages/core/jobs/due.ts packages/core/jobs/due_test.ts`가 0줄이다.
- 돌리는 법: `deno test --no-check packages/core/jobs/due_test.ts`.

## 보고

- 바꾼 file, 통과한 check.
- 등록할 것: 없음(`register.ts`는 이 task의 소유이고, 조립 목록은 `sj-jobs-store`의 보고가 이미 둔다).
- 안 쓰게 된 export: 없음.
- 정한 것: 위 "정한 것" 밖에 worker가 정한 것.
- 넘길 줄: `store.ts`·`rows.ts`(`sj-jobs-store` 소유)에서 모자라 최소로 더한 helper. 더했으면 이름을 적는다.
- 계약 바꾸기 요청: 표(`job_runs`의 칸·index)나 `claim_due`의 입출력을 바꿔야 하면 고치지 말고 여기 적는다.
- **무겁게 짠 것**, **알려진 미완 동작**: 없으면 "없음". 예: workflow_start의 `queued`(claimed) 줄을 닫아서 instance가 이미 시작됐으면 같은 차례가 두 instance를 만들 수 있는 것, `startup` claim을 응답을 잃고 다시 부르면 방금 넘긴 줄이 `interrupted`로 닫히는 것.

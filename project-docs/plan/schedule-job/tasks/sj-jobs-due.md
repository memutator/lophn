# sj-jobs-due

차례 판정과 job run 기록을 만든다: scheduler command `job.claim_due`, `job.run_started`, `job.run_ended`와 사람의 `job.decide_hold`다. README의 위험 test 둘("놓친 차례가 여러 번이어도 job은 한 번만 돈다", "앞 차례가 도는 동안 같은 job이 또 돌지 않는다")을 이 task가 쓴다. job run이 기대는 run의 끝 상태는 `headless-run`의 "run의 모양"(`done|failed|cancelled`)이다.

- 단위: jobs (wave 2)
- 선행: sj-jobs-store. 같은 `register.ts`에 command를 더한다.
- 소유(이 task만 고친다):
  - `packages/core/jobs/due.ts`(새 file)
  - `packages/core/jobs/due_test.ts`(새 file)
  - `packages/core/jobs/register.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/event.md`(남지 않는 event는 commit 뒤, 꺼졌다 켜지면 돌던 turn은 interrupted), `project-docs/architecture/place-session.md`(lophn이 꺼지면 turn이 interrupted로 닫힌다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `jobs`(lead가 더한다), `storage`. `project-docs/module-catalog.yaml`의 `packages/core/jobs`
  - 본보기: `packages/core/domains/commands.ts`(command handler와 `fail`), `packages/core/domains/commands_test.ts`(메모리 SQLite와 가짜 tx 하나로 handler를 부르는 test), `packages/core/storage/ledger/after-commit.ts`(`afterCommit`)
  - 제품 결정: `project-docs/products/roadmap/headless-schedule.md`의 "놓친 차례"와 "정한 것(agent)", `project-docs/plan/schedule-job/README.md`의 "정한 것"과 "뼈대 검토에서 정한 것"(`hold`로 기다리는 줄, "켤 때")
  - `sj-jobs-store`가 만든 `packages/core/jobs/schema.ts`(`claimed_at`, 두 unique index), `store.ts`, `schedule.ts`(`dueTurns`)
- 계약:
  - 쓰는 것: `sj-jobs-contract`의 `jobClaimDue`, `jobRunStarted`, `jobRunEnded`, `jobDecideHold`, `QueuedJobRun`, `JobRunState`, `JOBS_CHANGED_TOPIC`. `sj-jobs-store`의 `schedule.ts`, `store.ts`, `schema.ts`
  - 내놓는 것: 위 네 command의 handler. scheduler(`sj-jobs-scheduler`)와 대기 목록(`sj-shell-hold-card`)은 protocol 모양만 본다.

## 할 일

추가(planner, 살 단계 뒤): 아래 "planner가 정한다 / 열지 않는다"로 남긴 시간대는 tx port `jobZonePort {zone(): string}`로 정했다(README). `jobRunEnded`에는 선택 칸 `reason`을 둔다. agent는 자기가 만든 job만 고치고 지운다(사람은 모두).

1. `due.ts`: `createDueCommands(): {claimDue, runStarted, runEnded, decideHold}`. 바꾼 job마다 `tx.port(afterCommit).push(JOBS_CHANGED_TOPIC, {job, job_run})`를 한다. 바꾼 것이 없으면 싣지 않는다(scheduler가 그 신호로 다시 깨어나 claim을 또 부른다).
   - 말: "도는 줄"은 state `queued`나 `running`인 줄이다. 같은 job에 하나뿐이다(`sj-jobs-store`의 unique index).
   - zone: `sj-jobs-store`와 같이 `tx.port(jobZonePort).zone()`(뼈대 문제. `sj-jobs-contract` 할 일 7의 추천안).
2. `claimDue`(`job.claim_due`, machine) 한 tx에서 이 순서로 한다. `now = tx.now()`.
   1. `startup`이면 남은 `running` 줄과, 넘겼지만(`claimed_at`이 있음) 시작을 적지 못한 `queued` 줄을 `interrupted`(ended_at now)로 닫는다. 그 job은 끊긴 차례 하나를 놓친 것으로 센다(roadmap "도는 중에 lophn이 꺼져 끊긴 run도 놓친 차례로 친다"). 넘기기 전(`claimed_at` 없음)의 `queued` 줄은 시작한 적이 없으니 그대로 둔다.
   2. 켜진 job 가운데 `next_due_at <= now`이거나 1에서 끊긴 줄이 있는 job마다:
      - `count`: `next_due_at <= now`면 `dueTurns(spec, next_due_at, now).count`, 아니면 0. `last`: 그 `last`, 차례가 없으면 끊긴 줄의 `due_at`.
      - 놓친 수 `missed`: `startup`이면 `count`에 끊긴 차례(0이나 1)를 더한 값. 아니면 `count - 1`(0 아래로 가지 않는다).
      - 도는 줄이 있으면: `skipped` 줄 하나(reason `overlap`, `due_at` last, `missed_count` missed, ended_at now). 앞 차례가 돌면 이번 차례는 건너뛴다.
      - 아니고 `startup`이면(놓친 차례): `run`은 `queued` 줄 하나(`missed_count` missed). `hold`는 `held` 줄이 있으면 그 줄의 `missed_count`에 missed를 더하고 `due_at`을 last로 옮긴다. 없으면 `held` 줄 하나를 만든다.
      - 아니면(제때 온 차례): `queued` 줄 하나(`missed_count` missed). 그 job에 `held` 줄이 있으면 `skipped`(reason `superseded`, ended_at now)로 닫는다. 지금 도는 run이 놓친 일을 대신한다(README).
      - `count > 0`이면 `next_due_at`을 `dueTurns(...).next`로 옮긴다(`setNextDue`).
   3. `claimed_at`이 없는 `queued` 줄 전부(2에서 만든 줄과 `job.decide_hold`의 `run_now`가 만든 줄)에 `claimed_at = now`를 적고, 그 job의 `creator`, `place`, `action`과 짝지어 `start`로 돌려준다. 한 줄은 한 번만 넘긴다.
   4. `next_due_at`은 켜진 job의 가장 이른 `next_due_at`(없으면 null)이다.
   - 정한 것: 놓친 차례는 lophn이 꺼져 있던 차례, 곧 `startup` claim이 본 차례다(README "켤 때는 lophn을 켤 때다"). 켜져 있는 동안 잠자기 같은 이유로 늦게 깬 차례는 제때 차례로 한 번 돌고, 그 사이 차례 수는 `missed_count`에만 남는다. `hold` 정책도 그때는 돈다.
3. `runStarted`(`job.run_started`, machine): 줄이 없으면 `not_found`(그 사이 job이 지워졌다), `queued`가 아니면 `conflict`. `running`으로 바꾸고 `run`, `session`, `started_at`(now)을 적는다.
4. `runEnded`(`job.run_ended`, machine): 줄이 없으면 `not_found`, `queued`나 `running`이 아니면 `conflict`(예: 켤 때 `interrupted`로 닫힌 줄에 늦게 온 끝). state와 `ended_at`(now)을 적는다. `queued`에서 바로 오는 것은 run을 시작하지 못한 때다.
5. `decideHold`(`job.decide_hold`, user): 줄이 없으면 `not_found`, `held`가 아니면 `conflict`. `run_now`는 같은 job에 도는 줄이 있으면 `conflict`이고 줄은 `held`로 남는다(card가 남는다). 없으면 `queued`(`claimed_at` 없음)로 바꾼다. scheduler는 이 commit의 `JOBS_CHANGED_TOPIC`으로 깨어 다음 claim에서 이 줄을 받는다. `skip`은 `skipped`(reason `person`, ended_at now)다. 정한 것: 꺼 둔 job의 card도 [지금 실행]으로 돈다(사람이 고른 것이다).
6. `register.ts`: `createLedgerRegistration`의 `commands`에 넷을 더한다. read는 없다.
7. `due_test.ts`: 위험 test 둘. 준비는 file당 한 번 메모리 SQLite에 `jobsSchemaSteps`를 깔고, 가짜 tx(`sql`, `newId`, 바꿀 수 있는 `now`, `port`: `afterCommit`은 모으기만, zone은 `"UTC"`)를 둔다(`packages/core/domains/commands_test.ts` 꼴). job과 앞선 줄은 `store.ts`의 `insertJob`·`insertJobRun`으로 바로 넣는다. 판정은 돌려준 `start`와 `job_runs` 줄로 한다.
   - "놓친 차례가 여러 번이어도 job은 한 번만 돈다": `every: "1h"`, `next_due_at` T0인 job의 표.
     - `run`: 앞 기동에서 `running`이던 줄 하나가 있고 now가 T0+5h30m일 때 `claimDue({startup: true})`의 `start`에 그 job이 정확히 한 번 있고, 앞 줄은 `interrupted`, 새 `queued` 줄은 `missed_count` 7(차례 여섯과 끊긴 하나), `due_at` T0+5h, job의 `next_due_at`은 T0+6h다. 같은 now에 `claimDue({startup: false})`를 다시 부르면 `start`가 비고 줄이 늘지 않는다.
     - `hold`: now T0+5h30m의 `startup` claim은 `start`가 비고 `held` 줄 하나(`missed_count` 6)를 남긴다. now T0+8h30m에 다시 `startup` claim을 하면 `held` 줄은 여전히 하나이고 `missed_count` 9, `due_at` T0+8h다.
   - "앞 차례가 도는 동안 같은 job이 또 돌지 않는다": `every: "1m"`, 정책 `run`인 job.
     - now T0의 claim이 줄 하나를 넘기고 `runStarted`로 `running`이 된 뒤, now T0+5m30s의 claim은 `start`에 그 job이 없고 `skipped`(reason `overlap`) 줄 하나를 남긴다. 그 job의 도는 줄은 여전히 하나다.
     - 같은 job에 `held` 줄을 넣고 `decideHold(run_now)`를 부르면 `conflict`이고 그 줄은 `held`로 남는다. `runEnded(done)` 뒤에는 같은 결정이 통과하고 다음 claim이 그 줄을 넘긴다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "놓친 차례가 여러 번이어도 job은 한 번만 돈다", "앞 차례가 도는 동안 같은 job이 또 돌지 않는다"(`packages/core/jobs/due_test.ts`)
- `grep -rn "Date.now(\|new Date()\|Temporal.Now" packages/core/jobs/due.ts`가 0줄이다(시각은 `tx.now()`).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file. 없을 것이다(`register.ts`는 이미 `sj-jobs-store`가 등록했다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

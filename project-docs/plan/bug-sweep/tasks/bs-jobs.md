# bs-jobs

잠든 사이 늦게 처리한 차례를 놓친 차례로 치고(hold면 card), scheduler의 최대 잠을 1분으로 줄이고, 바퀴마다 열린 run 줄을 한 번 읽어 끝났으면 `job_run.ended`를 다시 적는다. `project-docs/issues/job.md`의 두 이슈를 고친다.

- 단위: jobs (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/jobs/due.ts`
  - `packages/core/jobs/due_test.ts`
  - `packages/core/jobs/scheduler.ts`
  - `packages/core/jobs/scheduler_test.ts`
  - `packages/core/jobs/ports.ts`
  - `packages/core/main/daemon/wiring/jobs.ts`
  - `project-docs/architecture/job.md`
- 읽을 것:
  - architecture: `project-docs/architecture/job.md`("언제 도나", "놓친 차례", "hold", "할 일마다 시작과 끝", "켤 때")
  - 이슈: `project-docs/issues/job.md`의 두 항목("지금", "고치려면"의 추천안, "정한 것")
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/jobs`(boundary `jobs`), `packages/core/main`(boundary `core`)
  - 계획: `project-docs/plan/bug-sweep/README.md`의 "정한 것"(늦은 차례, 최대 잠 1분, 끝 기록 다시 하기)
- 계약:
  - 쓰는 것: `JobSchedulerStore.open/ended/claimDue`, `JobStarter`(`packages/core/jobs/ports.ts`), 주입한 `Clock`·`JobTimers`. 외부 protocol은 바꾸지 않는다.
  - 내놓는 것: `JobStarter.runState`(아래). 다른 task가 기대는 것은 없다.

이슈와 코드가 어긋난 곳: 없다. 이슈의 `turnFor`(`due.ts`), `HOUR_MS`·`closeFinished`·`watch`·`logUnlessGone`(`scheduler.ts`)이 그대로 있다. 다만 이슈의 "`runService.get` 같은 read"는 없다. `RunService`(`packages/core/runs/service.ts`)가 밖에 내놓는 것은 `start/wait/cancel/...`이고 `get`이 없다(내부 `refresh`뿐). 아래 3번에서 고른다.

## 할 일

1. **늦은 차례 (`packages/core/jobs/due.ts`의 `turnFor`).**
   - 상수 `LATE_MS = 10 * 60_000`을 둔다.
   - `came`(온 차례가 있음)일 때 `late = Date.parse(now) - Date.parse(job.next_due_at!) > LATE_MS`로 잰다. 기준은 `turns.last`가 아니라 `job.next_due_at`(가장 오래된 온 차례)이다. 그래야 잠들어 여러 차례가 쌓인 경우도 잡힌다. 이 선택은 README가 답하지 않은 것이라 보고의 "정한 것"에 적는다.
   - `const missedNow = startup || late`로 두고 지금 `startup`으로 가르는 두 곳을 `missedNow`로 바꾼다: `missed = missedNow ? count + interrupted : Math.max(count - 1, 0)`와 `else if (missedNow && job.missed_policy === "hold")`. `held` 줄을 만들거나 접는 갈래와 `queuedRun`은 그대로다. 겹침(`open` 줄이 있음) 판정이 먼저인 순서도 그대로다.
   - 근거: `project-docs/architecture/job.md` "놓친 차례"·"hold", 이슈 job.md 둘째 항목의 "정한 것".
2. **최대 잠 1분 (`packages/core/jobs/scheduler.ts`).** `HOUR_MS`를 뜻에 맞는 이름(`MAX_SLEEP_MS = 60_000`)으로 바꾸고 `lap()`의 `sleep(...)` 식(`HOUR_MS`가 두 번 쓰이는 한 곳)에 쓴다. 파일 위쪽 주석의 "1시간 상한"도 고친다. `RETRY_MS`는 그대로다.
3. **끝 기록 다시 하기.**
   - `packages/core/jobs/ports.ts`의 `JobStarter`에 `runState(run: Id<"run">): Promise<Result<"running" | "done" | "failed" | "cancelled">>`를 더한다(`waitRun`은 그대로 둔다).
   - `packages/core/main/daemon/wiring/jobs.ts`의 `starter`에 구현한다. 한 번 읽고 기다리지 않는다. 권장은 `ctx.runService.wait(run, 0)`의 `value.state`다(`wait`는 읽은 뒤 `running`이면 timeout 뒤 한 번 더 읽고 돌려주므로 timeout 0이면 읽기 한 번이다. turn이 끝난 run도 `refresh`가 닫아 준다). `runs/read`(`runRead`, actor가 user뿐)를 `read()`로 부르는 길도 되지만 `JOBS_CONTEXT.scope.operations`에 더해야 하고 표만 읽는다. 어느 쪽이든 `packages/core/runs`와 protocol은 고치지 않는다.
   - `scheduler.ts`의 `closeFinished`에서 `workflow_start`가 아닌 줄(`job_run.run !== null`이고 `state === "running"`)도 `starter.runState(job_run.run)`을 한 번 부른다. 결과가 `ok`이고 `running`이 아니면 `store.ended(job_run.id, state)`를 적는다(`logUnlessGone`으로 감싼다. `watch`가 먼저 닫았으면 `conflict`라 정상이다). 읽기가 실패하면 넘어간다. 다시 부르기 loop는 두지 않는다.
   - **켜는 첫 바퀴(`startupDone === false`)에는 run 줄을 읽지 않는다.** 켤 때는 runs가 끊긴 run을 이미 `lophn_restarted`로 닫아 두었으므로 여기서 읽으면 그 줄이 `failed`로 닫혀, 뒤따르는 startup claim의 `closeLeftovers`가 하는 `interrupted`와 놓친 차례 계산이 사라진다. workflow 줄의 지금 동작(켜는 첫 바퀴도 읽음)은 건드리지 않는다. 이유를 한 줄 주석으로 남긴다.
4. **test.** 아래 "끝남"의 위험 test 하나를 `due_test.ts`에 쓴다. `scheduler_test.ts`는 기존 test만 맞춘다: fake `JobStarter`에 `runState`를 더하고(`reject(new Error("unused"))`), `timers[0]!.ms <= 3_600_000` 단정을 새 상한(60_000)으로 바꾼다. run 줄 닫기와 최대 잠은 새 test를 만들지 않는다(위험 test가 아니다). 기존 test 중 `claim(false)`를 10분 넘게 늦은 시각에 부르는 것이 있으면(예: `due_test.ts`의 겹침 test는 `T(1,30)`에 부름) 새 규칙에 맞게 단정만 고친다.
5. **문서 (`project-docs/architecture/job.md`).** 같은 변경에서 맞춘다: 그림의 "1시간 상한", "언제 도나"의 "1시간 상한/최대 1시간", "놓친 차례"의 켜진 채 timer가 늦은 경우와 "정책 `hold`는 켤 때의 놓친 차례에만 걸린다", "hold" 절, "할 일마다 시작과 끝"(바퀴가 열린 run 줄도 한 번 읽어 닫음), "켤 때"(첫 바퀴는 run 줄을 읽지 않음), 마지막의 "1시간 상한이 같은 표를 다시 읽는다". 다른 architecture 문서는 lead가 고친다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`packages/core/jobs/due_test.ts`): "켜진 채 10분 넘게 늦은 `hold` 차례는 돌지 않고 `held` 줄이 되고, 10분 안의 차례는 제때 돈다." 기존 `setup()`의 변수 시각(`setNow`)과 `claim(false)`만 쓴다. 실제 시간, sleep, timer를 쓰지 않는다. (`run` 정책의 늦은 차례가 한 번 도는 경우는 같은 test 안에 한 줄로 넣어도 된다.)
- 남지 않음: `grep -rn "HOUR_MS" packages`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 정한 것: 늦음의 기준(`next_due_at`), `runState` 구현 선택과 이유
- 무겁게 짠 것 / 알려진 미완 동작 (없으면 "없음")

# job

정해진 때 run을 돌리거나 workflow를 시작하는 job과 scheduler. 동작은 `project-docs/architecture/job.md`다.

## job run 끝을 적지 못하면 그 job은 다음 기동까지 돌지 않는다

```yaml
kind: bug
modules: [packages/core/jobs, packages/core/main]
```

지금: `packages/core/jobs/scheduler.ts`의 `watch`는 run이 끝나면 `store.ended`를 한 번 부른다. `ended`가 `not_found`·`conflict` 밖의 오류로 실패하면 `logUnlessGone`이 한 줄 남기고 끝이다. 그 job run 줄은 `running`으로 남고, `packages/core/jobs/due.ts`의 `turnFor`는 도는 줄이 있는 job의 차례를 모두 `skipped(overlap)`로 적는다. 그 줄은 다음 기동의 `closeLeftovers`가 `interrupted`로 닫을 때까지 남는다.

영향: lophn을 며칠 켜 둔 사람은 그동안 그 job의 차례가 모두 건너뛰어진다. 화면의 기록에 "Skipped because the previous turn was still going"이 쌓이지만, 사람은 왜 그런지 알 수 없다. writer 오류는 드물다.

고치려면:
- 작음: 바퀴마다 `open()`이 준 줄 가운데 `run`이 있고 `running`인 줄의 run 상태를 `starter.waitRun` 대신 한 번 읽어(`runService.get` 같은 read) 끝났으면 `ended`를 다시 적는다. 지금 `closeFinished`가 workflow 줄에 하는 일과 같은 자리다. 추천.
- 중간: `ended`가 실패하면 그 자리에서 몇 번 다시 부른다. 오류가 길게 가면 같은 일이 생긴다.

## 컴퓨터가 잠든 사이 놓친 hold job의 차례는 묻지 않고 돈다

```yaml
kind: bug
modules: [packages/core/jobs]
```

지금: `packages/core/jobs/due.ts`의 `turnFor`는 `startup && job.missed_policy === "hold"`일 때만 줄을 `held`로 만든다. lophn이 켜진 채 컴퓨터가 잠들었다 깨면 scheduler timer가 늦게 울려 여러 차례가 한꺼번에 오지만 startup claim이 아니라 `queued`로 바로 돈다(`missed_count`만 남는다).

영향: `hold`를 고른 job(예: 매일 09:00, 놓치면 묻기)이 노트북을 덮어 둔 밤을 지나 낮에 열면 사람에게 묻지 않고 돈다. lophn을 껐다 켠 때와 동작이 다르다.

더해: scheduler는 다음 차례까지 길어야 1시간(`HOUR_MS`) timer를 걸고 잔다. Linux와 macOS의 timer는 잠든 시간을 세지 않는 시계로 잰다고 보므로(확인 전), 노트북을 연 뒤에도 남은 잠이 지나야 바퀴가 돈다. 13:00에 열면 13:00~14:00 사이에 처리된다.

고치려면:
- 작음: 차례 시각보다 일정 시간 넘게 늦게 처리한 차례는 놓친 차례로 친다. 켤 때와 같이 `hold`면 card, `run`이면 한 번 돈다. 추천.
- 작음: 지나간 차례가 둘 이상(`count > 1`)일 때만 놓친 차례로 친다. 위 예(매일 09:00, 13:00에 열기)는 count가 1이라 고치지 못한다. 하루 넘게 덮은 때만 잡는다.
- 작음: 주기의 절반보다 늦으면 놓친 차례로 친다. 매일 job은 12시간 안에 열면 잡지 못한다.

정한 것(사람, 2026-10-23. planner 추천): 차례 시각보다 10분 넘게 늦게 처리한 차례는 켤 때와 같이 놓친 차례다. 잠에서 깬 뒤 늦지 않게 바퀴가 돌도록 scheduler의 최대 잠(`HOUR_MS`)을 1분으로 줄인다. 바퀴 한 번은 할 일이 없으면 읽기뿐이라 1분마다 돌아도 싸고, shell에서 깨어남을 알리는 길을 새로 두지 않아도 된다(agent).

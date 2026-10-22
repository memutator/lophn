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

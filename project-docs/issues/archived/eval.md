# eval (닫음)

## run 요약이 늘 dirty로 남는다

```yaml
kind: bug
modules: [tests]
closed: fixed
guard: 없음
```

- 지금: `tests/eval/versions/source.ts`의 `captureSource`는 `git status`를 `packages`, `deno.json`, `deno.lock`로 좁혀 무엇이든 나오면 `dirty: true`다. 그런데 `deno task check`와 core 기동이 `packages/shell/main/desktop/core/deno.lock`을 고쳐 둔다(commit하지 않는 file이다). 그래서 check를 한 번이라도 돌린 checkout에서는 코드를 안 고쳐도 모든 run이 dirty다. 첫 scorecard의 run 17개가 모두 `dirty: true`였고, working tree diff는 그 lock file 세 줄뿐이었다.
- 영향: `source.dirty`가 "고친 채 돌렸나"를 알려 주지 못한다. eval-experiment가 variant(고친 checkout)와 기준 run을 가를 때 이 칸에 기대면 모든 run을 variant로 본다. 전체 기록의 diff에도 lock 변경이 매번 섞인다.
- 고치려면:
  - (작음, 추천) `TARGET`의 status와 diff에서 `:(exclude)packages/shell/main/desktop/core/deno.lock`을 뺀다. 그 file은 lead와 worker가 commit하지 않는 file이라 잃는 것이 없다.
  - (중간) check가 그 lock을 고치지 않게 한다. check의 동작이 바뀌어 다른 계획까지 걸린다.

닫음: `captureSource`가 `git status`와 `git diff`에서 `:(exclude)packages/shell/main/desktop/core/deno.lock`을 뺀다. check를 돌린 checkout에서도 코드를 안 고쳤으면 `dirty: false`다.

# code-health

여러 module에 걸친 코드 건강 이슈다(죽은 이름, 긴 파일, test 준비 코드). 짝이 되는 architecture 문서는 없다.

## `apps/calls/calls_test.ts`의 동시성 test가 병렬 check 부하에서 가끔 깨진다

```yaml
kind: bug
modules: [packages/core/apps]
```

지금: "write는 앱마다 한 번에 하나씩 돌고 read는 동시에 돈다"가 `deno task check:full`(`--parallel`)에서 한 번 실패했다. 같은 file만 돌리면 다섯 번 모두 통과했고, 같은 branch에서 check:full을 다시 돌리면 통과했다. test의 `until(done)`은 `setTimeout(0)`을 1000번 돌고 조건이 안 되어도 조용히 끝나며, 그다음 `assertEquals(t.sent.length, 4)`가 깨진다. 기다림이 시간이 아니라 tick 수라 부하가 크면 조건보다 먼저 끝날 수 있다.

영향: lead의 merge·land가 코드와 상관없이 멈춘다(계획 둘이 full check를 같이 돌릴 때 늘어난다). 사람이 원인을 찾느라 시간을 쓴다.

고치려면: `until`이 조건이 안 되면 실패를 던지게 하고 기다림을 시간 상한(예: 2초)으로 바꾼다(작음). 추천: 이 안.

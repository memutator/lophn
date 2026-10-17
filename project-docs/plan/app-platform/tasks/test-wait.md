# test-wait

`apps/calls/calls_test.ts`의 `until`이 조건이 안 되어도 조용히 끝나서, 부하가 큰 `check:full`(`--parallel`)에서 뒤의 `assertEquals`가 깨진다. 조건이 안 되면 실패를 던지고, 기다림을 tick 수가 아니라 시간 상한(2초)으로 바꾼다.

- 단위: test-wait (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/calls/calls_test.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/code-health.md`의 "`apps/calls/calls_test.ts`의 동시성 test가 병렬 check 부하에서 가끔 깨진다"(닫는 일은 lead가 한다)
  - test 기준: `.claude/skills/write-test/SKILL.md`("시각과 timer는 주입한다", "조건이 안 맞으면 skip이나 return으로 그냥 통과하는 test"는 쓰지 않는다)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/apps`(boundary `apps`)
- 계약:
  - 쓰는 것: 없음(test file 하나 안의 helper).
  - 내놓는 것: 없음.

## 지켜야 할 것(계획 README 그대로)

- module은 `core/main`을 import하지 않는다. 바닥은 위층을 import하지 않는다. domain끼리는 problems → apps만.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 설치 사본은 읽기 전용이고 release bundle에 굳힌 사본과 섞지 않는다.

이 task는 test file 하나만 고친다. 앞의 셋은 닿지 않는다.

## 알고 시작할 것

- 지금 `until(done)`은 `setTimeout(0)`을 최대 1000번 돌고 조건이 안 되어도 그냥 돌아온다. 호출은 세 곳이다: "…이미 끝난 부모도 모른다" 구간의 `until(() => t.sent.length > 0)`, 그리고 "write는 앱마다 한 번에 하나씩 돌고 read는 동시에 돈다"의 `until(() => t.sent.length >= 3)`과 `>= 4`. 이슈가 가리킨 실패는 뒤의 `assertEquals(t.sent.length, 4)`다.
- 같은 file의 `tick()`(`setTimeout(0)` 20번)은 "아직 아무것도 안 일어났다"를 확인하기 전에 macrotask를 비우는 용도다(두 곳). 부하 때문에 일찍 끝나면 test가 거짓으로 실패하지 않고 오히려 덜 엄격해질 뿐이라 이 task에서 건드리지 않는다.
- 같은 꼴(조건이 안 되어도 조용히 끝나는 polling helper)이 다른 test에 있는지 저장소를 훑었다: `until`/`waitFor`/`eventually`로 부르는 test helper는 이 file 하나뿐이다. `packages/shell/renderer/desktop/connection/events/waiting-store_test.ts`의 `settle`은 macrotask 하나를 비울 뿐 조건을 기다리지 않는다. 그래서 다른 file은 고치지 않는다(정한 것).

## 할 일

1. `calls_test.ts`의 `until`을 고친다. 근거: 이슈 "고치려면".
   - 조건이 참이 될 때까지 기다리되 상한은 시간이다: `Date.now()` 기준 2000ms. 상한을 넘기면 `throw new Error(...)`(무엇을 기다렸는지 알 수 있게 호출 쪽에서 설명 문자열을 받으면 좋다. 받지 않으면 호출 위치가 stack에 나온다).
   - 기다리는 사이는 `setTimeout(r, 0)`이나 짧은 값(예: 1ms)으로 loop를 돌린다. 시간은 이 helper 안에서만 읽는다(test 대상 코드에는 시간을 주입하는 곳이 따로 없다).
   - 돌려주는 값은 없다. 조건이 참이면 바로 돌아온다. 실패는 던지는 것 하나다.
2. 호출 세 곳은 그대로 두고, 필요하면 설명 문자열만 넘긴다. test 이름과 `assertEquals`는 바꾸지 않는다.
3. `tick()`은 그대로 둔다. 근거: 위 "알고 시작할 것".

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 이 task는 test 자체를 고치는 일이다. 새 test를 만들지 않는다.
- 같은 file이 안정적으로 통과함을 본다: `deno test --no-check packages/core/apps/calls/calls_test.ts`를 다섯 번 돌려 모두 통과하고, 부하를 주는 쪽(`deno test --parallel --no-check packages/core/apps packages/core/events` 같은 병렬 실행)에서 한 번 더 통과한다.
- 남지 않음: `grep -n "i < 1000" packages/core/apps/calls/calls_test.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 다른 test에 같은 꼴의 helper가 없어 이 file만 고쳤다(위 "알고 시작할 것"). 문서에 답이 없어 worker가 정한 것이 더 있으면 적는다.
- 넘길 줄: 없음
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없음
- **알려진 미완 동작**: 없음. `tick()`의 tick 수 기다림이 남아 있다(위 이유).

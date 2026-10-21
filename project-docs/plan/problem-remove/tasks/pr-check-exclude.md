# pr-check-exclude

`deno task check`와 `check:full`이 `tests/e2e`, `tests/eval`, 그리고 그 둘만 쓰는 `tests/support`를 type check와 test discovery 양쪽에서 보지 않게 한다. 이 계획의 다른 task가 지우는 계약을 그 file들이 가리켜 land가 막히지 않게 하는, 이 계획의 첫 task다.

- 단위: check-exclude (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/check.ts`
  - `deno.json`
- 읽을 것:
  - 제품 결정: `project-docs/plan/problem-remove/README.md`의 "정한 것" 사람 셋째 줄(eval과 e2e를 이 개편 동안 고치지 않는다)과 agent 첫 항목(뺄 범위, 되돌리는 쪽, 이유 주석)
  - architecture: `project-docs/architecture/testing.md`의 "층"(`tools/check.ts`가 `tests`를 package 하나로 보고, `deno.json`의 `test.exclude` 대신 `--ignore`로 빼는 이유)과 "`tests/support`"(폴더마다 내놓는 것)
  - skill: `.claude/skills/write-test/SKILL.md`의 "check 파이프라인"
  - boundary·module: `project-docs/module-catalog.yaml`의 `tests`와 `tools`(둘 다 boundary 없음)
  - 코드: `tools/check.ts`(`NOT_IN_CHECK`, `DENO_EXCLUDED`, `sourceFiles`, `packageFiles`, `buildSteps`의 `check`·`check <package>`·`test` 단계), root `deno.json`의 `exclude`, `tools/dev.ts`와 `tests/live/`의 `tests/support` import
- 계약:
  - 쓰는 것: `tools/check.ts`의 `NOT_IN_CHECK`, `DENO_EXCLUDED`, 빠른 check의 `check tests`(file 목록), full check의 `deno check`(인자 없음)
  - 내놓는 것:
    - check가 type check와 test discovery에서 보지 않는 path: `tests/e2e`, `tests/eval`, `tests/support/annotation`, `tests/support/app`, `tests/support/coding`, `tests/support/gateway`, `tests/support/fake-oauth`, `tests/support/core/try-boot.ts`(조사: 이 file들을 import하는 곳은 e2e, eval, 서로뿐이다)
    - 남는 `tests/support`: `core/mod.ts`·`core/human.ts`·`core/process.ts`(`tools/dev.ts`, `tests/live`), `fake-server`(`tools/dev.ts`와 자기 test), `loop`·`wire`(`tests/harness`). 깨지면 그 자리에서 최소로 고친다.
    - `tools/check.ts`에 "e2e를 고치는 뒤 계획이 되돌린다"는 이유 주석 한 줄

## 할 일

근거는 README "정한 것"(agent 첫 항목)과 `project-docs/architecture/testing.md` "층"이다. 바꾸는 file은 `tools/check.ts` 하나다.

1. `tools/check.ts`에 type check와 test discovery 둘 다에서 빼는 목록을 새 상수로 둔다(이름은 worker가 정한다. 예: `NOT_CHECKED`). 값은 계약의 path 여덟이다.
   - 바로 위에 이유 주석 한 줄: 사람이 이 개편 동안 e2e와 eval을 고치지 않기로 해 지운 계약을 가리킨 채 두고, e2e를 고치는 뒤 계획이 이 목록을 되돌린다.
   - 정한 것: 기존 `NOT_IN_CHECK`(test discovery만 뺀다)는 `tests/live`와 새 목록을 합친 값으로 둔다. `tests/live`는 지금처럼 type check에 남는다(이유: `tests/live`는 남는 `tests/support/core`를 쓰고 이 계획이 고치지 않는 계약만 가리킨다).
   - 목록 항목은 폴더와 file이 섞인다(`tests/support/core/try-boot.ts`). 거르기는 "path와 같거나 `<path>/`로 시작한다"로 한다. 지금 빠른 check의 test file 거르기는 `<path>/`로 시작하는지만 봐서 file 항목을 못 거르니 같은 판정으로 바꾼다.
2. 빠른 check의 `check <package>` 단계: `sourceFiles(FOLDERS[p])`가 낸 file에서 새 목록에 든 것을 뺀다. 지금은 `check tests`만 해당한다.
3. full check의 `check` 단계: 인자 없는 `["deno", "check"]` 대신, `ALL_PACKAGES` 전부의 `sourceFiles`에서 새 목록을 뺀 file을 `deno check` 하나에 준다.
   - 정한 것: process 하나로 둔다. 이유: `deno check`에는 `--ignore`가 없다. package마다 나눠 돌리면 full check의 type check 메모리가 몇 배가 된다(core type check 하나가 약 2.6GB이고 full check가 동시에 2개까지 돈다, `.claude/skills/orchestrate/SKILL.md`). file 목록은 약 2,100개, 약 96KB라 인자 길이 한도 안이다.
   - `sourceFiles`가 `DENO_EXCLUDED`(`packages/shell/main/` 등)를 이미 빼므로 root `deno.json`의 `exclude`와 같은 범위가 된다.
4. test 단계: `--ignore`(`DENO_EXCLUDED` + `NOT_IN_CHECK`)와 빠른 check의 test file 거르기가 새 목록을 같이 빼는지 본다. 빠지는 test file은 `tests/eval/**/*_test.ts`, `tests/support/coding/cli_test.ts`, `tests/support/fake-oauth/issuer_test.ts`다. `tests/support/fake-server/*_test.ts`와 `tests/harness`는 남는다.
5. `deno.json`은 바꾸지 않는다.
   - 정한 것: top-level `exclude`에 넣지 않는다. 이유: 거기 든 폴더는 `deno task e2e`가 인자로 줘도 돌지 못하고(`project-docs/architecture/testing.md` "층") fmt·lint에서도 빠진다. fmt·lint·`tools/check-deps.ts`는 import 대상이 있는지 보지 않아 지운 계약에 깨지지 않으므로 e2e·eval도 그대로 본다.
6. 확인: 새 목록의 file에 일부러 type 오류를 넣고 `deno task check:full`을 돌린다. `tests/eval`의 한 file과 `tests/support/app/source.ts`에 넣으면 통과하고, 남는 `tests/support/core/mod.ts`에 넣으면 `check` 단계가 실패해야 한다. 셋 다 되돌린 뒤 commit한다. 일부러 넣은 오류를 commit하지 않는다.

## 끝남

- `deno task check`와 `deno task check:full`이 통과한다. `tools/check.ts`를 고치면 빠른 check도 package 전부를 돈다(`packageOf`).
- 할 일 6의 세 결과가 맞다(새 목록 안의 오류는 통과, `tests/support/core/mod.ts`의 오류는 실패).
- 위험 test: 없음. check 도구이고 `.claude/skills/write-test/SKILL.md` "쓸지 정하기"에 닿지 않는다.
- 남지 않음: `grep -n '"deno", "check"\]' tools/check.ts`가 0줄이다(인자 없는 full type check가 남지 않는다).
- `tests/e2e`, `tests/eval`, `tests/support`의 file은 고치지 않는다.

## 보고

- 바꾼 file
- 통과한 check(`check`, `check:full`)와 할 일 6의 세 결과
- 등록할 것: 없음이면 "없음"
- 안 쓰게 된 export: 없음이면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것(새 상수 이름 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

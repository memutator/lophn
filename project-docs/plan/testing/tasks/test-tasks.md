# test-tasks

`deno.json`에 task `e2e`와 `test:live`를 더하고, `tools/check.ts`가 루트 `tests/`를 package로 알아 fast·full 모두에서 `tests/harness`와 `tests/support`의 `*_test.ts`를 돌리고 `tests/e2e`와 `tests/live`는 어떤 경우에도 돌리지 않게 한다.

- 단위: test-tasks (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `deno.json`
  - `tools/check.ts`
- 읽을 것:
  - `.claude/skills/write-test/SKILL.md`("check 파이프라인" 절)
  - `project-docs/products/roadmap/testing.md`("test와 check", "폴더")
  - `project-docs/plan/testing/research/facts-main.md` 1절(`packageOf`, `expand`, 빈 목록이면 전체 discovery)
  - `project-docs/module-catalog.yaml`의 `tools`, boundary-catalog에 해당 없음(`tests`는 boundary가 null인 module로 lead가 올린다)
- 계약:
  - 쓰는 것: `tools/check.ts`의 `ALL_PACKAGES`, `FOLDERS`, `USES`, `packageOf`, `expand`, test 단(`buildSteps`의 `deno test --no-check ... --permit-no-files`)
  - 내놓는 것: `deno task e2e`(= `tests/e2e`를 도는 명령), `deno task test:live`(= `tests/live/run.ts`를 도는 명령. file은 `live-suite` task가 만든다). `tests/harness`, `tests/support`의 `*_test.ts`가 check에 든다.

## 지켜야 할 것(계획 공통)

- `~/.lophn`, OS keychain, 사람의 전역 harness 설정을 건드리지 않는다. E2E data root는 `.dev-data/e2e/<run>/home`뿐이다.
- 진짜 model provider는 `deno task test:live`에서만, 사람이 key를 줄 때만 부른다. worker와 lead는 live를 돌리지 않는다(key 없는 실행으로 gate만 확인한다).
- 전역 mutable 상태를 두지 않는다. 고정 port와 고정 path를 쓰지 않는다. 병렬로 돌아야 한다. sanitizer를 끄지 않는다. sleep으로 기다리지 않는다(gate, 가짜 clock, 신호).
- `tests/support`에는 띄우기와 연결만 둔다. flow의 단계는 test file에 그대로 쓴다. 공통 불변식은 함수 하나로 둔다.
- case 하나는 단계 6, fake 대답 3, 단정 3 이하다. 화면 문구는 단정하지 않는다.
- 의심 A~D를 고칠 때는 먼저 그 행이 고치기 전 코드에서 실패하는 것을 확인하고 보고에 적는다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.

## 정한 것

- `deno.json`에 `test.exclude`를 두지 않는다. 이유: Deno 2.9.7에서 `test.exclude`에 든 폴더는 인자로 직접 줘도 "No test modules found"가 난다(임시 폴더에서 확인했다). 그러면 `deno task e2e`가 못 돈다. 대신 `tools/check.ts`가 discovery를 부르는 모든 곳에 `--ignore=tests/e2e,tests/live`를 붙인다(`deno test --ignore=...`는 discovery에서만 빼고 직접 준 인자는 돈다). README·roadmap의 "deno.json test exclude"와 다르다. README "brief를 쓰며 바뀐 것"에 적혀 있다.
- `e2e` task는 `--parallel`을 쓰지 않는다. flow마다 core를 띄우므로 순서대로 돈다.
- `test:live`는 `deno run --allow-all tests/live/run.ts`다. key 없으면 이유를 찍고 0으로 끝나는 gate는 그 file이 한다.

## 할 일

1. `deno.json` tasks에 더한다: `"e2e": "deno test --allow-all --no-check tests/e2e"`, `"test:live": "deno run --allow-all tests/live/run.ts"`. (근거: write-test skill "check 파이프라인", roadmap "폴더")
2. `tools/check.ts`에서 `tests`를 package로 만든다: `ALL_PACKAGES`에 `"tests"`, `FOLDERS`에서 `tests`는 `tests`(tools처럼 특수 처리), `USES.tests`는 모든 package(core가 바뀌면 harness가 같이 돈다), `packageOf`가 `tests/` 아래 file을 `"tests"`로 돌려준다. 이 변경이 fmt·lint·`deno check`가 `tests/`를 보게 한다.
3. test 단에서 `tests` package는 `tests/harness`와 `tests/support` 아래 `*_test.ts`만 낸다(`tests/e2e`, `tests/live`는 `packageFiles`가 찾아도 거른다). full과 fast 모두, 그리고 목록이 비어 전체 discovery로 떨어지는 경우까지 `deno test` 인자에 `--ignore=tests/e2e,tests/live`를 붙인다.
4. 확인은 임시 file로 한다(끝나면 지운다). `tests/harness/x_test.ts`, `tests/e2e/y_test.ts`, `tests/live/z_test.ts`를 두고:
   - `tests/`만 바뀐 상태의 `deno task check`가 x만 돌린다.
   - core의 아무 file 하나를 건드린 상태의 `deno task check`가 x를 같이 돌린다.
   - `deno task check:full`이 x만 돈다.
   - `deno task e2e`가 y만 돈다.
5. fast check 시간을 재서 보고한다. core 변경 때 `tests`가 같이 `deno check` 되어 시간이 크게 늘면(체감 10초 이상) `tests`가 다른 package 변경 때는 test 단만 돌게 줄이는 안을 "정한 것"에 적는다. 줄이는 일은 이 task에서 한다.

## 세 질문

- contract: boundary ID는 없다(개발 도구, module-catalog `tools`). 지키는 것은 "harness가 check에 들고 e2e·live는 check에 안 든다"는 운영 규칙이다.
- 현실적 회귀: `tools/check.ts`의 `packageOf`가 `tests/`를 몰라 harness가 fast check에서 안 도는 것(이미 코드로 확인). 또는 e2e가 빈 목록 fallthrough 전체 discovery에 섞여 check가 core를 띄우는 것.
- 왜 지금 test로 못 잡나: check 자체를 보는 test가 없다. 임시 file로 확인하고 test는 만들지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(check 설정이라 임시 file로 위 네 가지를 확인하고 지운다)
- 남지 않음: 임시 file 세 개. `git status`에 `tests/`가 없다.
- `grep -n "test.exclude\|\"exclude\"" deno.json`이 기존 `exclude`(`.claude .dev-data ...`)만 보인다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"


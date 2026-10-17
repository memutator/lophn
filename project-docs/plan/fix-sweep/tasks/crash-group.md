# crash-group

앱 frame 위치를 못 푼 오류 관측(stack 없는 앱 process 종료, view 오류)을 report id가 아니라 같은 이유끼리 한 문제로 묶는다. 지금은 crash마다 새 문제와 새 App Engineer session이 열린다.

- 단위: crash-group (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/problems/snapshots/work.ts`
  - `packages/core/problems/snapshots/work_test.ts`(있으면 고치고, 없으면 새 file)
  - `tests/e2e/reaction_test.ts`(묶음이 바뀌어 기대가 달라지는 행만)
- 읽을 것:
  - 이슈: `project-docs/issues/platform.md`의 "stack 없는 앱 crash가 crash마다 새 문제와 새 App Engineer session을 연다"
  - 계획 README `project-docs/plan/fix-sweep/README.md`의 "정한 것" 1
  - 코드: `work.ts`의 `observedErrorGroupKey`와 `assembleException`(`evidence.bundle_hash`), `packages/core/apps/runtime/observations/crash.ts`(`process_exit` 관측: `error.name`은 evidence, `message`는 exit code나 signal), `packages/core/problems/reporting/model.ts`(문제는 `(app, group_key)`로 찾는다), `packages/core/problems/reporting/worker/collector.ts`의 `observeViewErrorPayload`(view 오류는 stack을 모으지 않는다), `packages/core/events/reactor/session-opening.ts`(`ProblemOpened`·`ProblemReopened` → App Engineer)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약: 쓰는 것 `ProblemGroupKey`(protocol, `kind: "exception"`, `discriminator`). 내놓는 것 없음.

## 할 일

1. `observedErrorGroupKey`: 앱 frame 위치가 없으면 discriminator를 report id 대신 `sha256(observation, 오류 이름, 메시지, bundle hash)`로 만든다. 위치가 있으면 지금 규칙(이름 + `path:line`) 그대로다. 주석도 고친다.
2. 같은 문제의 다음 발생이 새 문제를 열지 않는 것(그래서 reaction도 없다)은 지금 reporting 코드가 이미 하는지 확인만 한다.
3. `tests/e2e/reaction_test.ts`의 crash 행(`crash-opens-problem`, `crash-loop-halts`)과 view 오류 행이 새 묶음에서도 맞는지 돌린다. 기대가 바뀌면(예: 같은 crash가 문제 하나) 그 단정만 고친다. 고친 뒤 그 file을 3번 연속 돌린다(앱 E2E 전에 `deno task e2e:deps`).

## 끝남

- `deno task check:full`, core 기동 두 번이 통과한다.
- 위험 test(unit): "stack 없는 같은 이유의 관측 둘은 같은 group key이고, exit code(메시지)나 release가 다르면 다른 key다"
- `tests/e2e/reaction_test.ts` 3번 연속 통과.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 고치기 전 실패: 위험 test가 고치기 전 코드에서 실패한 출력 한 줄
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

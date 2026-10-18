# pt-coding-skills

coding agent skill `lophn-repair`가 지운 reproduction test를 요청하지 않게 고치고, `lophn-build-app`이 ticket에 적힌 실패 분기마다 `reportProblem`을 두게 하고, cap-problem guide에 이름으로 묶는 규칙을 쓴다.

- 단위: pt-coding-skills (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/coding-agent/guides/skills/lophn-repair/SKILL.md`
  - `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`
  - `packages/sdk/cap-problem/guide.md`
- 읽을 것:
  - 이슈: `project-docs/issues/coding-agent.md`의 "repair skill이 지운 reproduction test를 요청하게 한다", `project-docs/issues/problems.md`의 "앱이 문제를 보고할 자리(observation)를 정하는 지침이 없다"
  - architecture: `project-docs/architecture/coding-agent.md`(release 확정 순서, `app test` 단계)
  - 사실 확인(읽기만): ticket check 셋은 `packages/protocol/coding-agent/ticket/values.ts`의 `acceptanceCheckSchema`(`app_test`, `test_command`, `text`). 진입점이 저절로 보고하는 것은 `packages/core/apps/runtime/entrypoint/main.ts`(잡히지 않은 예외)와 `invoke.ts`(handler가 던진 `Error`. `AppApiRejection`은 보고하지 않는다).
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음. 이 task의 skill은 계획 `reuse-diagnose`(SDK 목록에 cap 셋 더하기)가 나중에 같은 file을 고친다. 이 task는 SDK 목록 절(`lophn-build-app` 4단계)을 건드리지 않는다.

## 할 일

README(`project-docs/plan/prompt-text/README.md`) "정한 것"의 reproduction과 observation을 따른다. skill은 한국어 그대로 둔다.

1. `lophn-repair/SKILL.md`:
   - 1단계: "acceptance 조건(원래 증상 reproduction test 포함)"을 ticket의 acceptance check(하나. `app_test`, `test_command`, `text` 중 하나)로 고친다.
   - 5단계: 원래 증상을 재현하는 test를 만든다는 말은 둔다. 그 test를 앱 `tests/`에 두고 `deno task test`로 수리 전에는 실패하고 수리 뒤에는 통과하는 것을 직접 확인한다고 쓴다. 직접 돌린 결과는 test result가 아니므로(skill의 "결과를 쓸 때"와 같다) 보고 summary에 "수행한 확인"으로 적는다.
   - 7단계: "원래 증상 reproduction과 app test를 요청"을 ticket의 check를 따르는 요청으로 고친다. `app test`는 ticket의 check 하나를 돌리는 요청이다. `text` check는 runner가 돌리지 않는다고 쓴다(`packages/core/apps/tickets/checker/result.ts`는 text에 판정이 없고 App Engineer가 판단한다).
   - 7단계에 한 줄을 더한다. `app test`가 `unavailable`로 거절되면(check가 돌지 않는 경우) 다시 요청하지 않고, 돌리지 못한 확인으로 `ticket report`의 summary에 이유와 함께 적는다. skill 글에 `test_command`가 돈다고 쓰지 않는다. 사실 확인: `packages/core/problems/tests/lifecycle.ts`의 `productAdmission`과 `proof.ts`가 지금 `test_command`를 `unavailable`로 거절한다. 이 줄은 runner가 생기면 다시 봐야 하며 아래 "알려진 미완 동작"에 적는다.
2. `lophn-build-app/SKILL.md`:
   - 1단계(ticket 읽기)에 ticket 본문의 "보고할 실패 분기와 이름"도 읽는다고 더한다.
   - 6단계(구현)에 더한다. ticket이 적은 실패 분기마다 `@lophn/cap-problem`의 `reportProblem(name, message)`을 그 자리에 둔다. 원인이 다른 실패는 이름을 나눈다(같은 이름은 한 problem으로 묶인다). 진입점이 이미 보고하는 잡히지 않은 예외와 handler가 던진 `Error`는 따로 보고하지 않고, 거절로 끝나는 업무 분기·외부 호출 실패·조용히 넘어가는 fallback이 대상이다. ticket에 보고 자리가 없는데 필요해 보이면 `message send`로 App Engineer에게 청한다. 규칙 본문은 cap-problem `guide.md`를 읽으라고 가리키고 skill에 되풀이하지 않는다.
3. `packages/sdk/cap-problem/guide.md`에 "이름으로 묶기" 절을 더한다(목적 절 아래나 `reportProblem` 설명 바로 뒤). 쓸 것: 같은 앱이 같은 이름으로 보고하면 한 문제로 묶인다 → 원인이 다르면 이름을 나눈다. 이름은 원인을 말하고 안정적이다(id·시각 같은 바뀌는 값을 넣지 않는다. 바뀌는 값은 `details`에 둔다). 보고할 곳: 거절로 끝나는 업무 분기, 외부 호출 실패, 조용히 넘어가는 fallback. 보고하지 않을 곳: 진입점이 저절로 보고하는 잡히지 않은 예외와 `Error`. 예제의 이름·message 하나를 이 규칙에 맞게 다듬는다. 이 guide는 SDK 설치 사본으로 앱에 복사되므로 새 요구를 `blueprint` 선언처럼 쓰지 않는다("이름은 선언하지 않는다"는 지금 말은 유지).

## 끝남

- `deno task check`가 통과한다(`packages/coding-agent/harnesses/install_test.ts`가 skill 두 개의 설치를 본다).
- 위험 test: 없음(글이다).
- 남지 않음: `grep -rn "reproduction" packages/coding-agent`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 정한 것: 7단계 `unavailable` 안내의 최종 문장
- 무겁게 짠 것: 없으면 "없음"
- 알려진 미완 동작: `test_command` check는 runner가 돌리지 않는다(`app test`가 `unavailable`로 거절한다). 그래서 수리 확인은 지금 `app_test`나 `text` check로만 끝나고, skill의 `unavailable` 안내 줄은 `test_command`가 살아나면 지워야 한다. 살릴지 지울지는 `project-docs/issues/coding-agent.md`의 "ticket의 `test_command` check를 runner가 돌리지 않는다"에서 사람이 정한다. 이 task는 그 이슈를 고치지 않는다.

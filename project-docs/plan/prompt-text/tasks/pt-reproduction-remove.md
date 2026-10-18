# pt-reproduction-remove

runner를 줄일 때 지운 `reproduction` test 종류가 protocol과 core에 남긴 것을 모두 지운다. 이 종류에만 쓰이던 연결 칸(`problem`, `basis_seq`, `reports`, `before`, `after`), 동결 test의 `symptom`, 요청 입력의 `ticket_source`도 같이 지운다.

- 단위: pt-reproduction-remove (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/problems/tests.ts`
  - `packages/protocol/problems/app-test-lookup.ts`
  - `packages/protocol/problems/test-frames.ts`
  - `packages/core/problems/tests/{commands,model,build,reads}.ts`
  - `packages/core/problems/tests/app-test/frozen.ts`
  - `packages/core/apps/tickets/checker/work.ts`
  - `tests/support/app/activate.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/coding-agent.md`의 "repair skill이 지운 reproduction test를 요청하게 한다"(protocol 쪽 줄만. skill 줄은 task `pt-coding-skills`)
  - architecture: `project-docs/architecture/testing.md`
  - 사실 확인(읽기만): 저장 표는 이미 `kind in ('app_test','test_command')`이고 연결 칸이 없다(`packages/core/problems/tests/schema.ts`의 `verifications`). 그래서 schema step을 고치지 않는다. `reads.ts`의 `rowToVerification`이 지운 칸을 `null`/`[]`로 채워 돌려주고 있다.
- 계약:
  - 쓰는 것: `requestTest`(`app test`), `listVerifications`, `verificationRecorded` event, `FrozenTest`
  - 내놓는 것: 지금 모양에서 `reproduction`과 위 칸만 빠진 같은 route들. 옛 모양을 읽는 곳은 남기지 않는다(AGENTS.md "호환성"). CLI(`packages/protocol/coding-agent/cli-commands.ts`의 `app test`)는 같은 schema를 가리키므로 따로 고치지 않는다.

## 할 일

먼저 `git ls-files packages tests tools | xargs grep -n "reproduction\|basis_seq\|symptom\|ticket_source"`로 지금 쓰는 곳을 다시 확인한다(아래 목록은 이 계획을 쓸 때 연 것이다). `basis_seq`는 `packages/protocol/problems/closing.ts`, `packages/protocol/lophn-agent/tool-values.ts`, `packages/shell/main/decision-handle/problem-decision.ts`에도 있지만 그쪽은 problem 판단의 근거 seq라 이 task와 무관하다. 건드리지 않는다.

1. `packages/protocol/problems/tests.ts`:
   - `TEST_KINDS`를 `["app_test", "test_command"]`로 줄인다.
   - `connectionFields`에서 `problem`, `basis_seq`, `reports`, `before`, `after`를 뺀다.
   - `frozenTestFields`에서 `symptom`을 빼고, `validFrozenTest`의 reproduction 가지를 지운다(app_test는 blueprint·SDK·실패 경로 필수, test_command는 셋 다 `null`). 위 주석도 맞춘다.
   - `validConnections`에서 reproduction 가지와 `problem/basis_seq/reports/before/after` 검사를 지우고, 남는 조건은 `value.kind === "test_command" || value.ticket === null` 하나다.
   - `requestTestInputSchema`의 `ticket_source`(주석 "coding agent의 reproduction 요청이 …" 포함)를 지운다. 요청을 받는 곳에서 읽는 곳이 없음을 grep으로 확인한 뒤 지운다(`packages/core/apps/control.ts`의 `ticket_source`는 release 준비의 다른 값이다).
   - `listVerificationsInputSchema`에서 `problem`과 "problem or ticket, not both" refine을 지운다. `verificationRecordedPayloadSchema`에서 `problem`, `basis_seq`를 지우고 refine은 `kind === "test_command" || ticket === undefined`만 남긴다. 안 쓰게 된 import·상수(`positiveSeq` 등)는 쓰는 곳을 확인하고 지운다.
2. `packages/protocol/problems/app-test-lookup.ts`: `AppTestVerificationFact.kind`에서 `"reproduction"`을 뺀다.
3. `packages/protocol/problems/test-frames.ts`: `symptom_reproduced` 칸을 지운다(쓰는 곳이 없다).
4. `packages/core/apps/tickets/checker/work.ts`: `verificationFactSchema.kind`의 enum에서 `"reproduction"`을 뺀다.
5. `packages/core/problems/tests/commands.ts`: `handleRequestTest` 첫머리의 `input.kind === "reproduction"` 거절을 지운다.
6. `packages/core/problems/tests/model.ts`: `TestConnection`에서 지운 칸을 빼고, `connectionOf`가 그 칸을 복사하는 줄과 `canonicalRequest`의 `reports` 중복 검사를 지운다. `build.ts`의 `parseVerification({...})` 호출에서 `problem/basis_seq/reports/before/after`를 뺀다. `reads.ts`의 `rowToVerification`에서 같은 칸을 빼고, `readVerificationList`의 `input.problem` 입력과 "문제와 이은 Verification은 없다" early return을 지운다. `app-test/frozen.ts`의 `symptom: null`을 지운다.
7. `tests/support/app/activate.ts`의 `app test` 입력(`kind: "app_test"` 요청, 380행 근처)에서 `problem/basis_seq/reports/before/after`를 뺀다.
8. 위를 지우고 type 오류가 나는 곳(`deno task check`)을 따라 같은 칸을 쓰던 곳을 고친다. 저장된 요청 기록(`test_requests.payload`)의 JSON 모양이 바뀌지만 개발 data는 지우고 새로 만든다(AGENTS.md "호환성". migration을 만들지 않는다).

## 끝남

- `deno task check`가 통과한다. `deno task check:full`에서 앱 test를 지나는 e2e(`tests/e2e/app-release_test.ts`, `app-activation_test.ts` 등)가 통과한다.
- 위험 test: 없음(지우는 일이다. `packages/core/problems/tests/` 안에 `reproduction`·지운 칸을 쓰는 test가 있으면 고치지 말고 지운다).
- 남지 않음: `git ls-files packages tests tools | xargs grep -n "reproduction"`가 0줄이다(생성물 `packages/shell/main/dist`, `packages/shell/renderer/dist`는 git에 없는 build 결과다. 다음 build가 갱신한다). `grep -rn "symptom_reproduced\|ticket_source" packages/protocol/problems`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 넘길 줄: 다른 계획 소유 file에서 지운 칸을 쓰는 곳이 나오면 고치지 말고 여기에 적는다(`packages/shell/renderer/**`는 계획 `settings-mcp` 소유. 이 task를 쓸 때 소스에서는 쓰는 곳을 찾지 못했다)
- 정한 것: 연결 칸·`symptom`·`ticket_source`·`problem` filter를 같이 지운 것은 이슈의 "reproduction 종류와 schema" 범위를 넓게 읽은 것이다. 이 종류에만 값이 있던 칸이고 항상 `null`로 채워 두면 `app test` 입력이 쓰지 않는 칸 다섯을 요구해 coding agent에게 헷갈린다.
- 무겁게 짠 것 / 알려진 미완 동작: 없으면 "없음"

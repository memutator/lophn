# missing-tool-reasons

목록에 없는 tool의 이유 구별(`removed_from_release`·`removed_from_grant`·`denied`·`unknown_tool`)은 run-loop에서 부를 길이 없다. 지우고 목록에 없는 tool은 `not_found` 하나로 둔다.

- 단위: missing-tool-reasons (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/app-api/missing.ts`
  - `packages/core/lophn-agent/tools/work.ts`
  - `packages/core/lophn-agent/tools/wire.ts`
  - `packages/core/lophn-agent/tools/app-toolkit.ts`
  - `packages/core/lophn-agent/tools/app-tools.ts`(`grantAllows` import만)
  - `packages/core/lophn-agent/tools/mod.ts`
  - `packages/core/lophn-agent/run-loop/prepare.ts`
  - `packages/core/lophn-agent/run-loop/core-ports.ts`
  - 위 file의 `*_test.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/agent-definition.md`의 "목록에서 빠진 tool의 이유 구별(grant·release·거절)이 run-loop에서 닿지 않는다"
  - 코드: `packages/core/lophn-agent/run-loop/tool-batch.ts`의 `one`(목록에 없는 tool을 `not_found` "tool is not available"로 먼저 닫는다. 이 동작은 그대로 둔다), `work.ts`의 `executeToolCall`과 `missingReason` 인자, `prepare.ts`의 `missing`, `core-ports.ts`의 `deps.tools.missing`, `app-toolkit.ts`의 `missingState`
  - AGENTS.md "속도"("죽은 코드는 지운다")
- 계약: 쓰는 것 없음(내부). 내놓는 것 없음.

## 할 일

1. `appApiMissingReason`, `AppApiMissingState`, `missingState`, `missingReason` 인자, `ToolSetup`·core-ports의 `missing`, `MissingToolCode`·`MISSING_TOOL_CODES`·`MISSING_TOOL_MESSAGES`를 지운다. `executeToolCall`의 목록 밖 tool은 `tool-batch.ts`와 같은 `not_found`로 닫는다(실제로는 tool-batch가 먼저 닫는다).
2. `grantAllows`는 `app-tools.ts`가 쓴다. 남는 것이 그것뿐이면 쓰는 곳 옆으로 옮기고 `missing.ts`를 지운다.
3. 지운 이름을 `grep -rn`으로 찾아 주석과 test에 남은 것도 고친다. 지운 동작만 보던 test는 지운다.

## 끝남

- `deno task check:full`, core 기동 두 번이 통과한다.
- `tests/e2e/operator_test.ts` 한 번 통과(`excluded` 행이 `not_found`를 본다. 앱 E2E 전에 `deno task e2e:deps`).
- 위험 test: 없음(동작이 같은 정리)
- 남지 않음: `grep -rn "removed_from_grant\|removed_from_release\|appApiMissingReason\|MISSING_TOOL_MESSAGES\|missingState" packages tests`가 0줄.

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

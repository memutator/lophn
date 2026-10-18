# rd-body-cli

coding agent가 보고의 message 앞부분과 log·details 본문을 읽는 CLI 명령 `problem occurrence`와 `problem body`를 더한다. 지금 `problem show`는 이름만 보이고 `problem more logs`는 log hash만 준다.

- 단위: rd-body (wave 2)
- 선행: rd-body-route. `report_details` field와 agent·coding 자격 판정을 먼저 고친다.
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/cli-commands.ts`
  - `packages/coding-agent/cli/commands/problem.ts`
  - `packages/coding-agent/cli/commands/types.ts`
- 읽을 것:
  - issue: `project-docs/issues/problems.md`의 "agent가 보고의 message, details, stack, log 본문을 읽을 길이 없다"
  - architecture: `project-docs/architecture/coding-agent.md`(CLI와 coding token), `project-docs/architecture/agent-definition.md`("agent credential의 operation 상한은 tool이 core에 부르는 route 이름이다"와 같은 원리)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `coding-agent-cli`(`coding-agent-cli-interface`), `problems`, `core-api`
  - 코드: `packages/protocol/coding-agent/cli-commands.ts`의 `token()`·`CODING_CLI_COMMANDS`, `packages/coding-agent/cli/registry.ts`(표와 어긋나면 기동 때 throw), `packages/coding-agent/cli/commands/types.ts`의 `READ_WORDS`·`entryOf`, `packages/core/server/identity/coding-token.ts`(token의 operation = 표에서 `auth: "coding_token"`인 명령의 route)
- 계약:
  - 쓰는 것: `problemGetOccurrence`(`problem.get_occurrence`), `reportBody`(`problems.report_body`). 둘 다 actors에 `coding_agent`가 있다.
  - 내놓는 것: CLI 명령 둘.
    - `problem occurrence`: route `problemGetOccurrence`, 입력 `{ report }`(`rpt_…`), 출력은 route 그대로(message `{ hash, preview(2,000자), truncated }`, `details_hash`, snapshot).
    - `problem body`: route `reportBody`, 입력 `{ report, field: report_text | report_details | snapshot_logs | feedback_state, offset_bytes?, length_bytes? }`. `length_bytes`는 CLI에서 기본 65,536(route 입력을 `.extend`로 default를 준다. `package list`가 `query`를 `.extend`로 더한 것과 같다).

## 할 일

1. `cli-commands.ts`의 `CODING_CLI_COMMANDS`에 `token("problem occurrence", …)`, `token("problem body", …)`를 `problem more` 뒤에 더한다. import는 `../problems/problem-views.ts`의 `problemGetOccurrence`, `../problems/report-body.ts`의 `reportBody`.
2. `commands/problem.ts`에 `entryOf("problem occurrence", "문제의 발생 하나의 message 앞부분과 근거를 읽는다")`와 `entryOf("problem body", "발생의 message, details, log 본문을 읽는다")`를 더한다. `problem more`의 summary는 "문제의 근거를 종류를 골라 더 읽는다. log 본문은 problem body로 읽는다"로, `problem show`는 "문제 하나를 읽는다. message 앞부분은 problem occurrence로 읽는다"로 고친다.
3. `commands/types.ts`의 `READ_WORDS`에 `"occurrence"`, `"body"`를 더한다. 이유: `isReadName`이 마지막 단어로 읽기와 변경을 가른다. 안 더하면 help가 두 명령을 변경으로 보인다.
4. coding token 길(확인됨): token의 operation은 표에서 `coding_token` 명령의 `route.name` 합집합이다(`coding-token.ts`). 두 명령이 표에 들어가면 `problem.get_occurrence`와 `problems.report_body`가 모두 token에 생긴다. `report_body`의 handler가 "볼 수 있는 발생인지"를 위해 `problem.get_occurrence`를 같은 credential로 확인하므로 둘 다 있어야 한다. token은 앱 하나에 묶여(`conditions.app`) 다른 앱의 보고는 `not_found`다.
5. help 확인: `cliMain(["help", "problem"])`가 두 명령을 읽기로 보이는지 본다(임시 확인, commit하지 않는다).

## 끝남

- `deno task check`가 통과한다. `packages/coding-agent/cli/main_test.ts`와 표/registry 일치 검사가 통과한다.
- 위험 test: 없음(route를 그대로 부르는 명령이다. 권한은 표→token에서 나오고 `coding-token_test.ts`가 본다).
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것
- 넘길 줄: coding agent skill(`lophn-repair`)이 새 명령을 아직 가리키지 않는다. skill은 이 task의 소유가 아니다.
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: coding 자격으로 본문을 읽는 길은 자동 test가 없다.

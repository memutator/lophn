# rd-body-tool

App Engineer가 보고의 본문을 읽게 한다. `problem.get`의 latest에 message 앞부분을 싣고, details·log 본문을 읽는 tool `problem.body`를 더하고, `problem.get`과 `problem.set_state`의 설명을 실제 동작에 맞춘다.

- 단위: rd-body (wave 2)
- 선행: rd-body-route, rd-app-api-tool, rd-resolve-rule. `rd-body-route`는 `report_details` field와 agent 자격 판정을 고친다. `rd-app-api-tool`은 `tool-lists.ts`를 같이 고쳐서 먼저 land해야 한다. `rd-resolve-rule`은 `problem.set_state` 오류 문구를 정한다.
- 소유(이 task만 고친다):
  - `packages/core/problems/agent-tools.ts`
  - `packages/core/agent-roles/tool-lists.ts`
- 읽을 것:
  - issue: `project-docs/issues/problems.md`의 "agent가 보고의 message, details, stack, log 본문을 읽을 길이 없다"(추천: 넷 다. 이 task는 tool 쪽 셋: latest의 message, 본문 읽기 tool, tool 설명), "고친 release 없이 resolved로…"의 program 쪽
  - architecture: `project-docs/architecture/agent-definition.md`("role의 tool 목록은 코드가 고정하고…", "agent credential의 operation 상한은 tool이 core에 부르는 route 이름이다", "tool 결과는 model에 약 24 KiB까지만 싣는다", "tool은 자원 하나에 동사 하나")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `problems`, `agent-roles`, `agent-tools`
  - 코드: `packages/core/problems/agent-tools.ts`(지금 3개), `packages/protocol/problems/problem-views.ts`의 `problemGet`·`problemGetOccurrence`(message preview는 2,000자), `packages/protocol/problems/report-body.ts`
- 계약:
  - 쓰는 것: `problemGet`, `problemGetOccurrence`, `reportBody`(field에 `report_details` 포함, `rd-body-route`), `problemSetState`; set_state의 `conflict` 문구(`rd-resolve-rule`)
  - 내놓는 것:
    - tool `problem.get`: `latest`가 `{ occurrence, snapshot, message: { hash, preview, truncated } | null, details_hash: string | null }`가 된다(`message`·`details_hash`는 `problem.get_occurrence`가 같은 이름으로 준 값). `latest`가 null이면 그대로 null이다. `routes: [problemGet, problemGetOccurrence]`.
    - tool `problem.body`: input `{ report: idSchema("rpt"), field: enum("report_text" | "report_details" | "snapshot_logs"), offset_bytes?: int >= 0 }`, effect `read`, `routes: [problemGetOccurrence, reportBody]`. 출력 `{ report, field, status: "available", text, truncated, next_offset_bytes } | { report, field, status: "unavailable", reason }`. 한 번에 16 KiB를 요청한다. `next_offset_bytes`는 `offset_bytes`에 돌려받은 `text`의 UTF-8 byte 길이를 더한 값이다(redaction이 글 길이를 바꾸면 조금 어긋날 수 있다. 설명에 적는다).
    - role 목록: `problem.body`는 모든 role의 읽기 tool이다(`problem.get`과 같다). `TOOL_ORDER`에서 `problem.get` 바로 뒤.

## 할 일

1. `problem.get` handler: `problemGet`을 읽은 뒤 `body.latest !== null`이면 `problemGetOccurrence`를 `{ report: body.latest.occurrence.report }`로 읽어 `message`·`details_hash`를 `latest`에 합친다. 이유: route는 pool에서 도는 동기 읽기라 blob 글을 못 읽고, `problem.get_occurrence`가 이미 그 일을 한다. route 계약을 바꾸지 않으려고 tool에서 합친다. 오류는 그대로 올린다(route가 blob을 못 읽으면 `preview: ""`, `truncated: true`로 이미 내려 준다). 기존 "크면 log를 덜어 낸다"(`slim`)는 `message`를 건드리지 않고 유지한다.
2. 설명을 실제로 주는 것에 맞춘다: "Read a problem: its recent occurrences, first and last release, and the latest occurrence's evidence: error name and source frames, the invocation, a summary of the logs (line count, no text), a preview of the report message (first 2,000 characters) and the hash of its details. Read the full message, details and log text with `problem.body`."
3. `problem.body` tool을 더한다. `field`가 `report_text`·`report_details`·`snapshot_logs`다(원문 stack은 열지 않는다: `rd-body-route`). `reportBody`를 `{ report, field, offset_bytes: offset ?? 0, length_bytes: 16384 }`로 부른다. 설명: "Read the text of a report: the message the app wrote (report_text), its details (report_details) or the logs captured with it (snapshot_logs). Find the report ID in the problem's occurrences. Long text is read in parts: pass next_offset_bytes as offset_bytes."
4. `problem.set_state` 설명을 "Mark a problem resolved or ignored. Resolve only after the release that fixes it is active: the program refuses to resolve while the active release was not activated after the release of the last occurrence (conflict). If the problem is fixed without a release, ask the person with `ask`."로 고친다.
5. `tool-lists.ts`: `READ_TOOLS`의 `"problem.get"` 뒤에 `"problem.body"`, `TOOL_ORDER`의 `"problem.get"` 뒤에 `"problem.body"`.
6. agent credential 길(확인됨): 위 `routes`가 `defineTool` → `operations` → `roleOperations`로 role 상한에 오르고(`ProblemGetOccurrence`, `problems.report_body`), 상한은 `agentRuntimePolicies`로 actor `agent` policy가 된다. `reportBody`·`problemGetOccurrence`의 route `actors`에 `agent`가 있다. App Engineer 자격의 `conditions.app`이 자기 앱 밖의 보고를 `not_found`로 만든다(`targetVisible`).
7. core 기동을 본다: 경계 확인은 orchestrate의 "core 확인" 방법대로 한 번 띄워 기동 오류가 없음만 본다.

## 끝남

- `deno task check`가 통과한다. `packages/core/main/agent-tools_test.ts`가 통과한다.
- 위험 test: 없음(읽기 tool이다. agent 자격으로 본문을 읽는 길은 process 경계를 건너는 test만 보일 텐데 새 E2E는 사람에게 먼저 묻는다).
- 남지 않음: `grep -rn "evidence (error, stack frames, invocation, logs)" packages`가 0줄이다(옛 설명).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: agent 자격으로 `problem.body`를 부르는 길은 자동 test가 없다.

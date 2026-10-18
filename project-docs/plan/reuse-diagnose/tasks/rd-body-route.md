# rd-body-route

`problems.report_body`가 보고의 details를 읽게 하고, agent 자격(App Engineer)이 부르면 항상 not_found가 되는 target 판정을 고친다. 이 route를 부르는 agent tool과 CLI 명령은 뒤 wave의 task(`rd-body-tool`, `rd-body-cli`)가 더한다.

- 단위: rd-body (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/problems/report-body.ts`
  - `packages/core/main/daemon/wiring/problems.ts`
- 읽을 것:
  - issue: `project-docs/issues/problems.md`의 "agent가 보고의 message, details, stack, log 본문을 읽을 길이 없다"
  - architecture: `project-docs/architecture/agent-definition.md`의 "agent credential의 operation 상한은 tool이 core에 부르는 route 이름이다"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `problems`, `core-api`
  - 코드: `packages/core/main/daemon/wiring/problems.ts`의 `reportBodyHandler`(끝의 `authorize(live.value, reportBody.name, target)`), `packages/core/server/identity/model.ts`의 `authorize`, `packages/core/storage/ledger/target-authorization.ts`의 `createTargetAuthorizer`, `packages/core/problems/snapshots/blobs.ts`(읽기 허용 field와 이유)
- 계약:
  - 쓰는 것: route `problems.report_body`(`reportBody`)와 `problem.get_occurrence`(`problemGetOccurrence`). 후자는 `reportBodyHandler`가 "볼 수 있는 발생인지"를 위해 같은 credential로 부른다. 그래서 `problems.report_body`를 쓰는 credential은 `problem.get_occurrence` operation도 가져야 한다.
  - 내놓는 것: `reportBody.input.field`가 `"report_text" | "report_details" | "snapshot_logs" | "feedback_state"`가 된다(`report_details` 추가). 나머지 입력·출력 모양은 그대로다. `snapshot_stack`(원문 stack)은 일부러 열지 않는다: `snapshots/blobs.ts`가 "원문 stack은 일반 호출자에게 돌려주지 않는다"고 정했고, 위치는 `problem.get`의 `snapshot.error.frames`로 이미 보인다.

## 할 일

1. `report-body.ts`의 `REPORT_BODY_FIELDS`에 `report_details`를 더한다. 머리 주석의 "field는 이 셋뿐"을 맞춘다. handler는 요청한 field에만 `general_read`를 켜므로(`reportBodyHandler`의 `fields.map`) 다른 file 변경은 없다.
2. `reportBodyHandler`의 마지막 `authorize(live.value, reportBody.name, target)`를 고친다. 읽어 보면 깨진 것으로 보인다: agent 자격의 `scope.targets`는 `{ session, turn }`이고 `authorize`는 scope의 모든 고정 조건 key가 target에 있어야 하는데 target은 `{ app, problem }`뿐이라 `forbidden`이 되고, 바깥에서는 `not_found`로 바뀐다. coding 자격(`scope.targets` = `{ app }`)과 사람은 지금도 된다. 같은 파일 위쪽의 `snapshotLogs.view`는 이미 `createTargetAuthorizer`(고정 조건을 target에 채운다)를 쓴다. 판정 규칙을 하나로 두려고 여기도 `createTargetAuthorizer(live.value)`를 쓴다. 이유: 같은 파일 안에서 두 규칙이 갈리면 한쪽만 맞는다.
   - 먼저 깨짐을 보인다: 임시 script(`.dev-data/rd-body-route/`, commit하지 않는다)에서 agent 모양 context(`scope.targets: { session, turn }`, `conditions.app` 있음)로 지금의 `authorize(...)`가 `forbidden`을 내고 고친 판정은 통과함을 본다.
3. 사람 자격 경로를 core 기동으로 본다(commit하지 않는다): `LOPHN_HOME=$PWD/.dev-data/rd-body-route`로 core를 띄우고, `tests/e2e/reaction_test.ts`의 `reportViewError`처럼 `problems/observe-view-error`로 보고 하나를 만든 뒤 `problem.get` → latest의 report id로 `problems/report_body`를 `report_text`·`report_details`로 부른다. 응답이 `available` 또는 `unavailable`(blob이 없을 때)이고 `forbidden`·`not_found`가 아님을 본다. 띄우기부터 끄기까지 Bash 호출 하나로 한다.
4. agent credential 길: 이 task는 operation을 더하지 않는다. `rd-body-tool`의 tool `routes`가 `reportBody`와 `problemGetOccurrence`를 적으면 `defineTool` → `roleOperations` → `agentRuntimePolicies`(actor `agent`)로 상한에 오른다. route의 `actors`는 이미 `agent`를 가진다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. agent 자격 경로의 test는 process를 건너는 core E2E가 있어야 하는데 새 E2E는 사람에게 먼저 묻는다(AGENTS.md). 보고의 "알려진 미완 동작"에 "agent 자격의 report_body는 자동 test가 없다"로 적는다.
- 남지 않음: `grep -n "authorize(live.value, reportBody.name" packages/core/main/daemon/wiring/problems.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: `snapshot_stack`을 열지 않은 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 위 위험 test 항목

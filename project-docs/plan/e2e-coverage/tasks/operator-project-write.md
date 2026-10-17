# operator-project-write

열린 이슈 `project-docs/issues/place-session.md` "앱 place의 Operator가 앱 data를 project 폴더에 쓸 길이 없다"를 닫는다. 제품 문서(O2·O3)와 Operator prompt는 앱 place의 Operator가 앱 data를 project 폴더에 파일로 쓸 수 있다고 하는데 코드(`placeScope`)는 앱 source 읽기만 준다. 이 brief는 **이슈의 추천(정책을 줄인다)** 으로 쓴다: 문서·prompt·주석을 코드에 맞추고, 앱 place의 Operator가 project 폴더와 앱 source에 쓰지 못하는 것을 `tests/e2e/operator_test.ts`의 행 하나로 지킨다.

**시작 조건: 사람이 이슈의 "정할 것"(앱 Operator가 project 폴더에 파일을 쓰는 기능을 지금 둘지)에 답한 뒤에만 시작한다.** 사람이 "둔다(만든다)"를 고르면 이 brief는 버리고 planner가 다시 쓴다(아래 "정한 것"). 이슈를 닫는 것은 lead다(`issue` skill. 이 task는 이슈 file을 고치지 않는다).

- 단위: operator (wave 3)
- 선행: operator-grants. 같은 file(`tests/e2e/operator_test.ts`)과 준비를 이어 쓰고, `packages/core/agent-roles/tools/operator.ts`를 앞 task도 고칠 수 있어 순서를 묶는다.
- 소유(이 task만 고친다):
  - `tests/e2e/operator_test.ts`
  - `project-docs/products/AGENT-ROLE.md`
  - `packages/core/agent-roles/roles/operator/prompt.md`
  - `packages/core/agent-roles/tools/operator.ts`
  - `packages/protocol/lophn-agent/operators.ts`
- 읽을 것:
  - `project-docs/issues/place-session.md`(이 task의 근거. "고치려면"의 두 길과 추천), `project-docs/plan/e2e-coverage/README.md` 전체(특히 "정한 것" 8, 지켜야 할 것), `project-docs/plan/e2e-coverage/research/candidates-docs.md` §1(`app-operator-writes-project`)과 §6(`lophn-reads-not-writes`)
  - 이 계획의 `tasks/operator-app-api.md`("이 file의 준비"와 `operatorWith`)
  - `project-docs/products/AGENT-ROLE.md`의 O1~O7(다른 항목 번호는 바꾸지 않는다. 다른 문서와 brief가 O4~O7을 가리킨다)
  - architecture: `project-docs/architecture/place-session.md` 49행("앱 place의 Operator는 앱 source 폴더를 읽기만 한다(쓰기는 App Engineer의 일이다)". 이미 코드와 같다), `project-docs/architecture/agent-definition.md`("agent 정의와 skill은 lophn data에 있어 file tool이 닿지 않는다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `agent-tools`, `run-loop`
  - 코드: `packages/core/agent-roles/place/place-folders.ts`(`placeScope`: 앱 place의 Operator는 `{read: [appSource], write: []}`. 바꾸지 않는다), `packages/core/lophn-agent/tools/file/scope.ts`(범위 밖은 `forbidden`, "path is outside the place"), `runtimeFolders`(같은 file. agent runtime child의 Deno 쓰기 권한은 모든 project 폴더와 앱 source의 합이라, tool 범위가 그 위의 마지막 한 겹이다), `packages/core/agent-roles/tools/operator.ts` 43행 주석과 `packages/protocol/lophn-agent/operators.ts` 17행 주석("앱 Operator의 project 폴더는 사람만 정하므로"), `packages/core/agent-roles/roles/operator/prompt.md`("In an app place you may write the app's data to files in a project folder the person chose. If you need to write a document outside any project, ask the person ..."), `packages/protocol/lophn-agent/tool-calls.ts`(`toolCallList`: `outcome.kind`)
  - main의 `tests/e2e/file-write_test.ts`(범위 밖 쓰기를 보는 행의 꼴), `tests/e2e/approval_test.ts`
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `operator-app-api`가 만든 `tests/e2e/operator_test.ts`의 준비(`operatorWith`는 `place: {kind: "project", ...}`로 만든다. 이 task의 행은 앱 place라 같은 helper를 `place`를 받게 넓히거나 이 행에서 `operatorCreate`를 직접 부른다. 가장 작은 쪽), `TestApp`(앱 source 폴더 `TestApp.source`), `openProject`의 project 폴더, `toolCallList`. **support brief의 이름으로 맞춘다**.
  - 내놓는 것: 같은 file의 행 하나, 문서·prompt·주석의 정리. 코드 동작은 바뀌지 않는다.

## 할 일

1. 시작 조건을 확인한다. 사람의 답이 "줄인다"가 아니면 여기서 멈추고 보고한다(제품 동작을 새로 정하지 않는다).
2. 문서·prompt·주석을 코드에 맞춘다. 나머지 O 항목의 번호는 바꾸지 않는다.
   - `project-docs/products/AGENT-ROLE.md`: O2와 O3 두 줄을 지운다. 앱 place의 Operator는 앱 data를 app-api로 읽어 결과를 대화로 남기는 것이 O1에 이미 있다. 번호가 비는 것은 그대로 둔다(`grep -rn "\bO[23]\b" project-docs`로 이 두 항목을 가리키는 곳이 없는지 본다. 있으면 그 문서도 같은 변경에서 고친다).
   - `packages/core/agent-roles/roles/operator/prompt.md`: "In an app place you may write the app's data to files in a project folder the person chose. If you need to write a document outside any project, ask the person which project it goes in first, with `ask`." 항목을 앱 place에서 쓸 수 없는 것에 맞게 바꾼다. 앱 place의 Operator는 앱 source를 읽을 수 있고 쓰지 못하며, 결과는 대화로 남기고 쓸 수 있는 것은 project place일 때 그 project 폴더라는 사실만 쓴다. 영어 고정 본문이라 영어로 쓴다. 이 prompt를 읽는 test(`role-table_test`, prompt fixture, 있으면 hash)가 있으면 같은 변경에서 맞춘다.
   - `packages/core/agent-roles/tools/operator.ts` 43행과 `packages/protocol/lophn-agent/operators.ts` 17행 주석에서 "앱 Operator의 project 폴더"를 뺀다. 코드는 바꾸지 않는다.
3. E2E 행 하나를 더한다. 앱 place의 Operator를 쓴다(`operatorCreate {place: {kind: "app", id: app}}`).

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `app-no-project-write` | `operatorCreate`(앱 place, grant 없음) + `openSession` → `say` → `waitTurnEnd` → `toolCallList({session})` | ① tool `file_write {path: "<project 폴더 절대 경로>/export.md", content: "x"}` ② text | disk: project 폴더에 `export.md`가 없고 앱 source 폴더(`TestApp.source`)에 새 file이 없다(`git status --porcelain`이 비었다) / ledger: `toolCallList`의 그 call이 성공이 아니다(범위 밖 `forbidden`이다. 오류 code가 기록에 있으면 `forbidden`을 단정한다) / fake: 둘째 요청의 tool_result가 실패다 | O2·O3를 지운 뒤에도 코드가 쓰기를 열지 않는다는 것. 후보 `app-operator-writes-project`(이슈의 줄이는 길로 바꾼 행). `lophn-reads-not-writes`(§6)의 앱 Operator 쪽 |

   `file_write`의 `path`가 절대 경로를 받는지는 `tools/file/`의 입력 검사로 확인한다. 상대 경로만 받으면 project 폴더로 나가는 `../` 경로가 아니라 범위 밖을 가리키는 입력으로 바꾼다. 단정은 위 셋이고 fake 대답은 2개다.
4. 어긋난 단정(범위 밖 쓰기가 성공함)은 제품 bug다. 고치기 전 코드에서 그 행이 실패하는 것을 먼저 확인하고(출력 한 줄을 보고에 적는다) 원인이 `packages/core/lophn-agent/tools/file/`(`file-write-rows`가 소유)나 `packages/core/agent-roles/place/`이면 이 task는 소유하지 않는다. 고치지 말고 보고한다.
5. 정한 것(문서에 답이 없어 이 brief가 정한 것):
   - 이슈의 추천(줄인다)을 따른다. 이유: O2는 쓸 project를 정하는 칸(Operator 정의 필드, 화면)과 runtime 권한·rewind까지 같이 바꾸는 중간 크기 제품 변경이고 지금 그 요구를 낸 사용자 흐름이 없다. 실제로 앱 data를 파일로 내보낼 일이 생기면 그때 만든다(이슈 "추천"과 같다).
   - 사람이 "만든다"를 고르면 정해야 할 것이 남는다(planner가 사람에게 묻는다): 쓸 project를 담는 칸의 이름과 자리(Operator 정의 front matter인지), 화면에서 사람이 고르는 방법, `placeScope`·`runtimeFolders`·rewind가 그 project 폴더를 어떻게 쓰는지, O3("project 밖에 쓰게 되면 먼저 묻는다")를 어떤 tool로 지킬지. 이 brief의 행은 그때 "그 project 폴더에는 쓰이고 다른 project와 앱 source에는 안 쓰인다"로 바뀐다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `agent-roles`·`agent-tools`(앱 place의 Operator는 앱 source를 읽기만 하고 file tool의 쓰기 범위는 place가 정한다).
- 현실적 회귀: 문서와 prompt가 약속한 쓰기를 구현하다 앱 source 쓰기까지 열리는 것, 범위 규칙이 바뀌어 앱 Operator가 project 폴더나 앱 source에 쓰는 것. agent runtime child의 Deno 권한은 모든 project 폴더와 앱 source를 쓸 수 있어 tool 범위가 마지막 한 겹이다(AGENTS.md 위험 목록의 권한 경계).
- 왜 지금 test가 못 잡나: `place-folders_test`는 `placeScope` 함수만 본다. 실제 file tool이 child process 안에서 그 범위를 지키는 것은 process를 건너야 보인다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다(prompt를 고쳤으니 prompt를 읽는 test도 돈다).
- `tests/e2e/operator_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/operator_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 남지 않음: `grep -rn "project 폴더에 파일로 쓸 수" project-docs packages --exclude-dir=issues --exclude-dir=plan`와 `grep -rn "a project folder the person chose" packages`가 0줄이다(`issues/place-session.md`는 lead가 닫는다).
- 위험 test: "앱 place의 Operator는 project 폴더와 앱 source에 쓰지 못한다"

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 찾은 제품 bug: 증상, 재현하는 행, 의심 file. 고쳤으면 "고치기 전 코드에서 그 행이 실패한 것"의 출력 한 줄
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"


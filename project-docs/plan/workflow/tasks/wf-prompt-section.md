# wf-prompt-section

`approval-simplify`가 grant 거름을 지운 뒤의 place-data에서, 모든 active domain의 workflow 가운데 이 agent가 참가자인 것을 place 층(system block 4)의 새 "Workflows" 절로 싣고, 바뀌면 다음 turn에 `workflows_changed` notice를 붙인다. 위험 test 하나를 둔다: workflow의 연락처는 그 workflow의 참가자가 아닌 agent의 prompt에 실리지 않는다.

- 단위: prompt (wave 3)
- 선행: wf-decl-reader
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/place/{place-data.ts,place-info.ts,place-info_test.ts}`
  - `packages/core/lophn-agent/prompt-assembly/{turn-prompt.ts,basis.ts}`
  - `packages/core/main/agent-runtime/product-driver.ts`
- 읽을 것:
  - 계획: `project-docs/plan/workflow/README.md`의 "정한 것"(연락처는 새 prompt 절, workflow 여럿이면 모두 싣는다)과 "뼈대 검토에서 정한 것"(선언에 이름이 오른 참가자 모두가 받는다, `session: open`인 연락처에 session id를 싣지 않는다), 위험 test 둘째 줄
  - 계약 모양: `project-docs/plan/workflow/tasks/wf-contract-shapes.md`의 "prompt 절"
  - architecture: `project-docs/architecture/agent-definition.md`("도는 turn은 시작 때 읽은 판을 끝까지 쓴다", "같은 재료는 같은 bytes다", "place 정보에는 잘 안 바뀌는 목록만", "kind 글은 … 결정적으로 조립한다"), `project-docs/architecture/agent-call.md`("주소는 session ID다": session id를 prompt에 싣지 않는 이유)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `run-loop`; `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`, `packages/core/lophn-agent`
  - 본보기(코드): kind 글이 place 층과 notice로 가는 길 — `place-data.ts`의 `kinds`(`PlaceKinds`), `turn-prompt.ts`의 `noticesOf`(`kinds_changed`), `basis.ts`의 `SeenBasis.kinds`·`BasisDiff.kinds`; test 본보기 `place-info_test.ts`의 `fakeCall`
- 계약:
  - 쓰는 것:
    - `readWorkflows`, `WorkflowFiles`, `productWorkflowFiles`(`packages/core/agent-roles/workflows/`, `wf-decl-reader`)
    - `WorkflowMembership`(`packages/protocol/lophn-agent/workflow-file.ts`), `PlaceWorkflows`(`packages/core/lophn-agent/prompt-assembly/model.ts`), notice 종류 `workflows_changed`
    - 절 글의 꼴(`wf-contract-shapes`의 "prompt 절")
  - 내놓는 것:
    - `PlaceFiles.workflows(self: AgentRef, place: Place | null): Promise<Result<WorkflowRead>>`. product-driver의 `placeFiles()`가 machine 자격의 `readWorkflows`로 꽂는다(다른 그릇의 선언은 agent 자격으로 읽을 수 없다).
    - `PlaceData.workflows`와 `placeInfo`의 "Workflows" 절. 모든 active domain의 선언 가운데 이 agent가 참가자로 풀리는 것만 싣는다.
    - `TurnPromptInput.place.workflows: PlaceWorkflows | null`
    - `SeenBasis.workflows: { hash } | null`, `BasisDiff.workflows`. 바뀐 turn에 notice `workflows_changed`(새 절 글, 없어졌으면 그렇다는 한 줄)가 붙는다.

## 할 일

brief는 main `e192a9d8c` 기준이다. `approval-simplify`(grant 거름 지움)가 land한 뒤에는 planner가 `place-data.ts`의 줄을 다시 맞춘다.

1. `packages/core/agent-roles/place/place-info.ts`
   - `PlaceData`에 `workflows: readonly WorkflowMembership[]`를 더한다(참가자인 workflow, 열쇠순).
   - `workflowSection(memberships: readonly WorkflowMembership[]): string`을 export한다. 없으면 `""`. 있으면 아래 글을 줄 단위로 만들어 `\n`으로 잇는다. 시각, 무작위, Map 순서에 기대지 않는다(열쇠순, 선언 순서).

     ```
     Workflows
     You take part in the workflows below. Hand work on as your contacts say: send call with the contact's to and reply, and give the workflow key as workflow. Contacts guide you; they do not limit whom you may call.

     Workflow <key>
     You are <participant> in this workflow.
     You are its entry: the workflow starts when you are given work.      ← entry일 때만
     Participants:
     - <name>: <참가자 글><" (you)" — 자기일 때만>
     Your contacts:                                                                     ← 연락처가 있을 때만
     - <to> — when: <when>
       to: <address JSON>, reply: "<reply>", <session 글>
     About this workflow:                                                               ← body가 비지 않았을 때만
     <body>
     ```

     - workflow 덩어리 사이는 빈 줄 하나다.
     - 참가자 글은 address에서 만든다: lophn이면 `lophn`, 아니면 `<ROLE_LABEL[role]>`에 Operator면 ` <name>`을 붙이고 ` (project <이름>)`이나 ` (app <이름>)`을 붙인다. 예: `judge: Operator judge (project lophn)`, `owner: Project Manager (project lophn)`.
     - address JSON은 `JSON.stringify(address)`다(`wf-decl-reader`가 key 순서를 고정했다).
     - session 글: `new`면 `a new session for each call`, `open`이면 `its open session: find the session id with session.list and send to {session, ...this to, fallback: "new"}`. session id는 싣지 않는다(cache. README "뼈대 검토에서 정한 것").
   - `placeInfo`가 `sections`의 맨 끝(Kinds 뒤)에 `workflowSection(data.workflows)`를 한 덩어리로 넣는다. 비면 넣지 않는다. "Agents you can call" 절은 건드리지 않는다.
2. `packages/core/agent-roles/place/place-data.ts`
   - `PlaceFiles`에 `workflows(self: AgentRef, place: Place | null): Promise<Result<WorkflowRead>>`를 더한다. 주석: 다른 그릇의 선언까지 읽어야 해서 turn의 agent 자격이 아니라 조립이 꽂는 machine 자격으로 읽는다.
   - `readPlaceData`가 `files.workflows(agent.agent, place)`를 부른다. 실패하면 `[]`로 두고 turn은 계속한다(kind 글을 못 읽을 때와 같다). 성공하면 `memberships`를 `PlaceData.workflows`에 넣는다.
   - `placeData`가 `place.workflows`를 돌려준다: 절 글이 `""`이면 `null`, 아니면 `{ hash: await sha256Hex(text), text }`(`sha256Hex`는 `packages/base/mod.ts`).
3. `packages/core/lophn-agent/prompt-assembly/basis.ts`
   - `SeenBasis.workflows: { hash: string } | null`, `basisOf` 입력에 `workflows: PlaceWorkflows | null`, `BasisDiff.workflows: { was: boolean; now: boolean } | null`. `kinds`와 같은 꼴로 비교한다.
4. `packages/core/lophn-agent/prompt-assembly/turn-prompt.ts`
   - `TurnPromptInput.place`에 `workflows?: PlaceWorkflows | null`을 더하고 `basisOf`에 `input.place.workflows ?? null`을 넘긴다(optional인 까닭은 아래 "정한 것").
   - `noticesOf`에 kinds 다음으로 `workflows_changed`를 더한다: 지금 없으면 `noticeInput({ kind: "workflows_changed", body: "You no longer take part in any workflow." })`, 있으면 `noticeInput({ kind: "workflows_changed", body: "The workflows you take part in changed. The new text follows." })` 뒤에 줄을 바꿔 새 절 글. `changed()`에 `diff.workflows !== null`을 더한다.
   - `PlaceWorkflows`는 `./model.ts`에서 import한다.
5. `packages/core/main/agent-runtime/product-driver.ts`: `placeFiles()`를 `placeFiles(machine: CoreCall)`로 바꾸고 `workflows: (self, place) => workflowsOf(machine, self, place)`를 더한다(`workflowsOf`는 `wf-decl-reader`가 둔 함수). `placeData: (call, agent) => placeData(call, agent, placeFiles(calls.machine))`.
6. `packages/core/agent-roles/place/place-info_test.ts`
   - 옛 test의 `files`에 `workflows: () => Promise.resolve(ok({ listing: { workflows: [], errors: [] }, memberships: [] }))`를 더한다.
   - 위험 test 하나를 더한다(아래 "끝남"). 준비는 file 안에서 한 번이다.
     - machine 자리의 `fakeCall`: `/domains/list`는 앱 Ledger의 domain `alpha` 하나, `/projects/list`는 project `lab` 하나(`{ id, name: "lab", title, purpose, revision, status: "active", folders: [] }`), `/apps/list`는 Ledger(`slug: "ledger"`), `/agent-definitions/list`는 `{ agents: [] }`.
     - 메모리 `WorkflowFiles`: `alpha`에 `relay.md` 하나. 참가자는 `builder: {role: app_engineer}`(place 없음 → Ledger)와 `planner: {role: project_manager, place: {project: lab}}`(다른 그릇), entry `planner`, 연락처는 `planner`에서 `builder`로 `{reply: result, session: open, when: "<고유한 글>"}`.
     - `PlaceFiles.workflows`는 진짜 `readWorkflows({ core: machine, self, place, files })`다.
     - agent 자리의 `fakeCall`은 옛 test처럼 place 정보 읽기에만 답한다(`/projects/get`, `/apps/get`, `/calls/sendable`, `/domains/list`, `/kinds/get`).
     - 판정(바깥 결과): project `lab`의 PM(그 domain을 맡지 않은 다른 그릇의 참가자)의 `place.text`에 "Workflow alpha/relay"와 연락처의 when 글이 있고 `place.workflows`가 null이 아니다. 같은 앱 Ledger의 Operator(맡은 domain이 alpha여도 선언에 없다)의 `place.text`에는 "Workflows"도 when 글도 없고 `place.workflows`가 null이다.

정한 것:
- `TurnPromptInput.place.workflows`는 optional(`workflows?: PlaceWorkflows | null`, 없으면 null)이다(이유: `tests/eval/experiment/assembly/prefix_test.ts`와 `tests/support/loop/harness.ts`가 place를 직접 만든다. tests/eval은 이 계획이 고치지 않고, harness는 이 task의 소유가 아니다). `placeData`는 늘 채운다.
- 절은 place 글의 맨 끝(Kinds 뒤)에 둔다(이유: "Agents you can call"과 섞지 않고, 잘 안 바뀌는 앞 절들의 글을 그대로 둔다. place 층은 block 하나라 cache에는 차이가 없다).
- workflow를 읽지 못하면 절 없이 turn을 계속한다(kind 글과 같다. 사람이 쓴 지침이 아니라 program이 만든 목록이다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "workflow의 연락처는 그 workflow의 참가자가 아닌 agent의 prompt에 실리지 않는다" — `packages/core/agent-roles/place/place-info_test.ts`
- 남지 않음: `grep -n "placeFiles()" packages/core/main/agent-runtime/product-driver.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`PlaceWorkflows`는 `prompt-assembly/model.ts`에서 바로 import한다. `prompt-assembly/mod.ts`에 export가 필요해지면 적는다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

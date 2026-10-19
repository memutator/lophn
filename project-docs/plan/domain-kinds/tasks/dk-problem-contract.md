# dk-problem-contract

kind 위반을 담는 project 범위의 problem 모양을 protocol에 더한다. 지금 problem은 app 칸이 필수라(`packages/protocol/problems/problem-record.ts:44`, `problemRecordSchema.app`) project 위반을 담을 수 없다. 앱 problem의 표·route·화면은 건드리지 않고 옆에 project problem을 더한다.

코드 이름은 아직 `project`다.

- 단위: problem (wave 1)
- 선행: dk-kinds-contract
- 소유(이 task만 고친다):
  - `packages/protocol/problems/project-problems.ts`
- 읽을 것:
  - plan: `project-docs/plan/domain-kinds/README.md`의 "정한 것"(위반, problem), roadmap `project-docs/products/roadmap/domain.md`의 "core가 아는 한 가지 모양"(problem 줄)과 "정한 것 (agent, 초안)"(문서 위반은 아무것도 막지 않는다)
  - 모양 본보기: `packages/protocol/problems/problem-views.ts`(`problemList`·`problemSetState`의 `defineRead`·`defineCommand` 꼴, `readActors`), `packages/protocol/problems/problem-record.ts`(`problemStateSchema`, `atSchema`·`seqSchema` 쓰임)
  - 위반 모양: `packages/protocol/projects/kinds-api.ts`의 `violationSchema`(`dk-kinds-contract`가 만든다)
- 계약:
  - 쓰는 것: `violationSchema`, `KINDS_VIOLATION_CAP`(`packages/protocol/projects/kinds-api.ts`, `kinds-work.ts`), `idSchema`, `atSchema`, `seqSchema`, `withReadCommon`, `defineCommand`, `defineRead`
  - 내놓는 것(아래 이름과 모양을 그대로 쓴다):

## 내놓는 모양

`project-problems.ts`

- id 접두는 앱 problem과 같은 `prb`를 쓴다(`packages/protocol/base/ids.ts`는 고치지 않는다). 표가 달라 `problem.get`(앱 problem)에 이 id를 주면 `not_found`다.
- `projectProblemSchema` = `{ id: prb, project: prj, violation: violationSchema, state: "open"|"resolved", opened_at, state_changed_at, last_seen_at, seq }`. `opened_at`은 지금 열린 구간이 시작된 시각, `seq`는 만들 때 1이고 상태가 바뀔 때마다 1씩 오른다. `ignored` 상태는 없다(위반이 사라지면 program이 닫는다).
- `problemSyncProject`: `defineCommand`, resource `problems`, method `sync_project`, `name: "problem.sync_project"`.
  - input `{ project, violations: [{ id: prb, violation }](200개 이하), truncated: boolean }`. `id`는 그 위반이 처음 보이는 것일 때만 쓰는 새 id다(core가 id를 만들지 않고 호출한 쪽이 준다. AGENTS.md "id는 인자로 받는다").
  - output `{ opened: int, reopened: int, resolved: int, unchanged: int }`.
  - actors `["machine"]`, errors `["invalid_input","forbidden"]`, `compare: z.strictObject({})`.
  - 뜻: 이 project의 지금 위반 **전체**를 알리는 것이다. 처음 보이는 정체성 key는 열고(`opened`), 닫혀 있던 것이 다시 보이면 다시 열고(`reopened`), 안 보이는 열린 것은 닫는다(`resolved`). `truncated`가 true이면 목록이 일부라 닫지 않는다.
- `problemListProject`: `defineRead`, method `list_project`, `name: "problem.list_project"`. input `{ project, state?, cursor?, limit?: 1..100 }`, output `withReadCommon(z.object({ problems: projectProblemSchema[] }))`, actors `["user","agent","machine"]`. 최근에 바뀐 것부터(`state_changed_at` 내림차순, id로 tie-break) 보이고 cursor로 잇는다.
- `PROJECT_PROBLEM_ROUTES = [problemSyncProject, problemListProject] as const`.

## 할 일

1. `project-problems.ts`를 만든다. 기존 `problem-views.ts`의 `readActors`·`readErrors` 꼴과 `cursor`·`limit` 규칙을 따른다.
2. mod.ts와 registry는 고치지 않는다(lead가 등록한다).
3. 앱 problem schema와 route는 한 줄도 고치지 않는다.

## 정한 것

- 이 task는 위반의 **정체성 key**를 `(source, kind, path, field, rule)`로 둔다(`kinds-contract`의 규칙). 같은 key는 같은 problem이다. 위반이 사라지면 `resolved`, 다시 나타나면 같은 problem을 다시 연다(앱 problem의 `ProblemReopened`와 같은 생각이지만 release와 무관하다).
- 새로 열렸거나 다시 열린 problem이 하나라도 있을 때만 PM을 깨운다는 규칙은 command output(`opened + reopened`)이 알려주고, event는 `dk-event`가 정한 `KindViolationFound`다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(schema만. 닫기·다시 열기 판정은 `dk-problem-core`가 test한다).
- 남지 않음: 해당 없음(새 file만 더한다). `project-problems.ts`에 `context`라는 단어가 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `packages/protocol/problems/mod.ts`에 `export * from "./project-problems.ts"`, `packages/protocol/problems/registry.ts`의 `ROUTES`에 `...PROJECT_PROBLEM_ROUTES`(lead가 한다)
- 안 쓰게 된 export: 없음
- 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**

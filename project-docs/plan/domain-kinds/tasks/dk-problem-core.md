# dk-problem-core

project 범위 problem을 core에 만든다: 표, 위반 목록을 통째로 받아 열고·닫고·다시 여는 machine command(`problem.sync_project`), 읽기(`problem.list_project`), 새 위반이 생기면 `KindViolationFound` event 내기, agent tool `problem.list`가 project problem도 보게 하기. 앱 problem의 표·command·read는 건드리지 않는다.

코드 이름은 아직 `project`다.

- 단위: problem (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/problems/project/`
  - `packages/core/problems/register.ts`
  - `packages/core/problems/agent-tools.ts`
- 읽을 것:
  - plan: `project-docs/plan/domain-kinds/README.md`의 "정한 것"(위반, 판 없음), roadmap `project-docs/products/roadmap/domain.md`의 "core가 아는 한 가지 모양"(problem 줄)
  - architecture: `project-docs/architecture/layers.md`와 `tools/check-deps.ts`(rule `tool-file`: `problems/agent-tools.ts`는 base, protocol, 같은 폴더, `lophn-agent/tools/spi.ts`만 import한다. core `problems`는 `projects`를 import하지 못한다. 위반을 보내는 쪽은 `projects`의 dispatcher이고 이 module은 command를 받기만 한다), `project-docs/architecture/event.md`
  - 등록 조각 본보기: `packages/core/problems/register.ts`(`ProblemsPart`, `groupingPart`가 `commands`·`reads`·`readerReads`를 내는 꼴)와 `packages/core/problems/grouping/register.ts`, 표 정의 `packages/core/problems/reporting/schema.ts`(`REPORTS_SCHEMA_STEPS`, "적용기가 한 번만 돌리므로 if not exists를 두지 않는다")
  - command 본보기: `packages/core/problems/grouping/commands.ts`(`CommandDefinition`, `tx.sql`, `tx.now()`), event 내기 `packages/core/problems/reporting/commands.ts`(`tx.emit(problemOpened, id, {…})` ≈:183)
  - read 본보기: `packages/core/problems/grouping/reads.ts`(`problemListRead`: `requireOperation`, cursor, `page()`가 `as_of_seq`·`next_cursor`를 채우는 꼴)
  - 계약: `packages/protocol/problems/project-problems.ts`(`projectProblemSchema`, `problemSyncProject`, `problemListProject`), `packages/protocol/projects/kinds-api.ts`(`Violation`), `packages/protocol/projects/kinds-work.ts`(`KINDS_DISPATCH_PRINCIPAL`), event `kindViolationFound`(`packages/protocol/events/domain.ts`, `dk-event`가 만들었다)
  - 테스트 규칙: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: 위 protocol 값
  - 내놓는 것: ledger에 표 `project_problems`, command `problem.sync_project`(machine, 호출자 principal이 `KINDS_DISPATCH_PRINCIPAL`일 때만), read `problem.list_project`, event `KindViolationFound`(subject는 project id, payload `{ project, count }`), agent tool `problem.list`의 `project` 입력

## 할 일

1. `project/schema.ts`: 표 하나, step id `problems.project_problems`.
   - 칸: `id text primary key`, `project text not null`, `identity text not null`(`source`·`kind`·`path`·`field`·`rule`을 NUL로 이은 글), `source text not null check (source in ('kinds_file','document'))`, `kind text`, `path text`, `field text`, `rule text not null`, `message text not null`, `state text not null check (state in ('open','resolved'))`, `opened_at text not null`, `state_changed_at text not null`, `last_seen_at text not null`, `seq integer not null check (seq >= 1)`. `strict`.
   - `create unique index project_problems_identity on project_problems (project, identity)`, `create index project_problems_state on project_problems (project, state, state_changed_at)`. 삭제는 막는다(`problems_no_delete` 트리거 꼴). 앱 `problems` 표와 `cross-owner FK`는 만들지 않는다.
2. `project/model.ts`: **순수 함수** `diffProjectProblems({ existing, incoming, truncated })`.
   - `existing`은 그 project의 모든 행, `incoming`은 `{ id, violation }` 목록(같은 identity가 둘이면 앞의 것).
   - 반환: `{ insert[], reopen[], resolve[], touch[], unchanged }`. 규칙: ① identity가 처음이면 `insert`(open, `incoming.id` 사용). ② 있고 `resolved`이고 이번에 보이면 `reopen`(open으로, `opened_at`=지금, seq+1). ③ 있고 `open`이고 이번에도 보이면 `touch`(`last_seen_at`만, message가 바뀌었으면 message도). ④ 있고 `open`인데 이번에 안 보이면 `resolve`(seq+1). **`truncated`이면 ④를 하지 않는다**(목록이 일부라 안 보이는 것이 사라진 것인지 모른다).
   - identity 계산 함수도 여기 둔다.
3. `project/commands.ts`: `problemSyncProject`의 `CommandDefinition`. ① actor가 machine이고 `ctx.principal === KINDS_DISPATCH_PRINCIPAL`이 아니면 `forbidden`. ② `tx.sql`로 그 project의 행을 읽어 `diffProjectProblems`를 돌리고 결과를 쓴다(시각은 `tx.now()`). ③ `insert.length + reopen.length > 0`이면 `tx.emit(kindViolationFound, project, { project, count: insert.length + reopen.length })`를 **한 번** 낸다(이전에 없던 위반이 생겼을 때만 PM을 깨운다. 위반이 줄거나 사라지는 것은 event가 아니다). ④ output `{ opened, reopened, resolved, unchanged }`.
4. `project/reads.ts`: `problemListProject`의 `ReadDefinition`. `requireOperation(ctx, problemListProject.name)`(앱 problem의 `reporting/access.ts`를 import하지 않고 같은 두 줄을 이 file에 쓴다. 폴더끼리 얽히지 않게), `state` 거르기, `state_changed_at` 내림차순 + id로 tie-break, cursor는 `<state_changed_at>|<id>`, 틀린 cursor는 `invalid_input`. 앱 problem처럼 `targetVisible`로 거르지 않는다(project 범위 판정은 agent tool이 자기 place로 한다).
5. `project/register.ts`: `projectProblemsPart = { schema, commands, reads, readerReads } satisfies ProblemsPart`. `packages/core/problems/register.ts`의 `reportParts`와 `createReaderRegistration`의 `parts`에 넣는다(`groupingPart` 옆).
6. `agent-tools.ts`의 `problem.list`: 입력에 `project: idSchema("prj").optional()`을 더한다. `project`가 있으면 `problemListProject`를 부르고(`state`만 쓴다. `app`·`since`·`until`과 같이 주면 `invalid`) 결과 `{ problems }`를 같은 `fitted(countSummary("problems", …), …)`로 돌려준다. `routes: [problemList, problemListProject]`(빠지면 credential 상한에서 막힌다). description에 "Pass `project` to list the kind violations of a project instead of app problems"를 더한다. PM이 자기 project의 열린 위반을 보는 길이다(`kind.check`는 지금 상태를 직접 검사하고 이것은 기록이다).
7. `project/model_test.ts`: 위험 test 하나(아래).

## 정한 것

- project problem은 앱 problem과 id 접두(`prb`)만 같고 표·route·tool 출력이 따로다. 이유: 앱 problem은 report·occurrence·snapshot·release에 묶여 있어 project 위반에 억지로 끼우면 무겁다(AGENTS.md "속도"). 화면에 보이는 "한 목록"은 이번 계획에서 만들지 않는다(roadmap에 없는 새 화면). PM은 `problem.list`로 본다.
- `ignored` 상태가 없다. 위반은 schema나 문서를 고치면 사라진다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "`diffProjectProblems`가 처음 보이는 위반은 열고, 사라진 위반은 닫고, 닫혔다 다시 보이면 다시 열며, 같은 위반 집합이면 아무것도 바꾸지 않고(event 대상이 없다), 목록이 `truncated`이면 닫지 않는다" (`project/model_test.ts`, 표 하나).
- 남지 않음: 해당 없음(앱 problem을 건드리지 않는다). `rg -n "context" packages/core/problems/project`가 0줄이다.
- core 기동: `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 찍는다(새 표와 command가 기동에 들어간다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`problems/register.ts`는 이 task 소유). protocol 쪽 `PROJECT_PROBLEM_ROUTES` 등록은 `dk-problem-contract` 보고를 따라 lead가 이미 했는지 확인하고 아니면 적는다
- 안 쓰게 된 export: 없음
- 정한 것
- 넘길 줄: `agent-tools.ts`의 `problem.list`가 두 route를 부른다
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: project problem을 보는 화면이 없다(PM은 tool로, 사람은 toast로 안다).

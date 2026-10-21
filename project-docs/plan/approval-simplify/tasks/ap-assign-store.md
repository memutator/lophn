# ap-assign-store

새 할당(`agent_assignments`)의 표, 읽기, 사람만 쓰는 command를 core에 만들고 shell main의 route 목록에 더한다. 옛 `agent_grants` 옆에 두며, 쓰는 쪽은 ap-app-call, ap-ask-turn, ap-assign-tools, ap-assign-editor가 바꾼다.

- 단위: assign (wave 1)
- 선행: ap-contract, ap-legacy
- 소유(이 task만 고친다):
  - `packages/core/approvals/assignment/`(새 폴더)
  - `packages/core/approvals/registration.ts`
  - `packages/shell/main/desktop/core/routes.ts`
- 읽을 것:
  - 계획: `project-docs/plan/approval-simplify/README.md`의 "뼈대 검토에서 정한 것"(MCP server는 설정한 층이 할당이라 할당 줄은 앱만 둔다, 새 할당 표와 route는 옛것 옆에 두고 cleanup이 옛것을 지운다)
  - roadmap: `project-docs/products/roadmap/approval.md`의 "할당 (agent grant)", "세 가지만 정한다" 1(할당은 사람만 한다. agent는 자기 할당을 넓히지 못한다), "단계"의 test 목록(agent는 자기 할당을 넓히지 못한다)
  - architecture: `project-docs/architecture/approval.md` "지키는 것"(결정 command는 사람 자격만 받는다), `project-docs/architecture/agent-definition.md`("Operator 정의를 만들고 고치는 tool은 grant를 주지 못한다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `approvals`, `core-api`, `project-docs/module-catalog.yaml`의 `packages/core/approvals`, `packages/shell/main`
  - 계약: `project-docs/plan/approval-simplify/tasks/ap-contract.md`의 `assignment.ts`(줄 모양, route, `revision`과 compare)
  - 본보기(옛 agent grant. 고치지 않는다): `packages/core/approvals/grants/{schema.ts,store.ts,commands.ts,reads.ts,registration.ts}`. `agentGrantsSetCommand`가 route의 actors에 더해 handler에서 한 번 더 사람 자격을 보는 꼴, `loadAgentGrant`가 줄이 없으면 빈 entries를 내는 꼴, `canonicalize`(`packages/base/mod.ts`)로 agent를 key로 쓰는 꼴
  - 코드: `packages/core/approvals/registration.ts`(`createCoreRegistration`이 schemaSteps·commands·reads를 모은다. schema step 순서는 migration 이력이다), `packages/protocol/server/mod.ts`의 `CommandDefinition`·`ReadDefinition`·`SchemaStep`, `packages/shell/main/desktop/core/routes.ts`와 `packages/shell/main/desktop/core/allowlist.ts`(SHELL_ROUTES의 read·command는 renderer에 열린다)
- 계약:
  - 쓰는 것: `agentAssignmentSchema`, `AgentAssignment`, `AssignmentEntry`, `assignmentRevisionSchema`, `agentAssignmentGet`, `agentAssignmentSet`, `AGENT_ASSIGNMENT_ROUTES`(ap-contract)
  - 내놓는 것: 표 `agent_assignments(agent text primary key, entries text not null, revision integer not null, updated_at text not null)`, `loadAssignment(sql, agent): Result<AgentAssignment>`(줄이 없으면 빈 entries, `packages/core/approvals/assignment/mod.ts`), `GetAgentAssignment`·`SetAgentAssignment`의 read·command 등록, shell `SHELL_ROUTES`에 `AGENT_ASSIGNMENT_ROUTES`. `SetAgentAssignment`는 사람 자격만 받고, compare의 `revision`이 지금 값과 다르면 `conflict`다.

## 할 일

옛 `grants/`와 `agent_grants` 표, `AGENT_GRANT_ROUTES`는 그대로 둔다(쓰는 곳이 남아 있다. ap-cleanup이 지운다). 근거는 위 계약이다.

1. `packages/core/approvals/assignment/schema.ts`: `ASSIGNMENT_SCHEMA_STEPS = [{id: "agent_assignments", sql: "create table agent_assignments (agent text primary key, entries text not null, revision integer not null check (revision > 0), updated_at text not null);"}]`. 줄이 있으면 한 번 이상 쓴 것이라 `revision`은 1부터다(줄 없음이 0).
2. `packages/core/approvals/assignment/store.ts`
   - key는 `canonicalize(agent)`(`packages/base/mod.ts`)다. 옛 `agentKey`(`packages/protocol/approvals/grants.ts`)는 쓰지 않는다(cleanup이 지운다).
   - `loadAssignmentRow(sql, agent): Result<{assignment: AgentAssignment, revision: number}>`: 줄이 없으면 `{assignment: {agent, entries: []}, revision: 0}`. 저장한 entries가 `agentAssignmentSchema`를 지나지 못하면 `internal`.
   - `loadAssignment(sql, agent): Result<AgentAssignment>`: 위의 `assignment`만 낸다. judge를 부르는 쪽(ap-app-call, ap-ask-turn)이 쓴다.
   - `saveAssignment(tx, agent, entries, revision)`: `insert ... on conflict (agent) do update`로 `entries = canonicalize(entries)`, `revision`, `updated_at = tx.now()`.
3. `packages/core/approvals/assignment/commands.ts`: `agentAssignmentSetCommand: CommandDefinition<typeof agentAssignmentSet>`.
   - `ctx.actor !== "user"`이면 `forbidden`("only the user changes an agent assignment"). route의 actors가 먼저 막지만 handler에서 한 번 더 본다(옛 `agentGrantsSetCommand`와 같다).
   - 지금 줄을 읽어 `compare.revision`과 다르면 `conflict`이고 쓰지 않는다. 같으면 `revision + 1`로 쓰고 `{assignment, revision}`을 돌려준다.
   - 앱이 있는지, tool이 그 앱의 것인지는 보지 않는다(옛 grant와 같다. 다른 domain의 비공개 tool 거르기는 화면과 tool 목록의 일이다, `architecture/domain.md`).
4. `packages/core/approvals/assignment/reads.ts`: `agentAssignmentGetRead: ReadDefinition<typeof agentAssignmentGet>`. `loadAssignmentRow`의 값에 `as_of_seq: snapshot.as_of_seq`, `next_cursor: null`을 붙인다. actors가 `user`·`machine`뿐이라 agent 자격 분기는 두지 않는다(옛 read의 `AgentOfSession` 분기는 가져오지 않는다).
5. `packages/core/approvals/assignment/registration.ts`: `assignmentRegistration = {schemaSteps: ASSIGNMENT_SCHEMA_STEPS, commands: [agentAssignmentSetCommand], reads: [agentAssignmentGetRead]}`. `packages/core/approvals/assignment/mod.ts`: `loadAssignment`, `assignmentRegistration`을 export한다(`loadAssignmentRow`, `saveAssignment`는 이 폴더 안에서만 쓴다).
6. `packages/core/approvals/registration.ts`: `createCoreRegistration()`의 `schemaSteps` 끝(옛 `agentGrantRegistration.schemaSteps` 뒤)에 `...assignmentRegistration.schemaSteps`, `commands`와 `reads`에 같은 것을 더한다. `memoryRoutes`는 그대로다. reader worker(`createReaderRegistration`)는 같은 reads를 가져간다.
7. `packages/shell/main/desktop/core/routes.ts`: import에 `AGENT_ASSIGNMENT_ROUTES`를 더하고 `SHELL_ROUTES`에 `...AGENT_ASSIGNMENT_ROUTES as readonly Route[]`를 더한다. 위 주석의 "에이전트 허락 읽기·바꾸기"에 할당 읽기·바꾸기를 더한다. `AGENT_GRANT_ROUTES` 줄은 그대로다.
   - `AGENT_ASSIGNMENT_ROUTES`는 ap-contract 뒤 lead가 `packages/protocol/approvals/mod.ts`에 올린다. 아직 없으면 `packages/protocol/approvals/assignment.ts`에서 바로 import하고 보고에 적는다.
8. `packages/core/approvals/assignment/commands_test.ts`: 아래 위험 test 하나. handler 하나를 부른다(`.claude/skills/write-test/SKILL.md` 층 2). 자격 거절은 tx를 쓰기 전에 나므로 tx는 `undefined as never`로 둔다(옛 `gate_test.ts`의 `agentGrantsSetCommand` test 꼴). 자격은 `agent:ses_…`, `coding_agent:ses_…`, `app:app_…`, `machine`을 표로 돈다.
9. 개발 data(`.dev-data/`)는 schema가 바뀌었으므로 지우고 새로 만든다(AGENTS.md "호환성"). migration은 만들지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`packages/core/approvals/assignment/commands_test.ts`): "사람이 아닌 자격으로 SetAgentAssignment를 부르면 forbidden이다"
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 찍는다(새 schema step과 read·command 등록이 기동 때 겹치지 않는지 본다).
- 옛것이 그대로다: `git diff --stat -- packages/core/approvals/grants`가 빈 출력이다.
- 옛 key 함수를 쓰지 않는다: `grep -rn "agentKey" packages/core/approvals/assignment`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 7에서 `assignment.ts`를 바로 import했으면 여기에 적는다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

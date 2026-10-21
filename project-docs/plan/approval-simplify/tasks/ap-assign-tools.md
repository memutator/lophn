# ap-assign-tools

agent의 tool 목록과 앱 사용 관계를 새 할당에서 읽는다. 앱 tool은 할당한 앱의 활성 release tool에서 뺀 tool을 뺀다. MCP tool은 할당 줄이 없고 지금처럼 server를 설정한 층(전역, project, Operator 정의)이 agent에 닿고 `mcp_off`로 끄지 않은 것이 목록에 뜬다. `app.usage`도 할당을 읽는다.

- 단위: assign (wave 2)
- 선행: ap-ask-turn
- 소유(이 task만 고친다):
  - `packages/core/apps/usage/users_test.ts`
  - `packages/core/apps/releases/public-tools_test.ts`
  - `packages/core/lophn-agent/tools/{app-tools.ts,app-toolkit.ts}`
  - `packages/core/lophn-agent/run-loop/{runtime-access.ts,prepare.ts,prepare_test.ts}`
  - `packages/core/main/agent-runtime/product-driver.ts`
  - `packages/core/apps/usage/users.ts`
  - `packages/core/approvals/grants/usage.ts`(지운다)
  - `packages/core/approvals/assignment/usage.ts`(새 file)
- 읽을 것:
  - 계획: `project-docs/plan/approval-simplify/README.md`의 "뼈대 검토에서 정한 것"(MCP server는 설정한 층이 곧 할당이고 끄기는 `mcp_off`, agent 할당 줄은 앱만 둔다)
  - roadmap: `project-docs/products/roadmap/approval.md`의 "세 가지만 정한다" 1(할당한 것만 tool 목록에 뜬다), "할당"(다른 domain의 비공개 tool은 할당해도 열리지 않는다), "지금 코드"의 앱 tool 할당 줄
  - architecture: `project-docs/architecture/agent-definition.md`("tool 목록은 session을 시작할 때 고정한다", "Operator 정의 층의 MCP server는 그 Operator의 turn과 Grants 목록에만 닿는다", "다른 domain의 비공개 tool은 agent의 tool 목록에도 없다", lophn place 정보의 domain 지도와 `app.usage`), `project-docs/architecture/domain.md`(비공개 tool 거르기), `project-docs/architecture/app-call.md`("agent에게는 앱 tool이 그대로 tool로 보인다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tools`, `run-loop`, `apps`, `approvals`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/apps`, `packages/core/approvals`, `packages/core/main`
  - 계약: `project-docs/plan/approval-simplify/tasks/ap-contract.md`의 `assignment.ts`(줄은 `{app, removed_tools}`뿐), `ap-assign-store.md`(표 `agent_assignments`, `loadAssignment`)
  - 코드
    - `packages/core/lophn-agent/tools/app-tools.ts`(`grantAllows`, `AppToolSource.entries`), `packages/core/lophn-agent/tools/app-toolkit.ts`(`createAppToolkit`의 `grants: Pick<Grants, "agentGrant">`), `packages/core/lophn-agent/tools/app-public.ts`(`withPublicOnly`. 고치지 않는다)
    - `packages/core/main/agent-runtime/product-driver.ts`의 `productToolkit`(machine 자격으로 `agentGrantsGet`을 읽는다)
    - `packages/core/lophn-agent/run-loop/runtime-access.ts`의 `RUNTIME_MACHINE_ROUTES`(`agentGrantsGet`)
    - `packages/core/lophn-agent/run-loop/prepare.ts`(`material`의 MCP 선택과 앱 tool, 229줄 근처 `toolsNotice` 위 주석, 363줄 근처 주석), `packages/core/lophn-agent/agents/resolve.ts`(`agent.mcp`는 층의 server tool에서 `mcp_off`를 뺀 것이다. 고치지 않는다)
    - `packages/core/approvals/grants/usage.ts`(`appGrantees`), `packages/core/apps/usage/users.ts`(`appToolUsers`), 그 test `packages/core/apps/usage/users_test.ts`와 `packages/core/apps/releases/public-tools_test.ts`(둘 다 `agent_grants` 표를 손으로 만든다)
  - problem-remove 뒤 `PublicToolsChanged`는 없다(`project-docs/products/change-log/0.6.0.md` 끝 항목). `packages/core/apps/releases/public-tools_test.ts`는 남아 있고, 막기 판정이 `appToolUsers`를 거치므로 `agent_grants` 표를 손으로 만든다(줄은 넣지 않는다). `users_test.ts`는 표를 만들고 앱 줄을 넣는다.
- 계약:
  - 쓰는 것: `agentAssignmentGet`, `AssignmentEntry`, `AgentAssignment`(ap-contract), `loadAssignment`·표 `agent_assignments`(ap-assign-store)
  - 내놓는 것: runtime machine 자격에 `GetAgentAssignment`가 있고 `GetAgentGrant`가 없다. `AppToolSource.entries`는 `AssignmentEntry[]`다. 앱 사용 관계는 `appAssignees(sql, app) → {agent, removed}[]`(`packages/core/approvals/assignment/usage.ts`)로 읽는다. 다른 domain의 비공개 tool 거르기(`app-public.ts`)는 그대로다. MCP tool 목록 만들기는 바꾸지 않는다.

## 할 일

근거는 README "뼈대 검토에서 정한 것"과 roadmap "세 가지만 정한다" 1이다. 옛 `agent_grants`와 `agentGrantsGet`은 지우지 않는다(화면과 place 정보가 아직 쓸 수 있다. ap-cleanup).

1. `packages/core/approvals/assignment/usage.ts`(새 file): `type AppAssignee = {agent: AgentRef; removed: ReadonlySet<string>}`, `appAssignees(sql: Pick<Sql, "all">, app: string): Result<AppAssignee[]>`. `select agent, entries from agent_assignments`의 줄마다 `agentAssignmentSchema`로 읽고(JSON이나 모양이 틀리면 `internal`), 그 앱 줄이 있으면 `{agent, removed: new Set(entry.removed_tools)}`를 더한다. 옛 `appGrantees`와 같은 꼴이다.
2. `packages/core/approvals/grants/usage.ts`를 지운다(`appGrantees`는 `users.ts`만 쓴다).
3. `packages/core/apps/usage/users.ts`: import를 `../../approvals/assignment/usage.ts`의 `appAssignees`로 바꾸고, `excluded`를 `removed`로 읽는다. 위 주석의 "grant: 앱을 맡은 agent…"를 할당으로 고친다.
   - 정한 것: `ToolUser.source`의 값 `"grant"`는 그대로 둔다. 이유: `packages/protocol/apps/usage.ts`의 `app.usage` 출력 enum이고 이 task의 소유가 아니다. 뜻은 "할당"이다.
4. test 둘(`packages/core/apps/usage/users_test.ts`, `packages/core/apps/releases/public-tools_test.ts`): 표를 손으로 만드는 줄을 `CREATE TABLE agent_assignments (agent TEXT, entries TEXT)`로 바꾸고, `users_test.ts`가 넣는 entries를 `[{app: APP, removed_tools: []}]`로 바꾼다. 이 줄만 고친다(`users.ts`가 새 표를 읽으면 두 test가 깨진다).
5. `packages/core/lophn-agent/tools/app-tools.ts`
   - `AppToolSource.entries: readonly AssignmentEntry[]`. `AgentGrantEntry` import를 `AssignmentEntry`로 바꾼다.
   - `grantAllows`를 `assigned(entries, app, tool)`로 바꾼다: 그 앱 줄이 있고 `removed_tools`에 tool이 없을 때 참이다.
   - 위 주석(앱 ∩ 선언 ∩ agent grant)과 `entries` 주석을 할당으로 고친다. ap-ask-turn이 단 `gate`는 그대로다.
6. `packages/core/lophn-agent/tools/app-toolkit.ts`
   - `createAppToolkit(options: {machine: CoreCall; assignment(agent: AgentRef): Promise<Result<AgentAssignment>>})`. `Grants`(`packages/core/approvals/ports.ts`) import를 지운다. ap-ask-turn 뒤 그 type은 없다.
   - `load`는 `assignment.entries`의 앱마다 `appTools`를 읽는다(지금과 같다). 머리 주석을 할당으로 고친다.
7. `packages/core/main/agent-runtime/product-driver.ts`의 `productToolkit`: `grants.agentGrant` 대신 `assignment: async (agent) => { const read = await readOf(options.machine, agentAssignmentGet, {agent}); return read.ok ? ok(read.value.assignment) : read; }`. import의 `agentGrantsGet`을 `agentAssignmentGet`으로 바꾼다. 주석 "grant는 machine 자격의 loopback으로 읽는다"를 할당으로 고친다.
8. `packages/core/lophn-agent/run-loop/runtime-access.ts`: `RUNTIME_MACHINE_ROUTES`의 `agentGrantsGet`을 `agentAssignmentGet`으로 바꾸고 import와 위 주석("활성 release 선언과 agent grant")을 맞춘다.
   - 정한 것: runtime 쪽 조립(`product-driver.ts`, `runtime-access.ts`)은 할당을 machine route로 읽는다. 이유: agent runtime child는 ledger를 열지 않는다. `loadAssignment`는 core main thread(Approvals)만 쓴다.
9. `packages/core/lophn-agent/run-loop/prepare.ts`: 229줄 근처 `toolsNotice` 위 주석("빠진 tool은 Gate가 call 때 지금 grant를 읽어 바로 막으므로")과 363줄 근처 주석("선언이나 grant를 읽지 못하면")의 grant를 할당으로 고친다. 코드는 고치지 않는다.
10. MCP: 고칠 것이 없는지 확인만 한다. `material`의 MCP 선택은 `agent.mcp`이고, 그것은 `resolveTurnAgent`(`packages/core/lophn-agent/agents/layers.ts`)가 부르는 `resolveAgent`(`packages/core/lophn-agent/agents/resolve.ts`)가 층(전역, place, Operator 정의)의 server tool에서 `mcp_off`를 뺀 것이다. agent grant의 `mcp_tool` 줄을 읽는 곳이 tool 목록 쪽에 없음을 `git grep -n "mcp_tool" -- packages/core/lophn-agent packages/core/main/agent-runtime`로 보고, 남은 줄을 보고에 적는다(Gate 쪽 `mcp_tool`은 ap-ask-turn이 `GateCall`로 바꿨다).
11. `prepare_test.ts`는 위 바꿈으로 깨질 때만 준비를 맞춘다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 할당 밖 tool을 부르면 막는 판정은 ap-gate의 "할당하지 않은 앱 tool과 뺀 tool은 어느 mode에서도 막는다"가 본다(`.claude/skills/write-test/SKILL.md`: 한 동작은 한 층에서만). 사용 관계는 `packages/core/apps/usage/users_test.ts`의 지금 test가 새 표로 계속 본다.
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 찍는다(runtime machine 자격이 `GetAgentAssignment`를 받는다).
- 남지 않음:
  - `git grep -nwE "agentGrantsGet|GetAgentGrant|AgentGrantEntry|appGrantees|grantAllows" -- packages/core/lophn-agent packages/core/main/agent-runtime packages/core/apps/usage`가 0줄이다.
  - `git ls-files packages/core/approvals/grants/usage.ts`가 빈 출력이다.
  - `git grep -n "agent_grants" -- packages/core/apps`가 0줄이다(할 일 4를 했을 때).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

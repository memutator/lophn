# wlophn-core

내장 lophn을 workspace마다 객체로 만든다. workspace의 lophn은 그 workspace의 범위 agent처럼 돌고, id는 workspace에서 정해지며(`lophn_home`, `lophn_<prj|app id>`), handle `lophn`만 예약이다.

- 단위: wlophn (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{workspaces,agent-values,agent-definitions,call-policy}.ts`
  - `packages/core/lophn-agent/agents/`
  - `packages/core/lophn-agent/workspaces/{directory,lifecycle}.ts`
  - `packages/core/lophn-agent/{register,secret-destinations}.ts`
  - `packages/core/lophn-agent/extensions/{mcp-toolkit,mcp-snapshot,mcp-server,mcp-oauth-vault,mcp-auth-control}.ts`
  - `packages/core/lophn-agent/run-loop/prepare.ts`
  - `packages/core/lophn-agent/instructions/files.ts`
  - `packages/core/agent-workspaces/workspace/{instruction-rules,session-directory,workspace-data}.ts`
  - `packages/core/agent-workspaces/agents/ensure.ts`
  - `packages/core/agent-workspaces/prompts/prompts.ts`
  - `packages/core/router/router.ts`
  - `packages/core/apps/{usage/users,calls/gate}.ts`, `packages/core/apps/annotations/`
  - `packages/core/approvals/`
  - `packages/core/main/daemon/wiring/{lophn-agent,assignment-file,approvals,apps,apps-delete,share-requests,extension-tools,acp-build}.ts`
  - `packages/core/main/agent-runtime/product-driver.ts`
  - `packages/cli/commands/{agent,app-share}.ts`
  - 위 file 옆의 `*_test.ts`
  - `project-docs/architecture/{agent-definition,agent-call}.md`
- 읽을 것:
  - 계획: `project-docs/plan/workspace-layers/README.md`의 정한 것
  - roadmap: `project-docs/products/roadmap/workspace-layers.md`
  - architecture: `project-docs/architecture/agent-definition.md`(정의 꼴, 범위 agent, 명함, 할당), `project-docs/architecture/agent-call.md`(주소, call 정책)
- 계약:
  - 쓰는 것: `AgentAtWorkspace`, `AgentAddress`(`protocol/lophn-agent/workspaces.ts`), `resolveAddress`(`session-directory.ts`)
  - 내놓는 것: `agentIdSchema`가 lophn id 꼴(`lophn_home`, `lophn_prj_…`, `lophn_app_…`)을 받는다. `LOPHN_AGENT_ID` 상수 대신 `lophnIdOf(workspace: Workspace | null): AgentId`와 `isLophn(id): boolean`, `workspaceOfLophn(id)`를 `protocol/lophn-agent/workspaces.ts`에서 내놓는다. `wlophn-migrate`와 `wlophn-ui`가 이것을 쓴다.

## 할 일

1. protocol. `LOPHN_AGENT_ID`를 지우고 위 세 함수를 더한다. id 꼴이 `mcp.<agent id>.<server>` secret 이름과 `mcp-oauth.<scope>.<server>.*` 이름의 parse, 정의 file 이름, `agentIdSchema` 모두에서 맞는지 확인한다(`.`을 쓰지 않는다).
2. 정의 저장(`agents/store.ts`): `agentSlotOf(root, id)`는 그대로 `<data>/agents/<id>.md`다. `agentIds()`가 `agt_`만 남기는 것을 lophn id도 남기게 고친다. 파일이 없는 lophn id는 기본 정의다(`inspect.ts` `loadAgent`·`parsedAgent`의 `agent === LOPHN_AGENT_ID` 분기를 `isLophn`으로).
3. 목록과 보이는 범위(`inspect.ts` `listAgents`, `visibleIn`, `reads.ts`): 있는 workspace(Home, `projectIds`, `appIds`, `WorkspaceLookups` in `agents/ports.ts`)마다 lophn 하나를 범위 agent로 낸다. Home lophn은 Home에서만, project·앱 lophn은 그 workspace에서만 보인다. archived 앱의 lophn은 지금 범위 agent 규칙대로 숨는다. `rowOf`의 개수 계산은 그 row의 workspace로 한다.
4. handle 규칙(`validate.ts` `duplicateHandle`): lophn 끼리는 handle이 같아도 된다. 사람이 만든 agent는 `lophn`을 쓰지 못한다(지금 예약 그대로).
5. 정의 file(`definition-file.ts`): lophn이면 `handle`, `profile`, `workspace` 칸을 받지 않는 지금 규칙을 `isLophn`으로 유지한다(workspace는 id에서 나온다). `commands.ts`: `agentChange`는 lophn id로 그 workspace의 lophn을 고친다. 삭제·생성 금지와 profile 고정을 `isLophn`으로.
6. 주소 풀기(`session-directory.ts` `agentIdByHandle`, `resolveAddress`; `workspaces/directory.ts` `accepts`·`describe`; `router.ts`; `workspaces/lifecycle.ts` session 시작): handle `lophn` + workspace → `lophnIdOf(workspace)`. handle만 있고 workspace가 없으면 부른 쪽이 있는 workspace다(지금 범위 agent 규칙과 같다). `AgentDirectory.cardOf(handle)`는 (handle, workspace)를 받는다.
7. 명함(`card.ts` `cardByHandle`, route `agents/card`, CLI `lophn agent card`): workspace를 받는다. agent session이 workspace 없이 읽으면 자기 workspace의 lophn이다. 명함의 차이(`diff`)는 그 lophn의 정의로 계산한다.
8. call 정책(`protocol/lophn-agent/call-policy.ts` `mayCall`): Home lophn이 다른 workspace의 lophn에게 넘기는 예외(`from.workspace === null`)를 lophn id로 다시 쓴다. agent 규칙은 id라 그대로 맞는다.
9. 할당·MCP·secret: 열쇠가 agent id라 lophn id로 그대로 맞는다. `agentAssignment`(`apps/usage/users.ts`)의 own app 더하기가 앱 lophn에도 걸리게 한다(앱 lophn은 그 앱의 범위 agent다). `mcp-oauth-vault.ts` `scopeOf`, `mcp-auth-control.ts`, `mcp-server.ts` fingerprint가 lophn id에서 겹치지 않는지 확인만 한다. `apps-delete.ts` `eraseRemnants`는 그 앱 lophn의 정의 file을 지운다(`agentDelete`의 lophn 금지를 거치지 않는 길로).
10. `agentRead` 부르는 곳 가운데 workspace 없이 `lophn`을 읽던 곳(`prepare.ts:911`, `mcp-toolkit.ts:170`, `extension-tools.ts:88`, `acp-build.ts` `agentNameOf`)은 session의 lophn id를 쓴다. `instruction-rules.ts` `agentFilePathOf`는 session의 agent id로 path를 만든다(lophn이면 lophn id).
11. 처음 띄울 때(`agents/ensure.ts` `ensureLophn`): 전역 `agents/lophn.md`를 만들지 않는다. 파일이 없으면 기본 정의이므로 만들 것이 없다.
12. `agent-workspaces/prompts/prompts.ts`의 agent 만들기·고치기 설명(:46, :49)에 "workspace마다 자기 lophn이 있다"를 맞춘다.
13. shell renderer, `shell/main`, CLI 가운데 이 task 소유가 아닌 곳이 `LOPHN_AGENT_ID`를 import하면 check가 통과하도록 최소로 맞추고 "넘길 줄"에 적는다(화면 동작은 `wlophn-ui`가 고친다).
14. `agent-definition.md`(정의 꼴, 범위, 명함, 할당 절)와 `agent-call.md`(주소, call 정책)를 고친 동작에 맞춘다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "calendar 앱 lophn의 정의 층 MCP server와 OAuth token이 lophn project의 lophn turn에 실리지 않는다"(secret·권한 경계)
  - "`{agent: \"lophn\", workspace: X}` call이 X의 lophn session으로 가고, workspace를 빼면 부른 쪽 workspace의 lophn이다"
- 남지 않음: `grep -rn "LOPHN_AGENT_ID" packages tools`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴을 따른다.

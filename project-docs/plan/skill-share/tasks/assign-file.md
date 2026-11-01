# assign-file

할당(agent가 쓸 앱과 뺀 command)의 저장을 ledger 표 `agent_assignments`에서 agent 정의 파일의 `apps`와 `permissions.deny`로 옮긴다. 할당 route와 그 route를 부르는 곳은 그대로 둔다.

- 단위: approvals (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/approvals/assignment.ts`
  - `packages/core/approvals/assignment/**`
  - `packages/core/approvals/gate/**`
  - `packages/core/approvals/{approvals.ts,approvals_test.ts,registration.ts}`
  - `packages/core/apps/calls/{gate.ts,calls_test.ts}`
  - `packages/core/apps/usage/{users.ts,users_test.ts}`
  - `packages/core/main/daemon/wiring/{approvals.ts,approvals_test.ts,apps.ts}`
  - `packages/core/main/daemon/wiring/assignment-file.ts`(새 file, data step을 내는 wiring)
  - `packages/core/lophn-agent/agents/{commands.ts,commands_test.ts,directory.ts,directory_test.ts,store.ts,validate.ts}`
  - `packages/core/lophn-agent/tools/{app-public.ts,app-public_test.ts}`
  - `packages/cli/commands/{agent.ts,agent_test.ts}`
  - `packages/shell/renderer/workspace/agents/core-grants.ts`
  - `packages/shell/renderer/workspace/agents/editor/{grants-panel.tsx,grants-model.ts,grants-model_test.ts}`
  - `packages/shell/renderer/conversation/agent-tab-core-source-sessions.ts`
  - `tests/e2e/{app-call_test.ts,app-data-rewind_test.ts,session_test.ts}`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/harness-config.md` 단계 6과 "정한 것"
  - 계획: `project-docs/plan/skill-share/README.md` 정한 것 2~5, `project-docs/plan/skill-share/facts.md` "할당", "agent 정의"
  - architecture: `project-docs/architecture/approval.md`(할당, judge), `project-docs/architecture/app-call.md`(caller별 판정), `project-docs/architecture/agent-definition.md`(사람만 쓰는 칸, 할당은 agent id마다 한 줄)
- 계약:
  - 쓰는 것: `agent-values.ts`의 `apps`(앱 slug 목록), `permissions.deny`(wave 0)
  - 내놓는 것: 할당을 읽고 쓰는 core 함수(`app-share-request`가 승인 때 그 agent 정의의 `apps`에 slug 하나를 더하는 데 쓴다). `AgentInfo`에 `apps`·`deny`.

## 할 일

1. 저장: 한 agent의 할당은 그 정의 파일의 `apps`(slug)와 `permissions.deny`(`lophn(<domain> <command 낱말>)`)다. `assignment.get`은 파일을 읽어 지금 모양(`{app: app id, removed_tools}`)으로 돌려주고, `assignment.set`은 파일에 쓴다. app id ↔ slug, command 이름 ↔ domain은 앱 표와 active release 선언(`appToolIndex`)에서 푼다. compare 값(`revision`)은 파일 hash로 바꾸거나 같은 뜻으로 둔다. protocol 모양을 바꾸면 Grants 탭(`core-grants.ts`, `grants-model.ts`)을 같이 고친다.
2. 사람만 쓴다: agent actor가 `agent.create`·`agent.update`로 `apps`·`permissions`를 넣거나 바꾸면 `forbidden`(`agents/commands.ts`, `mcp_servers`·`skip`과 같은 자리). CLI `lophn agent create|update` 입력에서도 뺀다(`.omit`).
3. ledger를 바로 읽던 동기 reader(`apps/calls/gate.ts`의 `assignmentOf`, `apps/usage/users.ts`의 `appAssignees`, `wiring/approvals.ts`)는 `AgentDirectory`(`agents/directory.ts`, `AgentInfo`에 `apps`·`deny`를 더한다)로 읽는다. 판정 결과(`not_assigned`, `removed`)와 flow·job 규칙은 그대로다. `appAssignees`의 signature는 그대로 둔다(`app-skill-decl`의 `public-tools.ts`가 같은 wave에 쓴다).
4. migration: data step `approvals.assignment-file`이 `<root>/lophn.db`를 열어 `agent_assignments`의 줄마다 그 agent 파일에 `apps`와 `permissions.deny`를 쓰고, 다 쓴 뒤 표를 지운다. 뺀 command의 domain은 active release 선언에서 찾고, active 선언에 없는 command는 버린다(막을 것이 없다). 파일이 없는 agent의 줄은 버린다. `wiring/assignment-file.ts`가 이 step을 낸다(`WIRINGS` 등록은 lead). 표를 만드는 schema step과 store를 지운다.
5. test·e2e에서 표에 바로 쓰던 곳을 정의 파일이나 `assignment.set`으로 바꾼다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "`agent_assignments`의 줄(앱 둘, 뺀 command 하나)을 data step이 옮긴 뒤 같은 agent가 같은 앱 command를 보고 judge가 같은 판정을 낸다"
  - "agent actor가 `apps`나 `permissions`를 넣은 `agent.update`는 `forbidden`이다"
- 남지 않음: `grep -rn "agent_assignments" packages`가 data step 밖에서 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `WIRINGS`에 넣을 wiring, schema step 목록에서 뺄 것
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**

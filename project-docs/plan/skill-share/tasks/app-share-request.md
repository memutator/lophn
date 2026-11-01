# app-share-request

앱 place의 agent가 `lophn app share`로 "이 앱을 agent A, B(와 coding agent)에게 할당" 요청을 내고, 사람이 대기 목록에서 한 번 승인하면 core가 그 agent 정의의 `apps`에 앱 slug를 넣고 coding agent를 골랐으면 설정 `coding-agent.shared_apps`에 넣는다.

- 단위: approvals (wave 2)
- 선행: assign-file. 승인이 그 task의 할당 쓰기 함수를 쓴다.
- 소유(이 task만 고친다):
  - `packages/protocol/approvals/share-request.ts`(새 file)
  - `packages/protocol/events/transient.ts`
  - `packages/core/approvals/share-requests/**`(새 module)
  - `packages/core/main/daemon/wiring/share-requests.ts`(새 file)
  - `packages/cli/commands/{app-share.ts,app-share_test.ts}`(새 file)
  - `packages/core/agent-places/{credentials.ts,tool-lists.ts,tool-lists_test.ts}`
  - `packages/shell/renderer/desktop/connection/**`
  - `packages/shell/main/notice/**`
  - `packages/shell/renderer/workspace/reactions/toast-handler.ts`
  - `packages/design/i18n/catalog/**`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/harness-config.md` 단계 8
  - 계획: `project-docs/plan/skill-share/README.md` 정한 것 8, `project-docs/plan/skill-share/facts.md` "대기 목록", "CLI 명령 표"
  - architecture: `project-docs/architecture/approval.md`, `project-docs/architecture/agent-definition.md`("agent 정의를 만들고 고치는 tool은 할당을 주지 못한다")
  - 본보기: activation 동의(`packages/protocol/apps/activation/consent.ts`, `packages/core/apps/releases/activation/consents.ts`, shell 대기 목록 card)
- 계약:
  - 쓰는 것: `assign-file`의 할당 쓰기 함수, `AgentDirectory`
  - 내놓는 것: 설정 `coding-agent.shared_apps`(앱 slug 목록, `declareSetting`)와 그것이 바뀌었다는 event. `harness-skill-copies`가 읽는다. 명령 이름 `lophn app share`(`share-guidance`가 쓴다).

## 할 일

1. protocol `share-request.ts`: 요청을 여는 command(agent, 앱 place의 그 앱만), 사람만 부르는 결정 command(승인·거절, compare), 열린 요청 read, transient event(열림, 닫힘). 요청 칸: 앱, 받을 agent id 목록, coding agent 여부, 이유 한 줄, 연 session.
2. core `share-requests`: 요청은 ledger 표에 남아 turn과 lophn 재시작을 넘는다(새 schema step). 같은 앱의 열린 요청이 있으면 새 요청이 그것을 대신한다. 승인하면 agent마다 할당 쓰기 함수로 `apps`에 slug를 더하고(이미 있으면 그대로), coding agent를 골랐으면 `coding-agent.shared_apps`에 slug를 더한다. 이미 뺀 command(`permissions.deny`)는 건드리지 않는다.
3. CLI `lophn app share --agent <name>... [--coding-agents] [--reason <text>]`(`places: ["app"]`, effect write): agent 이름을 id로 풀고 요청을 연다. 결과는 "요청을 열었다, 사람이 대기 목록에서 승인한다". `COMMANDS` 등록은 lead. `credentials.ts`와 `tool-lists.ts`에 route를 더한다.
4. shell 대기 목록에 새 card: 앱 이름, 받을 agent, coding agent 여부, 그 앱의 public skill과 public command 수, 승인·거절. OS 알림과 toast도 다른 요청과 같다. 문구는 i18n catalog에 더한다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "agent가 연 요청은 사람이 승인하기 전에는 어느 agent 정의도 바꾸지 않고, agent 자격으로 결정 command를 부르면 막힌다"
- 남지 않음: 없음

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `COMMANDS`, `WIRINGS`, `protocol/registry.ts`, `protocol/approvals/mod.ts`, boundary·module catalog에 올릴 ID
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**

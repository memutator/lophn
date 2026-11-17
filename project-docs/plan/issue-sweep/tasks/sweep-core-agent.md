# sweep-core-agent

lophn agent 쪽 bug를 고친다: provider secret이 덮이는 순서, fork한 harness session, turn 시작 때의 훑기, flow의 memory 한도, 공유 승인의 반쪽 적용.

- 단위: core-agent (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/`
  - `packages/shell/renderer/desktop/settings/providers/`
  - `packages/core/main/flow-host/`
  - `packages/core/supervision/security/`
  - `packages/protocol/acp/session.ts`
  - `packages/core/approvals/`
- 읽을 것:
  - 고칠 이슈마다 `project-docs/issues/<id>.yaml`의 `now`·`fix`·`decided`(추천안과 정한 것이 할 일이다)와 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`
  - 화면을 바꾸면 `.claude/skills/ui-design/SKILL.md`(wireframe을 먼저 고친다)
- 계약:
  - 쓰는 것: 소유 밖의 protocol, port, shell IPC, preload는 고치지 않는다. 필요하면 보고의 "계약 바꾸기 요청"에 적는다.
  - i18n catalog(`packages/design/i18n/catalog/`)에는 key를 더하기만 한다.

## 할 일

아래 이슈를 하나씩 고친다. 이슈 file은 고치지 않는다(lead가 닫는다). 이슈의 글이 지금 코드와 다르면 코드를 믿고 보고에 적는다.

1. `provider-id-overwrite`: core가 맡는 안
2. `forked-harness-session-loses-history`
3. `cut-off-notice-scans-all-turns`
4. `acp-session-copies-value-lists`
5. `flow-process-no-resource-limits`: 다시 생긴 문제라 test를 쓴다
6. `share-approval-partial-assignments`

알아 둘 것:
- 실제 model provider를 부르지 않는다. `packages/core/agent-workspaces/`는 `sweep-kit-instructions`의 것이다.

## 끝남

- `npm run check:full`이 통과한다.
- 위험 test: `provider-id-overwrite`(이미 있는 id로 잇기가 실패해도 그 provider의 secret이 그대로다), `flow-process-no-resource-limits`(flow process가 heap 한도 인자로 뜬다), `share-approval-partial-assignments`(둘째 agent가 실패하면 첫 agent도 그대로다)
- 이슈마다 고쳤는지, 못 고쳤으면 왜인지가 보고에 있다.

## 보고

- 이슈마다: 고침 / 일부 / 못 함(이유), 지금 코드가 어떻게 하나 한두 문장, 지키는 test 이름(없으면 없음)
- 바꾼 file, 통과한 check
- 등록할 것, 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것(실제 폰이나 Electron에서 못 본 것 포함). 없으면 "없음"

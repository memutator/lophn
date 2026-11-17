# sweep-contracts

wave 1이 계약(protocol, IPC) 밖이라 못 고친 것을 고친다.

- 단위: contracts (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/ipc/{machines.ts,surface.ts}`
  - `packages/shell/preload/{machines-api.ts,surface-api.ts}`
  - `packages/shell/main/desktop/wiring/{machines.ts,surface.ts}`
  - `packages/shell/renderer/desktop/workspaces/projects/`
  - `packages/shell/renderer/workspace/app-preview-tab.tsx`
  - `packages/shell/main/browser/agent/`
  - `packages/protocol/lophn-agent/{harness-host.ts,turn-reads.ts}`
  - `packages/core/main/daemon/wiring/harness.ts`
  - `packages/shell/main/extensions/bundled/harness/`
  - `packages/protocol/coding-agent/headless/`
  - `packages/core/lophn-agent/{run-loop,session}/`
  - `packages/core/apps/rewind/`
  - `packages/protocol/apps/calls/rewind.ts`
- 읽을 것:
  - 고칠 이슈마다 `project-docs/issues/<id>.yaml`의 `now`·`fix`·`decided`(`fix`의 "한 것" 줄이 wave 1이 이미 한 부분이다)와 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`
  - 화면을 바꾸면 `.claude/skills/ui-design/SKILL.md`(wireframe을 먼저 고친다)
- 계약:
  - 이 task는 아래 소유에 든 protocol, IPC, preload를 고쳐도 된다(wave 1이 계약 밖이라 못 한 일이다). 소유 밖의 계약은 고치지 않고 보고에 적는다.
  - i18n catalog(`packages/design/i18n/catalog/`)에는 key를 더하기만 한다.

## 할 일

1. 이슈 `remote-group-sessions-only-project-lophn`: `ListAgents`를 이 컴퓨터 읽기 목록에 더하고 popover가 그 workspace의 모든 agent의 session을 보인다. 기계 route의 위험 test에 줄을 더한다.
2. 이슈 `emulation-lost-on-devtools-open`의 남은 부분: main이 emulation이 풀린 것을 renderer에 알리고 preview 탭이 폰 틀과 기기 이름을 내린다.
3. 이슈 `forked-harness-session-loses-history`: `fix`의 "한 것" 줄이 적은 계약 넷을 고친다. fork를 지원하는 harness만, `through_seq`가 원본의 마지막 메시지일 때만 넘긴다.
4. 이슈 `cut-off-notice-scans-all-turns`의 남은 부분: `turnList`에 최신 순과 `limit`을 더해 첫 turn의 훑기도 끝의 몇 개만 읽는다.
5. 이슈 `sync-rewind-reply-capped`의 남은 부분: rewind의 답을 잃으면 취소가 아니라 결과 모름으로 남긴다. `app_rewinds`의 새 상태는 새 schema step으로 하고(AGENTS.md "호환성") 등록은 "등록할 것"에 적는다.

알아 둘 것:
- 항목들은 서로 기대지 않는다. 하나가 막히면 나머지를 끝내고 보고한다.
- `packages/shell/main/terminal/gui.ts`와 harness-gui adapter는 `sweep-coding-bodies`의 것이다.

## 끝남

- `npm run check:full`이 통과한다.
- 위험 test: "다른 기계의 창이 이 컴퓨터 읽기로 부를 수 있는 route는 목록에 있는 것뿐이다"(있는 위험 test에 줄 더하기), "rewind의 답을 잃으면 결과 모름으로 남는다"
- 항목마다 했는지, 못 했으면 왜인지가 보고에 있다.

## 보고

- 항목마다: 고침 / 일부 / 못 함(이유), 지금 코드가 어떻게 하나 한두 문장, 지키는 test 이름(없으면 없음)
- 바꾼 file, 통과한 check
- 등록할 것, 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것(실제 폰이나 Electron에서 못 본 것 포함). 없으면 "없음"

# sweep-coding-bodies

coding session의 대화를 가볍게 보내고(tool 본문을 펼칠 때 받기) 폰에서 이미지를 붙이고 다시 연 대화의 그림을 되살린다.

- 단위: coding-bodies (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/`
  - `packages/protocol/acp/`
  - `packages/protocol/extensions/acp-session.ts`
  - `packages/protocol/events/acp-project.ts`
  - `packages/core/coding-relay/`
  - `packages/shell/main/terminal/{coding-relay.ts,coding-relay_test.ts,gui.ts,gui_test.ts}`
  - `packages/shell/main/desktop/wiring/coding-relay.ts`
  - `packages/shell/renderer/conversation/`
  - `packages/mobile/src/screens/session/{conversation,thread,sheets,attach,ask,parts}.tsx`
  - `packages/mobile/src/data/{attach.ts,hooks.tsx}`
- 읽을 것:
  - 고칠 이슈마다 `project-docs/issues/<id>.yaml`의 `now`·`fix`·`decided`(`fix`의 "한 것" 줄이 wave 1이 이미 한 부분이다)와 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`
  - 화면을 바꾸면 `.claude/skills/ui-design/SKILL.md`(wireframe을 먼저 고친다)
- 계약:
  - 이 task는 아래 소유에 든 protocol, IPC, preload를 고쳐도 된다(wave 1이 계약 밖이라 못 한 일이다). 소유 밖의 계약은 고치지 않고 보고에 적는다.
  - i18n catalog(`packages/design/i18n/catalog/`)에는 key를 더하기만 한다.

## 할 일

1. 이슈 `remote-reply-over-frame-limit-is-dropped`의 (2): coding session(harness GUI)의 tool item이 입력·출력 본문을 snapshot과 update에 싣지 않고, 사람이 tool 줄을 펼칠 때 그 하나만 읽는다. lophn agent session이 쓰는 꼴(`body: null`과 본문 read)을 따른다. desktop의 harness GUI 탭, 폰의 coding 대화 둘 다 그 길로 읽는다. 먼저 긴 대화 fixture로 snapshot 크기가 얼마나 줄어드는지 재서 보고에 적는다.
2. 이슈 `phone-coding-session-takes-no-pictures`: 폰이 coding session에 그림을 붙여 보낸다. shell main이 그림을 그 탭의 임시 폴더에 쓰고 `file://` resource_link로 adapter에 넘긴다.
3. 이슈 `claude-gui-resume-drops-images`의 남은 부분: `AcpTerminal`에 그림 쓰기를 열어(`writeImage`) Claude와 omp의 replay가 그림을 임시 폴더에 쓰고 resource_link로 싣는다.
4. 할 수 있으면: 이슈 `claude-agent-row-emitted-late`, `claude-bang-output-shown-at-end`(둘 다 ACP tool item 갱신을 더하는 일이다). 위 셋을 끝낸 뒤에 하고, 못 하면 이유를 보고한다.

알아 둘 것:
- 실제 CLI를 부르는 녹화는 하지 않는다. `.claude/skills/harness-gui/SKILL.md`를 먼저 읽는다.
- 본문 read가 폰까지 가려면 route가 remote 허용 목록(`packages/protocol/remote/allowlist.ts`)과 core 조립 목록에 있어야 한다. 그 두 곳은 줄을 더하기만 하고 "등록할 것"에도 적는다.
- 본문을 가릴 때 지금의 redaction(lophn session이 본문을 null로 두는 이유, `acp-build_test.ts`)을 깨지 않는다.
- `packages/mobile/src/screens/{coding,terminal}/`과 `new-session.tsx`는 `sweep-phone-terminal-remote`의 것이다.

## 끝남

- `npm run check:full`이 통과한다.
- 폰 앱을 고쳤으므로 `cd packages/mobile && npm ci && npm run typecheck && npm test`도 통과한다(root check 밖이다).
- 위험 test: "coding session의 snapshot에는 tool 본문이 없고 본문 read가 그 tool의 것만 준다", "폰이 보낸 그림이 그 탭의 임시 폴더 밖에 쓰이지 않는다"
- 항목마다 했는지, 못 했으면 왜인지가 보고에 있다.

## 보고

- 항목마다: 고침 / 일부 / 못 함(이유), 지금 코드가 어떻게 하나 한두 문장, 지키는 test 이름(없으면 없음)
- 바꾼 file, 통과한 check
- 등록할 것, 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것(실제 폰이나 Electron에서 못 본 것 포함). 없으면 "없음"

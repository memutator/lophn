# sweep-phone-terminal-remote

폰에서 터미널 화면만으로 컴퓨터의 터미널과 TUI coding session을 remote로 쓰게 한다.

- 단위: phone-terminal-remote (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/mobile/src/screens/{coding,terminal}/`
  - `packages/mobile/src/screens/session/new-session.tsx`
  - `packages/mobile/src/data/{terminal.ts,terminal.test.ts,coding.ts,coding.test.ts}`
  - `packages/core/remote/{devices.ts,devices_test.ts,pairing.ts}`
  - `packages/shell/renderer/desktop/settings/remote/`
  - `tools/wireframes/drafts/phone/{coding,terminal}.tsx`
  - `tools/wireframes/pages/screens/`
- 읽을 것:
  - 고칠 이슈마다 `project-docs/issues/<id>.yaml`의 `now`·`fix`·`decided`(`fix`의 "한 것" 줄이 wave 1이 이미 한 부분이다)와 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`
  - 화면을 바꾸면 `.claude/skills/ui-design/SKILL.md`(wireframe을 먼저 고친다)
- 계약:
  - 이 task는 아래 소유에 든 protocol, IPC, preload를 고쳐도 된다(wave 1이 계약 밖이라 못 한 일이다). 소유 밖의 계약은 고치지 않고 보고에 적는다.
  - i18n catalog(`packages/design/i18n/catalog/`)에는 key를 더하기만 한다.

## 할 일

1. 이슈 `phone-tui-session-not-usable-from-terminal-screen`: 터미널로 도는 coding session을 열면 안내 화면(`screens/coding/terminal.tsx`의 `TerminalSession`) 대신 터미널 화면이 바로 열린다. `Switch to chat`은 그 화면의 menu로 옮긴다(바꾸기 전 확인 sheet는 그대로).
2. 같은 이슈: 새 session 화면의 agent sheet에서 coding agent 묶음 아래에 Terminal 항목을 놓는다. 고르면 `data/terminal.ts`의 `openTerminal`로 그 project에 터미널 탭을 열고 터미널 화면으로 간다(project가 골라져 있을 때만 선다).
3. 같은 이슈의 `decided`: 터미널 입력 허락(`devices.terminal_input`)은 pairing할 때 기본 켬이고 컴퓨터의 pairing 화면(Settings › Remote)에서 끌 수 있다. 이미 pairing한 기기의 값은 바꾸지 않는다(migration 없음). Settings의 기기별 switch는 그대로 둔다.
4. `screens/coding/parts.tsx`의 `stateOf`: 도는 coding session의 점을 `working` tone으로 한다(초록은 이제 "끝났고 안 봄"이다. `packages/shell/renderer/parts/agent-session/activity.ts`의 규칙).
5. `tools/wireframes/drafts/phone/coding.tsx`의 낡은 shot(Term, Screen, Fit, KEYS: Fit width와 100%, agent 이름이 먼저인 머리 줄)을 지우고 `terminal.tsx`의 flow로 가리킨다.

알아 둘 것:
- wave 1이 만든 것: `terminal_view/resize`·`terminal_view/open`, 폰의 `openTerminal(client, project, key?)`, 터미널 place의 session이 `term:<trm>`이면 coding session이 아닌 터미널이다.
- pairing할 때의 값이 어디서 정해지는지는 `packages/core/remote/`의 기기 등록(`devices.register`)과 pairing code를 만드는 곳을 읽고 정한다. 소유 밖 file(protocol의 pairing frame, wiring)을 고쳐야 하면 최소로 고치고 "넘길 줄"에 적는다.
- `screens/session/conversation.tsx`는 `sweep-coding-bodies`의 것이다. TUI session을 터미널 화면으로 보내는 것은 `TerminalSession` 쪽에서 한다.
- emulator 없이 type 검사와 unit test로만 확인한다.

## 끝남

- `npm run check:full`이 통과한다.
- 폰 앱을 고쳤으므로 `cd packages/mobile && npm ci && npm run typecheck && npm test`도 통과한다(root check 밖이다).
- 위험 test: "pairing으로 등록한 기기는 터미널 입력이 켜져 있고, pairing 때 끄면 꺼져 있다"(권한 경계)
- 항목마다 했는지, 못 했으면 왜인지가 보고에 있다.

## 보고

- 항목마다: 고침 / 일부 / 못 함(이유), 지금 코드가 어떻게 하나 한두 문장, 지키는 test 이름(없으면 없음)
- 바꾼 file, 통과한 check
- 등록할 것, 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것(실제 폰이나 Electron에서 못 본 것 포함). 없으면 "없음"

# mobile-terminal-core

폰이 coding session의 raw 터미널 화면을 보는 core 쪽을 짓는다: `terminal_view/{snapshot,watch,input}` route, 화면이 바뀌었다는 `TerminalScreenChanged` event, 보고 있는 폰이 있을 때만 shell에 화면을 밀어 올리게 하는 lease, 입력을 허락받은 principal에게만 여는 문. 허락 장치(기기마다의 스위치)는 `mobile-terminal-device-grant`가 짓는다. 이 task는 허락이 없으면 입력을 거절하는 기본값만 둔다.

- 단위: terminal-view (wave 3)
- 선행: mobile-coding-state, mobile-host-link
- 소유(이 task만 고친다):
  - `packages/core/terminal-view`(새 폴더 전체: `mod.ts`, `view.ts`와 `*_test.ts`)
  - `packages/core/main/daemon/wiring/terminal-view.ts`(새 file)와 `terminal-view_test.ts`(새 file)
  - `packages/protocol/coding-agent/terminal-view.ts`(새 file)
- 한 줄씩 허락(공유 file. 한 줄만 더하고 "넘길 줄"에 적는다): `packages/protocol/events/transient.ts`(event 정의 하나와 목록 한 줄. 다른 계획 `mobile-push`가 같은 file에 줄을 더한다), `packages/protocol/coding-agent/registry.ts`·`mod.ts`(route 배열과 내보내기), `packages/core/main/daemon/wiring/context.ts`(칸 둘: `terminalView`, 늦게 채우는 `terminalInputGrant`), `packages/core/main/daemon/assembly.ts`(import와 `WIRINGS`에서 `codingRelayWiring` 바로 뒤 한 줄. 맨 뒤 wiring은 `remoteWiring`이 그대로여야 한다), `project-docs/module-catalog.yaml`(`packages/core/terminal-view` 항목), `project-docs/flows/`의 area file와 `tests/*.yaml` 줄
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/coding-agent-relay-survey.md`의 1.5, 2(설계 7), 3(Raw terminal), 5(6번 위험), 6(1번). 이 brief와 README의 "정한 것"이 survey와 다르면 그쪽이 맞다(보는 것은 coding session의 터미널뿐, 화면 갱신은 event에 내용 없이 seq만, 입력은 허락한 기기만)
  - architecture: `project-docs/architecture/remote.md`("지키는 것": 폰 자격의 route 목록과 principal), `event.md`(남지 않는 event)
  - 이 계획이 먼저 낸 것: `packages/protocol/host-link/frames.ts`(`terminal_screen`, `terminalLineSchema`, 요청 `terminal_stream`·`terminal_input`), queue의 `callCoding`과 `ctx.hostLink.onFrame`(`mobile-host-link` 보고), `ctx.codingRelay.terminalKnown`·`onChange`(`mobile-coding-state` 보고)
  - 본보기: `packages/protocol/events/transient.ts`(`defineTransientEvent`, 목록), `packages/core/main/daemon/wiring/session-lifecycle.ts`(wiring 모양), `packages/core/main/daemon/wiring/context.ts`의 `Late`와 `ctx.provide`(`noticeRecorder`와 `wiring/notices.ts`가 본보기)
- 계약:
  - 쓰는 것: `terminal_screen` frame, `terminal_stream`·`terminal_input` 요청
  - 내놓는 것(`mobile-terminal-phone`이 기댄다. 모두 actor `user`, memory·read 기반, ledger 없음. 오류 code는 `invalid_input|forbidden|unauthorized|not_found|conflict|unavailable`만):
    - `terminal_view/snapshot` read `{terminal: string}` -> `{terminal, generation: int, seq: int, columns: int, rows: int, cursor: {x, y, hidden}, scrollback: TerminalLine[], lines: TerminalLine[], input: boolean}`. `input`은 부른 principal이 이 터미널에 칠 수 있는가(`terminalInputGrant`의 결과)라서 폰이 입력 칸을 그릴지 정한다. 터미널이 coding session 목록에 없으면 `not_found`(`ctx.codingRelay.terminalKnown`). 아직 화면이 오지 않았으면(watch 직후) `unavailable`
    - `terminal_view/watch` memory `{terminal: string, on: boolean, tail?: int 0~500(기본 100)}` -> `{}`. lease: principal과 터미널마다 하나, 30초이고 같은 호출을 다시 하면 갱신된다(폰이 10초마다). 터미널마다 lease가 하나라도 있으면 core가 host에 `terminal_stream {on: true, tail: lease들의 tail 최대}`를 보내고, 마지막 lease가 끝나거나 `on: false`면 `on: false`를 보낸다. 연결이 닫히면 lease는 다시 연결될 때 다시 켠다(`onOpen`에서 살아 있는 lease마다 `terminal_stream`을 다시 보낸다)
    - `terminal_view/input` memory `{terminal: string, text: string 1~8192, key: string}` -> `{}`. `ctx.terminalInputGrant(principal)`이 true를 돌려준 principal만 부를 수 있다(없거나 false면 `forbidden`). 터미널이 목록에 없으면 `not_found`. 같은 `key`는 터미널마다 200개 기억해 다시 보내면 host에 가지 않고 성공이다. 성공은 host의 `terminal_input` 답이 content `ok`일 때다(연결이 없으면 `unavailable`)
    - event `TerminalScreenChanged`(남지 않는 event. `<Entity><과거형 동사>`): subject `terminal:<terminal_ref>`, payload `{terminal: string, seq: int}`. 화면 내용은 싣지 않는다(폰이 `snapshot`을 다시 읽는다). 폰 allowlist에 더하는 것은 `mobile-terminal-phone`이다
    - `terminal_screen` frame이 오면 lease가 있는 터미널의 최신 화면을 메모리에 두고(옛 것을 대신한다) event를 낸다. lease가 없는 터미널의 frame은 버린다. 터미널이 목록에서 빠지거나(`codingRelay.onChange`) 연결이 닫히고 유예가 지나면 화면과 lease를 지운다

## 할 일

1. `protocol/coding-agent/terminal-view.ts`에 route 셋을 쓴다(`TerminalLine`은 `protocol/host-link`의 `terminalLineSchema`를 import한다). registry·mod에 한 줄씩. `transient.ts`에 event.
2. `core/terminal-view`: 화면 표, lease 표(시계는 `Clock`을 받는다), 입력의 `key` 기억(200개), host로 가는 요청을 하는 port(`callCoding`). 전역 mutable 상태를 두지 않는다.
3. `wiring/terminal-view.ts`: route handler와 `ctx.hostLink.onFrame("terminal_screen")`, `ctx.codingRelay.onChange`, lease 만료 timer를 잇는다. 허락 port는 늦게 채우는 칸(`terminalInputGrant`)이고 채워지지 않았으면 입력은 늘 `forbidden`이다. 칸을 채우는 것은 `mobile-terminal-device-grant`다.
4. 개발에서 한 번 본다: `tools/fake-coding-host.ts`는 터미널 화면을 올리지 못한다(`mobile-terminal-shell`이 더한다). 이 task의 test에서 가짜 `hostLink`로 본다.
5. flows catalog와 test.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "`terminal_view/input`은 허락 port가 true를 돌려준 principal만 호스트로 보내고 나머지는 `forbidden`이며, 터미널이 coding session 목록에 없으면 보기도 입력도 `not_found`다"
- 남지 않음: 없음
- subprocess, 서버를 띄우는 test는 새로 만들지 않는다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: route 입력·출력 예, lease 규칙과 기한 상수, `terminalInputGrant` 칸의 정확한 type(`mobile-terminal-device-grant`가 채운다), 등록할 것(registry, `transient.ts`의 목록, 폰 allowlist 줄은 `mobile-terminal-phone`이 더한다), lead가 flows와 `remote.md`·`terminal-agent.md`에서 고칠 것.

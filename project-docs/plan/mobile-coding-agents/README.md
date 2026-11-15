# mobile-coding-agents: 컴퓨터의 coding agent를 폰에서 다루고, 터미널을 폰에서 본다

- 목표: desktop에서 도는 Claude Code, Codex, OpenCode, omp의 harness GUI 대화를 폰이 lophn agent와 같은 대화 화면과 승인·질문 card로 보고 말하고 답하게 한다(roadmap 단계 5). 이를 위해 shell main과 core 사이의 연결을 한쪽 long-poll(`host/take`)에서 양방향 연결(`/host-link`)로 바꾸고, shell main이 GUI 상태를 core에 올려 core가 메모리 사본으로 기존 ACP 길(`acp/snapshot`, `acp/send`, `AcpUpdated`)을 그대로 낸다. 마지막 wave에서 폰이 coding session을 새로 열고 잠든 desktop 앱을 깨운다. 그 연결 위에 raw 터미널 보기와 허락받은 기기의 입력을 더한다(단계 9).
- 재료: `project-docs/products/roadmap/mobile.md`(단계 5, 9, 사람이 정할 것 6), 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/coding-agent-relay-survey.md`, `project-docs/architecture/{harness-gui,acp,remote,terminal-agent,coding-agent,platform}.md`, `project-docs/boundary-catalog.yaml`의 `host-queue-interface`, wireframe `tools/wireframes/drafts/phone/session.tsx`의 `Coding`(그림 `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/4-session.png`), 같이 도는 계획 `phone-app`(폰 앱을 native로 다시 짓는다)과 `mobile-push`.
- 범위 밖: 터미널의 resize(폰은 PTY 크기를 바꾸지 않는다), WebView terminal(xterm.js), 모든 터미널 탭 목록(보는 것은 coding session의 터미널뿐), 폰에서 이미지 붙이기와 rewind 미리보기, headless harness agent(`coding_*` agent, `claude -p`)의 승인 card, 터미널 PTY를 core로 옮기기, iOS, GUI를 띄우지 못하는 Windows의 switch.
- 단위: `host-link`(shell main과 core의 양방향 연결), `coding-relay`(coding session 중계), `terminal-view`(raw 터미널), `coding-phone`(폰 화면과 data). 소유 path는 brief가 정한다.
- 순서:
  - wave 1: `mobile-host-link`(frame schema, core의 `/host-link`, queue를 연결 위로)와 `mobile-coding-wireframes`(새 폰 화면의 wireframe). 지금 띄운다.
  - wave 2: `mobile-coding-state`(core의 사본과 route)와 `mobile-host-link-shell`(shell main을 연결로 옮긴다). 둘 다 frame schema에 기대어 wave 1 뒤다. 지금 띄운다.
  - wave 3: `mobile-coding-shell`(handle을 올리고, 입력과 switch를 받는다), `mobile-terminal-core`, `mobile-terminal-shell`. 지금 띄운다.
  - wave 4: `mobile-coding-open-host`(core·shell의 열기와 깨우기). `wiring/coding.ts`를 `mobile-terminal-shell` 뒤에 고치므로 wave 4다. `phone-app`과 상관없어 지금 띄운다.
  - wave 5~8은 `phone-app`이 main에 올라간 뒤에 띄운다(`packages/core/remote/**`, 폰 allowlist, `packages/mobile/**`를 고친다): wave 5 `mobile-coding-phone-data`, `mobile-terminal-device-grant`, `mobile-host-link-cleanup`(옛 route를 지우면 `core/remote/host_test.ts`가 깨져 그 file을 고쳐야 해서 여기다). wave 6 `mobile-coding-phone-screens`. wave 7 `mobile-terminal-phone`. wave 8 `mobile-coding-open-phone`.
  - land는 계획 끝에 한 번.

## 정한 것

- shell main과 core에 양방향 연결(`/host-link`, WebSocket)을 두고 `host/take`, `host/done`, `host/report`, `terminal_sessions/report`를 대신한다. 먼저 한다. 이유: GUI 상태(snapshot)는 route body 한도(256 KiB, 4096 item)에 안 들어가 HTTP로 올릴 수 없고, 폰을 두 번째 host로 만들 때도 같은 frame을 쓴다. 옛 route는 아무도 안 쓰게 된 뒤(`mobile-host-link-cleanup`)에 같은 계획 안에서 지우고 호환 길을 남기지 않는다. 그 사이에 쓰는 임시 이중 길은 wave 1~4에 있다.
- coding session은 shell main이 소유한다(handle, adapter, CLI). core는 올라온 ACP 상태를 메모리에 접어 두고 기존 `acp/snapshot`, `acp/send`, `AcpUpdated`를 바꾸지 않고 낸다. 이유: 폰이 lophn agent와 같은 대화 화면과 card를 쓰고, snapshot과 event의 순서가 core 한 곳에서 정해진다. session id는 desktop과 같은 `ses_<터미널 탭 ULID>`이고 ledger에는 행이 없다(harness-gui의 non-goal 유지).
- 터미널 TUI로 도는 session은 사람이 폰에서 확인한 뒤에만 GUI session이 된다. 확인 문구는 "도는 turn이 끊기고 desktop 탭도 chat 화면으로 바뀐다"를 말한다. route는 `confirmed: true`가 없으면 거절한다(`invalid_input`). 이유: 되돌릴 수 없는 중단이고 desktop 화면이 바뀌는 일이라 조용히 하지 않는다.
- coding session을 폰에서 새로 열고 되살리는 것과 desktop 앱 깨우기는 viewing·answering이 된 뒤의 wave(4와 8)에 둔다. 앱을 깨워도 PTY는 앱과 함께 죽어 있으므로 깨우기만으로는 목록이 비어 있고 열기와 함께일 때만 쓸모 있다. 깨우기는 폰의 명시적 단추(Start lophn on the computer)로만 한다. 되살리기는 ledger에 있는 coding session(`tabs/open`의 `tui` target이 쓰는 CLI session id)에 한한다(agent가 정함. CLI 자신의 지난 session 목록은 adapter마다 달라 이 계획에서 열지 않는다).
- headless coding agent(`agents/list`의 `coding_*`, `claude -p`)는 폰의 새 session 목록에 두지 않는다. 승인 card가 없고(모르는 것은 CLI가 거절) 앱이 떠 있을 때만 돈다. `phone-app`의 `phone-session`이 이미 목록에서 빼고 읽기만 보인다. 이 계획은 그것을 바꾸지 않는다.
- raw 터미널(단계 9)은 기본이 보기만이다. 폰에서 터미널에 치는 것은 원격 shell이라 기기마다 컴퓨터의 Settings › Remote 스위치를 사람이 켰을 때만 되고 기본은 꺼짐이다(`mobile-terminal-device-grant`). 폰은 PTY 크기를 바꾸지 않는다. 이유: 폰 하나가 desktop 창의 크기와 입력 focus를 흔들면 안 된다.
- 폰의 터미널 화면은 먼저 React Native의 styled text row로 그린다. WebView terminal은 그 길이 못 쓸 때만 더한다(`mobile-terminal-phone` 보고에 근거를 남긴다). 이유: native module 없이 되고 새 dev build가 필요 없다.
- 보는 터미널은 coding session의 터미널(`coding_sessions/list`에 나오는 것)뿐이다(agent가 정함). 모든 터미널 탭을 core에 알리는 새 보고를 만들지 않으려는 것이다.
- 화면 갱신은 터미널 화면 전체를 core에 두고, 바뀐 것은 `TerminalScreenChanged{terminal, seq}`만 알린다. 폰이 `terminal_view/snapshot`을 다시 읽는다. 최신 화면이 옛 화면을 대신하므로 느린 폰은 건너뛰고 replay와 backpressure queue가 없다(agent가 정함. survey의 row diff보다 단순). event 이름은 `<Entity><과거형 동사>` 규칙에 맞춰 survey의 `TerminalScreen`을 `TerminalScreenChanged`로 했다.
- `mobile-push`와 겹치는 곳: 양방향 연결이 먼저다. `mobile-push`의 `mobile-attention-desktop`(shell main의 `wiring/agent.ts`, `tracker.ts`)과 이 계획의 `mobile-coding-shell`(`wiring/agent.ts`의 터미널 보고를 연결로 옮긴다)은 같은 file을 고친다. `mobile-coding-shell`이 먼저 merge되고, `mobile-attention-desktop`이 그 결과 위에서 `terminal_sessions/signal`을 보낸다(`signal`은 작은 HTTP route로 그대로 둔다. `mobile-host-link-cleanup`은 `report`만 지운다). `status.py ready`가 소유가 겹치는 running task를 계획 사이에서도 막으므로, 둘 중 하나가 도는 동안 다른 하나를 띄우지 않는다. `packages/protocol/events/changes.ts`, `transient.ts`, `wiring/context.ts`, `assembly.ts`, `protocol/mod.ts`와 `devices` schema step(`DEVICES_SCHEMA_STEPS`와 `schema-steps.lock.json` 끝)은 두 계획이 한 줄씩 더하는 공유 줄이라 brief가 줄 하나씩만 허락하고, lead가 두 쪽을 다 남기며 합친다.
- worker는 `sonnet-high`로 띄운다(planner).

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `mobile-host-link` | host-link frame schema, core의 `/host-link` endpoint, queue가 연결 위로 요청을 보내고 `coding_*`·`terminal_*` 요청 종류를 받는다(옛 route는 남긴다) |
| 1 | `mobile-coding-wireframes` | 폰의 coding session 목록·switch sheet·깨우기·터미널 화면 wireframe(사람이 승인한 뒤에 화면 task를 띄운다) |
| 2 | `mobile-coding-state` | core의 relay 사본(접기, redaction, dedupe, 끊김 처리)과 `coding_sessions/{list,switch_plan,switch}`, `acp/snapshot`·`acp/send` 분기, fake host 도구 |
| 2 | `mobile-host-link-shell` | shell main이 `/host-link`로 붙어 기존 surface loop를 frame 위에서 돌린다 |
| 3 | `mobile-coding-shell` | shell main이 GUI handle 상태를 올리고 `coding_input`·`coding_switch`를 받고 보고를 연결로 보낸다 |
| 3 | `mobile-terminal-core` | `terminal_view/{snapshot,watch,input}` route, `TerminalScreenChanged` event, viewer lease |
| 3 | `mobile-terminal-shell` | terminal-host의 화면 dump, 보는 동안만 제한해 밀어 올리기, 입력을 main의 입력 길로 |
| 4 | `mobile-coding-open-host` | `coding_sessions/{open,wake}`와 shell의 `coding_open`(새 coding session 열기, 저장된 session 되살리기) |
| 5 | `mobile-coding-phone-data` | 폰 data(`useCodingSessions`, coding 대화 source, switch)와 allowlist 줄 |
| 5 | `mobile-terminal-device-grant` | 기기마다 터미널 입력 허락(ledger 칸, route, Settings › Remote 스위치) |
| 5 | `mobile-host-link-cleanup` | `host/take`·`done`·`report`와 `terminal_sessions/report`와 queue의 임시 이중 길을 지운다 |
| 6 | `mobile-coding-phone-screens` | 대화의 coding session, project workspace의 coding 목록, switch sheet |
| 7 | `mobile-terminal-phone` | 터미널 화면(styled row, key bar, 스크롤), allowlist 줄 |
| 8 | `mobile-coding-open-phone` | 폰의 새 coding session과 되살리기와 깨우기 단추 |

## 돌리기 전에

- wave 1~4는 `phone-app`과 path가 겹치지 않아 지금 띄워도 된다(`mobile-host-link-cleanup`은 `core/remote/host_test.ts` 때문에 wave 5다). `phone-app` 쪽이 건드리는 `packages/protocol/remote/allowlist.ts`, `packages/core/remote/**`, `packages/mobile/**`, `packages/design/native/**`, `tools/remote-dev.ts`는 wave 5 전에는 이 계획이 열지 않는다(wave 4까지). wave 5 전에 lead가 한다: (1) `phone-app`이 main에 올라가 `packages/mobile`이 있는지 확인한다. (2) `packages/design/i18n/catalog/mobile-coding.ts`를 빈 file로 만들어 `packages/design/i18n/en.ts`에 올린다. (3) 폰 task brief의 "소유"에 있는 `packages/mobile/...` path는 `phone-app` brief에서 예상한 이름이다. land된 실제 path(화면 폴더, `data` 폴더, `nav.ts`)로 고친다.
- `mobile-coding-phone-screens` 전에 사람이 wireframe(`mobile-coding-wireframes`가 낸 gallery Drafts › Phone app의 coding·terminal flow)를 보고 승인한다(roadmap: 화면 설계를 사람이 본 뒤 연다). 승인 전에 wave 6~8을 띄우지 않는다. wave 5의 data task는 화면이 아니라 승인 없이 돈다.
- wave 3까지는 shell을 띄우지 않고 확인한다. core에서는 `tools/fake-coding-host.ts`(`mobile-coding-state`가 짓는다)가 fake shell main으로 `/host-link`에 붙어 canned coding session과 터미널 화면을 올린다. 실제 Electron shell을 띄우는 일은 사람에게 묻는다. 사람의 `~/.lophn`, 실제 relay, 실제 model provider를 쓰지 않는다(개발 core는 `npm run dev:core`).
- emulator: 폰 task만 쓴다. `mobile-coding-phone-screens` port 5590·Metro 8230, `mobile-terminal-phone` port 5592·Metro 8232, `mobile-coding-open-phone` port 5594·Metro 8234(`mobile-push-phone`은 5580·8220). 각 task는 `-read-only -memory 2048 -port <port>`로 띄우고 모든 adb 명령에 `-s emulator-<port>`를 붙이고 끝나면 `adb -s emulator-<port> emu kill`로 끈다. 사람의 실제 폰(serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다. 폰 build는 `phone-app`의 lead가 지어 둔 dev build를 쓴다(이 계획은 native module을 더하지 않는다).
- `flows` catalog: route·event·test file을 더하고 지우는 task는 같은 변경에서 `project-docs/flows/`를 고친다(`flows` skill, check가 잡는다). 같은 wave의 두 task가 같은 yaml(`tests/shell.yaml` 등)에 줄을 더할 수 있다. 줄 단위이고 lead가 merge에서 합친다.
- `schema-steps.lock.json`과 `devices` ledger step: `mobile-terminal-device-grant`(이 계획)와 `mobile-push-device`(`mobile-push`)가 둘 다 `DEVICES_SCHEMA_STEPS` 끝과 lock 끝에 step을 더한다. 늦게 merge하는 쪽이 앞 쪽 뒤로 붙인다. 이미 낸 step의 SQL은 고치지 않는다.

## 사람이 할 것

- 없음(계정, key, 유료 service가 들지 않는다). 사람이 보는 것: ① `mobile-coding-wireframes`의 wireframe 승인(wave 6 전). ② 폰에서 터미널에 치는 것을 켜는 스위치 문구와 기본 꺼짐(wireframe에서 같이 본다). ③ 실제 Electron desktop을 띄워 폰으로 도는 turn을 하나 끊어 보는 확인(조사의 열린 것: 창을 다 닫은 채 PTY가 사는지, 창 없는 desktop에서 switch한 뒤 탭이 GUI로 보이는지. 이 계획은 shell을 띄우지 않으므로 land 뒤 사람이 한 번 본다).

## lead가 할 일

- merge 때마다: `npm run check`. 폰 task는 `cd packages/mobile && npm run typecheck && npm test`도, emulator 그림(`.dev-data/<id>/shots/`)을 wireframe 그림과 대조한다. 공유 줄(`assembly.ts`, `context.ts`, `protocol/mod.ts`, `protocol/coding-agent/{mod,registry}.ts`, `module-catalog.yaml`, `schema-steps.lock.json`, shell `wiring` 등록, root `package.json`의 `dev:coding-host`)은 task가 보고에 쓴 대로 합친다.
- wave 3 뒤: `npm run dev:core`를 띄워 `node tools/fake-coding-host.ts`가 붙고 `acp/snapshot`이 canned session을 내는지 한 번 본다(`mobile-coding-state` 보고). 안 되면 wave 4를 띄우지 않는다.
- wave 5 뒤: `git grep "host/take\|host/done\|host/report\|terminal_sessions/report" packages tools tests`가 0줄인지 본다.
- 끝에: `architecture/{harness-gui,acp,remote,terminal-agent,coding-agent,platform}.md`(양방향 연결, relay, switch 약속, 터미널 보기와 입력 허락), `boundary-catalog.yaml`의 `host-queue-interface`(host/* 설명을 `/host-link`로)와 `module-catalog.yaml`(`core/coding-relay`, `core/terminal-view`, `protocol/host-link`), `project-docs/flows/`(지운 route와 새 route·test), roadmap `mobile.md` 단계 5와 9와 사람이 정할 것 6, `packages/mobile/README.md`(coding session 개발 길: fake host), change-log `0.23/mobile-coding-agents.yaml`(wave 8까지 갔는지, 실제 desktop 확인은 사람이 한 것인지 적는다). 이어 할 일 하나를 이슈로 올린다: `mobile-push`의 `terminal_sessions/signal`은 tracker가 아는 TUI만 알려 GUI 탭(relay가 올린 ACP 상태)의 승인 대기는 push가 되지 않는다. 두 계획이 land된 뒤 `coding-relay`의 `approval_opened`·`turn_ended`를 같은 attention 길에 한 번 잇는다. `sdk-note`는 SDK를 건드리지 않아 필요 없다.

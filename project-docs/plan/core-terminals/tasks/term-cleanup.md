# term-cleanup

이 계획이 쓰지 않게 만든 옛 계약을 지운다: core와 shell 사이 link의 옛 요청과 frame, 화면이 창을 거쳐 열던 route, `tools/fake-coding-host.ts`. link에는 창이 있어야 하는 것(탭 열기·닫기·보이기, browser)만 남는다. flows, catalog, 남은 옛 이름을 맞춘다.

- 단위: term (wave 5)
- 선행: `term-desktop`, `term-phone`.
- 소유(이 task만 고친다):
  - `packages/protocol/host-link/`, `packages/protocol/lophn-agent/{host-queue,extension-tools}.ts`, `packages/protocol/coding-agent/{relay,terminal-view,terminals}.ts`, `packages/protocol/attention/routes.ts`
  - `packages/core/host-queue/`, `packages/core/server/host-link.ts`, `packages/core/server/host-link_test.ts`, `packages/core/terminal-view/`, `packages/core/terminal-agents/`
  - `packages/core/main/daemon/wiring/{host-queue,host-queue_test,terminal-view,attention,extension-tools,terminal-agents,session-lifecycle}.ts`
  - `packages/shell/main/desktop/core/host-link.ts`, `packages/shell/main/desktop/core/host-link_test.ts`, `packages/shell/main/desktop/wiring/surface.ts`
  - `packages/mobile/src/data/`(protocol을 지워 깨지는 곳만)
  - `tools/fake-coding-host.ts`(지운다), `tools/check-deps.ts`
  - `project-docs/flows/`, `project-docs/module-catalog.yaml`, `project-docs/boundary-catalog.yaml`
- 읽을 것:
  - 계획 README "정한 것"(화면은 route로만: 같은 일을 하는 길을 둘로 두지 않는다)
  - 계약: `project-docs/plan/core-terminals/tasks/term-contract.md` "고정할 모양"의 "link" 목록(지울 것과 남을 것)
  - architecture: `project-docs/architecture/platform.md` "core → host"(요청 종류와 기한), `project-docs/architecture/remote.md`(기기 route 목록), AGENTS.md "호환성"(옛 경로를 남기지 않는다)
  - 조사 `reports/multi-device/survey-s3-shell-work.md` 2.4 표, 1.5, 그룹 H
- 계약:
  - 쓰는 것: 계약의 "link" 목록
  - 내놓는 것: 없음

## 할 일

1. **link 요청.** `packages/protocol/lophn-agent/host-queue.ts`에서 `tool_call`, `terminal_interrupt`, `coding_input`, `coding_switch`, `coding_open`, `coding_body`, `coding_image_write`, `coding_image_read`, `terminal_stream`, `terminal_input`, `terminal_resize`, `terminal_open`의 payload schema와 `hostRequestSchema` 갈래, `LINK_REQUEST_KINDS`·`LinkRequestKind`, host 탭 target `coding`·`tui`(`tabs/open` 입력의 `coding`·`tui`는 남는다)를 지운다. `terminal` target의 `terminal_ref`를 필수로 한다. 남는 요청은 `tab_open`·`tab_close`·`tab_show`·`browser_call`이다.
2. **frame.** `packages/protocol/host-link/frames.ts`에서 `coding_report`·`coding_sync`·`coding_closed`·`terminal_screen`과 `hello`·`visible`의 `tui`를 지운다. 남는 frame은 `hello`·`visible`·`response`·`report`다. `HOST_LINK_SUBPROTOCOL`은 그대로 둔다(판 이름을 새로 만들지 않는다. 양쪽을 같은 변경에서 고친다).
3. **core queue와 서버.** `packages/core/host-queue/queue.ts`의 `callTool`·`callTerminalInterrupt`·`callCoding`과 link-only 기한(`LINK_CALL_MS`), 그 test 경우를 지운다. `packages/core/server/host-link.ts`가 지운 frame을 읽던 곳을 지운다. core wiring에 남은 쓰는 곳(`wiring/host-queue.ts`, `session-lifecycle.ts`)을 걷는다. `startShell`과 browser 탭 길은 남긴다(`core-browser` 계획의 것이다).
4. **route.** `coding_sessions/wake`(와 `wiring/host-queue.ts`에서 그것만 쓰던 shell 띄우기 갈래), `coding_sessions/list`의 `shell` 칸, `terminal_view/open`·`terminal_view/input`(core `terminal-view`의 `open`·`input`과 handler), `extension_tools/publish`(`wiring/extension-tools.ts`의 handler), `terminal_sessions/signal`(`wiring/attention.ts`의 handler)을 지운다. 폰이 그대로 쓰는 `terminal_view/snapshot|watch|resize`와 `TerminalScreenChanged`, `coding_sessions/list|switch_plan|switch|open`은 남긴다.
5. **shell.** `packages/shell/main/desktop/core/host-link.ts`가 `tui` 없이 `hello`·`visible`을 보내게 하고 지운 kind의 handler를 걷는다. `wiring/surface.ts`에 남은 지운 kind 처리를 걷는다.
6. **도구.** `tools/fake-coding-host.ts`를 지운다(core가 터미널과 coding session을 직접 가져 shell을 흉내 낼 일이 없다). 그것을 가리키는 문서·script를 grep해 고친다. `tools/check-deps.ts`에 이 계획이 남긴 예외(`PROTOCOL_CYCLE_EXCEPTIONS`의 이 계획 줄, 옛 shell 자리)가 쓸모없으면 뺀다.
7. **폰.** protocol을 지워 `packages/mobile`이 깨지면 `src/data/`의 그 줄만 고친다(`term-phone`이 쓰는 곳은 이미 걷었다).
8. **flows와 catalog.** 지운 route·frame·test 경우를 flows에서 고친다(`flows` skill, `node tools/flows.ts check`). boundary catalog의 host-link interface 설명(남는 frame과 요청만)과 remote-protocol 설명(기기 route에서 `terminal_view/open|input`, `coding_sessions/wake`가 빠지고 `terminals/open|input`이 든다), module catalog의 `packages/core/host-queue`·`packages/core/terminal-view` notes를 지금 모양으로 고친다.
9. **남은 옛 이름.** core와 protocol의 주석·오류 글에서 터미널·coding session·extension을 "shell main(host)이 갖는다"고 하는 줄을 grep해 고친다(focus 검사, 알림 띄우기, clipboard처럼 shell에 남은 것은 그대로).

## 끝남

- `npm run check`가 통과한다. `node tools/flows.ts check`가 통과한다. `cd packages/mobile && npm ci && npm run typecheck && npm test`가 통과한다. `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 찍는다.
- 위험 test: 없음(지우기만 한다). 지우는 test 경우가 지키던 권한 검사(host-link의 actor `user`만, 기기 route 목록)는 남은 test에 그대로 있다.
- 남지 않음: `grep -rnE "kind: \"(tool_call|terminal_interrupt|coding_input|coding_switch|coding_open|coding_body|coding_image_write|coding_image_read|terminal_stream|terminal_input|terminal_resize|terminal_open)\"|\"(coding_report|coding_sync|coding_closed|terminal_screen)\"|LINK_REQUEST_KINDS|callCoding|hostQueue\.callTool|callTerminalInterrupt|codingSessionsWake|terminalViewOpen|terminalViewInput|extensionToolsPublish|terminalSessionsSignal|fake-coding-host" packages tools tests project-docs/flows`가 0줄이다. 같은 낱말의 다른 칸(기기의 `terminal_input` 허락, approval의 `tool_call` id)이 잡히면 하나씩 보고 남긴다.
- 새 E2E와 subprocess·서버를 띄우는 test는 만들지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 이 task는 적어도 `packages/protocol/registry.ts`·`mod.ts`에서 뺄 route·export와 기기 route 목록 `packages/protocol/remote/allowlist.ts`에서 뺄 줄(`terminal_view/open`, `terminal_view/input`, `coding_sessions/wake`)과 고칠 주석을 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

## lead가 더함

- `term-desktop`·`term-phone`이 merge되어 shell과 폰은 옛 link 요청·frame·route를 쓰지 않는다. `term-desktop`이 남긴 것: `ipc/surface.ts`의 `tui` report 갈래(renderer가 보내지 않는다), 쓰지 않는 `extension-settings` intent(`ipc/shortcuts.ts`, `renderer/desktop/intents.tsx`), wiring `core.ts`·`context.ts`의 `relay.frames`. `coding-core`가 남긴 것: `HostLink.onFrame`·`RelayedFrameType`, `lifecycle.sweep()`과 `shellAttached` dep. 이것들도 지운다. 추가 소유: 그 file의 그 줄만.
- 낡은 주석과 글: `packages/core/terminal-agents/open.ts` 머리 주석, `packages/protocol/remote/allowlist.ts` 머리 주석(입력이 `terminal_view/input`로 간다는 글. 줄 목록은 lead가 고친다), `packages/protocol/remote/routes.ts`의 `deviceSchema.terminal_input` 주석(추가 소유: 주석만). architecture 문서는 lead가 고친다.
- `project-docs/flows/tests/core-rest.yaml`은 다른 계획(`core-setup`)도 고친다. 이 task가 지운 test file의 줄만 고친다.
- 기기 route 목록(`packages/protocol/remote/allowlist.ts`)의 줄과 `packages/protocol/registry.ts`·`mod.ts`의 줄은 지워야 check가 통과하면 이 task가 지운다(추가 소유: 그 줄만). 지운 것을 보고에 적는다.

# mobile-coding-open-host

폰이 coding session을 컴퓨터에서 새로 열고(`coding_sessions/open`), ledger에 있는 coding session을 되살리고, 앱이 꺼져 있으면 깨우는(`coding_sessions/wake`) core·shell 쪽을 짓는다. 연 session은 GUI(채팅) view로 나타나 기존 relay 길로 폰에 보인다. 폰 화면은 `mobile-coding-open-phone`이 한다.

- 단위: coding-relay (wave 4)
- 선행: mobile-coding-shell, mobile-terminal-shell
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/relay.ts`(route 둘을 더하는 만큼만)
  - `packages/core/coding-relay/open.ts`(새 file)와 `open_test.ts`(새 file)
  - `packages/core/coding-relay/mod.ts`와 `relay.ts`(필요한 만큼만)
  - `packages/core/main/daemon/wiring/coding-relay.ts`와 `coding-relay_test.ts`
  - `packages/shell/main/terminal/coding-open.ts`(새 file)와 `coding-open_test.ts`(새 file)
  - `packages/shell/main/desktop/wiring/coding-relay.ts`(`coding_open` 처리기를 다는 만큼만)
  - `packages/shell/main/desktop/wiring/surface.ts`(창 요청 길에 안쪽에서 요청을 넣는 입구 하나를 내주는 만큼만)
  - `packages/shell/main/desktop/wiring/coding.ts`(위 입구를 위해 내줄 것이 있을 때 그만큼만)
  - `tools/fake-coding-host.ts`(`coding_open`에 canned 답을 하는 갈래를 더하는 만큼만)
- 한 줄씩 허락(공유 file. 한 줄만 더하고 "넘길 줄"에 적는다): `project-docs/flows/`의 area file와 `tests/*.yaml` 줄
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/coding-agent-relay-survey.md`의 1.2(headless harness agent와 shell 시작), 1.4, 2(설계 6), 6(3, 6번). 이 brief와 README가 다르면 그쪽이 맞다(되살리기는 ledger의 coding session에 한한다)
  - architecture: `project-docs/architecture/platform.md`("core가 shell을 띄운다"), `harness-gui.md`, `coding-agent.md`(harness agent, TUI hold)
  - 이 계획이 먼저 낸 것: `HostRequest`의 `coding_open {project, harness, resume?: {session}}`(`mobile-host-link`. 이 task가 구현한다), `ctx.codingRelay`(`mobile-coding-state`), `gui.toggle`과 phone 출처 switch(`mobile-coding-shell`), `ctx.hostLink.onRequest`(`mobile-host-link-shell`)
  - 지금 코드: 탭 열기(`packages/core/main/daemon/wiring/host-queue.ts`의 `tabs/open`의 `coding`과 `tui` 갈래, `queue.openTab`), 창이 그것을 여는 곳 `packages/shell/renderer/workspace/use-surface-requests.ts`(`openTerminal`의 `command`와 `resume`), 터미널에서 사람이 치는 `<harness> gui`가 shell main에 닿는 길(`packages/shell/main/terminal/gui.ts`의 `request()`와 `terminalGuiPayloadSchema`), `packages/core/host-queue/queue.ts`의 `startShell`·`SHELL_START_FAILED`, `packages/core/main/daemon/shell-launcher.ts`
  - 한계(조사 7-1, 7-2): 창이 하나도 없을 때 새 터미널 탭이 어디에 생기는지, PTY가 앱 종료와 함께 죽는다는 것(그래서 깨우기만으로는 목록이 비어 있다). 이 task는 shell을 띄우지 않으므로 코드로만 맞추고 보고에 확인 못 한 것으로 적는다
- 계약:
  - 쓰는 것: 위 요청과 서비스
  - 내놓는 것(`mobile-coding-open-phone`이 기댄다. 모두 actor `user`, memory, 오류 code는 `invalid_input|forbidden|unauthorized|not_found|conflict|unavailable`만):
    - `coding_sessions/open` memory `{project: prj, harness: string, resume?: {session: ses}, key: string}` -> `{session: ses}`. `harness`는 harness-gui가 지원하는 것(`claude-code`, `codex`, `opencode`, `omp`)이고 아니면 `invalid_input`. `resume.session`은 그 project의 ledger session 가운데 그 harness agent의 것이어야 하고(CLI session id가 있어야 한다) 아니면 `not_found`나 `invalid_input`이다. 그 CLI session이 이미 다른 탭에서 도는 중이면(TUI hold, 사본이 있는 session) `conflict`(한 CLI session에 process 둘을 띄우지 않는다). shell이 없으면 `unavailable`(폰은 `wake`를 먼저 부른다). 성공하면 host가 연 터미널의 session id(`guiSessionId`)를 돌려주고 `StateChanged{coding_sessions}`가 나간다. 같은 `key`를 다시 보내면 한 번만 연다
    - `coding_sessions/wake` memory `{}` -> `{shell: "attached"|"starting"}`. 이미 붙어 있으면 `attached`, 아니면 `queue.startShell`로 앱을 띄우고(`starting`) 띄울 수 없으면(launcher가 없는 core, backoff 중) `unavailable`. 폰은 `coding_sessions/list`의 `shell`이 `attached`로 바뀌길 기다린다

## 할 일

1. `relay.ts`(protocol)에 두 route를 더한다. `core/coding-relay/open.ts`와 wiring에 handler: `open`은 입력을 검사한 뒤 `callCoding`으로 `coding_open`을 host에 보내고 답을 session id로 옮긴다. `wake`는 `queue.startShell`.
2. `shell/main/terminal/coding-open.ts`(Electron을 import하지 않는다): 그 project에 터미널 탭을 열어 GUI를 시작한다. 가장 단순한 길을 고른다: shell main이 안쪽에서 `tab_open` 요청(target `coding` 또는 `tui` 갈래나, 새 target 종류)을 창 요청 길(`surface.ts`)에 넣어 desktop 창이 터미널 탭을 열게 하고, 그 터미널에 사람이 치는 `<harness> gui`와 같은 명령(되살릴 때 resume 값)이 닿게 한다. 창이 없으면 `surface.ts`가 focus 없이 하나 연다(`openInactive`). 터미널이 열리고 handle이 만들어질 때까지 기다린다(기한 60초). 어느 쪽이 단순한지는 코드를 읽고 정하고 보고한다.
3. `wiring/coding-relay.ts`(shell)에서 `coding_open` 요청에 처리기를 단다. 실패는 error code로 돌려준다(이미 그 CLI session이 도는 중이면 `conflict`).
4. flows catalog와 test(core handler는 가짜 `hostLink`로, shell은 가짜 deps로).

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "이미 다른 탭에서 도는 CLI session을 `resume`으로 열면 `conflict`이고 두 번째 process를 띄우지 않는다"
- 남지 않음: 없음
- 확인: 실제 shell은 띄우지 않는다(사람에게 묻는 일). `npm run dev:core`와 `tools/fake-coding-host.ts`(이 task가 `coding_open`에 canned 답을 하게 더한다)로 core 쪽 `coding_sessions/open`과 `wake`를 한 번 본다. 끝나면 process를 모두 정리한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 열기에 고른 길과 이유, 창이 없을 때의 동작(코드로만 확인한 것), 깨우기 뒤 목록이 비어 있는 것을 폰이 어떻게 안내해야 하는지, 확인한 것과 못 한 것, lead가 `platform.md`·`harness-gui.md`에서 고칠 것.

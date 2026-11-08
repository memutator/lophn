# surf-tui

harness agent session을 터미널 탭에서 그 CLI의 resume으로 연다(`tab open --session <ses> --tui`). 탭에서 TUI가 도는 동안 그 session의 headless turn은 시작하지 않고 입력은 queue에 남는다.

- 단위: surf (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{host-queue,harness-host}.ts`
  - `packages/core/host-queue/`
  - `packages/core/main/daemon/wiring/{host-queue,harness}.ts`
  - `packages/cli/commands/tab.ts`
  - `packages/shell/main/extensions/bundled/harness/host.ts`
  - `packages/shell/main/terminal/harness-tui.ts`(새 file), `packages/shell/main/desktop/wiring/{surface,coding}.ts`
  - `packages/shell/ipc/surface.ts`
  - `packages/shell/renderer/workspace/use-surface-requests.ts`, `packages/shell/renderer/workspace/kinds/terminal.tsx`
- 읽을 것:
  - `project-docs/plan/agent-surface/README.md`, `project-docs/products/roadmap/agent-surface.md`("탭 열기"의 TUI, 정한 것 5·10)
  - architecture: `project-docs/architecture/{coding-agent,harness-gui,terminal-agent}.md`(coding-agent는 "harness agent" 절)
  - boundary: `project-docs/boundary-catalog.yaml`의 `harness-host-interface`
  - harness 흐름: `packages/shell/main/extensions/bundled/harness/host.ts`(`tick`, `workspaceFolder`, `harnessEnv`, `ADAPTER_ID`), `packages/core/main/daemon/wiring/harness.ts`(`take`, `start_turn`의 `isRunning` conflict), `packages/core/lophn-agent/run-loop/queue.ts`(`setRunning`이 steer 입력을 `steering`으로 돌린다)
  - resume 글: `packages/protocol/coding-agent/harness-adapter.ts`(`HARNESS_ADAPTERS[id].session.resume`), `packages/shell/terminal-host/shell-integration.ts`
  - 터미널 열기: `packages/shell/renderer/workspace/kinds/terminal.tsx`(`openTerminal(host, {cwd, resume})`), `packages/shell/ipc/terminal.ts`(`terminalOpenSchema`), `packages/shell/main/desktop/wiring/coding.ts`(`resumeLine`, `settled`), `packages/shell/main/terminal/cwd.ts`
  - TUI 끝 알기: `packages/shell/main/terminal/agent/tracker.ts`(`foreground`, `tuiLeft`, `gone`, `onForegroundExit`), `packages/shell/main/terminal/gui.ts`(같은 tracker를 쓰는 선례)
  - surf-queue가 낸 host queue와 `tab_open` 요청, renderer `use-surface-requests.ts`
- 계약:
  - 쓰는 것: surf-queue의 `tab_open` 요청과 push·ack.
  - 내놓는 것:
    - `tab_open` target에 `{tui: Id<"ses">}`를 더한다. 명령은 `lophn tab open --session <ses> --tui [--place …]`.
    - `harness/take` 입력을 `{}`에서 `{tui: Id<"ses">[]}`로 바꾼다(지금 TUI가 도는 session 목록. 매 tick이 heartbeat다). 쓰는 곳(extension `harness`)을 같은 변경에서 고친다.

## 할 일

1. **열기 판정(core).** `tabs/open`의 `tui` target은 이렇게 거른다.
   - session runtime이 harness가 아니면 `invalid_input`.
   - session workspace가 project가 아니면 `invalid_input`. home은 터미널이 없고(`terminal.tsx`의 "Home has no terminal"), 앱 workspace의 headless cwd(`source_path`)는 터미널 cwd 검사(등록한 project 폴더)를 지나지 못한다이번에는 project만 연다(사람 확인, 2026-11-08. roadmap "하지 않는 것").
   - `harness_session`이 아직 없으면(첫 turn 전) `conflict`("this session has not run yet").
   - turn이 돌고 있으면(`queue.isRunning`) `conflict`("a turn is running; wait or stop it").
   - 통과하면 그 자리에서 hold를 건다(아래). core는 한 thread라 판정과 hold 사이에 turn이 끼지 못한다.
2. **hold(core).** `wiring/harness.ts`에 `held: Map<ses, until>`(Clock)을 둔다. `take`는 hold된 session을 건너뛰고 `start_turn`은 hold된 session에 `conflict`다. `queue.setRunning`을 hold로 쓰지 않는다(steer 입력이 `steering`으로 가 harness가 읽지 않아 잃는다). 열 때 30초 예약, `harness/take {tui}`에 실려 오면 10초로 갱신, 목록에서 빠지면 바로 풀고, 예약이 확인되지 않으면 30초에 풀린다. shell이 죽거나 core가 다시 떠도 저절로 풀리고 다시 맞춰진다. 입력과 call은 queue에 그대로 남고(call은 accepted), hold가 풀리면 다음 tick에 돈다.
3. **shell main.** `packages/shell/main/terminal/harness-tui.ts`가 host 요청으로 연 터미널의 `terminal_ref → session`을 들고, tracker의 `tuiLeft`·`gone`이나 "30초 안에 TUI가 foreground에 안 보임"이면 지운다. extension `harness`의 `tick`이 이 목록을 `harness/take {tui}`에 싣는다. extension에 넘길 길은 `ctx`에 넣지 말고 surface wiring이 등록한 함수로 둔다. extension은 shell main 내부를 import하지 못하므로(check-deps rule `extension`), 막히면 lead에게 계약 요청으로 보고한다.
4. **renderer.** `tui` 요청은 `openTerminal(host, {cwd, resume: {harness: <adapter id>, external_session}})`로 연다. cwd는 session project의 첫 폴더(headless `workspaceFolder`와 같은 자리)다. runtime(`claude-code`)과 adapter id(`claude`)의 짝은 `host.ts`의 `ADAPTER_ID` 사본이 아니라 protocol의 표를 쓴다(없으면 `harness-adapter.ts`에 하나 두고 host.ts도 그것을 쓰게 한다). 터미널 탭은 login shell에 resume 줄을 친 것이라 CLI가 끝나도 탭은 남는다. 그래서 TUI 끝은 tracker로만 안다.
5. **자격.** TUI process에는 lophn 자격을 주지 않는다(터미널 env가 `LOPHN_*`를 지운다). TUI 안의 turn은 lophn 기록에 없다(정한 것 10). TUI에서 사람이 `/clear`로 CLI session id를 바꾸는 경우는 이번에 다루지 않고 보고한다.

## 끝남

- `npm run check`가 통과한다. renderer build가 된다.
- 위험 test(core unit 하나): "hold된 session에는 `take`가 입력을 주지 않고 `start_turn`이 `conflict`이며, heartbeat가 끊기면 풀려 queue의 입력이 다시 나간다".
- 사람에게 물을 것: harness CLI를 실제로 띄우는 확인(TUI resume). worker는 하지 않고 "실제 CLI로 안 돌림"으로 보고한다. 새 subprocess·E2E test는 만들지 않는다.

## 보고

brief-template의 보고 꼴. `coding-agent.md`·`boundary-catalog.yaml`의 `harness-host-interface`에 고칠 말을 적는다(문서는 lead가 고친다).

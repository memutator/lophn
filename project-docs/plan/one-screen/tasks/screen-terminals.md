# screen-terminals

다른 기계의 터미널과 coding agent를 이 컴퓨터의 탭에서 desktop 터미널 그대로 그린다. 받는 기계에 기기 route와 event를 열고(보기는 내 기기 모두, 치기와 다시 시작은 터미널 입력 허락이 있는 기기), 먼저 날 출력이 `machines/watch`를 넘쳐 다른 event를 떨어뜨리지 않는지 재고, 안 되면 폰처럼 화면 사본으로 그린다.

- 단위: screen (wave 2)
- 선행: screen-base-core, screen-base-scope.
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/terminals.ts`, `packages/core/terminals/routes.ts`, `packages/core/main/daemon/wiring/{terminals,terminals_test}.ts`
  - `packages/shell/renderer/terminal/`(`machine-deps.ts` 포함), `packages/shell/renderer/workspace/kinds/terminal.tsx`
  - `tools/wireframes/pages/screens/project-workspace.tsx`
  - `packages/design/i18n/catalog/project.ts`
  - `project-docs/flows/areas/{core-platform,harness}.yaml`, `project-docs/architecture/terminal-agent.md`
- 읽을 것:
  - 계획 README "정한 것 › 열리는 것"의 터미널과 coding agent
  - architecture: `project-docs/architecture/terminal-agent.md`(출력 lease와 seq, 입력 자격), `remote.md`(기기 route 목록, screen-base-scope 초안), `event.md`
  - review `reports/multi-device/review-core-terminals.md` "Facts the next plans build on"(route 줄, lease, 입력 자격)
  - 조사 `reports/multi-device/survey-n1-one-screen.md` G5, 부록 A "Terminal tab", 부록 C
  - 폰의 화면 사본 길: `packages/mobile/src/data/terminal.ts`, `packages/protocol/coding-agent/terminal-view.ts`
  - 개발 도구: `tools/remote-dev.ts`, `tools/dev.ts`의 `--viewer`, `project-docs/plan/tools/lead/boot.sh`(core를 손으로 띄우는 꼴)
- 계약:
  - 쓰는 것: `machineTerminalDeps`(screen-base-scope가 만든 자리), `useMachineData`, `TabScope`, `TabItem.machine`, `terminals/*` route와 `TerminalOutputAppended`·`TerminalRuntimeChanged`
  - 내놓는 것: `machineTerminalDeps(machine, …)`가 다른 기계에도 `TerminalDeps`를 준다. `screen-lists`는 그 `store`로 다른 기계의 coding agent·터미널 줄을 그린다.

시작 전에 다시 볼 것: `multi-device-fixes`의 `fix-terminals`(change-log `project-docs/products/change-log/0.23/multi-device-fixes.yaml`(끝난 task `fix-terminals`. brief는 `git show ffe208f94^:project-docs/plan/multi-device-fixes/tasks/fix-terminals.md`))가 `routes.ts`의 `open`이 `input`처럼 principal을 받아 기기(`deps.isDevice`)이고 `deps.granted`가 아니면 `command`·`resume`을 거절하게 했고, `wiring/terminals_test.ts`에 입력 자격 표를 두었다. restart를 그 모양(`isDevice`·`granted`)으로 맞추고 위험 test를 그 표에 더한다. 기기 목록 줄은 `fix-setup` 뒤의 `allowlist.ts`에 댄다.

## 할 일

1. **재기(먼저).** 둘째 기계 없이 한 기계에서 잰다. `.dev-data/screen-terminals/{a,b}`(0700)에 core 둘을 `boot.sh`처럼 띄운다(`LOPHN_HOME=<절대 경로> timeout --preserve-status -s TERM <초> env ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron packages/core/main/daemon/main.ts --port=0`, Bash의 `run_in_background`). 띄우기 전에 각 `settings.json`에 `remote.enabled: true`, 서로 다른 `remote.port`, `remote.relay: ""`를 적는다(실제 relay에 붙지 않는다). A에서 `roster/invite {kind: "computer", terminal_input: true}`, B에서 `roster/join`(`tools/remote-dev.ts`처럼 CLI token으로). 잴 동안만 이 worktree의 `packages/protocol/remote/allowlist.ts`에 아래 route와 event를 더한다(commit하지 않는다. lead가 넣는다). script(`.dev-data/screen-terminals/measure.ts`)는 B에 shell로 붙어(control `connect {client: shell}`, capability로 Gateway) `machines/watch`와 `machines/call`로 A의 터미널 하나에 `terminals/watch` lease를 걸고, A에서 그 터미널에 30초 동안 `yes`와 64 MiB를 한 번 쏟는다. ps·pkill로 process를 찾지 않는다. timeout으로 끝나게 한다.
   - 통과: (a) B의 Gateway와 A가 B에게 준 기기 Gateway 어느 쪽도 `closed{slow_consumer}`가 0번, (b) 쏟는 동안 A에서 낸 `StateChanged`(예: `settings/update`)가 2초 안에 B에 닿는다, (c) 쏟는 동안 B의 `machines/call project.list`가 2초 안에 답한다, (d) seq가 건너뛰면 `terminals/snapshot{after_seq}`로 맞출 수 있다.
   - 숫자(초당 frame, byte, 닫힘 수, 지연)를 보고에 적는다.
2. **기기 목록(lead가 넣는다. 보고의 "등록할 것"에 적는다).** 통과면: `REMOTE_ALLOWED_ROUTES`에 `terminals/list|snapshot|watch|resize`와 `coding_sessions/cli_sessions|rewind_preview`(coding agent GUI), `REMOTE_PERSON_ROUTES`에 `terminals/close|restart`, `REMOTE_ALLOWED_EVENTS`에 `TerminalOutputAppended`, `TerminalRuntimeChanged`. 실패면: `terminals/list`, `TerminalRuntimeChanged`, `terminals/close|restart`만 더하고 날 출력 route·event는 넣지 않는다(화면은 이미 있는 `terminal_view/*`와 `TerminalScreenChanged`).
3. **다시 시작의 자격.** `terminalsRestart`의 `shell_capability`를 optional로 하고, `routes.ts`의 `restart`가 `input`과 같이 `deps.granted(principal) || capability`로 본다(principal을 `wiring/terminals.ts`에서 넘긴다). 이 컴퓨터의 창은 지금처럼 focus 검사를 거친 shell main이 capability를 싣는다. 다른 기계의 창은 이 컴퓨터의 터미널 입력 허락으로 그 기계가 받는다.
4. **renderer.** `machine-deps.ts`가 다른 기계에 `TerminalDeps`를 짓는다: `core`는 그 기계의 `createTerminalCore(core, events)`, 입력·다시 시작은 shell main의 `TerminalApi` 대신 그 기계 core의 `terminals/input`·`terminals/restart`(capability 없이), clipboard와 링크 열기는 이 컴퓨터의 `lophnTerminal` 그대로, focus 보고는 하지 않는다. 실패 길이면 탭 본문은 `terminal_view/snapshot|watch|resize`와 `TerminalScreenChanged`로 화면 사본을 xterm에 그린다. 입력이 `forbidden`이면 탭 위쪽 toast로 "<기계>에서 이 컴퓨터의 터미널 입력을 켜야 한다"를 보이고 view만 남긴다.
5. `kinds/terminal.tsx`: `host.props.terminal`(8곳)을 탭의 기계 묶음 `host.machineData(tab.machine ?? host.machine).terminal`로 바꾼다(본문 component 안에서는 `useMachineData().terminal`). `thisComputerOnly`를 지운다.
6. wireframe 먼저(`ui-design` skill): `project-workspace.tsx`에 `project-terminal-other-machine`(탭 이름 옆 기계 꼬리표), `project-terminal-view-only`(허락 없음 toast)를 더한다. 글은 `project.ts`의 `terminal.*` key.
7. 문서와 flows: `terminal-agent.md`에 다른 기계의 터미널(기기 자격, restart, 고른 길과 잰 숫자), flows `core-platform.yaml`·`harness.yaml`의 `terminals/restart` 자격과 기기에 연 route 줄(`flows` skill).

### 정한 것
- 닫기와 다시 시작은 허락받은 기기만이다(`REMOTE_PERSON_ROUTES`): README가 기기 목록에 연다고만 했고, 둘 다 사람의 shell을 끝낸다.
- 다른 기계의 터미널에는 focus 검사를 두지 않는다: 그 검사는 이 컴퓨터의 capability를 지키는 것이고 받는 기계는 기기 허락만 본다.

## 끝남

- `npm run check`가 통과한다. `npm run wireframes`가 되고 gallery의 `project-terminal-other-machine`, `project-terminal-view-only`가 renderer component로 그려진다. `node packages/shell/renderer/build.ts`가 선다.
- 위험 test(`wiring/terminals_test.ts`에 더한다. 새 test file을 만들지 않는다): "터미널 입력 허락이 없는 기기 principal의 `terminals/input`·`terminals/restart`는 받는 core가 `forbidden`으로 거절해 PTY에 닿지 않고, 허락이 있는 기기의 restart는 capability 없이 generation을 올린다."
- 잰 script와 두 core는 test로 남기지 않는다(subprocess를 띄우는 test는 사람에게 묻는다). `.dev-data/screen-terminals/`는 commit하지 않는다.
- 남지 않음: `grep -n "thisComputerOnly" packages/shell/renderer/workspace/kinds/terminal.tsx`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

# coding-agent-terminal

shell main의 터미널이 core의 coding 요청(여는·넣는·멈추는)을 받아 실행하게 바꾼다. 사람이 [Start]를 눌러 시작하던 흐름(click → issue → start)과 TUI 아래 MCP·CLI process 관측을 지우고, core가 보낸 plan 그대로 앱 source 폴더에서 TUI를 연다. 첫 prompt는 argv로 넘기거나 session 시작 hook을 받은 뒤 paste한다. 사람이 그 탭에 focus해 있으면 메시지를 쥐고 있다가 넣는다.

- 단위: coding-agent (wave 3)
- 선행: 없음. 계약 고정 뒤에 열린다. core는 fake로 짓는다.
- 소유(이 task만 고친다):
  - `packages/shell/main/terminal/`
  - `packages/shell/terminal-host/`
- 읽을 것:
  - spec: S6 2장 5, 5장 4, 7장, 8장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/coding-agent.md`
  - inventory: `I1.6#9`(`coding-start.ts`의 click → issue → start 흐름), `I1.6#10`, `I1.6#11`, `I2.6#13`(`coding-start.ts`의 `folder_changed`·`project`·`folder_ref` 검사), `I2.6#15`, `I3.6#10`(PTY 입력 통로), `I3.6#15`, `I3.6#16`(main 쪽: session ↔ 터미널 탭 표), `U2.6#3`(main 쪽)
  - 결정: `../README.md` 3장 #6, #60
  - 계약: `packages/protocol/coding-agent/terminal-requests.ts`(`codingTerminalRequestSchema`, `codingTerminalResult`, `codingTerminalExited`), `launch-plan.ts`(`codingLaunchPlanSchema`), `packages/shell/ipc/terminal.ts`(`focusSession`, `TerminalRuntime.coding_session`, `no_terminal`)
- 계약:
  - 쓰는 것: 위 계약. core로 결과를 알리는 길은 shell main이 가진 사람 token의 core client(`packages/shell/main/desktop/core/`의 client). 이 task는 그 client를 인자로 받는 함수로 짓고 연결은 하지 않는다.
  - 내놓는 것:
    - `createCodingTerminalRequests({ supervisor, reportResult, reportExited, runCli })`: 요청 하나를 받아 처리하고 결과를 `reportResult`로, 끝을 `reportExited`로 알린다. Gateway frame을 받아 이 함수에 넘기는 연결은 `packages/shell/main/desktop/`(platform 단위)와 lead가 한다.
    - `focusSession`의 main 쪽 구현(`TerminalIpc`).

## 할 일

1. **요청 처리**(새 `main/terminal/coding/requests.ts`, 옛 `coding-start.ts`·`coding-children.ts`는 지운다. `I1.6#9`, `I1.6#11`):
   - 공통: 이 frame은 renderer로 중계하지 않는다(plan의 env에 coding token이 있다). log와 오류에 plan의 env 값을 넣지 않는다.
   - `open`: plan을 `codingLaunchPlanSchema`로 다시 검사한다. cwd(앱 source 폴더)가 디렉터리이고 읽을 수 있는지 본다(`I2.6#13`: project 폴더가 아니라 앱 source 폴더다). 안 되면 `folder_missing`으로 거절한다. 열기 전에 `lophn harness install --harness <id> --folder <cwd>`를 CLI exec로 한 번 돌린다(skill과 hook이 없을 때 놓는다. 사람이 고친 파일은 CLI가 안 덮는다). 설치 결과가 `failed`여도 TUI는 연다(결과는 `result`에 `install` 칸으로 알린다). 일반 shell 탭과 다른 제목(plan의 `title`)으로 새 탭 runtime을 만들고 focus를 옮기지 않는다(S6 5장 4). `result`로 `terminal_ref`를 알린다.
   - `input`: 그 session의 터미널 탭에 text를 넣는다. 사람이 그 탭에 focus해 있으면(`TerminalFocus` 표) focus가 풀릴 때까지 쥐고 있다가 넣고 알린다. 탭이 없으면 `no_terminal`.
   - `stop`: 그 session의 process를 멈춘다(process group 전체, `child-group.ts` 그대로).
   - process가 끝나면 `exited`를 알린다(`exit_code`, 이유 `exited`/`killed`/`host_lost`). host가 사라지면 그 host가 연 coding 탭 모두에 `host_lost`다. 자동 재시작·resume은 없다.
   - session ↔ 터미널 탭 표를 둔다(`I3.6#16`): `session → terminal_ref`. `focusSession`이 이 표로 탭을 고른다.
2. **host**(`terminal-host/`):
   - 지운다: `observe-socket.ts`(`LOPHN_TERMINAL_OBSERVE`와 관측 줄, `I1.6#10`), `child-watch.ts`(`I1.6#11`), host의 `credential_helper`·`child_started/ended/tui_ended` 줄, `main.ts`의 `open-coding`에 붙은 관측 attachment.
   - 고친다: `launch-plan.ts`는 새 plan을 PTY spawn 인자로 바꾼다(shell을 거치지 않고 `executable`과 `argv`로 직접 띄운다. env는 plan의 `env`에 `env_delete`를 지운 것). `coding-types.ts`는 새 plan 모양에 맞춘다. `prompt-delivery.ts`는 지운다. 첫 prompt는 plan이 `argv`면 argv로 이미 넘어가 PTY에 쓰지 않고, `paste_after_hook`이면 core가 session 시작 hook을 받은 뒤 보내는 일반 `input` 요청으로 들어온다(화면 출력으로 준비를 짐작하지 않는다, S6 2장 1). 그 파일의 붙여 넣기 쓰기(붙여 넣기 구간으로 한 번에 쓰고 제출은 마지막 CR 하나)는 `input` 처리로 옮긴다. 재전송·재spawn·resume은 없다.
   - 남긴다: `pty.ts`, `ring-buffer.ts`, `child-group.ts`, `env.ts`.
3. **runtime 표시**(`U2.6#3`의 main 쪽): `TerminalRuntime`에 `coding_session`을 채운다(`prompt` 칸은 argv로 넘겼으면 `none`, `input`으로 넣었으면 `delivered`/`not_delivered`. 옛 `coding?`은 안 쓴다). `launch_kind: "coding_tui"`는 그대로 쓴다. coding 탭이 끝나면 다시 시작(`restart`)을 거절한다(새 맡기기만 새 탭을 연다). 탭 제목으로 구별하는 renderer 쪽 표시는 screens-project 몫이다.
4. **supervisor와 ipc**(`supervisor.ts`, `controller.ts`, `ipc.ts`, `dev-seed.ts`): `focusSession` 채널을 등록한다(`TERMINAL_FOCUS_SESSION_CHANNEL`). 입력 검사는 기존 guard를 따른다. `supervisor.ts`의 `onEvent`(관측 줄)와 관련 코드를 지운다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "observe-socket\|LOPHN_TERMINAL_OBSERVE\|credential_helper\|child-watch\|coding-children\|human_start_handle\|ObservationStore\|stdin_after_ready" packages/shell/main/terminal packages/shell/terminal-host`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 요청 처리 함수를 Gateway frame 수신에 잇는 일(`packages/shell/main/desktop/main.ts`)과 route allowlist(`coding_agent_terminals.result`, `.exited`)는 platform 단위와 lead 몫이다. 이 task는 그 연결을 만들지 않고 호출 모양만 적는다.
- 안 쓰게 된 export: `packages/shell/ipc/terminal.ts`의 `TerminalCoding`·`TerminalRuntime.coding`
- 정한 것:
  - focus가 계속 풀리지 않을 때 `input`을 쥐고 있는 기한(두는지)
  - 설치 결과를 `result`에 싣는 칸 이름(계약에 칸이 없으면 계약 바꾸기 요청)
  - `harness install` exec의 timeout
- 계약 바꾸기 요청: `result`에 설치 결과 칸이 필요하면 여기에 적는다.

- (lead가 더함, coding-agent-cli가 넘긴 것) `packages/shell/terminal-host/child-watch.ts`가 지운 `mcp-server/main.ts` 경로를 아직 본다. 걷는다.
- (lead가 더함, coding-agent-session이 넘긴 것. 추가 소유, lead 승인: shell main route allowlist 줄) shell main route allowlist에 `coding_agent_terminals.result`, `coding_agent_terminals.exited`, `coding_agent_harnesses.report`를 더한다. 사람이 focus한 탭에 넣는 `input`은 focus가 풀릴 때까지 shell main이 쥔다.
- (lead가 더함, coding-agent-settings가 넘긴 것. 추가 소유, lead 승인: `shell/main/desktop/wiring/coding.ts`의 시작 줄) shell main이 core에 붙은 직후 `harnessSettings.read()`를 한 번 불러 감지 결과를 core에 알린다. 안 하면 사람이 Settings를 열기 전까지 core가 coding 맡기기를 `not_connected`로 거절한다.

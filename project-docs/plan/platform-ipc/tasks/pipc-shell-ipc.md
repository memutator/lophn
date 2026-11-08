# pipc-shell-ipc

shell을 공통 자리 규칙과 `ipcPath`로 옮기고, file 폴더와 hook·bridge endpoint를 나눈다. Windows용 pipe와 `.cmd` shim까지 준비하되 win32 gate는 PowerShell을 붙이는 다음 task까지 남긴다.

- 단위: pipc-shell (wave 2)
- 선행: pipc-socket-rule
- 소유(이 task만 고친다):
  - `packages/shell/main/browser-bridge/run-dir.ts`
  - `packages/shell/main/browser-bridge/run-dir_test.ts` (새 file)
  - `packages/shell/main/browser-bridge/shim.ts`
  - `packages/shell/main/browser-bridge/socket.ts`
  - `packages/shell/main/terminal/agent/socket.ts`
  - `packages/shell/main/desktop/wiring/bridge.ts`
  - `packages/shell/main/desktop/wiring/agent.ts`
  - `packages/shell/main/desktop/wiring/coding.ts`
  - `packages/coding-agent/local/hook.ts`
- 읽을 것:
  - 계획: `project-docs/plan/platform-ipc/README.md`, `project-docs/products/roadmap/platform-ipc.md`, `project-docs/plan/platform-ipc/tasks/pipc-socket-rule.md`
  - architecture: `project-docs/architecture/platform.md`의 앱 IPC·file·불변 조건, `project-docs/architecture/terminal-agent.md`의 hook key·시작 층, `project-docs/architecture/browser-tab.md`의 terminal bridge·ack·shim·정리
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `base`·`shell`·`coding-agent`, `project-docs/module-catalog.yaml`의 `packages/base`·`packages/shell/main`·`packages/coding-agent`
  - 공통 규칙: `packages/base/os/ipc.ts`, 선행 task가 만든 `packages/base/os/socket-dir.ts`, `packages/core/apps/runtime/processes/socket-dir.ts`, `tools/check-deps.ts`
  - 기존 경계: `packages/shell/main/browser-bridge/bridge.ts`, `packages/shell/main/browser-bridge/policy.ts`, `packages/shell/main/terminal/agent/ingress.ts`, `packages/protocol/coding-agent/terminal-hook.ts`
  - 기존 test: `packages/shell/main/browser-bridge/bridge_test.ts`, `packages/shell/main/browser-bridge/policy_test.ts`, `packages/shell/main/terminal/agent/agent_test.ts`, `.claude/skills/write-test/SKILL.md`
  - 시작 층 사용자: `packages/shell/terminal-host/shell-integration.ts`, `packages/shell/main/terminal/ipc.ts`
  - Windows 명령 본보기: `packages/core/supervision/security/node-shims.ts`, `packages/base/os/cmd-shim.ts` (후자는 `.cmd` launcher용이므로 `start`에 그대로 쓰지 않는다)
- 계약:
  - 쓰는 것: 선행의 `socketDirectoryPath`, 기존 `ipcPath`·`ipcPathLimit`. hook·bridge의 wire JSON, key 64 hex, env 이름, ack·timeout·URL 정책은 그대로다.
  - 내놓는 것: `run-dir.ts`가 export하는 `ShellRun`은 `{ dir: string; bridgeSocket: string; hookSocket: string; shim: string; script: string }`다. `prepareRunDir`는 base의 `Result<ShellRun, { code: "invalid_input" | "unavailable"; message: string }>`를 돌려준다. `RunDirDeps`에 명시적인 `platform`을 받는다.
  - 내놓는 것: `createBridgeWiring`은 기존 `runDir: Promise<string | null>` 대신 `run: Promise<ShellRun | null>`를 내고, `createAgentWiring` 입력도 `run`으로 바꾼다. `coding.ts`가 같은 변경에서 잇는다. `run`은 앱 ready·single-instance lock 뒤 file 폴더가 준비되면 확정하며 browser shim·listen 성공을 기다리지 않는다.
  - 유지하는 것: `TerminalBridge`, `TerminalHooks`, `shellInit()`의 공개 모양과 기존 `writeShellInit(fs, dir, cli)` 호출은 그대로다. 다음 task가 platform 인자를 더하고 Windows gate를 지운다.

## 확인한 코드

- `packages/shell/main/desktop/wiring/bridge.ts:64` gate와 같은 file `:90`의 `process.getuid!()`가 Windows 준비를 막는다. `packages/shell/main/desktop/wiring/agent.ts:236-238`은 bridge가 성공한 `runDir`를 기다린 뒤 직접 `h.sock`을 붙인다.
- `packages/shell/main/browser-bridge/run-dir.ts:35-69`는 SHA-256 key와 XDG/tmp 계산을 복제하고 같은 file `:48`은 UTF-8 byte가 **104 이상**이면 거절한다. core의 한도는 `ipcPathLimit`의 linux 107·darwin 103이고 `slotSockets`에서 **초과**를 거절한다.
- `packages/shell/main/browser-bridge/socket.ts:53`과 `packages/shell/main/terminal/agent/socket.ts:53`은 listen 뒤 무조건 chmod 0600이다. 두 server 모두 Node `net`을 쓴다.
- `packages/shell/main/browser-bridge/shim.ts:125`의 `shimSources`는 sh만 내고 같은 file의 JS `openWithSystem`(`:93`)은 darwin `open`, 나머지 `xdg-open`이다. `net.createConnection(config.socket)`(`:71`) 자체는 path transport다.
- `packages/coding-agent/local/hook.ts:38-40`의 이름은 `connectUnix`지만 실제 호출은 Node `connect({ path })`다. Windows 실동작 확인은 아직 없으며 별도 client protocol을 만들 근거는 없다.

## 할 일

1. `prepareRunDir`가 base의 공통 자리 규칙을 쓰게 한다. POSIX file은 지금처럼 `<공통 directory>/shell-<pid>/`, Windows file은 `<dataRoot>/run/shell-<pid>/`에 둔다. POSIX 경로는 `ipcPath(dir, "b" | "h", platform)`, Windows 경로는 `ipcPath(commonDirectory, "shell-<pid>-b" | "shell-<pid>-h", platform)`로 만든다. pipe 이름은 file 경로로 mkdir·chmod·remove하지 않는다. 근거는 roadmap의 file·endpoint 분리다.
2. **두 endpoint 모두** UTF-8 byte가 `ipcPathLimit(platform)`을 초과하면 file 정리 전에 `invalid_input`으로 거절한다. shell의 `SOCKET_PATH_MAX_BYTES = 104`와 SHA/XDG/tmp 규칙 사본은 사용자를 옮긴 뒤 지운다. Node hash 계산은 base 함수에 주입한다. bespoke `RunDirResult` 대신 base Result를 쓴다.
3. POSIX는 base·key·per-run 폴더 0700, socket 0600을 유지한다. Windows는 file 폴더의 ACL을 data root에 맡기며 uid와 chmod를 요구하지 않는다. wiring의 uid는 `process.getuid?.() ?? 0`로 받고 base의 win32 분기에서 쓰지 않는다. 정리는 현재 data root에 속한 `shell-<숫자>` 중 자기 pid 또는 죽은 pid만, 종료 때는 자기 file 폴더만 지운다. core socket·살아 있는 다른 shell·다른 data root는 건드리지 않는다.
4. `listenBridge`·`listenHooks`에 platform을 명시적으로 넘겨 chmod를 POSIX만 하게 한다. POSIX chmod 실패는 지금처럼 server를 닫고 실패한다. named pipe의 종료는 server close로 끝낸다. `connectUnix`는 실제 역할에 맞게 이름만 고치고 hook의 1초 deadline·실패해도 성공·payload 제한은 바꾸지 않는다.
5. wiring 세 file을 새 `run` 계약으로 한 번에 옮긴다. file 준비 실패만 `run = null`이고 browser shim 쓰기나 listen 실패가 이미 준비한 hook을 끄거나 그 폴더를 지우지 않게 한다. bridge·hook은 각자 listen 성공 후에만 env/key를 발급한다. hook이 살아 있는 동안 file 폴더가 남고, 기존 stop 순서와 quit의 동기 정리를 유지한다. Windows gate는 이번에는 남긴다.
6. `shimSources`·`writeShim`에 platform을 인자로 받아 POSIX sh와 Windows `browser.cmd`를 낸다. 공통 `browser.js`는 Electron Node로 돌린다. `.cmd`는 자기 process 안에서만 `ELECTRON_RUN_AS_NODE=1`을 두고 인자를 넘기며 execPath·script path의 공백·한글을 지킨다. `openWithSystem`에 Windows `cmd.exe`의 `start`를 더하고 빈 title과 URL 인자를 분리한다. 인터넷 URL의 `&`, `|`, `%`, `^`, `!`가 명령으로 풀리지 않게 cmd quoting을 처리한다. 실패·declined·timeout이면 URL을 잃지 않고 OS opener로 넘기며 `BROWSER`·`LPN_BROWSER_BRIDGE`·`ELECTRON_RUN_AS_NODE`를 지우고 URL·key는 출력하지 않는다.
7. 기존 key·URL·ack test는 중복해서 쓰지 않는다. 새 `run-dir_test.ts`에서는 경로 한도 경계와 cleanup·permission 경계만 본다. shell 시작 층이나 launcher 소스 문자열을 읽는 test는 만들지 않는다.

## 끝남

- `npm run check`가 통과한다. POSIX 기존 env/key·ack 동작이 유지되고 Windows gate가 아직 남아 있다.
- 위험 test: "socket 경로가 OS byte 한도를 넘으면 준비가 거절된다"를 POSIX 한글 경계(linux 107·darwin 103)로 본다. Windows는 긴 data root여도 hash된 pipe가 256 byte 안에 들어가는 결과를 본다. 도달할 수 없는 pipe 초과 입력을 억지로 만들거나 file 폴더 길이를 socket 한도로 막지 않는다.
- 위험 test: "run 정리가 다른 실행의 file을 지우지 않고 POSIX private mode를 유지한다"를 임시 폴더의 실제 file 결과로 본다. 현재 OS에서 가능한 permission 검사를 하며 Windows에 없는 mode 검사를 억지로 추가하지 않는다. 살아 있는 sibling·다른 이름·다른 data root의 sentinel은 남아야 한다. subprocess·서버는 띄우지 않는다.
- 기존 `bridge_test.ts`·`policy_test.ts`·`agent_test.ts`가 key·요청 경계를 계속 지킨다. 새 endpoint를 쓰려고 인증 정책을 넓히지 않는다.
- 남지 않음: `SOCKET_PATH_MAX_BYTES`, `connectUnix`, `bridgeWiring.runDir`, `options.runDir`, `${dir}/h.sock` 직접 조립이 없다. `run-dir.ts`에 XDG/tmp·hash 앞 12자 규칙 사본이 없다.
- 새 run 계약의 사용자 세 file이 함께 바뀌며, protocol·core import 예외와 pointer file이 생기지 않는다.

## 사람에게 물을 것

- named pipe 연결·`.cmd`·Windows `start`의 실제 quoting을 자동 test로 검증하려면 새 서버·subprocess test가 필요하다. 먼저 사람에게 묻는다. 이 task는 이를 만들지 않고 다음 wave 뒤 Windows 수동 확인으로 넘긴다.
- 실제 harness turn을 보내는 검증은 provider 호출이므로 별도 허락이 필요하다. fake hook이나 기존 순수 경계 test가 실제 Windows 실행 확인을 대신했다고 보고하지 않는다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 보고 꼴을 따른다. 등록할 것, 안 쓰게 된 export, 계약 바꾸기 요청, 무겁게 짠 것, 알려진 미완 동작을 빼지 않는다. 실행하지 못한 Windows 확인은 따로 적는다.

# always-os

**opus high.**

`always-mark`가 정한 OS port를 세 OS에 짓는다: 로그인 때 core를 띄우는 per-user 항목을 쓰고, 지우고, OS에 물어 사실을 읽는다(Linux systemd user unit, macOS LaunchAgent, Windows HKCU `Run` 값). 그리고 표시가 켜진 동안 기계가 저절로 잠들지 않게 하는 child(keep-awake)를 쥐고 푼다. OS 명령과 file은 모두 인자로 받아 이 Linux 기계에서 fake로 test한다. core에 잇는 것은 `always-boot`가 한다.

- 단위: always-os (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/always-on/os`(새 폴더 전체. test 포함)
  - 한 줄씩 허락: project-docs의 module-catalog.yaml에 path packages/core/always-on 항목(check-modules가 새 폴더를 요구하면. `always-mark`도 같은 항목을 낸다. lead가 하나만 남긴다), project-docs/flows의 tests group에 이 task의 test file 줄
- 읽을 것:
  - 계획: `project-docs/plan/always-on/README.md`의 "정한 것"(OS별 수단, Windows `Run`의 이유, env는 PATH·TMPDIR뿐, keep-awake), `tasks/always-mark.md`의 "계약"(port 모양)
  - architecture: `project-docs/architecture/platform.md`의 "OS로 가르는 규칙의 자리"(socket key = data root SHA-256 hex 앞 12자, win32 data root 정규화), "core 수명", "process와 IPC"(child tree 끄기, `windowsHide`), 지키는 것 3·13(PowerShell 정책을 우회하지 않는다)
  - 본보기: `packages/shell/main/desktop/autostart.ts`(fail closed 경로 검사 `verifiedExecPath`, `UNSAFE`·`UNSAFE_EXEC`, OS 답에서 상태를 읽는 꼴. 이 file은 `always-desktop`이 지운다. 규칙만 옮겨 온다), `packages/base/os/socket-dir.ts`(data root에서 key 만들기), `packages/shell/main/desktop/core/supervise.ts`의 `coreLaunch`(core를 띄우는 명령: Electron binary + `ELECTRON_RUN_AS_NODE=1` + `packages/core/main/daemon/main.ts` + `--port=0`, `LOPHN_HOME`, `LOPHN_LAUNCH_SHELL`), `packages/base/install/{linux,mac,win}-install.ts`(설치 경로)
  - 비교: `/home/pyosechang/projects/harness-lab/_report/multi-device/hermes.md` §10.1(systemd·launchd·schtasks, linger), `others.md` §5.6(Antigravity의 오류 code), `codex.md` §2.3(keep-awake)
- 계약:
  - 쓰는 것: `always-mark`의 port 모양(`ServiceEnv`, `Registration`, `Registrar`, `KeepAwake`, `AlwaysOnOs`). 이 task는 같은 모양을 `os/` 안에 따로 적어 구현한다(`ports.ts`를 import하지 않는다. 같은 wave라 아직 없다). 둘이 맞는지는 `always-boot`가 잇다가 type으로 본다. 모양을 바꾸지 않는다.
  - 내놓는 것: `packages/core/always-on/os/mod.ts`의 `createAlwaysOnOs(deps): AlwaysOnOs`. deps는 `{ platform: NodeJS.Platform; dataRoot: string; execPath: string; coreEntry: string; corePid: number; uid: number; home: string; env: Readonly<Record<string, string | undefined>>; exec(file: string, args: readonly string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }>; spawn(file: string, args: readonly string[], options: { windowsHide: true }): { onExit(listener: (code: number | null) => void): void; kill(): void }; files: { read(path: string): Promise<string | undefined>; write(path: string, text: string, mode: number): Promise<void>; remove(path: string): Promise<void> }; hash(text: string): string }`. 다른 platform은 `registrar.read`가 `unavailable`·`os_failed`다.

## 할 일

1. 이름: key = `hash(정규화한 data root)`의 앞 12자(socket 자리와 같은 규칙. win32는 구분자 `\`, 끝 구분자 없음, 소문자). Linux unit `lophn-core-<key>.service`, macOS label `dev.lophn.core.<key>`(plist `~/Library/LaunchAgents/<label>.plist`), Windows 값 이름 `lophn-core-<key>`. data root마다 따로라 data root 둘이 서로의 항목을 건드리지 않는다.
2. 안전한 글자: 실행 경로·core entry·data root에 제어 문자, `"`, Linux는 `` ` ``·`$`·`\`·`%`(systemd specifier)가 있으면 쓰지 않고 `unavailable`·`unverified_path`다(지금 `autostart.ts`의 fail closed와 같다). PATH는 그런 글자가 든 항목만 빼고 쓴다.
3. Linux(`systemd`): unit file은 `$XDG_CONFIG_HOME/systemd/user/`(없으면 `~/.config/systemd/user/`).
   ```ini
   [Unit]
   Description=lophn (<data root>)
   ConditionPathExists=<execPath>
   StartLimitIntervalSec=300
   StartLimitBurst=5
   [Service]
   Type=simple
   ExecStart="<execPath>" "<coreEntry>" --port=0
   Environment="ELECTRON_RUN_AS_NODE=1" "LOPHN_HOME=<root>" "LOPHN_LAUNCH_SHELL=1" "LOPHN_SERVICE=1" "PATH=<PATH>"
   Restart=on-failure
   RestartSec=5
   KillMode=mixed
   TimeoutStopSec=120
   [Install]
   WantedBy=default.target
   ```
   `ConditionPathExists`는 제거 뒤 남은 unit이 아무것도 하지 않게 한다. `TimeoutStopSec`는 core 종료 기한 90초보다 길다. 쓰기: file → `systemctl --user daemon-reload` → `systemctl --user enable <unit>`(`--now` 없이. 도는 core가 lock을 쥐고 있다). 읽기: file이 없으면 `absent`, 내용이 지금 쓸 것과 다르면 `stale`, `systemctl --user is-enabled <unit>`가 `enabled`면 `registered`, `disabled`면 `off_in_system`. user bus에 못 붙으면(`Failed to connect to bus` 등, systemd 없는 배포판·WSL) `unavailable`·`no_service_manager`. 지우기: `disable` → file 지우기 → `daemon-reload`. `stop`하지 않는다(그 unit이 띄운 core가 이 core일 수 있다).
4. macOS(`launchd`): plist(XML escape). `ProgramArguments` = `["/bin/sh", "-c", "[ -x \"$0\" ] || exit 0; exec \"$0\" \"$@\"", execPath, coreEntry, "--port=0"]`(앱을 지운 뒤 남은 plist가 실패를 되풀이하지 않게 실행 파일이 없으면 0으로 끝난다), `EnvironmentVariables` = `ELECTRON_RUN_AS_NODE=1`, `LOPHN_HOME`, `LOPHN_LAUNCH_SHELL=1`, `LOPHN_SERVICE=1`, `PATH`, `TMPDIR`(잡은 값이 있으면. core control socket 자리가 `os.tmpdir()`에서 나오므로 앱이 찾는 자리와 같아야 한다), `RunAtLoad` true, `KeepAlive` = `{ SuccessfulExit: false }`, `LimitLoadToSessionType` = `Aqua`, `ProcessType` = `Interactive`(core가 agent turn과 앱 build를 돌린다. 기본값은 CPU·IO를 줄인다). 쓰기: file → `launchctl enable gui/<uid>/<label>`. `bootstrap`하지 않는다(지금 띄우면 lock을 잃은 둘째 core가 뜬다. 다음 로그인에 launchd가 `~/Library/LaunchAgents`를 읽는다). 읽기: file이 없으면 `absent`, 내용이 다르면 `stale`, `launchctl print-disabled gui/<uid>`에 그 label이 disabled면 `off_in_system`, 아니면 `registered`. 지우기: `launchctl disable gui/<uid>/<label>` → file 지우기. `bootout`하지 않는다(launchd가 띄운 core를 죽인다).
5. Windows(`windows_run`): 값 = `"<execPath>" --core --home "<root>"`(Electron이 `--core`로 ensure만 하고 끝난다. env는 Explorer의 것이라 `ServiceEnv`를 쓰지 않는다). 쓰기: `reg add HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v <name> /t REG_SZ /d <값> /f`와 `reg delete HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run /v <name> /f`(사람이 lophn에서 다시 켰으니 Startup apps의 끔을 푼다. 없으면 무시). 읽기: `reg query … Run /v <name>`가 없으면 `absent`, 값이 다르면 `stale`, `StartupApproved\Run`의 그 값(REG_BINARY)의 첫 byte가 홀수면 `off_in_system`, 아니면 `registered`. 지우기: `Run`과 `StartupApproved\Run`의 그 값을 지운다. `reg.exe`는 `%SystemRoot%\System32\reg.exe`를 쓴다.
6. 명령마다 기한 5초. 기한을 넘기거나 예상 밖 답이면 `unavailable`·`os_failed`이고 log에 명령 이름과 exit code만 남긴다(경로, env 값은 싣지 않는다).
7. `captureEnv()`: `env.PATH`(없으면 빈 문자열)와 darwin이면 `env.TMPDIR`. 다른 이름은 읽지 않는다.
8. keep-awake(`hold`는 이미 쥐고 있으면 그대로 `held`):
   - Linux: `systemd-inhibit --what=sleep --who=lophn --why="Keep lophn running" --mode=block tail --pid=<corePid> -f /dev/null`. `systemd-inhibit`이 없거나 바로 끝나면 `no_inhibitor`.
   - macOS: `caffeinate -i -w <corePid>`.
   - Windows: `powershell.exe -NoProfile -NonInteractive -Command <script>`. script는 `Add-Type`로 `kernel32!SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)`를 부르고 `Wait-Process -Id <corePid>`. `-ExecutionPolicy`를 주지 않는다(지키는 것 13. `-Command` 글은 script file 정책에 걸리지 않는다). `windowsHide`.
   - 모두 core pid에 묶여 core가 SIGKILL돼도 풀린다. `release()`는 child를 끈다(Windows는 tree 끄기). child가 스스로 끝나면 `onLost`.
   - 저절로 잠들기만 막는다: Linux는 `sleep`만(덮개 닫기는 logind의 `LidSwitchIgnoreInhibited` 기본값대로 그대로 잔다), macOS는 `-i`만, Windows는 `ES_SYSTEM_REQUIRED`만(화면 끄기·잠금은 막지 않는다).
9. 순수 부분(이름, 글 만들기, OS 답 읽기)과 명령 부르기를 나눠 순수 부분은 platform을 인자로 받는다(지키는 것 3).
10. flows: 새 test file을 tests group에 올린다. 이 folder에는 route·명령 입구가 없다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`packages/core/always-on/os/*_test.ts`, fake exec·files):
  - "세 OS의 등록 글에는 실행 경로, core entry, data root, 정해진 이름(`ELECTRON_RUN_AS_NODE`, `LOPHN_HOME`, `LOPHN_LAUNCH_SHELL`, `LOPHN_SERVICE`, `PATH`, `TMPDIR`)만 있고, deps의 env에 넣어 둔 API key·token 값은 어디에도 없다. 안전하지 않은 글자가 든 경로는 쓰지 않고 `unverified_path`다"
  - "OS 답을 `registered`로 읽는 것은 항목이 있고, 지금 쓸 글과 같고, 켜져 있을 때뿐이다(Linux `is-enabled` disabled, macOS print-disabled, Windows StartupApproved 홀수 byte는 `off_in_system`. bus 없음은 `no_service_manager`). `unregister`는 `systemctl stop`·`launchctl bootout`을 부르지 않는다"
- 실제 `systemctl`·`launchctl`·`reg`·`systemd-inhibit`을 부르는 test는 만들지 않는다(사람 기계의 상태를 바꾼다).
- 남지 않음: 없음.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 세 OS의 등록 글 예 하나씩(경로는 예시 값), OS 답을 읽는 표(명령 → 답 → `Registration`), 실기에서 확인하지 못한 가정(macOS의 Login Items "Allow in the Background" 끔이 `print-disabled`에 보이는지, `LimitLoadToSessionType` Aqua, Windows `reg add`의 따옴표, `systemd-inhibit`이 GNOME 자동 절전을 막는지)을 따로 적는다. 사람이 Mac·Windows에서 볼 목록이다.

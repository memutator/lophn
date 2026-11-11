# platform-ipc Windows 수동 확인

## 상태와 범위

- 상태: **Windows 실기 확인함(2026-11-09) — 설치본 CLI 경로만 미확인**.
- 확인 대상: 구현 land commit `90a4cd00e`를 포함한 main(0.23.9)의 `npm run dev`. 확인하며 고친 것(아래 "확인 중 고친 것")을 얹은 working tree로 다시 돌렸다.
- PowerShell 7(`pwsh.exe`)과 Windows PowerShell 5.1(`powershell.exe`)을 **각각** lophn 터미널의 시작 shell로 실행한다. 이미 열린 터미널 안에서 다른 PowerShell을 실행하는 것으로 대신하지 않는다.
- Linux의 check·smoke 통과는 Windows PowerShell·named pipe·`.cmd` 실행 확인을 대신하지 않는다.
- 사람이 Windows 미확인을 남긴 채 land하도록 승인했다. 원래의 Windows 확인 선행 조건은 이 승인으로 변경됐으며, 아래 항목은 land 뒤에도 별도로 확인한다. 미확인·환경 제약·실패를 통과로 쓰지 않는다.
- Windows foreground 감지·TUI 종료 signal·GUI toggle·adapter 전체 실행은 이 acceptance의 지원 범위가 아니다. `claude gui`는 탭 GUI 진입을 확인한다.

## 준비와 안전 경계

- [x] 확인할 commit과 Windows build가 일치한다. (main `bf696a8c1` + 아래 수정, `npm run dev`)
- [x] 별도의 개발용 data root를 사용한다. 사람의 `~/.lophn`을 바꾸지 않는다. (`.dev-data`, W03은 `C:\tmp\로픈 데이터\home`)
- [ ] 한글·공백이 있는 data root와 CLI 설치 경로를 준비한다. 기존 data를 이동하지 않는다. (data root만. 설치본은 Smart App Control이 막아 CLI 경로는 못 봄)
- [x] 실제 provider를 호출하지 않는 synthetic hook과 GUI 진입으로 확인한다.
- [x] 사용자 profile·alias·function과 execution policy를 덮거나 우회하지 않는다. (원래 profile이 없어 사람 승인으로 임시 profile을 만들고 확인 뒤 지웠다)
- [x] hook 설치가 필요하면 사람이 Settings의 기존 Install hooks 경로를 사용한다. (설치하지 않음. `lophn hook`을 직접 불러 synthetic hook을 보냄)
- [x] bridge 실패 확인은 개발용 인스턴스에서만 한다. bridge를 끄는 재현 방법을 기록하고 hook endpoint까지 함께 종료하지 않는다.

## 환경 기록

| 항목 | PowerShell 7 | PowerShell 5.1 |
|---|---|---|
| 확인자·일시 | 사람 + agent, 2026-11-09 | 사람 + agent, 2026-11-09 |
| commit·build | main `bf696a8c1` + working tree 수정, `npm run dev` | 같음 |
| Windows 버전 | Windows 11 Home 25H2 (10.0.26200), Smart App Control 켜짐 | 같음 |
| `$PSVersionTable.PSVersion` | 7.6.9 (winget, MSIX) | 5.1.26100.9711 |
| 시작 shell 실행 경로 | `C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.9.0_x64__8wekyb3d8bbwe\pwsh.exe` (PATH의 `WindowsApps\pwsh.exe` alias로 찾음) `-NoLogo -NoExit -Command ". '<run>\shell-init\functions.ps1'"` | `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` 같은 인자 |
| data root·CLI 경로 | `C:\projects\lophn\.dev-data`, `C:\projects\lophn/.cache/dev-cli\lophn.cmd`. W03은 `C:\tmp\로픈 데이터\home` | 같음(W03은 7에서만) |
| `Get-ExecutionPolicy -List` | LocalMachine RemoteSigned, 나머지 Undefined | CurrentUser RemoteSigned, 나머지 Undefined (첫 실행은 agent shell에서 물려받은 Process Bypass였다) |
| harness 버전·`.exe`/`.cmd` 형태 | 실제 `claude.exe`(`~\.local\bin`). codex·cline·omp·opencode는 인자를 찍는 `.exe` 대역, kilo는 `.cmd` 대역 | 같음 |

## 확인표

결과는 `통과`, `실패`, `미확인` 중 하나로 적는다. 환경 제약으로 실행하지 못한 항목은 `미확인`과 이유를 남긴다. 각 행의 재현 절차·관찰값은 아래 결과 기록에 적는다.

| ID | 실행과 기대 결과 | PowerShell 7 | PowerShell 5.1 |
|---|---|---|---|
| W01 | profile이 평소대로 실행된다. 기존 profile 파일과 execution policy가 바뀌지 않는다. 정책이 시작 script를 막으면 실패 원문을 기록하며 우회하지 않는다. | 통과 | 통과 |
| W02 | 기존 harness alias·function이 있으면 그대로 우선한다. wrapper가 이를 덮지 않는다. 없는 경우에만 실제 외부 명령을 감싼다. | 통과 | 통과 |
| W03 | 한글·공백이 있는 data root와 CLI 경로에서도 시작 script를 읽고 hook·GUI·browser 기능을 사용할 수 있다. | 통과 (data root, 고친 뒤). CLI 경로 미확인 | 미확인 (7에서만 봄) |
| W04 | provider를 부르지 않는 native 대역으로 일반 인자·공백 포함 인자·`a&b`를 전달한다. 인자가 분리·변형되지 않고 native 종료 상태가 유지된다. `.cmd` launcher도 확인한다. | `.exe` 통과, `.cmd` 실패 | `.exe` 통과, `.cmd` 실패 |
| W05 | Kilo 호출 중 `KILO_NO_DAEMON=1`, Cline 호출 중 `CLINE_SESSION_BACKEND_MODE=local`이다. 각각 기존 값이 있는 경우와 없는 경우에 호출 뒤 원래 상태로 돌아온다. | 통과 (고친 뒤) | 통과 (고친 뒤) |
| W06 | synthetic hook으로 turn 시작·끝을 보내면 해당 터미널 탭의 상태가 전환된다. 다른 탭/앱에 focus가 있을 때 turn 끝 알림을 확인한다. | 통과 | 통과 |
| W07 | synthetic permission hook을 보내면 권한 물음 상태와 알림이 표시된다. | 통과 | 통과 |
| W08 | `claude gui`가 해당 cwd의 lophn 탭 GUI 진입으로 이어진다. provider 호출은 하지 않는다. | 통과 | 통과 |
| W09 | `claude gui --resume <id>`와 `claude gui --resume=<id>`가 지정한 resume 값을 전달한다. 잘못된 GUI 인자는 사용법과 종료 상태 2를 내고 provider를 실행하지 않는다. | 통과 (고친 뒤) | 통과 (고친 뒤) |
| W10 | PowerShell에서 `& $env:BROWSER '<URL>'`을 실행하면 lophn browser 탭으로 열린다. 아래 특수문자 URL도 확인한다. | 통과 (고친 뒤) | 통과 (고친 뒤, launcher 직접 호출) |
| W11 | bridge가 요청을 거절하거나 연결에 실패하면 OS browser로 fallback한다. URL이 보존되고 shim 재귀 실행·추가 명령 실행이 없다. | 통과 (고친 뒤) | 미확인 (터미널 shell이 7로 바뀜) |
| W12 | browser shim 준비 또는 bridge listen 실패 상태에서도 hook endpoint가 열리고 synthetic hook이 도착한다. | 통과 | 통과 |

### browser URL 예시

lophn이 연 PowerShell 터미널에서 실행한다. 작은따옴표는 PowerShell의 문자열 경계이며 URL 자체에는 포함하지 않는다.

```powershell
& $env:BROWSER 'https://example.com/?q=한글&pipe=|&percent=%PATH%&caret=^&bang=!'
```

- lophn 탭과 OS fallback 양쪽에서 확인한다.
- browser가 표시용으로 URL을 인코딩하는 것과 shim이 query를 잘라내거나 shell이 해석하는 것을 구분한다. 실제 도착 URL을 기록한다.
- `%PATH%`가 환경변수 값으로 바뀌거나 `& | ^ !`가 명령으로 해석되면 실패다.

## 결과 기록

공통 도구(저장소 밖 `C:\tmp\lophn-check\`, 확인 뒤 남겨 둠): `check.ps1 <auto|hook|hookquick|browser|w03>`을 lophn 터미널 안에서 돌려 `result-ps51.txt`·`result-ps7.txt`에 남겼다. native 대역은 인자마다 `<…>`와 두 env를 찍고 `STUB_EXIT`로 끝나는 `argdump.exe`(C# `Add-Type`)를 `codex·cline·omp·opencode.exe`로 복사했고, `kilo.cmd`는 `@"%~dp0argdump.exe" %*`이다. 그 폴더를 PATH 앞에 두고 `npm run dev`를 띄웠다. profile은 marker 변수, `function omp`, `Set-Alias opencode Write-Output`을 둔 임시 file이다.

```text
ID: W01
PowerShell 버전: 7.6.9, 5.1.26100.9711
결과: 통과
재현 절차·명령: 임시 profile의 SHA-256을 시작 전에 저장, 탭에서 `check.ps1 auto`
기대 결과: profile이 돌고, file hash와 `Get-ExecutionPolicy -List`가 그대로
실제 결과·종료 상태·도착 URL: marker `profile ran: …`이 있고 hash same=True, policy unchanged=True. 시작 인자는 `-NoLogo -NoExit -Command ". '…\functions.ps1'"`
로그·화면 근거: result-ps7.txt, result-ps51.txt "--- W01"
환경 제약·후속 조치: 정책이 막는 경우(AllSigned 등)는 재현하지 않았다. 5.1 첫 실행은 agent shell의 `PSExecutionPolicyPreference=Bypass`를 물려받아, 7 확인부터 그 변수를 지우고 dev를 띄웠다.
```

```text
ID: W02
PowerShell 버전: 7.6.9, 5.1.26100.9711
결과: 통과
재현 절차·명령: profile의 `function omp`·`Set-Alias opencode Write-Output` 뒤 `omp gui x`, `opencode hello`, `Get-Command`
기대 결과: 사용자 정의가 그대로, 나머지(claude·codex·kilo·cline)만 lophn wrapper
실제 결과·종료 상태·도착 URL: `USER omp function: gui x`, `hello`. omp=사용자 Function, opencode=Alias, 나머지는 wrapper Function
로그·화면 근거: result-*.txt "--- W02"
환경 제약·후속 조치: 없음
```

```text
ID: W03
PowerShell 버전: 7.6.9
결과: 통과 (data root, browser는 고친 뒤). CLI 경로는 미확인
재현 절차·명령: `LOPHN_DEV_HOME='C:\tmp\로픈 데이터\home' npm run dev`, 탭에서 `check.ps1 w03`, 다른 탭에서 `claude gui`
기대 결과: 시작 층, hook, GUI, `$BROWSER`가 모두 돈다
실제 결과·종료 상태·도착 URL: `LPN_SHELL_INIT=C:\tmp\로픈 데이터\home\run\shell-14116\shell-init`, wrapper 정의됨, synthetic hook으로 탭이 작업 중→끝남, `claude gui` GUI 진입. 터미널 코드페이지 949에서 `BROWSER=C:\tmp\로픈 데이터\home\run\browser-7a2b6176fa43\browser.exe`, `& $env:BROWSER 'https://example.com/w03'` exit 0, lophn browser 탭으로 열림
로그·화면 근거: result-ps7.txt "--- W03"(마지막 실행)
환경 제약·후속 조치: 고치기 전 `.cmd` shim은 exit 1 `Cannot find module 'C:\tmp\嚥≪뮉逾??怨쀬뵠??home\run\shell-31928\browser.js'`였다(cmd가 batch를 949로 읽음). 설치본(`package --dir`)은 Smart App Control이 서명 없는 `lophn-desktop.exe`를 막아 한글 설치 경로의 `bin\lophn.cmd`를 못 봤다(이슈 `windows-unsigned-blocked-by-smart-app-control`). dev CLI launcher는 저장소 경로가 ASCII여야 한다(`win-install.ts` 주석).
```

```text
ID: W04
PowerShell 버전: 7.6.9, 5.1.26100.9711
결과: `.exe` 통과, `.cmd` 실패
재현 절차·명령: `codex plain 'with space' 'a&b'`, `cline …`, `kilo …`(.cmd), 각각 `$env:STUB_EXIT='7'`로 한 번 더
기대 결과: 인자 셋이 그대로, 종료 상태 7 유지
실제 결과·종료 상태·도착 URL: codex `<--no-daemon> <plain> <with space> <a&b>` exit 0/7, cline `<plain> <with space> <a&b>` exit 0/7. kilo.cmd는 `<plain> <with space> <a>` 뒤 `'b'은(는) 내부 또는 외부 명령…` exit 1, `x`만 넘기면 exit 7
로그·화면 근거: result-*.txt "--- W04"
환경 제약·후속 조치: `.cmd`의 `a&b`는 wrapper 없이 `kilo.cmd plain 'a&b'`로 불러도 같다. PowerShell이 공백 없는 인자를 따옴표 없이 cmd에 넘기는 동작이라 lophn이 고칠 자리가 아니다. 처음에는 script 안에서 wrapper를 부르면 `$script:__lophn_native_*`가 비어 모두 실패했다(고침).
```

```text
ID: W05
PowerShell 버전: 7.6.9, 5.1.26100.9711
결과: 통과 (고친 뒤)
재현 절차·명령: 값 없음/`orig`인 상태에서 `kilo run`, `kilo daemon`, `cline task`, `cline hub`
기대 결과: 호출 중 `1`·`local`, 뒤에는 없음/`orig`. daemon·hub에는 두지 않음
실제 결과·종료 상태·도착 URL: 호출 중 `KILO_NO_DAEMON=<1>`·`CLINE_SESSION_BACKEND_MODE=<local>`, 뒤 isNull=True/`orig`, daemon·hub는 `orig`
로그·화면 근거: result-*.txt "--- W05"
환경 제약·후속 조치: 고치기 전 PowerShell 7은 없던 값을 빈 문자열로 남겼다(isNull=False, 뒤 명령에 `KILO_NO_DAEMON=<>`). 5.1의 고친 판 확인은 lophn 밖에서 같은 `functions.ps1`을 dot-source해 했다.
```

```text
ID: W06
PowerShell 버전: 7.6.9, 5.1.26100.9711
결과: 통과
재현 절차·명령: `check.ps1 hook`: `lophn hook claude SessionStart|UserPromptSubmit`, 10초 동안 다른 앱으로 focus, `Stop {last_assistant_message:"synthetic turn end"}`
기대 결과: 탭이 작업 중→끝남, focus가 밖이면 turn 끝 알림
실제 결과·종료 상태·도착 URL: 사람 확인 y. 7은 lophn 밖 앱에 focus를 두었을 때 "synthetic turn end" 알림. 첫 7 실행에서 알림이 없었던 것은 focus가 lophn 안이었던 것으로 본다
로그·화면 근거: result-*.txt "--- W06"
환경 제약·후속 조치: 없음
```

```text
ID: W07
PowerShell 버전: 7.6.9, 5.1.26100.9711
결과: 통과
재현 절차·명령: `UserPromptSubmit` 뒤 `PermissionRequest {tool_name:"Bash", tool_input:{command:"echo synthetic"}}`, 이어 `PostToolUse`·`Stop`·`SessionEnd`
기대 결과: 권한 물음 상태와 알림, 풀린 뒤 끝남
실제 결과·종료 상태·도착 URL: 사람 확인 y, 알림 문구 "Bash"
로그·화면 근거: result-*.txt "--- W07"
환경 제약·후속 조치: 없음
```

```text
ID: W08
PowerShell 버전: 7.6.9, 5.1.26100.9711
결과: 통과
재현 절차·명령: 새 탭에서 `claude gui`, 메시지는 보내지 않음
기대 결과: 그 탭이 GUI로 바뀜
실제 결과·종료 상태·도착 URL: 사람 확인 "gui 뜸"
로그·화면 근거: 화면
환경 제약·후속 조치: 없음
```

```text
ID: W09
PowerShell 버전: 7.6.9, 5.1.26100.9711
결과: 통과 (고친 뒤)
재현 절차·명령: `LPN_TERMINAL_HOOK`을 확인용 pipe(`pipe-capture.mjs`)로 잠시 바꾸고 `claude gui`, `claude gui --resume abc_1.x-y`, `claude gui --resume=abc_2`. 잘못된 인자 여섯(`extra`, `--resume`, `--resume 'a b'`, `--resume=`, `--resume x y`, `--Resume=x`)
기대 결과: payload에 resume 값과 cwd, 잘못된 인자는 usage와 종료 2, claude 실행 없음
실제 결과·종료 상태·도착 URL: `{"event":"lophn-gui","payload":{"resume":"abc_1.x-y","cwd":"C:\\projects"}}` 등 셋 다 도착, exit 0. 잘못된 인자는 모두 exit 2, claude process 수 그대로, 화면에 `usage: claude gui [--resume <id>]`
로그·화면 근거: result-*.txt "--- W09"
환경 제약·후속 조치: 고치기 전에는 PowerShell의 `$OutputEncoding`이 BOM 있는 UTF-8이면 파이프 글 앞의 BOM 때문에 `lophn hook`이 JSON parse에서 조용히 버렸다(고침).
```

```text
ID: W10
PowerShell 버전: 7.6.9, 5.1.26100.9711
결과: 통과 (고친 뒤)
재현 절차·명령: `& $env:BROWSER '<예시 URL>'`, `& $env:BROWSER 'https://example.com/?x=1&echo>C:\tmp\lophn-check\inj&y=2'`
기대 결과: lophn browser 탭에 URL 그대로
실제 결과·종료 상태·도착 URL: 7의 lophn 터미널에서 둘 다 exit 0, lophn 탭 주소창 `https://example.com/?q=%ED%95%9C%EA%B8%80&pipe=|&percent=%PATH%&caret=^&bang=!`, `https://example.com/?x=1&echo%3EC:\tmp\lophn-check\inj&y=2`(한글·`>`는 browser의 표시 인코딩). `%PATH%`가 풀리지 않았고 inj file 없음. 5.1은 터미널 shell이 7로 바뀌어 lophn 터미널로는 못 보고, 5.1에서 launcher를 바로 불러 인자가 그대로 도착함을 봤다(대역 browser.js가 argv를 찍음, `C:\tmp\로픈 런처`)
로그·화면 근거: result-ps7.txt "--- W10"(마지막 실행)
환경 제약·후속 조치: 고치기 전 `.cmd` shim은 예시 URL에 `&은(는) 예상되지 않았습니다.` exit 1, 둘째 URL에 `?x=1`만 열리고 `echo>…\inj`가 실행되어 file이 생겼다(이슈 `windows-browser-shim-cmd`, 고쳐 닫음).
```

```text
ID: W11
PowerShell 버전: 7.6.9, 5.1.26100.9711
결과: 통과 (고친 뒤, 7)
재현 절차·명령: 연결 실패는 그 탭에서 `LPN_BROWSER_BRIDGE`의 socket을 없는 pipe로 바꿈. 거절은 Settings의 웹 링크를 시스템 browser로 바꿈. 각각 W10의 두 URL
기대 결과: OS browser에 URL 그대로, 추가 명령 없음
실제 결과·종료 상태·도착 URL: 넷 모두 exit 0(155–162 ms). 주소창 `https://example.com/?q=%ED%95%9C%EA%B8%80&pipe=|&percent=%PATH%&caret=^&bang=!`, `https://example.com/?x=1&echo%3EC:\tmp\lophn-check\inj&y=2`. inj file 없음
로그·화면 근거: result-ps7.txt "--- W11"(마지막 실행)
환경 제약·후속 조치: 사람 확인으로 연결 실패·거절 모두 lophn 밖 기본 browser에 탭 하나씩 열렸다. 고치기 전에는 cmd에서 먼저 깨져 fallback에 닿지 못했다.
```

```text
ID: W12
PowerShell 버전: 7.6.9, 5.1.26100.9711
결과: 통과
재현 절차·명령: `squat-bridge.mjs <hash>`가 새 electron pid마다 `\\.\pipe\lophn-<hash>-shell-<pid>-b`를 먼저 연 상태로 `npm run dev`, 탭에서 `check.ps1 hookquick`
기대 결과: bridge만 꺼지고 hook은 도착
실제 결과·종료 상태·도착 URL: dev log `browser bridge is off: cannot listen (Error: listen EADDRINUSE … shell-20712-b)`, `-h` pipe는 열림. 터미널 `BROWSER`·`LPN_BROWSER_BRIDGE` 없음, synthetic hook으로 탭이 작업 중→끝남(사람 확인 y)
로그·화면 근거: result-*.txt "--- W12", squat.log
환경 제약·후속 조치: shim 쓰기 실패 쪽은 재현하지 않았다(listen 실패로 확인).
```

### 확인 중 고친 것

- `packages/base/os/socket-dir.ts`: win32 pipe 자리를 data root의 구분자·끝 구분자·대소문자와 상관없이 같게 했다. core는 `C:\…\.dev-data`, dev 도구는 `C:\…/.dev-data`로 서로 다른 pipe를 찾아 `npm run dev`가 "core control이 ready가 되지 않는다"로 뜨지 않았다.
- `packages/shell/terminal-host/shell-integration.ts`: PowerShell wrapper의 실제 경로를 `$global:`에 둔다(`$script:`는 script 안에서 부르면 비었다). Kilo·Cline env를 되돌릴 때 없던 값은 지운다(PowerShell 7이 빈 값을 남겼다).
- `packages/coding-agent/local/hook.ts`: stdin 앞의 BOM을 뗀다.
- `packages/shell/terminal-host/env.ts`·`cli.ts`: PowerShell 7을 PATH에서도 찾고(winget·Store MSIX는 `WindowsApps\pwsh.exe` alias로만 보인다), 존재 확인을 `lstat`으로 한다(alias는 `stat`이 EACCES).
- `packages/shell/main/browser-bridge/shim.ts`·`desktop/wiring/bridge.ts`: Windows `$BROWSER`를 `.cmd`에서 data root `run\browser-<hash>\browser.exe`(OS의 .NET Framework `csc.exe`로 build하는 C# launcher)로 바꿨다. cmd.exe를 거치지 않아 URL의 `& | % ^ !`가 글자 그대로 가고, 경로를 UTF-16으로 다뤄 한글 data root에서도 돈다.
- `tools/dev.ts`: `LOPHN_DEV_HOME`이 `C:\…` 경로를 받는다(전에는 `/`로 시작해야 해서 Windows에서 쓸 수 없었다). 사람의 `%USERPROFILE%\.lophn`은 여전히 거절한다.

## 승인과 남은 확인

- [x] PowerShell 7 결과와 근거를 모두 기록했다.
- [x] PowerShell 5.1 결과와 근거를 모두 기록했다.
- [ ] 실패·미확인 항목을 lead에게 전달했고, 통과로 바꿔 쓰지 않았다. (이슈 `windows-unsigned-blocked-by-smart-app-control`. `windows-browser-shim-cmd`는 고쳐 닫음)
- [x] 사람이 Windows 실기 미확인 상태의 land를 승인했다. 기존 full check·E2E·core 기동 gate는 유지한다.
- [ ] lead가 Windows 실기 결과를 review했다.

현재 판정: **hook·PowerShell 시작 층·`claude gui`·`$BROWSER` 중계와 fallback·bridge 실패 격리는 Windows(PowerShell 5.1·7)에서 통과한다. `$BROWSER`는 확인 중 `.cmd`에서 exe launcher로 바꿨다. 한글 설치 경로의 CLI는 미확인이다.**

# bundle file 나눠 쓰기 Windows 수동 확인

## 상태와 범위

- 상태: **Windows 실기 미확인**. Linux test와 check만 통과했다. 통과로 쓰지 않는다.
- 확인 대상: change-log `bundle-file-sharing`·`bundle-file-sharing-windows`(0.23.36 이후 판)의 `npm run dev`.
- 무엇: 봉인된 앱 bundle 사본의 file이 `<data>\bundle-files\<sha256>`과 hardlink로 이어지고, 사본을 지운 뒤에도 남은 사본의 file이 읽기 전용으로 남는지.
- 개발용 data root(`.dev-data`)만 쓴다. 사람의 `%USERPROFILE%\.lophn`을 바꾸지 않는다. 실제 provider를 부르지 않는다.

## 확인표

- [ ] B01 옛 data root 옮기기: 0.23.35 이하로 release를 둘 이상 낸 `.dev-data`를 새 판으로 띄운다. dev log에 data step `apps.bundle-file-sharing-win32` 오류가 없고, `.dev-data\data-migrations.json`에 그 id가 있다.
- [ ] B02 link가 이어졌다: 두 release의 bundle에서 같은 의존 file 하나를 골라 `fsutil hardlink list <bundle>\node_modules\react\index.js`가 두 bundle과 `bundle-files\<sha256>`을 함께 보인다(관리자 PowerShell이 필요할 수 있다).
- [ ] B03 용량: 옮기기 전후로 `.dev-data\apps`와 `.dev-data\bundle-files`를 합친 크기가 release 수만큼 늘지 않는다(Explorer 속성은 hardlink를 두 번 센다. `fsutil volume diskfree`로 전후 빈 공간을 비교한다).
- [ ] B04 새 release: 앱 하나를 고쳐 release를 새로 준비하고 activation한다. 앱이 정상으로 뜨고, 새 bundle의 `node_modules` file도 B02처럼 이어진다.
- [ ] B05 읽기 전용 유지: B04 뒤 지난 bundle의 이어진 file에 `attrib <file>`이 `R`을 보인다.
- [ ] B06 앱 지우기: 같은 의존을 쓰는 앱이 둘 이상일 때 하나를 지운다. 남은 앱이 뜨고, 그 앱 bundle의 이어진 file이 `attrib`에서 `R`이고, 지운 앱만 쓰던 `bundle-files` file은 없어졌다.
- [ ] B07 끊긴 준비: release 준비 도중(봉인 전) core를 끄고 다시 띄워 같은 commit으로 다시 준비한다. 준비가 성공하고 B05가 그대로다.
- [ ] B08 이전 release로 돌아가기: data schema가 같은 지난 release로 돌아간다. 앱이 그 release의 화면으로 뜬다.

## 결과 기록

```text
ID:
결과: 통과 | 실패 | 미확인
재현 절차·명령:
실제 결과:
환경 제약·후속 조치:
```

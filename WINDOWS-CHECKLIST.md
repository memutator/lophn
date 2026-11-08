# platform-ipc Windows 수동 확인

## 상태와 범위

- 상태: **Windows 실기 미확인 — 사람 승인으로 land 진행**.
- 확인 대상: `plan/platform-ipc`의 변경을 포함한 Windows build.
- PowerShell 7(`pwsh.exe`)과 Windows PowerShell 5.1(`powershell.exe`)을 **각각** lophn 터미널의 시작 shell로 실행한다. 이미 열린 터미널 안에서 다른 PowerShell을 실행하는 것으로 대신하지 않는다.
- Linux의 check·smoke 통과는 Windows PowerShell·named pipe·`.cmd` 실행 확인을 대신하지 않는다.
- 사람이 Windows 미확인을 남긴 채 land하도록 승인했다. 원래의 Windows 확인 선행 조건은 이 승인으로 변경됐으며, 아래 항목은 land 뒤에도 별도로 확인한다. 미확인·환경 제약·실패를 통과로 쓰지 않는다.
- Windows foreground 감지·TUI 종료 signal·GUI toggle·adapter 전체 실행은 이 acceptance의 지원 범위가 아니다. `claude gui`는 탭 GUI 진입을 확인한다.

## 준비와 안전 경계

- [ ] 확인할 commit과 Windows build가 일치한다.
- [ ] 별도의 개발용 data root를 사용한다. 사람의 `~/.lophn`을 바꾸지 않는다.
- [ ] 한글·공백이 있는 data root와 CLI 설치 경로를 준비한다. 기존 data를 이동하지 않는다.
- [ ] 실제 provider를 호출하지 않는 synthetic hook과 GUI 진입으로 확인한다. 실제 model 호출이 필요하면 별도 허락을 받는다.
- [ ] 사용자 profile·alias·function과 execution policy를 덮거나 우회하지 않는다. 정책이 시작 script를 막으면 그대로 기록한다.
- [ ] hook 설치가 필요하면 사람이 Settings의 기존 Install hooks 경로를 사용한다. foreground 기반 자동 dialog를 전제로 삼지 않는다. 개발용 설정 밖 변경이 필요하면 먼저 중단하고 알린다.
- [ ] bridge 실패 확인은 개발용 인스턴스에서만 한다. bridge를 끄는 재현 방법을 기록하고 hook endpoint까지 함께 종료하지 않는다.

## 환경 기록

| 항목 | PowerShell 7 | PowerShell 5.1 |
|---|---|---|
| 확인자·일시 | 미기록 | 미기록 |
| commit·build | 미기록 | 미기록 |
| Windows 버전 | 미기록 | 미기록 |
| `$PSVersionTable.PSVersion` | 미기록 | 미기록 |
| 시작 shell 실행 경로 | 미기록 | 미기록 |
| data root·CLI 경로 | 미기록 | 미기록 |
| `Get-ExecutionPolicy -List` | 미기록 | 미기록 |
| harness 버전·`.exe`/`.cmd` 형태 | 미기록 | 미기록 |

## 확인표

결과는 `통과`, `실패`, `미확인` 중 하나로 적는다. 환경 제약으로 실행하지 못한 항목은 `미확인`과 이유를 남긴다. 각 행의 재현 절차·관찰값은 아래 결과 기록에 적는다.

| ID | 실행과 기대 결과 | PowerShell 7 | PowerShell 5.1 |
|---|---|---|---|
| W01 | profile이 평소대로 실행된다. 기존 profile 파일과 execution policy가 바뀌지 않는다. 정책이 시작 script를 막으면 실패 원문을 기록하며 우회하지 않는다. | 미확인 | 미확인 |
| W02 | 기존 harness alias·function이 있으면 그대로 우선한다. wrapper가 이를 덮지 않는다. 없는 경우에만 실제 외부 명령을 감싼다. | 미확인 | 미확인 |
| W03 | 한글·공백이 있는 data root와 CLI 경로에서도 시작 script를 읽고 hook·GUI·browser 기능을 사용할 수 있다. | 미확인 | 미확인 |
| W04 | provider를 부르지 않는 native 대역으로 일반 인자·공백 포함 인자·`a&b`를 전달한다. 인자가 분리·변형되지 않고 native 종료 상태가 유지된다. `.cmd` launcher도 확인한다. 대역을 썼다면 파일과 실행 방법을 기록한다. | 미확인 | 미확인 |
| W05 | Kilo 호출 중 `KILO_NO_DAEMON=1`, Cline 호출 중 `CLINE_SESSION_BACKEND_MODE=local`이다. 각각 기존 값이 있는 경우와 없는 경우에 호출 뒤 원래 상태로 돌아온다. provider를 부르지 않는 대역으로 확인한다. | 미확인 | 미확인 |
| W06 | synthetic hook으로 turn 시작·끝을 보내면 해당 터미널 탭의 상태가 전환된다. 다른 탭/앱에 focus가 있을 때 turn 끝 알림을 확인한다. | 미확인 | 미확인 |
| W07 | synthetic permission hook을 보내면 권한 물음 상태와 알림이 표시된다. 실제 provider 요청으로 대신하지 않는다. | 미확인 | 미확인 |
| W08 | `claude gui`가 해당 cwd의 lophn 탭 GUI 진입으로 이어진다. provider 호출은 하지 않는다. Windows toggle이나 adapter 전체 실행 성공으로 해석하지 않는다. | 미확인 | 미확인 |
| W09 | `claude gui --resume <id>`와 `claude gui --resume=<id>`가 지정한 resume 값을 전달한다. 잘못된 GUI 인자는 사용법과 종료 상태 2를 내고 provider를 실행하지 않는다. | 미확인 | 미확인 |
| W10 | PowerShell에서 `& $env:BROWSER '<URL>'`을 실행하면 lophn browser 탭으로 열린다. 아래 특수문자 URL도 확인한다. | 미확인 | 미확인 |
| W11 | bridge가 요청을 거절하거나 연결에 실패하면 OS browser로 fallback한다. URL이 보존되고 shim 재귀 실행·추가 명령 실행이 없다. 각각의 실패 재현 방법을 기록한다. | 미확인 | 미확인 |
| W12 | browser shim 준비 또는 bridge listen 실패 상태에서도 hook endpoint가 열리고 synthetic hook이 도착한다. hook까지 끈 상황으로 대신하지 않는다. | 미확인 | 미확인 |

### browser URL 예시

lophn이 연 PowerShell 터미널에서 실행한다. 작은따옴표는 PowerShell의 문자열 경계이며 URL 자체에는 포함하지 않는다.

```powershell
& $env:BROWSER 'https://example.com/?q=한글&pipe=|&percent=%PATH%&caret=^&bang=!'
```

- lophn 탭과 OS fallback 양쪽에서 확인한다.
- browser가 표시용으로 URL을 인코딩하는 것과 shim이 query를 잘라내거나 shell이 해석하는 것을 구분한다. 실제 도착 URL을 기록한다.
- `%PATH%`가 환경변수 값으로 바뀌거나 `& | ^ !`가 명령으로 해석되면 실패다.

## 결과 기록

실패·미확인은 항목별로 아래 형식을 복사해 남긴다. 통과도 재현 절차와 관찰 결과를 남긴다. 로그에서 인증 key·token 등 secret은 제거한다.

```text
ID:
PowerShell 버전:
결과: 통과 / 실패 / 미확인
재현 절차·명령:
기대 결과:
실제 결과·종료 상태·도착 URL:
로그·화면 근거:
환경 제약·후속 조치:
```

## 승인과 남은 확인

- [ ] PowerShell 7 결과와 근거를 모두 기록했다.
- [ ] PowerShell 5.1 결과와 근거를 모두 기록했다.
- [ ] 실패·미확인 항목을 lead에게 전달했고, 통과로 바꿔 쓰지 않았다.
- [x] 사람이 Windows 실기 미확인 상태의 land를 승인했다. 기존 full check·E2E·core 기동 gate는 유지한다.
- [ ] lead가 Windows 실기 결과를 review했다.

현재 판정: **Windows 실기 미확인. 사람 승인으로 land 진행하며 Windows 통과를 뜻하지 않는다.**

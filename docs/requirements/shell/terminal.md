---
type: requirements
concerns: [shell/terminal]
---
# shell/terminal

프로젝트 폴더에서 사람이 쓰는 터미널 탭의 시작·focus 입력·환경·출력 보존을 맡는다; 탭 배치는 shell/workspace를 따른다.

## 요구

**[R1]** 사람은 프로젝트에 등록된 폴더 하나를 골라 터미널 탭을 열고 등록 폴더가 하나이면 그 폴더를 시작 위치로 쓰며 여러 개이면 선택 전에는 시작하지 않는다.
- 이유: 프로젝트의 어느 폴더에서 명령이 실행되는지 추측하지 않게 한다.
- 확인: 한 폴더·여러 폴더·없는 폴더 프로젝트를 각각 열어 실제 시작 위치와 선택 전 미실행을 확인한다.
- 의도: shell#I7

**[R2]** 시작 폴더가 없거나 디렉터리가 아니거나 읽을 수 없으면 이유를 표시하고 다른 폴더로 조용히 대신 시작하지 않는다.
- 이유: 시작 위치를 바꾸면 같은 명령도 다른 파일을 바꿀 수 있다.
- 확인: 등록 폴더를 옮긴 뒤 터미널을 열어 홈 폴더나 작업 위치로 fallback하지 않는지 본다.
- 의도: shell#I7

**[R3]** 터미널은 사람이 선택한 탭에 키보드 입력·붙여넣기·제어 키를 전달하고 다른 탭에 입력을 보내지 않는다.
- 이유: 현재 입력 대상이 사람의 focus와 일치해야 한다.
- 확인: 터미널 두 개와 문서 탭 사이를 오가며 focus가 있는 터미널만 입력받는지 본다.
- 의도: shell#I7

**[R4]** 일반 터미널은 Linux·macOS의 사용자 login shell 또는 Windows PowerShell 7·없으면 표시한 5.1을 직접 시작하고 ticket의 사람이 누른 [Start]는 coding-agent/sessions의 검증된 harness executable·분리 인자를 PTY로 직접 시작한다.
- 이유: 사람 shell과 ticket TUI 시작의 대상·허락을 구별한다.
- 확인: 일반 탭에서 표시한 shell이 시작되고 [Start]에서는 exact ticket·harness·방식에 묶인 일회 handle과 검증한 adapter로 지정 TUI만 열리는지 본다.
- 의도: shell#I7

**[R5]** 일반 shell에는 플랫폼 credential을 주입하지 않고 사람이 허락한 coding TUI에는 platform/identity의 검증된 보호 loader로 해당 connection credential만 붙이며 token 원문은 argv·prompt·PTY·출력·공통 환경에 넣지 않는다.
- 이유: TUI 연결 준비가 일반 shell의 플랫폼 권한 상속으로 번지지 않게 한다.
- 확인: 일반 shell의 환경은 그대로이고 [Start] child의 MCP·CLI만 같은 connection을 사용하며 app secret·user token·confirmation handle이 전달되지 않는지 본다.
- 의도: platform#I2, shell#I7

**[R6]** 터미널은 OS 사용자 권한으로 동작하며 lophn 앱 sandbox가 아니라고 표시하고 프로젝트 폴더 밖 접근이나 사람이 실행한 외부 coding agent의 행동을 lophn이 제한한다고 안내하지 않는다.
- 이유: 프로젝트 시작 위치와 권한 격리는 같은 보장이 아니다.
- 확인: 터미널 첫 열기 안내에 OS 사용자 권한과 프로젝트 시작 위치가 서로 다른 뜻으로 보이는지 본다.
- 의도: shell#I7, platform#I2

**[R7]** 탭 전환·다른 공간 이동·터미널 숨김은 shell과 출력을 유지하고 같은 Electron 실행 동안 최근 출력은 터미널마다 최대 10,000줄과 UTF-8 5MiB 중 먼저 도달한 범위까지 보존한다.
- 이유: 화면 전환이 작업 종료가 되어서는 안 되지만 무한 출력이 다른 화면을 막아서도 안 된다.
- 확인: 숨긴 탭에서 출력을 내고 돌아와 같은 shell과 출력을 읽으며 상한을 넘으면 오래된 출력부터 제외되고 제외 표시가 보이는지 본다.
- 의도: shell#I7, shell#I4

**[R8]** 터미널 원시 출력은 disk·ledger·blob·일반 log·세션 문맥에 자동 저장하지 않고 shell renderer가 재생성되어도 살아 있는 terminal host의 최근 출력 범위만 다시 표시한다.
- 이유: password·token이 포함될 수 있는 출력의 보존 범위를 좁힌다.
- 확인: secret 모양의 출력을 내고 저장소·진단·agent 문맥에 자동 사본이 없으며 renderer crash 뒤 최근 출력이 다시 보이는지 본다.
- 의도: platform#I2, shell#I7

**[R9]** shell이 종료되면 종료 상태·확인된 exit code 또는 결과 불명을 출력 옆에 남기고 다시 시작은 사람이 누른 때만 새 shell로 수행한다.
- 이유: 실패를 자동 명령 반복으로 고치거나 성공으로 추측하지 않는다.
- 확인: 정상 종료·강제 종료·host crash를 구별하고 이전 입력을 재생하지 않는지 본다.
- 의도: shell#I7

**[R10]** 살아 있는 터미널 탭을 닫거나 Electron을 종료할 때에는 연결된 작업이 종료될 수 있음을 확인하고 취소하면 유지하며 확정한 종료 뒤에는 해당 shell과 child의 종료를 확인한다.
- 이유: 탭 닫기가 사람이 진행 중인 외부 작업을 말없이 버리지 않게 한다.
- 확인: 실행 중 명령에서 닫기 취소와 종료를 각각 해 보고 종료 확인 실패는 결과 불명으로 남는지 본다.
- 의도: shell#I7

**[R11]** 터미널 출력의 제어 문자열은 제목·색·커서 같은 허용 표시로만 해석하고 clipboard 쓰기·파일 열기·앱 command·자동 URL 열기·플랫폼 결정을 실행하지 않는다.
- 이유: 출력은 실행 지시가 아니라 터미널에 표시할 자료다.
- 확인: clipboard와 링크 제어 문자열·가짜 confirmation 출력을 보내도 OS나 플랫폼 행동이 생기지 않는지 본다.
- 의도: platform#I2, shell#I3

**[R12]** coding TUI 시작 직전에 사람의 exact 시작 handle·ticket 현재 판·connection scope·harness executable/profile·등록 project 폴더를 다시 검증하고 다른 harness·cwd로 자동 대체하지 않으며 첫 prompt 전달과 중복 방지는 coding-agent/sessions를 따른다.
- 이유: 클릭 뒤 바뀐 대상이나 중복 IPC가 다른 일을 시작하면 안 된다.
- 확인: ticket·executable·scope·folder 변경은 거절하고 같은 시작 요청 재전달은 같은 runtime만 반환하며 준비·전달 결과 불명 뒤 재전송·재spawn이 없는지 본다.
- 의도: shell#I7, platform#I2

**[R13]** 터미널 배치·renderer 복원은 기존 host의 관측 가능한 runtime에만 다시 연결하고 Electron 재시작이나 host 결과 불명 뒤 coding TUI를 자동 spawn·resume하거나 첫 prompt를 재생하지 않는다.
- 이유: 다시 보는 일과 다시 실행하는 일은 다르다.
- 확인: renderer 재생성은 살아 있는 동일 generation을 표시하고 Electron 재시작은 상태 unknown과 사람이 누르는 새 시작으로 남으며 ticket claim은 session 관측과 독립인지 본다.
- 의도: shell#I7, shell#I4

## 열린 질문

## 버린 것

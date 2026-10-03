---
type: domain-model
concerns: [shell/terminal]
---
# shell/terminal

Electron 실행 동안만 존재하는 터미널 runtime 값과 출력 buffer를 정의하며 entity·ledger 표·command·event를 만들지 않는다.

## TerminalRuntime (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `terminal_ref` | string | 아니오 | main이 만든 불투명 메모리 참조; credential 아님 | 탭 대응 |
| `project` | `prj` ID | 아니오 | → documents/projects | 프로젝트 |
| `folder_ref` | string | 아니오 | 등록 폴더를 main이 해석 | 시작 위치 |
| `cwd_at_start` | string | 아니오 | 실제 정규화 디렉터리; 존재·접근 검사 | 시작 경로 |
| `shell_path` | string | 아니오 | OS 사용자 shell의 확인한 실행 파일 | 직접 spawn 대상 |
| `state` | `starting \| running \| exited \| unknown` | 아니오 | 상태표 | 실제 관측 |
| `generation` | integer | 아니오 | 새 시작마다 증가 | 늦은 출력 제외 |
| `columns`, `rows` | integer | 아니오 | 1 이상의 정수; 현재 표시 영역에서 계산 | PTY 치수 |
| `exit_code` | integer | 예 | 실제 시작한 shell의 확인한 종료에만 값 | 종료 코드 |
| `failure_reason` | string | 예 | 시작 실패·종료 확인 실패의 안전한 설명; 본문·credential 없음 | shell/terminal#R2,R9의 이유 |
| `output_seq` | integer | 아니오 | host 내부 출력 chunk 순서; ledger seq 아님 | 재표시 cursor |
| `dropped_output` | boolean | 아니오 | 상한·renderer 단절 누락이면 true | 출력 일부 없음 |

### 상태

| 전 | 후 | 조건 |
|---|---|---|
| 없음 | `starting` | 사람이 시작; 등록 폴더·shell·caller 검사 통과 |
| `starting` | `running` | PTY 실제 생성 성공 |
| `starting` | `exited` | 시작 실패가 확인됨 |
| `running` | `exited` | PTY 종료가 확인됨; exit code는 확인된 경우만 |
| `starting`, `running` | `unknown` | terminal host 사망·연결 소실; 성공 추정 금지 |
| `exited`, `unknown` | `starting` | 사람의 새 시작과 이전 child group 종료 확인; 새 generation; 옛 입력 재생 없음 |

## 정책

- **PTY 소유.** Electron main이 감독하는 별도 terminal host가 PTY handle·child group·출력 ring buffer를 소유한다. 창 변경은 PTY 종료가 아니며 main 종료·탭의 명시 폐기가 종료 경계다.
- **시작.** 등록 폴더가 하나면 이를 사용하고 여러 개면 선택 전 시작하지 않는다. 폴더 존재·디렉터리·접근을 확인하며 실패하면 다른 폴더로 대신 시작하지 않는다. Linux/macOS는 OS 사용자 login shell, Windows는 PowerShell 7 우선·없으면 표시한 5.1을 직접 spawn한다. 실행 파일·argv·cwd를 구별하며 OS 사용자 권한이라는 안내를 앱 sandbox 보장과 섞지 않는다.
- **환경.** OS 사용자 환경에서 플랫폼이 만든 token·connection·handle·내부 endpoint를 제외한다. 플랫폼 secret 주입은 없다. terminal host 제어 pipe는 shell child에 상속하지 않는다.
- **출력.** 터미널별 ring buffer는 최대 10,000줄·5,242,880 UTF-8 bytes 중 먼저 도달한 한도다. 가장 오래된 완전 chunk부터 제외하며 남은 큰 chunk는 안전한 문자 경계로 잘라 dropped_output을 켠다. disk·ledger·blob 기록은 없다.
- **입력.** 살아 있는 shell renderer main frame의 해당 터미널 focus와 generation을 main이 확인하여 키보드·붙여넣기·제어 키를 host에 전달한다. OSC 52 clipboard·OSC 8 자동 링크·임의 escape 기반 host 동작은 막는다.
- **복원.** 시작 폴더 선택·탭 위치만 → shell/workspace에 남는다. runtime·출력·입력 history·진행 명령은 Electron 재시작에 복원하지 않는다.
- **종료.** 살아 있는 탭 폐기·Electron 종료는 사람이 작업 종료 영향을 확인해야 진행하며 취소하면 runtime과 출력을 유지한다. host는 Linux/macOS process group, Windows ConPTY·Job Object로 실제 child를 종료한다. 종료 확인 전 PID만으로 성공·재시작 가능을 주장하지 않는다.

---
type: requirements
concerns: [coding-agent/sessions]
---
# coding-agent/sessions

ticket을 외부 harness로 시작하는 사람 동작, 첫 prompt와 터미널 탭의 TUI, session 관측을 맡는다. 터미널 탭은 shell/terminal, credential은 coding-agent/connection, 실제 작업 권리는 coding-agent/tickets다. coding loop나 durable 외부 session supervisor는 만들지 않는다.

## 요구

**[R1]** 시작은 ticket·harness·방식을 고르는 동작 하나로 제공하고 지금은 사람이 자기 터미널에서 직접 시작하거나 ticket의 [Start]를 눌러 lophn의 project 터미널 탭에서 TUI로 여는 두 방식만 허용한다.
- 이유: 익숙한 harness를 유지하면서 복사·설정·시작의 복잡도를 줄인다.
- 확인: 두 방식이 같은 지정 ticket의 MCP claim→작업→보고로 이어지고 문제 발생·ticket 생성·summary 조회만으로 coding process가 열리지 않는다.
- 의도: coding-agent#I2

**[R2]** [Start]는 그 ticket과 선택 harness를 시작하는 사람 허락이며 별도 confirmation window를 요구하지 않고 credential 생성·scope 확대·앱 activation·harness의 자체 trust 결정을 대신하지 않는다.
- 이유: 시작 허락과 플랫폼의 다른 권한을 합치지 않는다.
- 확인: 클릭 없이 시작 요청이 거절되고 클릭해도 미연결 credential 발급·trust 허락은 coding-agent/connection과 해당 제품의 사람 절차에 남는다.
- 의도: coding-agent#I2

**[R3]** TUI는 ticket 대상 앱의 연결 source가 속한 등록 project에서 사람이 고른 폴더로 열고 첫 prompt에는 지정 ticket 읽기·MCP claim·작업·완료 보고 지시와 근거 읽을 곳만 넣는다.
- 이유: ticket 본문·secret을 복제하지 않고 올바른 작업 자리에서 실제 계약을 읽게 한다.
- 확인: 여러 폴더는 사람이 고른 등록 폴더를 쓰고 source나 project가 없으면 자동 임의 cwd 대신 연결 안내로 끝나며 첫 prompt에 token·전체 log·수리 묶음이 없다.
- 의도: coding-agent#I2, coding-agent#I3

**[R4]** harness 선택은 coding-agent/harnesses의 사람 선택과 기본 규칙을 따르고 실행 직전에 executable·profile·지원 version·연결 scope·ticket 현재 상태를 다시 확인하며 다른 harness로 자동 대체하지 않는다.
- 이유: 오래된 감지와 클릭 당시 정보가 실제 실행 대상을 바꾸면 안 된다.
- 확인: executable 이동·회수·다른 profile·이미 claim된 ticket이면 안전한 다음 행동으로 끝나고 자동 재감지·재발급·새 harness 실행은 없다.
- 의도: coding-agent#I2

**[R5]** 첫 prompt는 검증된 harness 실행 adapter로 한 번만 전달하고 준비 신호를 확인하지 못했거나 전달 결과가 모르면 자동 재전송·재시작하지 않는다.
- 이유: prompt를 shell 명령으로 해석하거나 같은 일을 두 번 시키지 않아야 한다.
- 확인: 공백·줄바꿈·shell 문자가 분리 인자 또는 PTY 입력으로만 들어가고 readiness timeout·응답 유실에서는 unknown과 터미널 확인 안내가 남는다.
- 의도: coding-agent#I2

**[R6]** session 상태는 starting·ready·working·waiting_input·ended·unknown으로 관측하며 실제 process·hook·plugin·extension·검증된 출력 evidence와 시각·출처를 붙이고 관측이 없거나 낡으면 unknown으로 둔다.
- 이유: process 생존·MCP 연결·무출력만으로 작업이나 입력 대기를 알 수 없다.
- 확인: hook 없는 제품과 lophn 재시작에서는 unknown이며 process exit 증거는 ended이지 ticket 완료·테스트 통과가 아니다.
- 의도: coding-agent#I4

**[R7]** 외부 session ID는 harness가 실제 제공한 hook·plugin·extension·protocol 또는 session file evidence에서만 얻고 터미널 탭·connection·lophn agent session ID를 대신 쓰지 않는다.
- 이유: ID 부재를 가짜 identity로 채우면 잘못된 resume와 결과 연결을 만든다.
- 확인: 시작 때 ID가 없으면 없음으로 표시하고 pi의 transcript 경로와 제품 ID를 나누며 미검증 Hermes·OpenClaw ID는 unknown으로 남는다.
- 의도: coding-agent#I4

**[R8]** 자기 터미널에서 시작한 session은 lophn이 시작 허락·process 소유·첫 prompt 전달을 기록했다고 표시하지 않고 유효한 credential의 MCP와 명시 evidence만 연결한다.
- 이유: 같은 connection을 쓰는 여러 외부 session을 하나의 제어 대상으로 오인하지 않는다.
- 확인: connection과 cwd가 같아도 session을 추측해 합치지 않고 관측 근거가 없는 외부 session의 상태·종료·resume는 unknown이다.
- 의도: coding-agent#I4

**[R9]** 시작 접수·process 시작·session 준비·ticket claim·작업 보고는 서로 별개이며 session 시작이나 working 관측은 claim 생성·갱신·반납·완료 판정을 바꾸지 않는다.
- 이유: 작업 권리와 외부 프로세스 관측은 다른 사실이다.
- 확인: 두 session의 같은 ticket 시작 경쟁에서도 coding-agent/tickets의 claim 하나만 성공하고 ended·unknown·무호출로 claim을 자동 해제하거나 연장하지 않는다.
- 의도: coding-agent#I4

**[R10]** lophn 재시작·실행 실패 뒤 새 TUI는 사람이 다시 선택할 때만 수행하고 기존 process와 첫 prompt 전달 결과를 확인하지 못하면 unknown으로 둔다. resume 실행은 현재 지원하지 않는다.
- 이유: 재시작이 작업 재실행이나 버려진 session의 성공으로 바뀌어서는 안 된다.
- 확인: 재시작 후 자동 spawn·prompt 재전송이 없고 관측 복구와 ticket claim 재조회가 따로 이루어진다.
- 의도: coding-agent#I4

## 열린 질문

없음.

## 버린 것

- 외부 process를 전혀 시작하지 않는 단정은 사람이 [Start]로 허락한 TUI 시작을 막으므로 폐기한다.
- headless·자동 시작·preset 사전 허락·coordinator는 나중 범위이며 이번 시작 방식·명령·권한을 열지 않는다. catalog의 resume capability는 현재 자동 resume나 durable execution intent를 허용하지 않는다.

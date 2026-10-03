---
type: flow
concerns: [coding-agent/sessions, coding-agent/harnesses, coding-agent/connection, coding-agent/tickets, platform/identity, platform/secrets, documents/projects, shell/terminal, shell/workspace]
---
# ticket에서 coding agent를 시작한다

사람이 실행 준비가 된 ticket을 coding agent에게 맡기려 할 때 시작한다. 시작 방식은 자기 터미널의 직접 시작 또는 ticket의 [Start] 두 가지다.

## 흐름

1. 사람은 ticket의 원하는 결과·준비 상태를 확인하고 사용할 harness와 방식을 고른다. nullable 기본 harness가 비면 설치·실행 확인 후보가 하나일 때 제안하고 여러 개면 고르게 한다. 제안만으로 시작하지 않는다. (coding-agent/tickets#R2, coding-agent/tickets#R3, coding-agent/harnesses#R5, coding-agent/sessions#R1)
2. [Start] 방식에서 사람은 등록된 project 폴더를 고르고 누른다. 클릭은 exact ticket·harness·terminal_tui의 일회 시작 handle에 묶이며 별도 confirmation window를 요구하지 않는다. connection 생성·scope 확대·release activation·harness trust의 허락은 대신하지 않는다. (coding-agent/sessions#R2, coding-agent/sessions#R3, shell/terminal#R1, shell/terminal#R12)
3. shell main은 ticket 현재 판·claim 여부·active connection scope·실행 파일/profile/version·앱 source와 project 관계·실제 폴더 접근을 재검사한다. 인증 경계가 keychain credential을 지정 child의 trusted loader에 보호 전달한다. 원문은 prompt·argv·일반 env·PTY에 없다. 과정은 사람에게는 보이지 않는다. (coding-agent/sessions#R4, shell/terminal#R12, platform/identity#R15, platform/secrets#R12)
4. terminal host는 검증한 executable·분리 argv·cwd로 PTY를 직접 열고 첫 prompt를 adapter 계약으로 정확히 한 번 전달한다. prompt에는 지정 ticket 읽기·MCP claim→작업→보고 지시와 근거 참조만 넣는다. 사람은 project 터미널 탭에서 TUI를 본다. (coding-agent/sessions#R3, coding-agent/sessions#R5, shell/terminal#R4)
5. coding agent가 MCP로 ticket을 claim하고 작업한 뒤 결과를 보고한다. lophn은 시작 접수·process·session ready/working/waiting_input·실제 claim·완료 보고를 각각 확인한다. derived 관측과 native session ID는 검증된 evidence만 사용하고 안쪽 과정은 사람에게는 보이지 않는다. (coding-agent/tickets#R11, coding-agent/tickets#R17, coding-agent/sessions#R6, coding-agent/sessions#R7, coding-agent/sessions#R9)

## 다른 갈래

- 자기 터미널 방식이면 사람이 직접 process를 시작해 ticket을 지정하고 설치된 connection의 MCP로 claim한다. lophn이 process를 시작·소유·첫 prompt 전달했다고 기록하지 않는다. (coding-agent/sessions#R8, coding-agent/tickets#R11)
- 필수 채택·조건이 없는 요청은 가짜 근거를 채우지 않고 실행 준비를 보류한다. 모든 요청 접수와 준비의 상태 모델 충돌은 redesign/propagate#Q3에 남긴다. (coding-agent/tickets#R2, coding-agent/tickets#R3, coding-agent/tickets#R5)
- ticket·scope·path/profile·폴더가 바뀌면 conflict/unavailable로 멈추고 다른 harness/cwd로 fallback하지 않는다. keychain 잠김도 평문 전달로 바꾸지 않는다. (coding-agent/sessions#R4, shell/terminal#R2, platform/identity#R15)
- 같은 시작 요청 중복은 같은 runtime만 반환한다. 준비·첫 prompt 결과가 모르면 unknown이며 재전송·재spawn·resume하지 않는다. 복원은 살아 있는 host에 재연결할 뿐 새 실행이 아니다. (coding-agent/sessions#R5, coding-agent/sessions#R10, shell/terminal#R13)
- harness의 permission 입력은 사람의 그 TUI에서 처리한다. session 시작·종료·working 관측만으로 claim 갱신·반납·작업 완료·문제 닫힘을 만들지 않는다. (coding-agent/sessions#R9, coding-agent/tickets#R12)

## 끝

사람은 해당 project 터미널에서 선택한 coding TUI와 확인된 진행·필요 입력을 보고 ticket의 실제 담당·결과를 별도로 안다. 실패·결과 불명은 시작 성공으로 꾸미지 않는다. (coding-agent/sessions#R6, coding-agent/sessions#R9)

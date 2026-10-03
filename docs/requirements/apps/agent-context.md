---
type: requirements
concerns: [apps/agent-context]
---
# apps/agent-context

앱이 agent에게 보여 줄 현재 화면 상태와 민감한 칸을 선언하고, 힌트·주석을 받을 자리를 기존 command로 제공한다. turn 문맥 조립은 lophn-agent/harness/prompt-assemble, 되쓰기 판정은 lophn-agent/harness/tool-judgment, 현재 탭 선택은 shell/workspace가 맡는다.

## 요구

**[R1]** 앱은 화면마다 현재 상태를 돌려주는 read command와 힌트·주석을 받는 write command 및 허용 자리를 선언하며 선언하지 않은 화면은 agent context나 되쓰기를 제공하지 않는다.
- 이유: 화면 DOM을 임의로 읽거나 입력칸을 임의로 바꾸는 통로 없이 기존 command 계약을 쓴다.
- 확인: 선언된 화면의 코드 입력·지난 attempt는 조회되지만 미선언 화면과 주석 자리는 조회·변경되지 않는다.
- 의도: apps#I12

**[R2]** 화면 상태 조회는 현재 앱·release·화면·view session과 상태 revision에 묶인 짧은 요약 및 추가 자료를 반환하고 현재 화면과 연결할 수 없으면 없음이나 unavailable을 반환한다.
- 이유: 다른 탭과 옛 attempt를 지금 보고 있는 상태로 설명하지 않는다.
- 확인: 같은 앱의 두 탭에서 다른 attempt를 열면 각각의 상태가 반환되고 탭을 닫으면 옛 상태를 최신으로 내보내지 않는다.
- 의도: apps#I12

**[R3]** 매 turn에 쓰는 앱 요약은 redaction 뒤 UTF-8 2KiB 이하로 제공하고 추가 자료는 같은 read command의 tool 조회로만 얻는다.
- 이유: 화면 전체를 매번 model 입력에 복제하지 않는다.
- 확인: 큰 코드 입력과 지난 attempt가 있어도 요약은 2KiB를 넘지 않고 상세는 별도 조회에서만 나온다.
- 의도: apps#I12

**[R4]** 앱이 민감하다고 선언한 칸은 요약·상세·오류 모두에서 내보내기 전에 제거하고 platform/redaction 검사에 실패하면 원문 대신 생략 사실을 반환한다.
- 이유: 앱의 화면 상태 공유가 secret이나 개인정보를 model로 보내는 우회가 되지 않는다.
- 확인: 민감한 입력칸의 값은 요약·상세·오류에 없고 redaction 실패 때도 원문이 반환되지 않는다.
- 의도: apps#I12

**[R5]** 힌트·주석 쓰기는 선언한 자리와 조회한 화면 revision을 입력으로 검사하고 대상이 닫혔거나 revision이 달라지면 충돌로 거절한다.
- 이유: 답을 만드는 동안 사람이 고친 코드나 다른 attempt에 힌트를 덮어쓰지 않는다.
- 확인: 조회 뒤 코드를 바꾸거나 탭을 닫고 주석 쓰기를 요청하면 적용되지 않으며 현재 화면을 다시 읽도록 안내한다.
- 의도: lophn-agent#I11

**[R6]** context 조회와 주석 쓰기는 apps/runtime의 같은 command 통로와 apps/permissions의 agent command 허락을 사용하고 되쓰기의 확인·revert 판단은 lophn-agent/harness/tool-judgment를 따른다.
- 이유: context 전용 권한이나 DOM 쓰기가 기존 호출 안전 규칙을 우회하지 않는다.
- 확인: 화면을 열어 두었어도 agent command 허락을 거두면 조회·되쓰기가 거절되고 되돌릴 수 없는 주석 쓰기는 사람 결정을 기다린다.
- 의도: apps#I11, apps#I12

## 열린 질문

## 버린 것

- 앱 DOM·screenshot을 자동으로 긁거나 임의 JavaScript로 입력칸을 바꾸는 context 통로는 두지 않는다.

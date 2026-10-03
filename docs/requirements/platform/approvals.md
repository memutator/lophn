---
type: requirements
concerns: [platform/approvals]
---
# platform/approvals

approval request가 사람에게 무엇을 왜 허락받는지 고정하고, 정확한 동작 하나에 결정을 묶어 한 번만 전달하는 일을 맡는다; 사람의 결정을 받는 화면은 shell/confirmation-window, 실제 동작과 결과는 요청한 concern이 맡는다.

## 요구

### 결정할 내용

**[R1]** approval request는 요청자와 agent 역할·tool·MCP 서버가 있으면 그 이름, 정확한 대상과 redaction한 입력 미리보기, 이유, 변경 범위, 외부 전송 정보와 수신처, 되돌릴 수 있는 범위와 남는 영향을 결정 전에 제시하며 필수 설명이 없거나 공백뿐이면 생성하지 않는다.
- 이유: 사람이 효과를 이해하지 못한 채 허락하는 일을 막는다.
- 확인: 외부 MCP 동작과 앱 동작을 요청하여 모든 설명을 확인하고 이유나 변경 설명을 비우면 request가 생기지 않는지 본다; redaction은 platform/redaction을 따른다.
- 의도: platform#I3

**[R2]** 수리 동작의 approval request는 바뀌는 범위뿐 아니라 보존할 데이터와 실제 검증 기준을 제시한다.
- 이유: 고친다는 말이 다른 데이터의 손실을 숨겨서는 안 된다.
- 확인: 수리 release의 결정을 받기 전에 보존 데이터와 검증 근거를 읽을 수 있고 화면 배치는 shell/confirmation-window를 따르는지 본다.
- 의도: platform#I3

**[R3]** approval request의 허락과 거절은 shell/confirmation-window에서 받은 사람의 명시적 결정만 인정하며 앱·coding agent·lophn agent·MCP 서버가 자기 요청을 허락하지 못한다.
- 이유: 요청하는 주체와 결정하는 사람을 분리한다.
- 확인: 각 요청 주체의 자격으로 허락과 거절을 보내면 거절되고 사람의 보호된 결정을 통해서만 상태가 바뀌는지 본다.
- 의도: platform#I3

**[R4]** approval request에는 기본 선택을 두지 않고 침묵·창 닫기·notification 읽음·일반 세션의 긍정·일반 질문 답을 허락이나 거절로 해석하지 않는다.
- 이유: 다른 행동을 되돌릴 수 없는 동작의 동의로 확장하지 않는다.
- 확인: 각 행동 뒤에도 request가 결정 대기로 남는지 보고 lophn-agent/questions의 고정 option action과 혼동하지 않는지 본다.
- 의도: platform#I3

### 정확한 동작과 한 번 사용

**[R5]** 허락은 사람이 본 호출 주체·동작·정확한 대상·전체 입력·비교 기준과 필요한 assignment·tool·MCP 연결에만 묶이며 그중 하나가 바뀌면 새 approval request를 요구한다.
- 이유: 같은 이름이나 비슷한 입력의 다른 동작에 허락이 넘어가면 안 된다.
- 확인: 대상의 현재 release, 입력 한 값, MCP 연결 또는 assignment 판을 바꾸면 이전 허락으로 시작하지 못하는지 본다.
- 의도: platform#I3

**[R6]** approval request의 요청자·동작·영향·설명·기한은 생성 뒤 바꾸지 않으며 끝난 결정을 수정하거나 다시 열지 않는다.
- 이유: 사람이 결정한 내용과 남은 기록이 항상 같아야 한다.
- 확인: 결정 전후 수정과 종료 뒤 늦은 결정이 거절되고 바뀐 제안에는 새 request가 생기는지 본다.
- 의도: platform#I3

**[R7]** 허락 하나는 실제 적용 영역의 접수 또는 변경과 함께 한 번만 사용되며 중복 전달·동시 사용·실패·결과 미확인 뒤 재호출로 새 동작을 시작하지 않는다.
- 이유: 중복 클릭과 통신 실패가 중복 효과로 이어져서는 안 된다.
- 확인: 같은 허락을 동시에 보내고 재전송하여 최초 접수나 변경만 남는지 보고 결과 미확인 상태에서도 새 사용이 거절되는지 본다.
- 의도: platform#I3

**[R8]** 사람이 확인해야 하는 앱 command의 approval request는 실제 호출 주체를 요청자로 남기고 사람의 결정과 구별하며 정확한 앱·release·command·입력에 묶여 apps/invocations의 실행 직전 접수와 함께 한 번 사용된다.
- 이유: apps/invocations의 유일한 선행 접수 예외를 보장한다.
- 확인: agent나 다른 앱의 요청을 사람이 허락해도 원래 요청자가 유지되고 허락 뒤 command의 release나 입력을 바꾸면 시작되지 않으며 동일 요청 재전송은 apps/invocations의 같은 접수를 돌려주는지 본다.
- 의도: platform#I3

**[R9]** 허락의 접수와 실제 적용 성공은 구별하여 보여 주며 허락이 저장됐다는 이유만으로 동작이 완료됐다고 표시하지 않는다.
- 이유: 결정 전달 뒤에도 현재 전제 검사와 실제 작업이 실패할 수 있다.
- 확인: 허락 후 적용 영역을 실패시켜 결정은 유지되지만 결과는 해당 영역의 실패로 보이는지 보고 제출 상태와 입력 보존은 shell/desktop을 따른다.
- 의도: platform#I3

**[R10]** 앱 permission과 Operator assignment를 허락한 결정은 요청에 나온 고정 범위만 허용하고 다른 동작이나 범위 확대를 대신 허락하지 않는다.
- 이유: 지속되는 범위의 결정도 포괄 허락이 아니다.
- 확인: 범위 밖 적용이 거절되고 확대에는 새 request가 필요한지 보며 실제 적용은 apps/permissions와 lophn-agent/assignments를 따른다.
- 의도: platform#I3

**[R11]** 허락 뒤에도 적용 직전에 현재 권한·대상·비교 기준·원래 일의 유효성을 다시 검사하며 금지된 동작이나 더는 맞지 않는 전제로는 시작하지 않는다.
- 이유: 허락이 현재의 안전 검사와 범위 검사를 면제하지 않는다.
- 확인: 허락 뒤 대상 보관·권한 회수·판 변경을 각각 일으켜 적용이 거절되는지 보고 tool 재판정은 lophn-agent/harness/tool-judgment를 따른다.
- 의도: platform#I3

### 기한과 끝

**[R12]** approval request의 기본 기한은 없음으로 두되 지정한 기한에 도달하면 결정과 새 사용을 모두 거절하고 자동으로 허락하지 않는다.
- 이유: 기한의 끝은 동의가 아니며 저장된 허락도 늦게 사용할 수 없다.
- 확인: 기한 직전과 기한에 허락·사용을 시도하고 이미 허락된 기록은 보존되지만 기한 뒤 사용은 거절되는지 본다.
- 의도: platform#I3

**[R13]** 사람과 원래 요청자는 대기 request를 취소할 수 있고 machine은 원래 일 종료·취소·전제 변경 때 대기를 취소하며 끝난 run의 허락으로 새 동작을 적용하지 않는다.
- 이유: 끝난 일의 대기가 남아 나중에 효과를 내지 않게 한다.
- 확인: 화면만 닫으면 유효한 대기는 유지되지만 취소나 run 종료 뒤 늦은 결정과 사용은 적용되지 않는지 본다; run 처리는 lophn-agent/harness/waiting-and-recovery를 따른다.
- 의도: platform#I3

**[R14]** 사람은 이유 없이 거절할 수 있고 적은 거절 이유는 요청한 역할에게 내용 그대로 돌려주되 platform/redaction을 지키며 관련 없는 다른 대기는 유지한다.
- 이유: 거절은 정당화가 필요 없는 사람의 선택이고 요청별 결정이다.
- 확인: 빈 이유와 글이 있는 이유로 각각 거절하고 다른 request가 바뀌지 않으며 안전한 이유의 내용이 역할에게 전달되는지 본다.
- 의도: platform#I3

**[R15]** 거절·만료·취소는 해당 호출을 미실행으로 끝내고 사람 결정으로 구별하며 agent run이 새 판단으로 이어지는 처리는 lophn-agent/harness/waiting-and-recovery를 따른다.
- 이유: lophn-agent/harness/waiting-and-recovery에 따라 사람의 거절을 도구 실패나 반복 실패로 세지 않는다.
- 확인: 세 종료 뒤 호출이 시작되지 않고 실패 횟수를 올리지 않으며 원래 run이 허용된 새 판단으로 이어지는지 본다.
- 의도: platform#I3

**[R16]** 사람이 거절한 같은 동작·대상·입력은 같은 run과 같은 원래 사람 요청에서 handoff로 이어진 run에서 다시 묻지 않되 새로운 사람 요청은 막지 않는다.
- 이유: lophn-agent/harness/tool-judgment에 따라 설명만 바꾸거나 역할을 바꿔 같은 허락을 재촉하지 않는다.
- 확인: 거절 후 설명 변경과 handoff에서는 새 request가 생기지 않고 새 사람 요청에서는 요청할 수 있는지 본다; 계보 검사는 lophn-agent/handoff와 lophn-agent/harness/tool-judgment를 따른다.
- 의도: platform#I3

### 결정에 필요한 정보

**[R17]** 결정 화면의 기본 정보는 사람이 판단할 동작·대상·이유·변경과 외부 전송·보존 데이터·되돌릴 수 없는 영향으로 요약하되 R1·R2의 필수 설명을 숨겨 결정을 유도하지 않고 기술적인 호출 출처·정확한 입력·비교 기준은 필요할 때 안전한 상세에서 확인하게 한다.
- 이유: 모든 기술 필드를 읽게 하지 않으면서 사람이 결정한 실제 내용과 기록의 정확성은 유지한다.
- 확인: 코드나 내부 식별자를 몰라도 효과와 위험을 읽고 결정할 수 있고 펼친 상세와 고정 action이 같으며 secret 원문은 나오지 않는지 본다; en·message key·배치·child modal과 앱 입력 차단은 shell/wording·shell/confirmation-window를 따른다.
- 의도: platform#I3

## 열린 질문

없음.

## 버린 것

- 호출마다 한 번 허락과 계속 허락을 함께 제공하던 방식은 버린다: request는 고정 동작 하나의 한 번 사용이고 지속 범위는 apps/permissions와 lophn-agent/assignments가 맡는다.
- 창을 닫은 뒤 300초가 지나도 항상 결정할 수 있다는 약속은 버린다: 기한·취소·원래 일의 유효성이 우선한다.
- 앱별 host journal과 approval permit으로 접수를 확정하던 v2 방식은 버린다: apps/invocations의 단일 ledger 접수와 한 번 사용을 따른다.
- terminal에서 yes와 추가 grant 입력만으로 승인하던 방식은 현재 채택하지 않는다: H5 추천안인 shell/confirmation-window만 인정한다.

---
type: flow
concerns: [documents/contexts, documents/outline-and-search, documents/versions, apps/blueprint, apps/permissions, apps/runtime, lophn-agent/roles/context-engineer, lophn-agent/roles/common, lophn-agent/questions, lophn-agent/assignments, lophn-agent/handoff, lophn-agent/harness/prompt-assemble, lophn-agent/revert, platform/identity, platform/notifications, shell/desktop, shell/confirmation-window]
---
# 함께 볼 자료와 관점을 정한다

사람이 여러 문서나 앱 자료를 같은 목적 아래 묶어 agent와 함께 보고 싶다. 목적과 필요한 판단만 사람이 정하고, 자료 찾기와 작은 범위 읽기는 lophn이 맡는다.

지키는 약속: documents#I5, documents#I4, lophn-agent/roles#I1, lophn-agent/roles#I4, lophn-agent/roles#I6, lophn-agent#I1, lophn-agent/harness#I3.

## 흐름

1. contexts 화면에서 사람이 함께 볼 목적을 말하거나 기존 context를 고치려 한다. conversation 화면에서 Context Engineer와 필요한 의도·경계를 정한다. 대화가 아닌 context와 자료를 작업 대상으로 유지한다. (documents/contexts#R1, documents/contexts#R5, lophn-agent/roles/context-engineer#R1, shell/desktop#R1)
2. Context Engineer는 목차·검색에서 이번 목적에 필요한 고정 문서의 section과 본문 범위만 읽고, 앱 자료 후보는 blueprint의 읽기 command 이름·설명·입력·효과를 조회한다. 직접 앱 command를 실행하거나 코드·원본 파일·웹을 읽지 않는다. 사람에게는 보이지 않는다. (lophn-agent/roles/context-engineer#R2, lophn-agent/roles/context-engineer#R3, lophn-agent/roles/context-engineer#R4, lophn-agent/roles/common#R1, lophn-agent/roles/common#R3, lophn-agent/roles/common#R11, apps/blueprint#R4, apps/blueprint#R20)
3. conversation 화면에서 Context Engineer가 목적에 대한 책임 근거는 기준, 배경 자료는 참고, 변화만 따라갈 자료는 watch로 제안한다. 사람은 지금 필요한 항목과 읽을 수 있는지를 먼저 확인하고, 선택 이유·읽은 고정 근거·자료가 부족한 부분은 필요할 때 살핀다. 근거와 추정을 섞지 않는다. (lophn-agent/roles/context-engineer#R6, lophn-agent/roles/context-engineer#R7, lophn-agent/roles/common#R10, documents/contexts#R1, documents/outline-and-search#R4)
4. conversation 화면에서 기존 요청과 자료만으로 정할 수 없는 목적·경계가 있으면 사람에게 필요한 결정만 묻는다. 사람은 의도와 범위를 정하고, Context Engineer는 허용된 context 구성 변경과 설계 보고를 남긴다. 자유 답을 정확한 변경 동작으로 자동 해석하지 않는다. (lophn-agent/roles/context-engineer#R5, lophn-agent/roles/context-engineer#R10, documents/contexts#R5, lophn-agent/questions#R1, lophn-agent/questions#R15)
5. contexts 화면에서 사람이 남은 context의 목적과 필요한 항목을 확인한다. lophn은 항목마다 현재 허용 범위를 다시 검사하며 context 이름이나 연결된 자료만으로 agent의 읽기·앱 command 범위를 넓히지 않는다. 초기 model 입력은 관점별 목차·요약으로 시작하고 본문은 요청한 section만 읽는다. 범위 검사와 입력 조립은 사람에게는 보이지 않는다. (documents/contexts#R2, documents/contexts#R4, platform/identity#R8, platform/identity#R9, apps/permissions#R28, apps/runtime#R32, lophn-agent/harness/prompt-assemble#R4)
6. 문서 watch 항목의 최신 판이 바뀌면 machine이 전후 고정 판과 대상 부분을 비교하고 확인된 변화만 한 번 남긴다. section 소실도 같은 key로 확인하며, 추출 실패는 변화가 아니라 미확인으로 남긴다. 앱 read command를 watch 항목으로 두었다는 이유만으로 자동 호출하지 않는다. 사람에게는 보이지 않는다. (documents/contexts#R9, documents/contexts#R10, documents/contexts#R11, documents/contexts#R12, documents/contexts#R13)
7. contexts 화면에서 사람은 watch 변화의 대상과 근거를 열고 바뀐 부분만 확인한다. notification이나 자료 변화만으로 agent 판단을 시작하지 않으며, 필요하면 conversation 화면에서 판단을 요청한다. 이미 승인된 Operator가 있으면 승인된 목적·자료·주기 안에서 다음 판단을 한다. (platform/notifications#R1, platform/notifications#R3, platform/notifications#R7, documents/outline-and-search#R21, lophn-agent/assignments#R4, lophn-agent/assignments#R5, lophn-agent/assignments#R15)
8. contexts 화면에서 사람이 끝난 agent 일의 revert를 요청하면 lophn은 그 일의 확정 변경 전체와 현재 판·관계·권한·후속 충돌을 검사한다. 사람은 confirmation-window 화면에서 복원 가능·불가·충돌·남을 영향을 확인하고 명시적으로 결정한다. 복원 불가 업무 변경이 섞이면 기본으로 막고, 사람이 남을 영향을 확인한 경우에도 안전하고 독립적인 복원 가능 변경 전체만 새 변경으로 복원한다. 실제 복원과 남은 영향을 구별하며 원래 판단을 다시 시작하거나 변경 기록을 지우지 않는다. 검사는 사람에게는 보이지 않는다. (lophn-agent/revert#R1, lophn-agent/revert#R2, lophn-agent/revert#R3, lophn-agent/revert#R4, lophn-agent/revert#R5, lophn-agent/revert#R6, lophn-agent/revert#R7, lophn-agent/revert#R9, shell/confirmation-window#R4, shell/confirmation-window#R5)

## 다른 갈래

- 사람 요청을 다른 역할에서 넘겨받는 경우 유효한 Context Engineer 담당과 필요한 고정 근거를 확인한다. 담당이 없거나 멈췄으면 대기열을 만들지 않고 맡길 수 없다고 알린다. 발신 역할의 권한이나 세션 전체를 가져오지 않는다. 사람에게는 보이지 않는다. (lophn-agent/handoff#R1, lophn-agent/handoff#R2, lophn-agent/handoff#R3, lophn-agent/handoff#R4, lophn-agent/handoff#R6)
- 사람의 목적 결정이 없으면 conversation 화면에서 관련 변경을 보류하고 미정인 보고를 남긴다. 대화를 닫거나 답이 없다는 이유로 추천을 확정하지 않는다. (lophn-agent/roles/context-engineer#R10, lophn-agent/questions#R8)
- 최신 판에서 section이 사라지면 contexts 화면에서 소실을 알리고 사람이 대상을 다시 고르게 한다. 비슷한 제목·본문으로 몰래 바꾸지 않는다. 추출 실패나 format 변경 때문에 비교할 수 없으면 미확인으로 구별한다. (documents/contexts#R9, documents/contexts#R11)
- 자료가 허용 범위 밖이면 제목·존재·근거까지 제외한다. 허용 앱 read 항목이 있더라도 Context Engineer는 계약만 조회하며 실제 호출은 허락된 역할과 현재 command 범위를 다시 확인한다. 사람에게는 보이지 않는다. (platform/identity#R8, lophn-agent/roles/common#R11, apps/permissions#R28, apps/runtime#R32)
- context에서 항목을 빼거나 보관하면 대상 문서·앱·용어는 변경하지 않는다. 보관 중 문서 watch 검사는 멈추고 이전 구성의 늦은 비교를 적용하지 않는다. (documents/contexts#R7, documents/contexts#R12)
- revert 전에 후속 변경이나 안전하게 복원할 수 없는 관계가 있으면 아무 변경도 시작하지 않는다. contexts 화면에서 현재 영향과 충돌 이유를 확인하며 복원 가능 부분만 복원됐다고 전체 복원으로 표시하지 않는다. confirmation-window 화면에서 닫기·Escape는 적용 결정이 아니고, 확인 중 대상 변경이나 조회 실패가 있으면 옛 행동을 제거해 최신 내용을 다시 확인하게 한다. 실제 적용과 부분 결과 확인은 flow/review-agent-work와 같은 계약을 따른다. (lophn-agent/revert#R3, lophn-agent/revert#R4, lophn-agent/revert#R6, shell/confirmation-window#R4, shell/confirmation-window#R5)
- 연결이 끊기면 contexts 화면의 마지막 확인 자료와 conversation 화면의 작성 중 요청을 유지한다. 최신 구성·watch 결과를 확인하지 못했음을 알리고 재연결 뒤 현재 기록을 다시 읽는다. (shell/desktop#R7, shell/desktop#R8)

## 끝

사람이 같은 목적 아래 필요한 자료와 관점을 다시 열 수 있다. 읽은 근거는 고정 판으로 남고, watch의 확인된 변화와 미확인이 구별되며 판단은 사람 요청 또는 승인된 Operator 주기에서만 시작한다. (documents/contexts#R1, documents/contexts#R4, documents/contexts#R10, documents/contexts#R11, platform/notifications#R7, lophn-agent/assignments#R15)

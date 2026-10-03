---
type: requirements
concerns: [lophn-agent/handoff]
---
# lophn-agent/handoff

사람 요청에서 이어진 run 사이에서 다른 역할에 무엇·왜·제외·기대 결과와 고정 근거를 맡기는 handoff의 방향·대상·권한 경계를 맡으며 받는 run의 출처 모양은 lophn-agent/harness/run-loop가 맡는다.

## 요구

### 책임과 범위

**[R1]** handoff의 허용 방향은 lophn에서 App Engineer·Context Engineer, App Engineer에서 lophn·Context Engineer, Context Engineer에서 lophn뿐이고 Operator의 보내기·받기는 모두 금지한다.
- 이유: 역할의 책임 경계를 일 전달에서도 유지한다.
- 확인: 각 허용 방향은 접수되고 Context Engineer→App Engineer 및 Operator 양방향은 거절되는지 본다.

**[R2]** handoff는 실제 받을 유효한 assignment를 선택해야 하며 담당이 없거나 멈췄거나 회수됐으면 거절하고 담당 없는 대기열·세션 제어권 이전은 만들지 않는다.
- 이유: 책임 대상이 없는 일을 묵혀 두거나 다른 사람의 진행 세션을 빼앗지 않는다.
- 확인: App Engineer 없는 앱 handoff는 시작되지 않고 오류 이유가 보이는지 본다.

**[R3]** handoff에는 보낸 run·원래 사람 요청·무엇·왜·제외·기대 결과·필요한 고정 근거를 전달하고 기획·설계는 채택한 판과 채택 질문을 함께 확인하며 설명이 빠지면 시작하지 않는다.
- 이유: 받는 역할이 원래 목적과 검토한 근거를 알 수 있어야 한다.
- 확인: 각 내용이 빠진 전달은 거절되고 판과 채택 답의 일치 검사는 lophn-agent/questions를 따르는지 본다.

**[R4]** handoff는 보낸 쪽 세션 전체·tool 기록·세션 요약을 복사하지 않고 필요한 설명과 고정 근거만 전달한다.
- 이유: 사람 말 전체와 불필요한 권한·맥락을 새 역할에 주지 않는다.
- 확인: 받는 run에 원래 요청과 필요한 근거만 있으며 발신 세션 원문이 자동 복제되지 않는지 본다.

**[R5]** handoff는 원래 사람 요청에서 이어진 run에서만 보내고 보낸 run은 전달 사실을 남겨 끝내며 받은 결과·티켓·문제 변화가 새 후속 판단을 자동 시작하지 않는다.
- 이유: lophn-agent/handoff에 따라 handoff를 부모·자식 실행이나 event 깨움으로 만들지 않는다.
- 확인: 주기 run의 handoff가 거절되고 수신 run 종료 뒤 발신 역할이 자동 실행되지 않는지 본다.

**[R6]** handoff는 발신 권한·approval request 결정을 옮기지 않고 수신 역할의 범위와 tool 판정을 다시 적용하며 한시적 고정 근거 읽기는 lophn-agent/roles/app-engineer의 계약만 따른다.
- 이유: 범위가 작은 담당자가 다른 역할 권한을 상속하지 않는다.
- 확인: 승인된 발신 동작도 수신에서 별도 판정되고 근거 주소가 최신·연결 문서 접근을 열지 않는지 본다.

**[R7]** 같은 run과 같은 원래 사람 요청에서 handoff로 이어진 run에서는 사람이 거절한 동일 동작·대상·정확한 입력을 다시 묻지 않되 사람의 새 요청은 막지 않는다.
- 이유: lophn-agent/harness/tool-judgment에 따라 역할 교체로 거절을 우회하지 않는다.
- 확인: 거절 뒤 다른 역할이 같은 동작을 재요청하면 lophn-agent/harness/tool-judgment가 억제하고 새 사람 요청은 별도로 판단하는지 본다.

**[R8]** 오래 남길 handoff 결과는 실제 문서 고정 version 주소 또는 산출물이 없는 이유로 남기며 후속 version이 원래 전달 결과를 바꾸지 않는다.
- 이유: 결과의 사실을 최신 문서로 덮어쓰지 않는다.
- 확인: 수신 run 결과에서 당시 문서를 읽을 수 있고 저장은 documents/versions를 따르는지 본다.

**[R9]** 같은 handoff 요청을 재전송해도 수신 run은 하나만 생기고 현황·결과 읽기·추가 입력·멈춤은 실제 수신 run의 현재 권한 계약을 따른다.
- 이유: 접수와 협업 제어를 중복 만들지 않는다.
- 확인: 중복 전달로 수신 run이 늘지 않고 끝난 run에 추가 변경은 lophn-agent/harness/run-loop 규칙으로 막히는지 본다.

## 열린 질문
- lophn-agent/handoff#Q1 같은 원래 사람 요청의 handoff 순환·총 사슬 길이를 어떻게 제한할까.

## 버린 것
- subagent 깊이 1과 깊이 2 금지·자식 tool 경계는 subagent 자체를 쓰지 않으므로 제거했다.
- 부모를 계속 진행시키고 자식 결과를 자동 전달·재판단하는 구조는 lophn-agent/handoff의 독립 handoff로 바꿨다.

---
type: requirements
concerns: [platform/notifications]
---
# platform/notifications

정해진 사실에서만 이 컴퓨터의 사람에게 notification을 만들고 원래 사실을 찾게 하며 읽음을 보존하는 일을 맡는다; OS 표시와 열린 세션에서의 배치는 shell/desktop과 lophn-agent/conversation이 맡는다.

## 요구

### 계기와 사실

**[R1]** notification은 운영 보고 문제의 열림·재발·닫힘, approval request 생성, question 생성, ticket 확인 완료·검사 실패, 반복 실패나 대상 보관으로 machine이 멈춘 assignment, watch 항목 변화·절 소실, release activation 실패에서만 생긴다.
- 이유: platform/notifications의 한 계기 표만 쓰면 필요하지 않은 소식이 늘거나 영역별 정책이 어긋나지 않는다.
- 확인: problems/grouping·problems/closing, platform/approvals, lophn-agent/questions, coding-agent/tickets, lophn-agent/assignments, documents/contexts, apps/releases에서 각 조건을 일으켜 하나씩 생기고 운영 보고가 아닌 문제와 사람이 직접 멈춘 assignment에서는 생기지 않는지 본다.
- 의도: platform#I9, platform#I5

**[R2]** 표 밖의 추가 report·ticket 생성·claim·claim 해제·완료 보고·취소·handoff 종료·run 종료·일반 문서 저장·앱의 직접 발송 요청은 notification을 만들지 않는다.
- 이유: 옛 협업과 앱의 별도 발송 경로가 platform/notifications를 우회하지 못하게 한다.
- 확인: 나열한 사실을 각각 기록하고 해당 사실 자체는 소유 concern에 남지만 notification 수는 늘지 않는지 본다.
- 의도: platform#I9

**[R3]** notification은 원래 발생 시각·대상·실제 변화·필요한 사람 행동과 결과를 여는 길 또는 결과 없는 이유를 원래 사실에서 보여 주며 본문·대화·추론·업무 상태의 복사본을 만들지 않는다.
- 이유: 표시가 달라도 같은 사실을 보고 현재 대상과 당시 사실을 구별해야 한다.
- 확인: 대상의 현재 상태를 바꾸어도 당시 변화와 발생 시각이 유지되고 열린 세션에서는 역할의 발언이 아닌 같은 notification을 참조하는지 본다.
- 의도: platform#I5, platform#I9

**[R4]** 같은 원래 사실의 notification은 최대 1개이며 재전달·재접속·재시작·여러 세션 표시로 늘지 않고 다른 사실은 종류나 미읽음이 같다는 이유로 덮어쓰지 않는다.
- 이유: 전달 중복을 제거하면서 서로 다른 근거를 잃지 않는다.
- 확인: 같은 사실을 여러 번 전달한 뒤 lophn을 다시 열어 하나만 남는지 보고 같은 종류의 두 사실은 각각 남는지 본다; 세션별 표시는 lophn-agent/conversation을 따른다.
- 의도: platform#I9, platform#I1

### 읽음과 전달

**[R5]** 사람은 notification의 읽음과 읽지 않음을 구별하고 명시적으로 읽음 표시할 수 있으며 읽음은 재시작 뒤에도 유지된다.
- 이유: 놓친 사실을 다시 찾되 이미 본 사실을 다시 처리할 필요가 없어야 한다.
- 확인: 읽음 표시 후 재시작하고 같은 notification을 다시 읽어도 최초 읽음이 유지되는지 본다.
- 의도: platform#I9, platform#I1

**[R6]** notification 수신·보기·읽음·클릭·결과 열기는 승인·질문 답·문제 닫힘·ticket 확인 같은 결정으로 취급하지 않는다.
- 이유: 전달과 결정은 다른 행동이다.
- 확인: 각 행동 뒤에도 결정 대상의 상태는 바뀌지 않고 결정이 필요하면 platform/approvals나 lophn-agent/questions의 실제 절차로 가는지 본다.
- 의도: platform#I7, platform#I5

**[R7]** notification의 생성·전달·읽음은 agent run을 새로 시작하거나 닫힌 세션을 다시 열지 않는다.
- 이유: event를 계기로 agent를 깨우지 않는 이전 결정을 지킨다.
- 확인: 닫힌 세션과 멈춘 assignment에 관련 소식을 만들어도 세션과 run 수가 늘지 않는지 본다.
- 의도: platform#I9

**[R8]** OS 전달 실패나 창 닫기 때문에 notification을 버리지 않으며 재조회·재구독은 같은 사실을 다시 보여 주고 전달에 model call을 쓰지 않는다.
- 이유: 표시 경로가 잠시 없어도 사람이 볼 사실은 남아야 한다.
- 확인: OS 전달을 실패시키고 재시작하여 원래 notification을 조회할 수 있고 새 notification과 model call이 생기지 않는지 본다.
- 의도: platform#I9

**[R9]** OS notification은 사람이 켠 경우에만 같은 notification을 표시하는 경로로 사용하며 platform/redaction을 지킨 최소 제목과 대상 열기만 전달한다.
- 이유: 창 뒤의 질문을 찾게 하되 민감한 원문을 잠금 화면에 노출하지 않는다.
- 확인: 기본 상태에서는 창 안에만 보이고 사람이 켠 뒤 OS 표시에서 입력·secret·원문이 빠져 있는지 본다; 실제 OS 표시와 tray는 shell/desktop을 따른다.
- 의도: platform#I9, platform#I2

**[R10]** OS 전달에 실패하면 자동 retry용 별도 업무 상태를 만들지 않고 다음 화면 조회에서 보존된 notification과 안전한 전달 실패 이유를 보여 준다.
- 이유: 전달 실패가 새 계기나 반복 발송으로 확대되지 않게 한다.
- 확인: 전달 실패 뒤 다음 조회에서 근거를 잃지 않고 같은 notification을 볼 수 있으며 ledger에 배달 성공·실패용 업무 상태가 추가되지 않는지 본다.
- 의도: platform#I9, platform#I5

**[R11]** 닫힌 세션 뒤에도 관련 notification을 개별 근거와 발생 순서대로 모두 다시 읽을 수 있게 하며 임의의 종류·우선순위·고정 개수로 생략하지 않는다.
- 이유: 표시 묶음을 정하기 전에도 원래 사실을 잃지 않아야 한다.
- 확인: 여러 종류의 notification을 만든 뒤 세션을 다시 열어 각 원래 사실에 닿을 수 있는지 본다; 표시 배치는 shell/desktop과 lophn-agent/conversation을 따른다.
- 의도: platform#I9

**[R12]** notification의 자동 표시는 현재 입력 focus·문서·앱을 바꾸지 않고 사람이 명시적으로 열었을 때만 대상 화면으로 이동한다.
- 이유: 알아야 할 사실이 지금 하던 일을 빼앗으면 안 된다.
- 확인: 문서 입력과 앱 조작 중 창 안·OS notification을 표시해 focus와 현재 화면이 유지되고 사람이 Open을 선택한 뒤에만 이동하는지 본다; 배치·OS 동작은 shell/desktop을 따른다.
- 의도: platform#I9

## 열린 질문

- platform/notifications#Q1 닫힌 세션 뒤 여러 notification을 어떻게 묶어 보여 줄까.
- platform/notifications#Q2 OS 전달 retry 간격과 실패 표시 시점을 어떻게 정할까.
- platform/notifications#Q3 OS notification을 기본 제공할까, opt-in으로 둘까, 창 안만 쓸까.

## 버린 것

- 역할 정의·App Engineer·Context Engineer·Operator의 책임 수신자와 요청자 routing을 버린다: notification의 수신자는 이 컴퓨터의 사람 한 명이다.
- handoff와 모든 ticket 전이를 소식으로 보내던 정책을 버린다: platform/notifications의 ticket 확인 완료와 검사 실패만 계기다.
- 앱과 사람의 임의 직접 notification 발송을 버린다: platform/notifications 밖의 발송을 지원하지 않는다.
- notification을 정한 일에서만 만든다는 추상적인 이전 요구는 별도로 두지 않는다: R1과 R2의 정확한 목록으로 대체한다.

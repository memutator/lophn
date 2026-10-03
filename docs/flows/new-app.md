---
type: flow
concerns: [lophn-agent/roles/lophn, lophn-agent/roles/common, lophn-agent/roles/app-engineer, lophn-agent/conversation, lophn-agent/questions, lophn-agent/handoff, lophn-agent/assignments, documents/versions, apps/registration, apps/blueprint, apps/sdk, coding-agent/connection, coding-agent/guides, coding-agent/tickets, problems/problem-codes, problems/tests, apps/preview, apps/releases, apps/data, apps/runtime, apps/permissions, platform/approvals, platform/notifications, shell/confirmation-window, shell/wording]
---
# 만들고 싶은 것을 말하고 새 앱을 받는다

사람이 개인 앱으로 해결하고 싶은 일을 말하며 시작한다. 예를 들어 가계부를 만들고 싶다고 말하면, 사람은 목적과 필요한 선택만 결정하고 lophn은 기획·설계·구현 근거·확인을 이어 준다.

지키는 약속: apps#I1, apps#I2, apps#I3, lophn-agent/roles#I2, lophn-agent/roles#I3, lophn-agent/roles#I6, lophn-agent#I1, lophn-agent#I3, coding-agent#I3, coding-agent#I4, coding-agent#I5, problems#I6, shell#I8.

## 흐름

1. conversation 화면 사람이 하고 싶은 일을 말한다. lophn 역할은 기존 앱 변경·문서로 남기기·공용 SDK 활용을 먼저 대조하고 새 앱이 필요한지 판단한다. 기존 재료로 해결되면 새 앱을 만들지 않는다. (lophn-agent/conversation#R1, lophn-agent/roles/lophn#R1, lophn-agent/roles/lophn#R6, lophn-agent/roles/lophn#R9)
2. lophn 역할이 선택한 방안과 다른 방안을 버린 이유·재사용할 것·새로 만들 것·위험·근거를 기획 문서의 고정 판으로 남긴다. 저장과 판 보존은 lophn이 처리하고 사람에게는 보이지 않는다. (lophn-agent/roles/lophn#R10, lophn-agent/roles/lophn#R11, documents/versions#R14)
3. conversation 화면 사람이 아직 정하지 않은 목적·취향·선택만 설명과 추천을 보고 답하고 실제 확인한 기획 판을 채택한다. 앱 등록 선택은 그 판의 정확한 등록 내용에 묶고 confirmation-window 화면에서 확정한다. 기획 채택과 등록이 별개 결정이면 별개 질문으로 받는다. (lophn-agent/questions#R1, lophn-agent/questions#R3, lophn-agent/questions#R13, lophn-agent/questions#R16, shell/confirmation-window#R6)
4. machine이 선택한 이름·slug·한 줄 목적과 기획 판으로 앱을 코드·source·release 없이 등록하고 그 앱의 App Engineer assignment를 준비한다. lophn 역할은 원래 목적과 무엇·왜·제외·기대 결과, 같은 채택 판과 답을 준비된 담당에게 handoff하고 전달 사실을 남겨 그 일을 끝낸다. 받은 담당의 독립된 일이 이어지며 원래 세션의 상대나 제어권은 바꾸지 않는다. 사람에게는 보이지 않는다. (apps/registration#R2, apps/registration#R3, lophn-agent/assignments#R1, lophn-agent/roles/lophn#R12, lophn-agent/handoff#R2, lophn-agent/handoff#R3, lophn-agent/handoff#R5, lophn-agent/conversation#R1)
5. conversation 화면 App Engineer는 handoff로 받은 기획과 사람의 말에서 설계를 이어 문서로 남긴다. 사람이 추가 대화를 하려면 같은 도크에서 그 앱의 App Engineer를 상대로 새 세션을 열고, 이미 받은 기획과 필요한 말만 근거로 이어 가며 원래 lophn 세션 전체를 복사하지 않는다. 사람은 필요한 추가 결정에만 답하고 실제 확인한 고정 설계 판을 채택한다. App Engineer는 그 판과 채택 답에서 실행 가능한 acceptance check를 가진 구현 ticket을 만든다. 어느 lophn agent 역할도 코드를 짜거나 웹을 보거나 외부 coding agent를 시작하지 않는다. (lophn-agent/roles/app-engineer#R7, lophn-agent/roles/app-engineer#R8, lophn-agent/roles/app-engineer#R10, lophn-agent/roles/app-engineer#R17, lophn-agent/conversation#R1, lophn-agent/handoff#R4, lophn-agent/questions#R16, coding-agent/tickets#R3, coding-agent/tickets#R8, lophn-agent/roles/common#R1, lophn-agent/roles/common#R2, lophn-agent/roles/common#R3)
6. app-detail 화면 사람이 맡길 일을 확인하고 직접 연 Claude Code·Codex 등 coding agent 세션에 그 ticket을 명시적으로 시킨다. 연결이 없으면 confirmation-window 화면에서 연결 이름과 전체 또는 앱 하나의 범위를 먼저 정한다. ticket이 생겼다는 사실이나 목록 발견만으로 착수하지 않는다. (coding-agent/connection#R1, coding-agent/connection#R2, coding-agent/tickets#R11, coding-agent/guides#R22)
7. 사람 지시를 받은 coding agent가 유효한 claim으로 필요한 고정 근거와 SDK 안내를 읽고 source를 연결해 정확한 SDK와 템플릿에서 구현한다. blueprint와 예상 실패의 보고 경로를 갖추며 운영 데이터나 secret에 직접 접근하지 않는다. 준비 과정은 사람에게는 보이지 않는다. (apps/registration#R4, coding-agent/connection#R5, coding-agent/connection#R10, coding-agent/guides#R8, coding-agent/guides#R11, apps/blueprint#R1, apps/sdk#R7, apps/sdk#R33, problems/problem-codes#R8)
8. test runner가 격리된 환경에서 같은 고정 bundle의 blueprint·필수 보고 경로·SDK·권한과 ticket의 테스트를 실제로 확인한다. 실패나 미실행을 통과로 바꾸지 않고, 같은 bundle의 app test를 통과하지 못하면 release를 준비하지 못한다. 통과 뒤 coding agent가 현재 claim을 재확인해 같은 bundle의 release를 준비한다. 사람에게는 보이지 않는다. (problems/tests#R1, problems/tests#R4, problems/tests#R6, problems/tests#R7, problems/tests#R13, problems/problem-codes#R9, apps/releases#R5, apps/releases#R6, coding-agent/tickets#R8, coding-agent/tickets#R15)
9. app-detail 화면 사람이 운영 데이터와 분리된 preview를 보고 바뀔 동작·필요 권한·데이터 영향과 실제 테스트 결과를 확인한다. coding agent는 만든 release·변경·실행한 확인·미실행·한계를 보고한다. preview나 완료 보고를 운영 적용이나 업무 정확성의 증명으로 표시하지 않는다. (apps/preview#R1, apps/preview#R2, apps/preview#R4, apps/preview#R10, apps/releases#R9, coding-agent/tickets#R17, problems/tests#R12)
10. confirmation-window 화면 사람이 정확한 release의 동작·권한·데이터 변경·손실 가능성을 보고 적용을 승인하거나 거절한다. 필요한 앱 접근은 정확한 범위의 사람 결정으로 허락하며 기획·설계 채택이나 ticket 보고로 대신하지 않는다. (apps/releases#R8, apps/releases#R9, apps/releases#R11, apps/permissions#R1, platform/approvals#R5, shell/confirmation-window#R6)
11. machine이 현재 대상과 사람 결정의 유효성을 재검사하고, 데이터 변경이 필요하면 기존 쓰기를 멈춘 뒤 보호 backup과 migration을 수행한다. 실제 bundle·handler·데이터 schema·연결의 시작 준비를 확인한 뒤에만 선택한 release를 적용한다. 사람에게는 보이지 않는다. (apps/releases#R12, apps/releases#R13, apps/releases#R14, apps/data#R4, apps/data#R5, apps/data#R6, apps/runtime#R2)
12. machine이 완료 보고의 같은 release에 대해 acceptance check를 조건별로 실제 검사하고 통과·실패·미확인을 구별한다. 실제 사용까지 맡긴 ticket은 activation 확인도 필요하며 확인 완료 또는 검사 실패에서 해당 notification을 만든다. 사람에게는 보이지 않는다. (coding-agent/tickets#R8, coding-agent/tickets#R18, coding-agent/tickets#R19, platform/notifications#R1, platform/notifications#R2)
13. app-detail 화면 사람이 사용할 수 있는 앱과 확인된 결과, 필요한 다음 행동만 본다. app-space 화면에서 앱을 쓴다. 복잡한 기획·handoff·claim·검사 과정과 안쪽 식별자는 기본 안내에 내보내지 않으며 적용 성공과 ticket의 실제 확인은 서로 대신하지 않는다. (lophn-agent/conversation#R4, platform/approvals#R9, coding-agent/tickets#R19, apps/runtime#R13, shell/wording#R1, shell/wording#R2, shell/wording#R8)

## 다른 갈래

- 1에서 기존 앱 변경이나 문서가 맞으면 그 결과로 끝내거나 해당 작업으로 이어 간다. 새 앱이 필요하다는 결론을 먼저 내리지 않는다. (lophn-agent/roles/lophn#R6, lophn-agent/roles/lophn#R11)
- 3·5에서 미루기·무응답이면 미결정으로 남기며 등록·ticket 작성·권한 확대를 임의로 진행하지 않는다. 선택지의 전제가 바뀌면 답은 보존하되 적용하지 않고 새 결정을 받는다. (lophn-agent/questions#R8, lophn-agent/questions#R14, lophn-agent/questions#R12, lophn-agent/roles/app-engineer#R8)
- 4에서 담당이 없거나 멈췄으면 handoff 준비가 안 됐다고 설명한다. 담당 없는 자동 대기나 구현 완료를 표시하지 않는다. (lophn-agent/handoff#R2, lophn-agent/roles/lophn#R12)
- 6·7에서 연결 회수나 claim 만료면 새 요청을 거절하고 남긴 결과를 보존한다. 사람이 새 세션에 다시 맡기기 전에는 자동으로 연결이나 coding agent를 시작하지 않는다. (coding-agent/connection#R8, coding-agent/connection#R9, coding-agent/tickets#R13, coding-agent/tickets#R14, coding-agent/tickets#R11)
- 8에서 필수 보고 경로나 테스트가 빠졌으면 준비를 막고 app-detail 화면에서 실패 또는 미확인과 필요한 다음 행동을 본다. app test·preview·시작 확인은 각각 검사한 범위만 증명한다. (problems/tests#R4, problems/tests#R7, problems/tests#R12, apps/releases#R5, apps/preview#R10, apps/runtime#R3)
- 10에서 거절·만료·취소이면 적용은 미실행이다. 창을 닫거나 notification을 읽는 일도 승인으로 보지 않는다. (platform/approvals#R4, platform/approvals#R15, platform/notifications#R6)
- 11에서 migration·시작 확인이 실패하면 새 release를 적용 성공으로 보이지 않는다. 업무 쓰기 전 실패는 backup의 무결성과 schema를 확인해 복구하고 app-detail 화면에서 실제 실패·복구 결과를 본다. (apps/releases#R15, apps/data#R7, apps/data#R11, platform/notifications#R1)
- 흐름 중 연결이 끊기거나 화면을 닫아도 확정 요청과 결정은 남는다. conversation 화면에서 다시 열어 이어 가고 답 접수·적용 완료·미실행을 따로 확인한다. (lophn-agent/conversation#R2, lophn-agent/questions#R10, platform/approvals#R9)

## 끝

사람은 앱을 실제로 사용할 수 있는지, 맡긴 확인이 통과했는지, 아직 필요한 결정이 있는지 구별한다. 기획·코드·preview·준비만으로 새 앱이 완성됐다고 하지 않고, 실제 적용과 acceptance check가 모두 확인된 때에만 맡긴 일을 완료로 본다. (apps/releases#R14, coding-agent/tickets#R18, coding-agent/tickets#R19, platform/approvals#R9)

---
type: flow
concerns: [documents/versions, lophn-agent/questions, apps/registration, lophn-agent/assignments, lophn-agent/handoff, lophn-agent/roles/app-engineer, coding-agent/tickets, problems/tests, apps/releases, platform/approvals, platform/notifications]
---
# 새 앱 하나가 생기기까지

1. 사람이 lophn에게 "가계부를 앱으로 만들고 싶어"라고 말한다. run이 하나 시작한다.
2. lophn 역할이 기존 앱과 문서를 보고 기획 문서를 남긴다. 그리고 question을 연다. option 하나에 "앱 `money` 등록"이라는 action이 붙어 있다.
3. 사람이 그 option을 고른다. machine이 그 action을 사람의 결정으로 적용해 앱을 가볍게 등록한다. 코드도 release도 아직 없다.
4. 앱이 생기자 machine이 그 앱을 맡을 App Engineer assignment를 만든다. lophn은 원래 요청을 App Engineer에게 handoff한다(받는 run의 source에 남는다).
5. App Engineer가 사람과 인터뷰해 설계 문서를 남기고, 구현 ticket을 만든다. ticket에는 실행할 수 있는 acceptance check가 있다.
6. 사람이 Claude Code를 열고 "lophn ticket 해 줘"라고 한다. coding agent가 ticket을 claim하고, 코드를 짜고, app test를 돌린다. test result가 남는다.
7. 그 test를 통과한 같은 bundle로 release를 준비한다. activation은 되돌릴 수 없는 일이라 사람이 confirmation window에서 승인한다.
8. machine이 ticket의 acceptance check를 검사해 통과하면 ticket이 확인된다. 사람에게 notification이 간다.

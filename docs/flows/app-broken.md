---
type: flow
concerns: [problems/reporting, problems/snapshots, problems/grouping, platform/notifications, lophn-agent/roles/app-engineer, coding-agent/tickets, coding-agent/repair-context, problems/tests, apps/releases, problems/closing]
---
# 앱이 깨졌을 때

1. 가계부 앱이 은행 파일을 읽다가 선언한 problem code `import.parse_failed`로 보고한다. 그 순간의 화면과 최근 invocation이 snapshot으로 붙는다.
2. machine이 같은 code의 보고를 problem 하나로 묶고, 사람에게 notification이 간다.
3. 사람이 App Engineer에게 "이거 봐 줘"라고 한다. App Engineer가 problem과 snapshot을 읽고 해석을 남긴 뒤 repair ticket을 만든다. problem 하나에 열린 repair ticket은 하나다.
4. coding agent가 repair ticket을 claim하면 problem이 "고치는 중"이 된다. coding agent는 수리 묶음(repair context)을 받아 읽고, 먼저 이전 release에서 실패하는 reproduction test를 만들고, 고친 release에서 통과시킨다. 둘 다 test result로 남는다.
5. 고친 release가 activation되어 활성 상태이고 그 release에서 reproduction test가 통과했으면 problem이 닫힌다. 사람이 "고쳐졌다"고 확인해도 닫힌다. 시간이 조용히 지났다는 것만으로는 닫히지 않고, agent는 problem을 닫지 못한다.

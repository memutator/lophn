# problem과 ticket 덜어내기: 남은 것은 coding agent 연결의 크기

상태: 로드맵, 정할 것 없음. 2026-10-20 사람이 problem과 ticket 모델이 너무 빡빡하다며 방향을 냈고, 2026-10-21 "최대한 덜어낸다"로 정하고 App Engineer가 앱을 직접 짓기로 했다. 계획 넷(`problem-remove`, `approval-simplify`, `ae-builds`, `reactor-remove`)이 land했고 변경과 결정은 `project-docs/products/change-log/0.6.0.md`에 있다. 마지막으로 남았던 coding agent 연결의 크기는 2026-10-26에 정했다(hook·감지·설치를 남긴다).
2026-10-28: 계획 `remove-role`이 role을 없앴다. agent는 lophn과 사람이 만든 agent이고 session이 workspace(home, project, app)를 갖는다(`products/AGENT.md`, changelog `0.9.0`). 아래에서 Project Manager는 그 project workspace의 session, App Engineer는 그 앱 workspace의 session, Operator는 사람이 만든 agent로 읽는다.
배경 문서: `project-docs/architecture/coding-agent.md`, `project-docs/products/roadmap/approval.md`, `project-docs/products/roadmap/workflow.md`.

## 정한 것 (사람)

- (2026-10-21) "lophn agent는 코드를 짜지 않는다"를 바꾼다. lophn agent가 하지 않는 것은 길고 복잡한 coding agent의 일이다.
  - lophn에서 만드는 앱과 그 앱에 필요한 context는 App Engineer가 훨씬 잘 닿는다. ticket으로 넘기며 context를 잃을 필요가 없다.
  - 개인 앱은 규모가 작아 코딩용 최적화의 부담도 적다.
  - workflow에서도 lophn agent가 직접 코딩한다.
- (2026-10-21) 지금은 App Engineer가 coding agent에게 외주를 주는 흐름을 막는다. coding agent 연결을 얼마나 남길지(B-lite, B)는 보류한다. 뒤에 workflow에서 coding agent 같은 다른 harness를 불러와야 할 수 있기 때문이다. Router는 받는 곳이 `coding_agent`로 풀리는 call을 거절한다.
- (2026-10-26) coding agent 연결의 hook, 감지, 설치는 남긴다. B와 B-lite는 하지 않는다. 사람이 연 터미널의 coding agent도 같은 hook으로 탭 icon, 상태 점, 알림을 얻는다(`project-docs/architecture/terminal-agent.md`, `project-docs/products/change-log/0.9.0.md`). App Engineer가 맡기는 흐름은 그대로 막혀 있다.

## 정한 뒤 남은 기록

1. **coding agent 연결을 얼마나 남길까. (정함, 사람 2026-10-26: hook·감지·설치를 남긴다)** 지금은 App Engineer가 맡기는 흐름을 막는다. 뒤에 workflow에서 coding agent 같은 다른 harness를 불러와야 할 수 있어, 크기는 그때 정한다. ticket을 지운 뒤에도 그 길은 약 8~9천 줄이다: PTY launch, hook에서 읽는 상태, 도는 중의 메시지 줄, harness 물음 비추기, 사람 home에 skill과 hook 설치, coding token과 CLI, Settings의 coding agent 화면.
   - **B-lite**: harness 설치, 감지 화면, guide를 지운다(약 2천 줄). hook, 메시지, CLI는 남긴다. 잃는 것: 사람 home에 자동 설치와 감지 화면.
   - **B**: coding agent를 한 번 띄우는 PTY로만 쓴다. call 본문이 첫 prompt가 되고, process가 끝나면 call이 닫힌다. 결과는 App Engineer가 앱 source의 file과 git diff로 읽는다. lophn CLI, hook, `packages/coding-agent`가 없어진다(약 5~6천 줄 더).
     - 잃는 것: 도는 중에 App Engineer와 coding agent가 주고받는 메시지, 돌기와 기다림 표시, harness 물음 비추기.
     - `approval.md`의 "unattended면 lophn이 hook으로 받은 harness 물음에 shell 규칙으로 답한다"(사람이 고른 C)가 hook 없이는 안 된다. B로 가면 그 자리는 "unattended면 harness의 skip을 켜고 띄운다"가 된다.
   - 사람이 터미널 탭에서 자기 coding agent를 쓰는 길(PRODUCT 6절)은 둘 다 그대로다.
   - 어느 쪽이든 입력 종류 `reaction`, `<lophn-reaction>` tag, 받은 메시지의 `event` 칸을 같이 본다. 남은 쓰임이 coding session 끝 알림 하나라 이름을 그대로 두었다(`reactor-remove`).

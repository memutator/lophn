# tab owner: 탭이 agent의 시야와 책임을 보인다

상태: 1·2단계(주인 저장과 표시, sidebar의 팀 tree와 session 탭 목록, `lophn tab list`, 사람의 browser 탭 넘기기와 되찾기)는 계획 tab-scope로 만들었다(change-log `tab-scope`). session이 든 탭을 자기 밑 session에 주는 길(`lophn tab give`)은 change-log `tab-give`다. 지금 설계는 `project-docs/architecture/workspace-layout.md`의 "탭의 주인"과 "agent가 연 탭"이다. 이 문서에는 남은 것만 둔다.
배경 문서: `project-docs/architecture/{workspace-layout,browser-tab,agent-call}.md`, `project-docs/products/roadmap/{a2a-access,browser-profile}.md`.

## 사람의 말 (원문)

2026-11-21:

> 이 workspace tab이 단순한 layout의 관심사가 아니라는 점이야. agent의 시야, agent간의 책임을 representation이 될 수 있기를 기대하는데 현재는 그 부분에 대해서 많이 미흡한 것 같아

> browse use를 쓰는 agent가 연 탭만 쓰던데, 사용자가 쓰던 브라우즈 탭도 넘길 수 있으면 좋을 거 같다

## 남은 것

- **"Hand to"의 상대 넓히기.** 지금 상대는 lophn session뿐이다. coding agent GUI 탭이 팀 member가 되면(`a2a-access.md`) 그때 상대에 든다.

## 정한 것

1. 넘길 수 있는 상대는 그 탭이 있는 기계에서 도는 session이다. (agent)
2. coordinator가 자기 탭을 자식에게 넘길 수 있다. (agent, 2026-11-21 roadmap. change-log `tab-give`로 만들었다)

## 하지 않는 것

- 탭의 자리로 시야를 정하기. 배치는 사람이 자유로 한다.
- 터미널과 문서 탭을 넘기기, 읽기만 넘기기, page의 snapshot만 대화에 붙이기. 요구가 생기면 한다.
- 앱 화면을 agent가 읽거나 조작하기.
- agent가 사람이 지금 보는 것을 스스로 알기.
- 탭을 다른 기계의 session에 넘기기.
- 칸마다 탭 줄이 있는 pane tree로 돌아가기.

## 확인하지 않은 것

- call이나 `team spawn`이 연 session 탭과 sidebar의 팀 tree를 사람이 실제 창에서 오래 써 본 적이 없다(`architecture/agent-call.md` "열린 것").

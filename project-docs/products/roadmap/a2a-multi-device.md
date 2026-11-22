# a2a multi-device: 다른 기계의 agent에게 일을 맡긴다

상태: 로드맵. 2026-11-21 사람이 방향을 냈고 planner가 정리했다. 단계 1~3(live mail, 늦게 가는 길과 대기 목록, handoff note)과 단계 5(workflow 참가자에 컴퓨터를 적기, run 화면의 컴퓨터와 배달 상태)는 계획 `machine-a2a`가, 단계 4(`team spawn --on`: 다른 컴퓨터에 연 팀원이 연 컴퓨터의 팀 규칙 하나 아래 일하고 sidebar 팀 tree에 선다)는 그 뒤의 일(change-log `team-spawn-across`)이 만들었다. 설계는 `project-docs/architecture/machine-a2a.md`("다른 컴퓨터에 연 팀원" 포함)와 `workflow.md`의 "다른 컴퓨터의 참가자"에 있고, 정한 것은 그 문서들의 결정으로 옮겼다. 여기에는 남은 일만 둔다.
배경 문서: `project-docs/architecture/{machine-a2a,agent-call,workflow,remote,folder-sync}.md`, `project-docs/products/roadmap/{multi-device,multi-machine}.md`.

## 사람의 말 (원문)

2026-11-21(planner가 낸 여섯 물음에):

> (기계를 누가 고르나) workflow나 지침, 프롬프트에서 정할 일이고 agent가 부를 수 있는 길을 마련해놔야지

## 남은 것

- 다른 컴퓨터에 연 팀원은 잎이다: 그 컴퓨터에도 다른 컴퓨터에도 자기 팀원을 열지 못한다. 기계를 건너는 팀이 두 단계 이상 필요해지면 연 컴퓨터가 깊이를 세는 채로 손자를 여는 길을 다시 본다.
- 연 컴퓨터의 팀 tree와 `team read`는 그 팀원을 그 컴퓨터의 agent handle로 보인다. 그 agent의 보이는 이름과 얼굴은 연 컴퓨터가 모른다.
- 도는 컴퓨터의 `team read`는 그 팀원의 부모(연 컴퓨터의 session)를 보이지 않는다.
- 연 컴퓨터는 그 컴퓨터에서 팀원의 turn이 도는지 모른다(sidebar의 running은 "그 컴퓨터가 받았다"이다).

## 확인하지 않은 것

- 확인은 한 기계에 띄운 개발 core 둘로 했다. 서로 다른 기계와 OS로는 돌려 보지 않았다.
- `team spawn --on`의 길은 두 Router를 잇는 test와 gallery로만 돌려 보았고 개발 core 둘로는 아직 돌려 보지 않았다.
- folder-sync의 길은 실제 도구(Syncthing, Google Drive)와 실제 두 기계로 돌려 본 적이 없다(`multi-machine.md` "남은 것").

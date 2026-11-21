# a2a multi-device: 다른 기계의 agent에게 일을 맡긴다

상태: 로드맵. 2026-11-21 사람이 방향을 냈고 planner가 정리했다. 단계 1~3(live mail, 늦게 가는 길과 대기 목록, handoff note)과 단계 5(workflow 참가자에 컴퓨터를 적기, run 화면의 컴퓨터와 배달 상태)는 계획 `machine-a2a`가 만들었다. 설계는 `project-docs/architecture/machine-a2a.md`와 `workflow.md`의 "다른 컴퓨터의 참가자"에 있고, 정한 것 1~17은 그 문서들의 결정으로 옮겼다. 여기에는 남은 일만 둔다.
배경 문서: `project-docs/architecture/{machine-a2a,agent-call,workflow,remote,folder-sync}.md`, `project-docs/products/roadmap/{multi-device,multi-machine}.md`.

## 사람의 말 (원문)

2026-11-21(planner가 낸 여섯 물음에):

> (기계를 누가 고르나) workflow나 지침, 프롬프트에서 정할 일이고 agent가 부를 수 있는 길을 마련해놔야지

## 남은 것

### `team spawn`이 기계를 건넌다 (단계 4)

지금 `team spawn`은 이 컴퓨터 안에서만 자식을 연다. 다른 컴퓨터에 일을 맡기는 길은 `call send --on`뿐이고, 그렇게 열린 session은 부른 session의 팀(spawn tree)에 들지 않는다. 한 기계 안의 call 전달을 mail 하나로 맞춘 뒤에 한다(그래야 팀 규칙, 팀 상한, ask call이 기계를 건너 한 벌로 선다).

- 정한 것: `team spawn`이 기계를 건너는 것은 call 다음 단계다. (agent: 사람에게 물었고 답이 없어 추천대로 둔다)

## 단계

| 단계 | 하는 일 |
|---|---|
| 4 | `team spawn`이 기계를 건넌다 |

4는 한 기계 안의 call 전달을 mail 하나로 맞춘 뒤에 한다.

## 확인하지 않은 것

- handoff note와 다른 컴퓨터의 workflow step은 실제 두 컴퓨터로 돌려 보지 않았다(unit test와 review만).
- folder-sync의 길은 실제 도구(Syncthing, Google Drive)와 실제 두 기계로 돌려 본 적이 없다(`multi-machine.md` "남은 것").

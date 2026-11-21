# a2a multi-device: 다른 기계의 agent에게 일을 맡긴다

상태: 로드맵. 2026-11-21 사람이 방향을 냈고 planner가 정리했다. 단계 1~3(live mail, 늦게 가는 길과 대기 목록, handoff note)과 단계 5의 넘기기·report는 계획 `machine-a2a`가 만들었다. 설계는 `project-docs/architecture/machine-a2a.md`와 `workflow.md`의 "다른 컴퓨터의 참가자"에 있고, 정한 것 1~17은 그 문서들의 결정으로 옮겼다. 여기에는 남은 일만 둔다.
배경 문서: `project-docs/architecture/{machine-a2a,agent-call,workflow,remote,folder-sync}.md`, `project-docs/products/roadmap/{multi-device,multi-machine}.md`.

## 사람의 말 (원문)

2026-11-21(planner가 낸 여섯 물음에):

> (기계를 누가 고르나) workflow나 지침, 프롬프트에서 정할 일이고 agent가 부를 수 있는 길을 마련해놔야지

## 남은 것

### `team spawn`이 기계를 건넌다 (단계 4)

지금 `team spawn`은 이 컴퓨터 안에서만 자식을 연다. 다른 컴퓨터에 일을 맡기는 길은 `call send --on`뿐이고, 그렇게 열린 session은 부른 session의 팀(spawn tree)에 들지 않는다. 한 기계 안의 call 전달을 mail 하나로 맞춘 뒤에 한다(그래야 팀 규칙, 팀 상한, ask call이 기계를 건너 한 벌로 선다).

- 정한 것: `team spawn`이 기계를 건너는 것은 call 다음 단계다. (agent: 사람에게 물었고 답이 없어 추천대로 둔다)

### workflow run 화면의 다른 컴퓨터 step (단계 5의 화면)

참가자에 컴퓨터를 적은 step은 그 컴퓨터로 넘어가고 report가 돌아온다(만들었다). run 화면은 아직 그 step이 어느 컴퓨터에서 도는지와 배달 상태(아직 닿지 않음, 대기, 도는 중, 모름)를 보이지 않는다. `ReadWorkflowInstance`의 `remote_steps`가 이미 그 값과 그 컴퓨터의 session을 준다. 화면은 branch `ui/workflow-ux`의 새 run 화면 위에 선다.

- 정한 것: run 화면은 그 step이 어느 컴퓨터에서 도는지와 배달 상태를 보인다. (사람, 2026-11-21)
- 같이 볼 이슈: `workflow-remote-step-turn-end-no-line`(다른 컴퓨터가 가져간 step의 turn이 실패·멈춤·재시작으로 끝나면 시작한 컴퓨터에 줄이 없다. 화면이 그 컴퓨터와 session으로 가는 길을 보이는 것이 첫 안이다).

## 단계

| 단계 | 하는 일 |
|---|---|
| 4 | `team spawn`이 기계를 건넌다 |
| 5의 남은 것 | run 화면의 컴퓨터와 배달 상태 |

4는 한 기계 안의 call 전달을 mail 하나로 맞춘 뒤에 한다. 5의 화면은 4를 기다리지 않는다.

## 확인하지 않은 것

- handoff note와 다른 컴퓨터의 workflow step은 실제 두 컴퓨터로 돌려 보지 않았다(unit test와 review만).
- folder-sync의 길은 실제 도구(Syncthing, Google Drive)와 실제 두 기계로 돌려 본 적이 없다(`multi-machine.md` "남은 것").

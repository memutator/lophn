# approval: 남은 것

상태: 로드맵. 2026-10-20 사람이 approval을 다시 설계하라고 했고, 계획 `approval-simplify`가 그 대부분을 만들었다(changelog `project-docs/products/change-log/0.6.0.md`). 지금 모양은 `project-docs/architecture/approval.md`다: 할당이 허락이고, 묻는 길은 기다리는 turn 하나이고, 실행 때 묻는 것은 shell 규칙의 `ask`뿐이며, turn mode(attended, unattended, skip)가 물을지를 정한다. 이 문서에는 아직 만들지 않은 것만 남긴다.
배경 문서: `project-docs/architecture/approval.md`, `project-docs/architecture/coding-agent.md`, `project-docs/products/roadmap/problem-ticket.md`, `project-docs/products/roadmap/headless-schedule.md`, `project-docs/products/roadmap/workflow.md`.

## 남은 것

### unattended coding agent의 물음에 shell 규칙으로 답한다

- attended에서는 harness의 권한 물음을 지금처럼 대기 목록에 비추고(`subject.kind: "harness"`) 답은 터미널에서 한다.
- unattended에서는 lophn이 hook으로 받은 그 물음에 shell 규칙으로 답한다. deny와 floor면 거절하고 나머지는 허락한다. coding agent도 lophn agent와 같은 바닥을 쓴다(사람, 2026-10-20).
- 2026-10-21 App Engineer가 coding agent에게 맡기는 흐름을 막았다(`problem-ticket.md`). 그 흐름이 다시 열릴 때 만든다.
- test: unattended coding agent가 floor 명령을 물으면 lophn이 거절한다.

### reaction이 연 turn의 mode

- 지금은 attended다(`approval-simplify`). 사람이 없을 때 앱 문제로 열린 App Engineer가 shell `ask`에 걸리면 기다린다.
- 사람이 따로 더 고민하기로 했다(2026-10-20). 남은 reaction `ReleaseActivationFailed`를 `ae-builds`가 지우면 이 항목은 없어진다.

## 하지 않는 것

- **OS sandbox.** 조사한 다섯 harness 가운데 기본으로 켜는 것은 Codex뿐이다. shell 규칙은 실수를 줄일 뿐 경계가 아니다.
- **LLM 판정(guardian, smart).** 판정은 program이 결정적으로 하고, 결정은 사람과 할당이 한다.
- **timeout.** attended에서는 사람이 대기 목록에서 답하고, unattended에서는 묻지 않는다.
- **명령 parser(tree-sitter)와 위험 명령 regex 사전.** prefix 규칙과 짧은 기본 목록으로 시작했다.
- **CLI `--dangerously-skip-permissions`.** CLI가 여는 run은 처음부터 unattended라 묻지 않는다(`headless-run`).

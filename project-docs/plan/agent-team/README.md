# agent-team

- 목표: 팀(spawn tree)으로 일할 때 자식의 질문과 승인이 사람이 아니라 부모 coordinator에게 먼저 간다. 부모가 답하거나 위로 올려서 root에서 사람에게 닿는다. `team spawn`, `team read`, 상한, 팀 지시문을 이 흐름에 맞춘다.
- 재료:
  - 계획 `agent-surface`의 결과: `spawned_by`, `team spawn|read|end`, `team_changed`.
  - `project-docs/products/roadmap/agent-surface.md`.
  - `project-docs/architecture/{approval,agent-call,workspace-session}.md`.
  - `../harness-lab/_report/multi-harness-orchestration/`:
    - `README.md`
    - `t3code.md` "자식의 질문이 부모에게 오는 경로"
    - `paseo.md` §4·5
    - `orca.md` "worker가 받는 계약"
    - `happy.md` B "계층과 상한"
- 범위 밖:
  - 자식 답 묶기(fan-in)
  - 팀원 격리(worktree)와 spawn cwd
  - 부모 archive가 자식까지 닫기
  - agent끼리 steer
  - harness runtime 자식의 승인(그 CLI가 headless에서 스스로 처리한다)
  - 사람이 자식 탭에서 바로 승인하기

## 정한 것

- **ask는 부모에게 간다.** spawn된 session(`spawned_by` 있음)의 `ask` tool과 shell 규칙 `ask`는 사람이 아니라 부모에게 가는 result call이다.
  - 자식 turn은 지금처럼 turn 안 request로 기다리고, 부모의 답이 그 request를 푼다.
  - 근거: 사람, 2026-11-08: "cordinator든 leader든 걔가 먼저 답하고 걔 판단으로 안 되겠음 걔가 사용자한테 올리고".
- **올리는 장치는 따로 없다.** 부모가 판단할 수 없으면 자기 `ask`를 쓴다. 부모도 spawn된 session이면 그 위로 가고, root에서 사람에게 닿는다. (agent) 규칙 하나가 사슬을 만든다.
- **attended와 unattended는 같은 길이다.** root가 unattended면 root의 `ask`가 `unattended`를 돌려주고, root가 스스로 정한다. (agent) 사람이 없는 사슬에서도 coordinator가 한 번은 본다. 지금 unattended의 "ask 명령은 그냥 실행"보다 엄하다.
- **skip은 지킨다.** skip session의 shell ask는 지금처럼 run이고 부모에게 가지 않는다. `ask` tool(질문)은 skip이어도 부모에게 간다. (agent) skip은 사람이 그 session에 직접 정한 "묻지 마"라서 부모가 뒤집지 않는다(`approval.md`: "skip은 사람이 그 대화에 정한 것"). 질문은 승인이 아니라서, 지금도 skip turn의 `ask`가 기다린다.
- **부모의 승인 답은 이번 한 번의 허락·거절뿐이다.** 글에서 읽지 않고 구조로 받는다. `always`(shell 규칙 더하기)는 사람만 한다. `deny`는 누구도 풀지 못한다. (agent) 규칙 층은 사람의 settings다(`approval.md`).
- **팀 밖 session의 `ask`는 지금 그대로다.** 자식 탭에는 승인 카드가 뜨지 않는다. (agent)
- **`team spawn`과 `team read`.** `team spawn`의 `--reply` 기본은 `result`다. `team read`는 팀원마다 답하지 않은 call을 보인다. (agent)
  - 이유: lophn 자식이 `call reply`를 잊으면 부모가 깨지 않는다(`agent-call.md` "result 답"). 부모가 그것을 알아챌 길이 필요하다.
- **상한 기본값은 `max_depth: 2`(root 0), `max_members: 8`이다.** agent-surface는 3·16으로 두었다. 넘을 때 거절 글에 "직접 하거나 부모에게 청하라"를 넣는다. (agent)
  - 근거: 사람이 든 예(root → 번역 coordinator → 번역 셋)가 깊이 2다.
  - 다른 곳: Happy Agent는 깊이 3(root 포함)에 tree당 5, Orca는 기본 깊이 1이다.
- **팀 지시문은 system prompt에 넣지 않는다.** `team spawn` help, 자식이 받는 첫 call 봉투의 고정 글, 내장 skill `lophn-agent`에 둔다. (agent) T3 주입 지시문, Orca preamble과 같은 내용이다. prompt cache를 깨지 않게 이 자리에 둔다. 내용:
  - spawn한 뒤 turn을 끝낸다.
  - poll하지 않는다.
  - worker면 직접 한다.
  - 모르면 `ask`한다(부모에게 간다).
- **답은 묶지 않는다.** program은 누가 답을 빚졌는지는 알지만 언제 올지는 모른다. 묶을 때는 coordinator가 묶음을 선언하는 꼴로 하고, 그 전에 reply 잊음을 먼저 푼다. (사람, 2026-11-08)
- **팀원 격리는 lophn이 강제하지 않는다.** project context(skill)의 일이다. (사람, 2026-11-08)

## task

| wave | id | 하는 일 |
|---|---|---|
| 1 | `team-ask` | 위 정한 것 전부. spawn된 session의 ask를 부모 result call로 보내고, 부모 답으로 request를 푼다. 답 구조, request와 call의 끝 맞추기, spawn 기본 reply, `team read`의 열린 call, 상한 기본값, 지시문, 문서 |

## lead가 할 일

- **`agent-surface`가 main에 land한 뒤 연다.** `spawned_by`와 team 명령 위에 서기 때문이다. 외부 선행은 status 도구가 보지 않으니 lead가 직접 막는다.
- `project-docs/plan/tools/lead/lead.sh agent-team`이 연 worktree에서만 일한다.
- brief를 쓸지는 lead가 정한다. 쓴다면 아래를 brief에서 고정한다. 근거와 함께 lead가 정하고, 정할 수 없으면 planner에게 보고한다.
  - request와 call을 어떻게 잇는가.
  - 부모 답의 꼴: `call reply`에 구조 칸을 더할지, 새 명령을 둘지.
  - 한쪽이 먼저 끝날 때. request가 취소나 재시작으로 끝나면 열린 call을 닫는다. 부모가 끝나 call이 `receiver_ended`면 request는 거절로 푼다.
  - 질문의 답 글이 자식의 tool result로 가는 꼴.
- 위험 test:
  - 부모의 허락이 `deny`를 풀지 못한다.
  - 부모가 shell 규칙을 더하지 못한다.
  - 팀 밖 session의 `ask`는 지금 그대로다.
  - 부모가 끝나면 자식의 request가 거절로 풀린다.
- 동작을 land하는 같은 변경에서 문서를 고친다.
  - `approval.md`: 묻는 길.
  - `agent-call.md`: 팀의 ask call.
  - roadmap `agent-surface.md`: 정한 것에 위 결정을 적는다. "하지 않는 것"에 답 묶기, 격리, 부모 archive cascade, agent끼리 steer를 적는다.
- 사람에게 물을 것: push. 새 subprocess·Worker·서버 test나 E2E를 만들기 전. 실제 model provider 호출.
- 끝나면 changelog 열린 판에 항목을 남긴다.

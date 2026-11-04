# agent-status: subagent가 도는 동안 terminal coding agent를 진행 중으로

- 목표: terminal 탭의 coding agent가 main turn을 끝냈어도 subagent가 살아 있으면 진행 중으로 보이고, finished 알림은 일이 다 끝났을 때 한 번만 간다. done 직후 다시 깨어나 알림이 두 번 가는 흔들림을 없앤다.
- 재료: `/home/pyosechang/projects/harness-lab/multi-harness-session-status-report.md`(Orca, T3, Paseo, Emdash, herdr 비교. §4 "적용할 점"), `project-docs/architecture/terminal-agent.md`.
- 범위 밖: 화면 문구로 상태 읽기(herdr식), harness-runtime lophn agent(headless, process가 끝나면 turn이 끝난다), lophn agent session(subagent가 없다), Codex와 그 밖 harness의 child(hook에 근거가 없다).

## 정한 것

1. 표시 상태는 main turn 상태와 child 집합을 따로 들고 합쳐 계산한다. main이 끝났어도 child가 살아 있으면 running이다(Orca `foldAgentLeadStatus`, T3 보유 규칙. 따로 집계만 한 Paseo는 지금 증상이 그대로 남는다). (agent)
2. child 근거는 hook에서 받는다. Claude Code는 `SubagentStart`·`SubagentStop`과 hook payload의 `background_tasks` 중 agent 항목, OpenCode는 session tree(root session의 idle만 turn을 닫는다). 그 밖 harness는 지금 그대로다. (agent)
3. background shell(dev server 등)은 진행 중으로 치지 않는다. 늘 도는 process 때문에 영원히 running이 되는 것을 막는다(T3, herdr Claude). (agent)
4. child가 남아 있으면 finished 알림을 보내지 않고, 다 끝나 idle이 될 때 한 번 보낸다(T3). 알림은 1.5초 늦추고 그 사이 다시 running이면 보내지 않는다. 상태는 바로 바꾼다(Orca). (agent)
5. child는 `SubagentStop`, session 경계(`SessionStart`, `SessionEnd`), 사람의 interrupt로 지운다. 근거가 끊긴 child가 영원히 남지 않게 그 child의 hook이 10분 오지 않으면 지운다(Orca·T3의 timeout). (agent)
6. hook 목록이 늘어 이미 설치한 사람의 `~/.claude/settings.json`에 빠진 event가 생긴다. 지금 설치 화면이 빠진 event를 다시 설치하라고 보이는 길을 쓴다. 사람에게 묻지 않고 고치지 않는다. (agent)

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `status-signals` | child 시작·끝 signal, Claude subagent hook 설치, OpenCode 자식 session 거르기 |
| 2 | `status-fold` | tracker가 child 집합을 들고 합쳐 계산, finished 알림 늦추기와 child timeout |

## lead가 할 일

- 사람에게 묻는다: Claude Code의 subagent hook payload와 `background_tasks` 꼴을 확인하려면 실제 harness를 한 번 돌려야 한다(실제 model 호출). 허락 전에는 Claude Code 문서와 harness-lab 보고서의 근거로 fixture를 만들고 그렇다고 적는다.
- merge마다: `architecture/terminal-agent.md`를 고친다.
- 다 끝나면: change-log 열린 판에 적고 계획 폴더를 지운다.

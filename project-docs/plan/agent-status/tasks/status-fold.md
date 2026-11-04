# status-fold

tracker가 terminal마다 main turn 상태와 child 집합을 따로 들고, 보이는 상태와 finished 알림을 둘을 합쳐 정한다.

- 단위: status (wave 2)
- 선행: status-signals. 그 task가 내놓은 `ChildStarted`·`ChildEnded`·`TurnEnded.children`을 쓴다.
- 소유(이 task만 고친다):
  - `packages/shell/main/terminal/agent/tracker.ts`
  - `packages/shell/main/terminal/agent/agent_test.ts`
  - `packages/shell/main/desktop/wiring/agent.ts`(`createAgentTracker`에 시각·timer를 넘기는 줄만)
- 읽을 것:
  - architecture: `project-docs/architecture/terminal-agent.md`
  - 계획: `project-docs/plan/agent-status/README.md`의 정한 것 1, 4, 5
  - 근거: `/home/pyosechang/projects/harness-lab/multi-harness-session-status-report.md` §2.1(`foldAgentLeadStatus`), §3.3, §3.6, §4의 5~7
- 계약:
  - 쓰는 것: `HookSignal`의 `ChildStarted`, `ChildEnded`, `TurnEnded.children`
  - 내놓는 것: 바깥 모양은 그대로다(`TerminalAgent.state`는 `running | waiting | idle | unknown`). 화면 쪽 file은 고치지 않는다.

## 할 일

1. terminal마다 child 집합(id → 마지막으로 들은 시각)을 둔다. `ChildStarted`는 더하거나 시각을 고치고, `ChildEnded`는 뺀다. `TurnEnded.children`이 오면 그 id들을 더한다. `SessionStarted`, `SessionEnded`, 사람의 interrupt(`humanInput`)는 집합을 비운다.
2. 보이는 상태: waiting이 우선이고, 그 다음 main이 running이면 running, main이 끝났어도 child가 있으면 running, 둘 다 없으면 idle이다(Orca `foldAgentLeadStatus`에서 child waiting과 monitoring을 뺀 꼴).
3. finished 알림(`notify`, `TurnEnded` 안): child가 남았으면 보내지 않는다. 마지막 child가 빠져 idle이 될 때 보낸다. 보낼 때는 1.5초 기다렸다가 그 사이 상태가 다시 running이면 보내지 않는다. 상태와 `unseen`은 바로 바꾼다. 알림 본문은 지금처럼 마지막 `last_assistant_message`다.
4. child timeout: 10분 동안 그 child의 signal이 오지 않으면 뺀다. 빼서 idle이 되면 3과 같이 알린다.
5. 시각과 timer는 인자로 받는다(AGENTS.md "코드": Clock). `setTimeout`을 tracker 안에서 직접 부르지 않는다.
6. `project-docs/architecture/terminal-agent.md`의 상태·알림 절을 고친다(lead가 merge 때 확인한다).

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`agent_test.ts`, fake clock): "subagent가 도는 동안 Stop이 와도 running이고 finished 알림이 가지 않는다. 마지막 child가 끝나면 알림이 한 번 간다", "Stop 뒤 1.5초 안에 다시 TurnStarted가 오면 알림이 가지 않는다".
- 남지 않음: 없음.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로.

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

## lead가 더함

- (lead가 더함) `ChildStarted`는 대기 중인 권한 물음도 푼다(`PermissionResolved`처럼 waiting을 0으로). 앞 task에서 `agent_id`가 붙은 Claude `PostToolUse`·`PostToolUseFailure`가 `PermissionResolved`에서 `ChildStarted`로 바뀌었다. 그래서 지금은 subagent의 권한 물음을 허락한 뒤 main의 다음 hook이 올 때까지 탭이 waiting에 남는다. 이 규칙이 그것을 되돌린다. 위험 test에 한 줄 더한다: "subagent의 권한 물음 뒤 그 subagent의 tool hook(ChildStarted)이 오면 waiting이 풀린다".
- (lead가 더함) 앞 task가 tracker에 넣은 임시 줄을 지운다: `AgentSignal`의 `ChildStarted`·`ChildEnded`는 두고, `hook()`이 child 신호를 바로 버리는 early return은 지운다. `AgentSignal`에 `child?: string`, `children?: readonly string[]`를 더한다. wiring의 `signalOf`는 `hookSignalOf`의 결과를 그대로 넘기므로 칸은 runtime에 이미 실려 온다.
- (lead가 더함) `TurnEnded.children`의 id는 `ChildEnded.child`와 같은 값이다(Claude Code CLI 2.1.316 bundle을 읽어 확인했다. local_agent task id = agentId = `SubagentStart`·`SubagentStop`의 `agent_id`). 실제 harness로는 확인하지 않았다. test fixture도 문서와 bundle을 근거로 만들고 그렇다고 한 줄 적는다.
- (lead가 더함) 시각과 timer: tracker deps에 `now(): number`와 timer를 거는 함수(취소할 수 있는 것)를 더하고, `desktop/wiring/agent.ts`에서 `Date.now`와 `setTimeout`·`clearTimeout`을 넘긴다. tracker 머리 주석대로 shell tsc는 `packages/base`를 따라가지 못하므로 `Clock` type을 import하지 말고 deps 함수로 받는다. child timeout은 child마다 timer를 걸지 말고, 신호가 올 때와 알림 timer가 돌 때 오래된 child를 거르는 쪽이 단순하면 그쪽을 고른다. 다만 아무 신호도 오지 않아도 10분 뒤에는 빠져야 한다.

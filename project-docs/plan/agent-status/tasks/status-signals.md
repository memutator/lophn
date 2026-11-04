# status-signals

harness hook에서 child(subagent)의 시작과 끝을 signal로 낸다. Claude Code는 subagent hook을 설치 목록에 더하고, OpenCode는 지금 버리는 하위 session의 상태를 child signal로 바꾼다. tracker는 아직 child signal을 무시한다(다음 task).

- 단위: status (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/hook-signal.ts`
  - `packages/protocol/coding-agent/hook-signal_test.ts`
  - `packages/protocol/coding-agent/harness-adapter.ts`
  - `packages/coding-agent/harnesses/hook-bodies.ts`
  - `packages/coding-agent/harnesses/install_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/terminal-agent.md`
  - 계획: `project-docs/plan/agent-status/README.md`의 정한 것 2, 3, 6
  - 근거: `/home/pyosechang/projects/harness-lab/multi-harness-session-status-report.md` §2.1(Orca가 Claude에서 child를 모으는 넷), §4의 3, §5
- 계약:
  - 쓰는 것: `HookSignal`(`hook-signal.ts`), harness adapter의 `events` 표, 설치기가 `events`로 빠진 event를 찾는 길(`packages/coding-agent/harnesses/jsonc-hooks.ts`의 `missing`)
  - 내놓는 것: signal type 둘. `ChildStarted {child: string}`, `ChildEnded {child: string}`. `child`는 harness 안에서 그 child를 가르는 id다(Claude는 `agent_id`, OpenCode는 하위 session id). 그리고 `TurnEnded`에 붙는 `children?: readonly string[]`: Stop payload가 아직 살아 있는 agent child 목록을 실으면 그 id들이다(Claude `background_tasks` 중 종류가 agent이고 끝나지 않은 것). background shell은 넣지 않는다(정한 것 3).

## 할 일

1. Claude Code adapter(`harness-adapter.ts`의 `claude`)의 `events`에 `SubagentStart` → `ChildStarted`, `SubagentStop` → `ChildEnded`를 더한다. 같은 꼴의 hook을 쓰는 harness(`CLAUDE_SHAPED`를 쓰는 것) 중 문서로 같은 event를 확인한 것만 더하고, 확인 근거를 그 줄 주석에 적는다. 확인 못 한 harness는 건드리지 않는다.
2. `hook-signal.ts`:
   - `ChildStarted`·`ChildEnded`를 만든다. `isSubagent`가 `agent_id`가 붙은 event를 버리는 규칙은 지금처럼 두되, `SubagentStart`·`SubagentStop`은 버리지 않는다.
   - `agent_id`가 붙은 다른 hook(PostToolUse 등)은 버리지 말고 `ChildStarted {child: agent_id}`로 바꾼다. Start를 놓쳐도 child가 살아 있음을 안다(Orca `claude-events.ts:175-193`). tracker는 같은 child의 Started를 여러 번 받아도 된다.
   - Claude `Stop` payload에 `background_tasks`가 있으면 끝나지 않은 agent 항목의 id를 `TurnEnded.children`에 싣는다. 항목 꼴은 근거 문서(§2.1, `orca:shared/claude-background-task-inventory.ts`)를 따르고, 실제 payload로 확인하지 못했으면 보고에 적는다.
3. OpenCode plugin 본문(`hook-bodies.ts`, `session.status`를 root session 것만 넘기는 곳, 247줄 근처): 하위 session의 `busy`는 root session id와 함께 child 시작으로, `idle`은 child 끝으로 넘긴다. `hook-signal.ts`가 그것을 `ChildStarted`·`ChildEnded`로 바꾼다. root의 turn 시작·끝은 지금 그대로다.
4. 이미 hook을 설치한 사람: 설치기는 `events`에 있는데 설정 file에 없는 event를 `missing`으로 본다. 그 결과가 Settings의 harness 설치 화면에 "다시 설치"로 보이는지 확인한다. 보이지 않으면 고치지 말고 보고한다(그 화면은 이 task 소유 밖). 사람의 `~/.claude`는 건드리지 않는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "Claude subagent hook과 agent_id가 붙은 tool hook은 child signal이 되고, background shell만 남은 Stop은 children이 비어 있다"(`hook-signal_test.ts`). 설치 test(`install_test.ts`)가 새 event를 쓰는 Claude 설정을 만든다.
- 남지 않음: 없음.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 특히 실제 payload로 확인하지 못한 칸(Claude `background_tasks` 항목 꼴, OpenCode 하위 session event)을 적는다.

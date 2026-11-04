# harness-agent: third-party harness를 lophn agent로 (A2A, CLI 명령)

- 목표: Claude Code, Codex, OpenCode를 정의의 `runtime`으로 둔다. 다른 agent, run, workflow step이 lophn A2A(call 봉투, content block)로 일을 보내면 shell 쪽 host가 그 harness의 CLI 명령(headless)을 실행하고 결과가 답이다. harness는 자기 shell에서 `lophn` 명령으로 답하고 다른 agent를 부른다. TUI 열기는 같은 harness session을 resume한다.
- 재료: `project-docs/products/roadmap/agent-platform.md` 단계 7(사람의 원문, 정한 것 3, 4). 코드 사실과 path는 task brief에 있다.
- 범위 밖: `claude gui`(단계 8, ACP와 별도 설치 뒤), 표준 Agent Client Protocol(쓰지 않는다), 별도 설치(단계 6).

## 정한 것

1. `runtime`에 harness 값(`claude-code`, `codex`, `opencode`)을 더한다. 설정 `harness.enabled`가 꺼져 있으면(기본) host code를 load하지 않고 harness runtime session을 열지 않는다. 계획 extension이 먼저 land했으면 이 설정 대신 extension(`extensions.harness.enabled`)으로 켠다. (agent) → extension이 먼저 land해 `extensions.harness.enabled` 하나로 켜고 host는 extension `harness`다(lead, wave 1 land).
2. host는 shell main에 있다(core는 PATH를 모른다). core에는 shell 내부 principal의 route로 붙고, 그 route는 runtime이 harness인 session만 고친다. (agent)
3. harness가 쓴 tool은 lophn이 실행한 것이 아니므로 gate·rewind의 tool-call chain에 넣지 않는다. 메시지의 part kind `harness_tool {name, summary, status}`로 남긴다. (agent)
4. 이어 가기는 harness의 session id다. lophn session에 외부 session id를 둔다(새 ledger step). TUI 열기와 `conversation` 답이 같은 id로 resume한다. (agent)
5. headless 실행은 도중에 묻지 못한다. 띄울 때 권한 flag를 넘기고 그 표는 program에 있다: 정의의 `permissions.deny`를 harness의 금지 flag로 옮기고, 전부 허락(`bypassPermissions`, `danger-full-access`)은 쓰지 않는다. (agent)
6. 답은 harness가 `lophn call reply`를 부르면 그것이고, 아니면 마지막 출력이다(bare 자동 답과 같은 길). harness가 `lophn`을 부를 때는 그 session·turn에만 쓰이고 turn 끝에 만료되는 agent 자격을 env로 받는다. user token은 넘기지 않는다. (agent)
7. 사람 없이(workflow, job) 돌려도 된다. harness가 programmatic 실행을 공식으로 지원한다(사람, 2026-11-04).

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `harness-core` | runtime 값, 설정, Router harness transport와 입력함, host route, `harness_tool` part, 외부 session id |
| 2 | `harness-headless` | headless 명령 data, 출력 parser, 권한 표, shell host가 입력을 실행하고 기록 |
| 3 | `harness-reply` | harness가 `lophn call reply|send`를 쓰는 turn 자격, workflow harness 참가자 |

## lead가 할 일

- 사람에게 묻는다: parser fixture를 녹화하려면 harness를 실제로 한 번 돌려야 한다(실제 model 호출). 허락 전에는 각 CLI 문서와 `--help`로 만든 fixture로 하고 그렇다고 적는다. headless session id로 TUI resume이 되는지도 그때 본다.
- merge마다: `architecture/coding-agent.md`, `terminal-agent.md`, `agent-definition.md`, `agent-call.md`를 고친다. `products/AGENT.md` P6과 `PRODUCT.md`의 "lophn은 coding agent에게 일을 맡기지 않는다"를 고친다.
- 다 끝나면: `agent-platform.md` 단계 7, `roadmap/workflow.md` 남은 일 1, `issues/coding-agent.md`를 고치고 change-log 열린 판에 적고 계획 폴더를 지운다.

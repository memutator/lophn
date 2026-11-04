# harness: third-party harness를 lophn agent로, 그리고 gui로

- 목표: Claude Code, Codex, OpenCode를 정의의 `runtime`으로 둔다. agent로 쓰는 길(call, run, step)은 lophn A2A이고 shell 쪽 host가 그 harness의 headless CLI 명령을 실행한다. 사람이 보는 `<harness> gui`는 lophn GUI가 ACP client가 되어 harness CLI를 ACP process로 띄운다. 둘 다 lophn session 기록에 남고 대화 화면은 같은 source로 읽는다.
- 재료: `project-docs/products/roadmap/agent-platform.md` 단계 6·7(정한 것 2, 26~32, 겹침 5, 6, 23, 24). 코드 사실과 path는 task brief에 있다.
- 범위 밖: 별도 배포(MVP 뒤), harness의 능력 선언 꼴을 명함에 더 싣기(지금은 runtime과 description), lophn 밖 터미널에서 `claude gui`(lophn 터미널 안에서만 먼저 한다).

## 정한 것

1. `runtime`에 harness 값(`claude-code`, `codex`, `opencode`)을 더한다. 값 하나가 두 길(headless, ACP)을 다 쓴다. 설정 `harness.enabled`가 꺼져 있으면(기본) host code를 load하지 않고 harness runtime session을 열지 않는다. (agent, 사람이 정할 것 1의 추천)
2. host는 shell main에 있다(core는 PATH를 모른다). core에는 shell 내부 principal의 route로 붙고, 그 route는 runtime이 harness인 session만 고친다. (agent)
3. harness가 쓴 tool은 lophn이 실행한 것이 아니므로 gate·rewind의 tool-call chain에 넣지 않는다. 메시지의 part kind `harness_tool {name, summary, status}`로 남긴다(`schema_version` 1 그대로). (agent)
4. 이어 가기는 harness의 session id다. lophn session에 외부 session id를 둔다(새 ledger step). TUI 열기와 `conversation` 답이 같은 id로 resume한다. (agent)
5. headless 실행은 도중에 묻지 못한다. 띄울 때 권한 flag를 넘기고 그 표는 program에 있다: 정의의 `permissions.deny`를 harness의 disallow flag로 옮기고, 전부 허락(`bypassPermissions`, `danger-full-access`)은 쓰지 않는다. 정의에 harness 권한 칸을 더하지 않는다(P2). (agent)
6. 답은 harness가 `lophn call reply`를 부르면 그것이고, 아니면 마지막 출력이다(bare 자동 답과 같은 길). harness가 `lophn`을 부를 때는 그 session·turn에만 쓰이고 turn 끝에 만료되는 agent 자격을 env로 받는다. user token은 넘기지 않는다. (agent)
7. ACP(gui)의 권한 요청은 lophn이 판정한다: ACP kind를 gate 종류로 옮기고(execute → shell, edit → file 쓰기, read → file 읽기, fetch → web), deny는 늘 막고 `ask`는 대화 화면에 묻는다. ACP SDK와 adapter는 판을 정확히 고정해 같이 낸다. (agent)
8. 사람의 구독으로 사람 없이 돌려도 된다(사람, 2026-11-04). adapter가 구독 쓰기를 막으면(`claude-agent-acp`의 `--hide-claude-auth`) 우회하지 않는다. (agent)

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `harness-core` | runtime 값, 설정, Router harness transport와 입력함, host route, `harness_tool` part, 외부 session id |
| 2 | `harness-headless` | headless 명령 data, 출력 parser, 권한 표, shell host가 입력을 실행하고 기록 |
| 3 | `harness-reply` | harness가 `lophn call reply|send`를 쓰는 자격, workflow harness 참가자 |
| 4 | `harness-acp` | ACP client host, 권한 요청 판정 |
| 5 | `harness-gui` | lophn 터미널의 `<harness> gui`, 대화 화면의 harness session, 설정 화면 |

## lead가 할 일

- 사람에게 묻는다: parser fixture를 녹화하려면 harness를 실제로 한 번 돌려야 한다(실제 model 호출). 허락 전에는 각 CLI 문서와 `--help`로 만든 fixture로 하고 그렇다고 적는다. ACP session id와 TUI resume id가 같은지도 그때 본다.
- merge마다: `architecture/coding-agent.md`, `terminal-agent.md`, `agent-definition.md`, `agent-call.md`, `approval.md`를 고친다. `products/AGENT.md` P6와 `PRODUCT.md`의 "lophn은 coding agent에게 일을 맡기지 않는다"를 고친다(roadmap "뒤집는 기존 결정").
- 다 끝나면: `agent-platform.md` 단계 6·7, `roadmap/workflow.md` 남은 일 1, `issues/coding-agent.md`를 고치고 change-log 열린 판에 적고 계획 폴더를 지운다.

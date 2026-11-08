# workspace-layers

- 목표: 내장 lophn을 workspace(Home, project, 앱)마다 객체로 두고, 모든 workspace가 같은 설정 층(지시, skill 끄기, MCP, model)을 갖게 하고, 그 위에 workspace memory와 agent memory를 더한다.
- 재료: `project-docs/products/roadmap/workspace-layers.md`(왜, 지금, 목표 꼴), `project-docs/architecture/{agent-definition,agent-call,workspace-session,approval}.md`, `harness-lab/_report/memory-architecture/README.md`(다른 harness의 memory).
- 범위 밖: memory 자동 추출·주기 정리·embedding 검색, 과거 session 검색 넓히기, 다른 workspace의 memory를 prompt에 싣기, `harness-config` roadmap 단계 4(project 층을 repo `.lophn/settings.json`으로), 사람이 만든 전역 agent를 workspace마다 나누기.

## 정한 것

- 내장 lophn은 workspace마다 객체다. name, model, 본문, `mcp_servers`, `skills_off`, `mcp_off`, `extensions`, `apps`, `permissions`, `skip`이 그 workspace의 것이다(사람, 2026-11-08).
- handle은 모두 `lophn`이고 lophn 하나는 handle과 workspace의 짝으로 가리킨다. name은 사람이 workspace마다 바꾼다(사람, 2026-11-08).
- workspace의 lophn은 그 workspace의 범위 agent처럼 돈다. handle `lophn`만 예약이고 profile은 고정이다. id는 workspace에서 정해진다: Home `lophn_home`, project·앱 `lophn_<prj|app id>`. 정의는 `<data>/agents/<id>.md`이고 파일이 없으면 기본 정의다(agent). 범위 agent라는 있는 개념을 쓰므로 목록·명함·call 정책이 그대로 맞고, agent id로 열쇠를 삼는 곳(할당, share request, MCP OAuth token, `mcp.<agent id>.*` secret, call policy 규칙)이 겹치지 않는다. Home lophn은 Home에서만 보인다.
- 전역 `lophn.md`에 사람이 적은 칸, 그리고 `lophn` id로 저장된 것(ledger 행, settings의 call policy 규칙, secret과 OAuth token, share request)은 migration이 모든 workspace의 lophn으로 옮긴다. 행처럼 workspace가 함께 적힌 것은 그 workspace의 lophn id로, 여럿에 걸리는 것은 모든 lophn으로 복사한다(agent). 동작을 그대로 잇는 길이다. 사람이 그 뒤에 workspace마다 뺀다.
- Settings의 전역 lophn 편집(`desktop/settings/agents/`의 lophn card)은 없앤다. 전역 `LOPHN.md` 편집은 남는다(agent).
- 모든 workspace가 같은 층을 갖는다. Home의 그릇 자리는 `<data>/home/`(`LOPHN.md`, `extensions.json`, `skills/`)이고, 앱은 `<data>/apps/<app>/extensions.json`을 더한다. project model 층은 workspace model 층이 된다(사람, 2026-11-08).
- Home 층의 MCP OAuth owner 열쇠는 전역(`global`)과 다른 `home`이다(agent). 지금 `scopeOf`는 workspace null을 전역으로 본다.
- 앱 지시 층은 앱 source의 `AGENTS.md`다. `agent-definition.md:50`의 "AGENTS.md는 지시로 읽지 않는다"를 앱에 한해 뒤집고, `prompts/app.md`의 "file tool로 읽어라"를 지운다(사람, 2026-11-09). source가 연결되지 않은 앱은 그 층이 없다.
- memory는 둘이다. workspace memory `<그릇 자리>/memory.md`(Home `<data>/home/memory.md`)는 그 workspace의 lophn만 쓰고 그 workspace의 모든 agent가 받는다. lophn은 따로 agent memory가 없다. agent memory `<data>/agent-memory/<agt_id>.md`는 사람이 만든 agent마다 하나다(사람, 2026-11-08). `<data>/agents/*.md`를 훑는 옛 data step과 섞이지 않게 폴더를 따로 둔다(agent).
- memory는 지시 block 뒤에 `~~~data`로 감싸 workspace memory, agent memory 순으로 싣는다. session 시작 때 고정하고(daemon 재시작과 Compact 뒤에는 다시 읽는다), 파일마다 8 KiB이고 넘치는 쓰기는 거절한다. notice는 내지 않는다(사람, 2026-11-09).
- memory는 file tool이 아니라 memory tool 하나로 쓰고 rewind로 되돌린다. file tool 범위에 memory 파일을 열지 않는다(사람, 2026-11-09).
- memory에는 사람이 정한 것, 계산할 수 없는 의도, "무엇을 누구에게 물으면 되나" pointer만 담는다. 정의·할당·명함처럼 계산할 수 있는 것과 다른 workspace의 내용은 담지 않는다. 경계를 넘는 길은 call뿐이다(사람, 2026-11-08). 이 규칙은 내장 prompt가 말한다.

## task

| wave | id | 하는 일 |
|---|---|---|
| 1 | `wlophn-core` | lophn id·정의 자리·읽기·주소 풀기·명함·목록, `lophn` 비교를 lophn 판별로, 내장 prompt의 agent 설명 |
| 1 | `wlophn-migrate` | 전역 lophn.md와 `lophn` id로 저장된 것을 workspace마다의 lophn으로 옮기는 data step과 ledger step |
| 1 | `wlophn-ui` | 화면이 workspace의 lophn을 다루기, Settings의 lophn 편집 없애기 |
| 2 | `wlayer` | Home 그릇 자리, Home·앱의 지시·MCP·skill 끄기·model 층, 앱 `AGENTS.md` 층, route를 project에서 workspace로, `prompts/app.md` |
| 3 | `wmem` | memory 자리, memory tool, 주입과 session 시작 고정, rewind, 내장 prompt·skill(`update-apps`, `migrate-sdk`)의 memory 문구와 `sdk-note` |
| 4 | `wui` | Home과 앱에서 Agents 탭 열기, 층 화면, memory 보기·고치기 |

## lead가 할 일

- `project-docs/plan/tools/lead/lead.sh workspace-layers`가 연 worktree에서만 일한다. 도구의 첫 인자는 계획 이름이다.
- wave 1은 셋이 함께 land한다. `wlophn-core`만 land하면 사람의 data root가 옛 `lophn` id로 남아 깨진다. `wlophn-migrate`와 `wlophn-ui`는 `wlophn-core` 뒤에 나란히 띄운다.
- migration은 사람의 `~/.lophn`을 건드리지 않고 `.dev-data/`를 복사해 돌려 본다. 옛 꼴의 root(전역 lophn.md에 `mcp_servers`·`apps`가 있고, `lophn` session·share request·call policy 규칙이 있는 것)를 test fixture로 만들어 확인한다.
- `context-cache` 계획이 prompt 조립(`turn-prompt.ts`, `run-loop/prepare.ts`)을 같이 고친다. `status.py ready`가 running 소유 겹침을 막지만, `wlayer`와 `wmem`를 띄우기 전에 그 계획의 상태를 본다.
- `wlayer`와 `wmem`은 앱 agent가 읽는 지침(`migrate-sdk` skill 등)을 바꾸므로 `sdk-note` skill대로 메모와 Instruction diff를 쓴다.
- 새 tool이 생기면 열린 session에 `tools_changed` notice가 한 번 간다. 정상이다.
- 끝나면 changelog 열린 판에 바뀐 동작과 위 정한 것을 남기고, `wrap-plan`을 planner에게 넘긴다.
- 사람에게 묻는 것: push, 실제 model provider 호출, `~/.lophn`에 migration 돌리기.

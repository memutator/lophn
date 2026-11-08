# workspace-layers: workspace마다 lophn과 설정 층, 그리고 agent memory

상태: 아직 계획으로 열지 않았다.
2026-11-08 사람이 memory roadmap을 열려 했다. 동기는 둘이다. SDK migration 때마다 agent가 사람의 이전 결정을 몰라 다시 묻는다. agent는 무엇을 알 수 있는지 모른다(사람: "agent는 메타인지가 없다. 무엇을 알 수 있는지에 대한 정보를 memory가 책임져야 한다"). 이야기하다 보니 memory의 주인이 될 "workspace의 lophn"이 코드에 객체로 없다는 것이 드러났고, 그것을 먼저 바로잡기로 했다.
조사: `harness-lab/_report/memory-architecture/`(Claude Code, Codex, Hermes, Mixdog, omp/pi, OpenCode, dsh, antigravity의 memory 구조 비교, 2026-11-08).
배경 문서: `project-docs/architecture/agent-definition.md`, `project-docs/architecture/workspace-session.md`, `project-docs/products/roadmap/harness-config.md`.

## 왜

- **내장 lophn은 객체가 하나다.** `<data>/agents/lophn.md` 하나가 Home, 모든 project, 모든 앱에서 session을 연다(`definition-file.ts:146-155`가 `workspace` 칸을 거절한다). "가계부 앱의 lophn"은 lophn.md와 session workspace의 조합일 뿐이다. 그래서:
  - calendar 앱의 lophn에 Google Calendar MCP를 붙이면(정의 `mcp_servers`) lophn project의 lophn에게도 붙는다.
  - 이름, model, 할당(`apps`), 본문이 모든 workspace에서 같다. 이름을 workspace마다 바꿀 수 없다.
  - `lophn agent card lophn`은 어디서 읽어도 같다. Home이 앱마다의 lophn을 구분해 볼 수 없다.
  - Home이 일을 앱의 lophn에게 넘겨도(`prompts/home.md`) 받는 쪽이 같은 객체라 넘기는 의미가 약하다.
- **Home과 앱에는 사람이 붙이는 workspace 층이 비어 있다.** 아래 "지금" 표. Home은 전역과 구분되지 않는다.
- **agent memory가 없다.**
  - Home의 `update-apps`(6단계)와 앱의 `migrate-sdk`(10, 11단계)가 사람에게 묻고, 답은 그 session 대화에만 남는다. 다음 SDK 판에서 같은 것을 다시 묻는다.
  - agent는 무엇을 누구에게 물으면 되는지 모른다. 예: harness-lab project에 harness 조사 report가 있어도, 다른 workspace의 agent는 사람이 path를 주기 전에는 모른다.

## 지금

내장 lophn이 받는 사람 설정 층(2026-11-08 조사):

| 층 | 전역 | Home | project | 앱 | lophn 정의 |
|---|---|---|---|---|---|
| 지시 | `<data>/LOPHN.md`(없으면 CLAUDE.md) | 없음 | 첫 폴더 `LOPHN.md`, 폴더가 없으면 `<data>/projects/<prj>/LOPHN.md` | 없음. source의 `AGENTS.md`는 `prompts/app.md`가 file tool로 읽으라고만 한다 | 본문 |
| skill | `skill_folders` 설정, `<data>/skills` | 없음(builtin, shared, 전역만) | `<첫 폴더>/.lophn/skills`, `<data>/projects/<prj>/skills/`, 끄기는 `extensions.json` | `<source>/.lophn/skills`, `<data>/apps/<app>/skills/`, 끄기 자리 없음 | `skills_off` |
| MCP | 설정 `lophn-agent.extensions.mcp_servers` | 없음 | `<data>/projects/<prj>/extensions.json` | 없음 | `mcp_servers`, `mcp_off` |
| model | 전역 설정 | 없음 | project model(`agents/layers.ts` `projectModelRead`) | 없음 | `model` |

- 층 합치기: 지시 `PROMPT_INSTRUCTION_LAYERS`(`protocol/lophn-agent/instructions.ts:28`, "app 층은 없다"), skill `discoverSkills`(`extensions/skills.ts:386`), MCP `serversOf`(`extensions/mcp-toolkit.ts:135`, project 층은 `workspace.kind === "project"`일 때만), model `resolveAgent`(`agents/resolve.ts`).
- 그릇 자리: project `<data>/projects/<prj>/`(`extensions.json`, `skills/`, `artifacts/`, `workflows/`), 앱 `<data>/apps/<app>/`(`skills/`, `artifacts/`, `data/`, `source/`, ...). Home은 그릇 자리가 없다(`workspaceDataFolder`는 project, 앱만 받는다).
- Home workspace 정보(`workspace-info.ts`)는 project를 이름과 목적만, 앱을 목적·public command·쓰는 곳·package까지 싣는다.
- 내장 skill과 고정 prompt는 workspace 종류별로 이미 나뉜다(`BUILTIN_SKILLS`의 `workspaces`, `agent-workspaces/prompts/{home,project,app}.md`). 이 roadmap은 그것을 건드리지 않는다.
- `extensions.json`에는 data step 주인이 없다.

## 목표 꼴

```
~/.lophn/                               전역 층: 어느 workspace에서나
  LOPHN.md, settings.json, skills/
  agents/<agt_id>.md                    사람이 만든 agent 정의(지금과 같다)
<data>/home/                            Home 그릇 자리(새로)
  LOPHN.md, extensions.json, skills/    Home 층
  agents/lophn.md                       Home의 lophn
  memory/<agent>.md
<data>/projects/<prj>/                  project 그릇 자리(지시는 지금처럼 첫 폴더 LOPHN.md 우선)
  extensions.json, skills/
  agents/lophn.md                       그 project의 lophn
  memory/<agent>.md
<data>/apps/<app>/                      앱 그릇 자리
  extensions.json, skills/              앱 층(MCP, 끄기를 새로)
  agents/lophn.md                       그 앱의 lophn
  memory/<agent>.md
```

1. **내장 lophn은 workspace마다 객체다.**
   - 정의는 그 workspace 그릇 자리의 `agents/lophn.md`이고, 사람이 바꾼 칸만 적는다(지금 lophn.md 규칙과 같다). 파일이 없으면 기본 정의다.
   - handle은 모두 `lophn`이고 주소는 `{agent: "lophn", workspace}`다(call 주소는 이미 이 꼴이다). name, model, 본문, `mcp_servers`, `skills_off`, `mcp_off`, `extensions`, `apps`, `permissions`, `skip`은 그 workspace의 lophn 것이다.
   - 명함(`agents/card`)은 workspace를 받는다. agent session이 읽으면 기본은 자기 workspace의 lophn이다.
   - 전역 `<data>/agents/lophn.md`는 없어진다. 모든 workspace에 공통인 것은 전역 층이 맡는다.
2. **Home, project, 앱이 같은 층 세트(지시, skill과 끄기, MCP와 끄기, model)를 갖는다.** 이 층은 그 workspace의 모든 agent가 받는다(lophn 정의는 lophn만 받는다). calendar 앱의 Google Calendar MCP는 앱 층이나 그 앱 lophn 정의에 붙인다.
3. **agent memory는 (agent, workspace)마다 하나이고 자기 것만 든다.**
   - 담는 것: 사람이 정한 것(앱마다 SDK 선택, 기능을 넣지 않기로 한 것), 계산할 수 없는 의도(앱 사이 관계의 이유), 그리고 "무엇을 누구에게 물으면 되나" pointer. 다른 agent의 내용을 복사하지 않는다. 정의, 할당, 명함처럼 계산할 수 있는 것은 담지 않는다.
   - workspace 경계를 넘는 길은 call뿐이다. 남의 memory를 읽는 길은 두지 않는다.
   - Home의 lophn memory는 각 workspace가 무엇을 맡고 무엇을 아는지의 지도가 된다. 다른 workspace의 agent는 모르는 것을 Home의 lophn에게 묻는다.
   - `update-apps`는 묻기 전에 memory를 보고, 사람이 답하면 적는다. `migrate-sdk`도 같다.

## 정한 것

- 내장 lophn을 workspace마다 객체로 둔다(사람, 2026-11-08). 이름을 workspace마다 바꿀 수 있어야 하고, handoff가 다른 객체에게 넘기는 것이어야 한다.
- 모든 workspace가 같은 설정 층을 갖는다. Home도 전역과 다른 자기 층을 갖는다(사람, 2026-11-08: "어느 하네스든 프로젝트별 설정을 두는 것처럼").
- memory는 자기 것만 들고, 경계를 넘는 것은 call이다(사람, 2026-11-08: "자기 것만 들고 있어야 추상화, 책임 분리가 된다").
- memory가 "무엇을 알 수 있는가"를 책임진다(사람, 2026-11-08).
- Home은 Home이라 부른다. 새 용어를 만들지 않는다(사람).
- handle은 `lophn`으로 고정하고 name만 바꾼다(agent). 주소가 이미 `{agent, workspace}`라 handle을 바꿀 이유가 없다.
- lophn 정의 자리는 그 workspace의 그릇 자리(`agents/lophn.md`)다(agent). 그릇 자리는 workspace의 lophn data가 이미 사는 곳이고, `<data>/agents/`에 두면 workspace를 지울 때 따로 지워야 한다.
- 전역 `lophn.md`에 사람이 적어 둔 칸은 migration이 모든 workspace의 lophn 정의로 복사한다(agent). 동작을 그대로 잇는 길이 이것뿐이다. 사람이 그 뒤에 workspace마다 뺀다.
- 자동 추출(turn 뒤 fork), 주기 정리(dream, curator), embedding 검색은 이번에 만들지 않는다(agent). 다른 harness에서 그것이 붙은 이유는 memory가 커졌기 때문이다. 작은 memory를 사람이 고치는 것으로 시작한다.

## 정할 것

1. **앱 지시 층의 자리.** (a) 앱 source의 `AGENTS.md`를 층으로 올린다(template에서 오고 이미 그 역할을 한다. `prompts/app.md`의 "file tool로 읽어라"를 지운다). (b) 앱 source에 `LOPHN.md`를 새로 둔다(project와 이름이 같다). (c) `<data>/apps/<app>/LOPHN.md`(repo와 같이 다니지 않는다). 추천 (a). 무엇이든 template·지침이 바뀌므로 `sdk-note`가 필요하다.
2. **memory를 prompt에 무엇으로 싣나.** (a) 지시 block에 싣는다. (b) `~~~data` fence로 감싼 참고 data로 싣는다. 추천 (b). memory는 agent가 쓰는 글이고, agent가 웹에서 읽은 것을 적으면 다음 session에 지시가 되는 길이 생긴다(Claude Code가 남긴 비대칭, Mixdog이 막은 길).
3. **세션 중 memory 변경.** (a) session 시작 때 고정하고 다음 session부터 보인다(Hermes). (b) 지시처럼 turn마다 다시 읽고 notice를 붙인다. 추천 (a). agent가 자주 쓰므로 (b)는 notice와 cache miss가 잦다.
4. **memory 크기와 쓰는 길.** 추천: 한 파일 8 KiB, 넘치는 쓰기는 거절해 agent가 정리하게 한다(Hermes). 쓰는 길은 file tool(자기 파일 하나만 쓰기로 연다, rewind로 되돌린다).
5. **사람이 만든 전역 agent(workspace 없음).** 그 agent도 여러 workspace에서 돌아 같은 "가상" 문제가 있다. 추천: 정의는 그대로 하나(사람이 전역으로 만든 것이다), memory만 (agent, workspace)마다.

## 단계

1. 내장 lophn을 workspace마다: 정의 자리와 읽기(`AgentDirectory`, `resolve`), 편집기·할당 panel·명함이 workspace를 받기, 전역 lophn.md migration(`dataSteps`).
2. Home 그릇 자리와 Home·앱 층: `<data>/home/`, 지시·MCP·skill 끄기 층을 Home과 앱에 더하기, Agents 탭이 Home과 앱에서도 층을 보이고 고치기, `extensions.json` data step 주인 정하기.
3. memory: 자리, 쓰기, 주입, Agents 탭에서 보이고 고치기. `update-apps`, `migrate-sdk`, `prompts/home.md`에 memory 쓰는 법을 더하기(`sdk-note`).

## 범위 밖

- 과거 session 검색 넓히기(`SearchSessionMessages`는 같은 agent·place의 최근 200개만). memory와 따로 열 수 있다.
- workspace 정보에 다른 workspace의 memory를 싣기. 위 "정한 것"에서 막았다.
- `harness-config.md`의 project 층을 repo `.lophn/settings.json`으로 옮기는 단계 4. 이 roadmap은 층의 자리를 그 단계와 겹치지 않게 그릇 자리에 둔다.

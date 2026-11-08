# wui

Home과 앱에서도 Agents 탭을 열어 그 workspace의 층(지시, skill, MCP, model)을 보고 고치게 하고, workspace memory와 agent memory를 보고 고치게 한다.

- 단위: wui (wave 4)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/agents/`
  - `packages/shell/renderer/workspace/kinds/agents.tsx`, `packages/shell/renderer/workspace/{use-tab-host-slices.ts,workspace-window.tsx}`
  - `packages/shell/{ipc,main/editor,preload}/`의 memory 파일 열기(새 file, `ipc/instructions.ts` 본보기)
  - `packages/design/i18n/catalog/agents.ts`
  - `tools/wireframes/pages/screens/`의 Agents 화면 page
  - `project-docs/architecture/agent-definition.md`의 "Agents 화면의 범위" 절
- 읽을 것:
  - 계획: `project-docs/plan/workspace-layers/README.md`의 정한 것
  - architecture: `project-docs/architecture/agent-definition.md`(Agents 화면, 층, memory 절)
  - skill: `.claude/skills/ui-design/SKILL.md`
- 계약:
  - 쓰는 것: `workspaceExtensionSettings*`, `workspaceModel*` route, 지시 편집 `layer: home | app`(`wlayer`), `workspaceMemoryFile`, `agentMemoryFile`(`wmem`)
  - 내놓는 것: 없음

## 할 일

1. `workspace/kinds/agents.tsx:55-58`의 `projectId === null` guard를 걷어 Home과 앱에서도 Agents 탭을 연다. `workspace-window.tsx:392`, `use-tab-host-slices.ts`가 Home과 앱의 workspace를 넘기게 한다.
2. `core-source.ts`, `core-extensions.ts`, `source.ts`에서 앱과 Home을 막는 곳(`isAppWorkspace`로 `unavailable`, `instructionsOf`가 null, `readServers`가 전역만)을 걷어 그 workspace의 층을 읽고 쓴다. 앱 지시 층은 source의 `AGENTS.md`이고, source가 없으면 그 칸을 비워 보인다.
3. memory: 그 workspace의 Agents 탭에 workspace memory 칸(lophn이 쓴다는 표시와 함께), agent 편집기에 agent memory 칸을 둔다. 사람은 editor로 열어 고친다(지시 편집과 같은 길). 크기를 8 KiB 대비로 보인다.
4. wireframe을 먼저 고치고 그 코드를 옮긴다(ui-design skill). `dev:mock` fake source를 Home·앱 층과 memory가 보이게 맞춘다.
5. `agent-definition.md`의 "Agents 화면의 범위" 절을 고친 화면에 맞춘다.

## 끝남

- `npm run check`가 통과한다.
- `npm run wireframes`가 되고, gallery의 Agents page가 옮긴 component로 그려진다.
- 위험 test: 없음(화면).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴을 따른다.

## wave 1이 남긴 것 (lead가 더함)

추가 소유: `packages/shell/renderer/shell/left-sidebar-workspaces.ts`, `packages/shell/renderer/workspace/sidebar/`, `tools/wireframes/mock/`

- Home의 Agents 탭을 열면 Home lophn 명함의 범위가 아직 "All of lophn"(scope null)으로 보인다. Home lophn에 맞는 범위 글로 바꾼다.
- `left-sidebar-workspaces.ts`는 다른 workspace의 lophn session을 지금 workspace의 lophn 줄(이름, 얼굴)로 그린다. 사람이 lophn 이름을 workspace마다 바꾸면 다른 workspace session이 이 workspace의 이름으로 보인다. sidebar의 새 session 목록도 다른 workspace의 lophn을 기본 이름 "lophn"으로 보인다. 그 workspace의 lophn 이름을 읽어 보인다(Home에서 workspace 없이 `agents/list`를 부르면 모든 lophn이 온다).
- wireframe mock(`tools/wireframes/mock/agents-data.ts` 등)이 옛 id `"lophn"`을 쓴다. Agents page를 고칠 때 lophn id로 맞춘다.

## wlayer가 남긴 것 (lead가 더함)

추가 소유: `packages/protocol/lophn-agent/{skill-settings,agent-definitions}.ts`, `packages/core/lophn-agent/extensions/skills-handler.ts`, `packages/core/agent-workspaces/workspace/workspace-info.ts`와 옆 `*_test.ts`

- 계약: `skillsRead` 입력(`skill-settings.ts`)이 Home의 skill 층을 물을 길이 없다(null은 전역만이고 Settings가 쓴다). `wlayer`의 route처럼 `{workspace: "home" | prj id | app id}` 열쇠(`workspaceKeySchema`, `protocol/lophn-agent/mcp-settings.ts`)로 Home·project·앱을 고르게 하고 `skills-handler.ts`가 그 workspace의 `extensions.json` 끄기 목록을 읽게 한다. Settings의 전역 읽기는 그대로 둔다.
- model 출처 이름: `agent-definitions.ts` `AGENT_VALUE_LAYERS`의 `"project"`가 이제 workspace 층(Home·project·앱)을 뜻한다. `"workspace"`로 바꾸고 쓰는 곳(화면 문구 포함)을 같이 고친다. 문자열로도 grep한다.
- `workspace-info.ts`: project·앱 prompt는 "Skills folder" 줄이 있는데 Home은 없다. Home의 `<data>/home/skills/`도 같은 꼴로 보인다.
- 화면: 할당·MCP 인증 화면이 Home 층 owner `{kind: "home"}`(`McpOwnerWorkspace`)를 보낸다. source가 없는 앱은 `AGENTS.md` 지시 칸을 비워 보이고 편집을 열지 않는다(지금은 열면 `unavailable`).
- Home lophn에는 file 쓰기 tool이 없어(`tool-lists.ts`) Home `skills/`는 사람이 직접 고친다. 이 task에서 Home tool은 바꾸지 않는다.

## wmem이 남긴 것 (lead가 더함)

- memory tool 이름은 `agent.memory`다(brief의 "memory tool"). 상한 `MEMORY_MAX_BYTES`(8192)는 `packages/protocol/lophn-agent/tool-lists.ts`에 있다. 자리 함수는 `workspaceMemoryFile`, `agentMemoryFile`, `memoryFileOf`(`packages/core/agent-workspaces/workspace/data-folder.ts`)다.
- memory는 session 시작 때 고정된다. 사람이 editor로 고친 내용도 다음 session부터 보인다는 것을 memory 칸에 짧게 보인다.

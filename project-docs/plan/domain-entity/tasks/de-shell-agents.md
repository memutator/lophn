# de-shell-agents

Agents 화면(Settings의 Agents, project 창의 Agents 탭, 대화 위쪽 agent 선택, 알림과 reaction 설정)에서 앱 place와 App Engineer를 되살린다. agent 목록에 App Engineer와 앱 place의 Operator가 보이고, Operator를 앱에도 만들 수 있고, 알림·sender chip이 App Engineer를 부르고, 지침 편집 입구가 다시 앱 place를 안다. 그리고 agent grant 화면의 "붙일 수 있는 tool" 규칙을 project 기준에서 앱 기준으로 바꾼다(같은 앱의 tool은 모두, 다른 앱은 public만). Operator가 domain을 고르는 칸과 domain 기준 거르기는 `de-shell-operator-domains`가 더한다.

- 단위: shell (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/ipc/instructions.ts`
  - `packages/shell/main/editor/instructions.ts`
  - `packages/shell/renderer/conversation/{agent-tab-core-source-env,agent-tab-core-source-sessions,agent-tab-fake-source,agent-tab-source}.ts`
  - `packages/shell/renderer/conversation/composer/agent-composer.tsx`
  - `packages/shell/renderer/conversation/thread/sender-chip.tsx`
  - `packages/shell/renderer/desktop/main.tsx`
  - `packages/shell/renderer/desktop/connection/events/{reactions,waiting-store}.ts`
  - `packages/shell/renderer/desktop/connection/waiting/`
  - `packages/shell/renderer/desktop/settings/connections/source.ts`
  - `packages/shell/renderer/desktop/settings/reactions/`
  - `packages/shell/renderer/editor/instructions-entry.tsx`
  - `packages/shell/renderer/workspace/agents/`
  - `packages/shell/renderer/workspace/kinds/agents.tsx`
  - `packages/shell/renderer/workspace/reactions/toast-handler.ts`
  - `packages/shell/renderer/workspace/sidebar/sidebar-agent.ts`
  - `packages/design/wording/catalog/{agents,conversation,data,workspace-settings}.ts`
  - `packages/design/wording/catalog/{agents,conversation,data,workspace-settings}.placeholders.ts`
  - `tools/wireframes/mock/agents-data.ts`
  - `tools/wireframes/pages/screens/{agent-settings,agents-tab}.tsx`
  - `tools/wireframes/pages/screens/agent-setup/`
  - `tools/wireframes/pages/screens/waiting/`
- 읽을 것:
  - skill: `.claude/skills/wording/SKILL.md`, `.claude/skills/ui-design/SKILL.md`
  - architecture: `project-docs/architecture/agent-definition.md`("Operator 정의를 만들고 고치는 tool은 grant를 주지 못한다"), `project-docs/architecture/place-session.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `agents`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > 되돌리기", `project-docs/products/AGENT-ROLE.md`
  - 본보기(화면): `tools/wireframes/pages/screens/agent-settings.tsx`와 `agents-tab.tsx`, `agent-setup/`
  - 본보기(git): `212513bcb`(Agents 화면에서 앱 place와 App Engineer를 걷어 낸 diff를 거꾸로 읽는다). 그 뒤에 land한 Operator `skills` 고르기(`dd99513f0`)와 public tool 거르기(`f89cb33c0`)는 지우지 않는다.
- 계약:
  - 쓰는 것: `AgentsSource.list(place)`가 앱 place도 받는다(`de-place-restore`가 `workspace/agents/{core-source,source}.ts`를 맞춰 두었다), `AppTool.domain`(`GrantApi`에 `domain` 이름을 실을 수 있다)
  - 내놓는 것: `GrantApp`에서 `project` 칸이 없어지고(`app.project`를 읽지 않는다), `appsFor(apps, place)`(`editor/grants-model.ts`)는 `place`(project id 또는 앱 id)가 앱 id와 같은 앱은 모든 tool을, 아닌 앱은 public tool만 남긴다.

## 할 일

1. `212513bcb`를 `workspace/agents/`, `conversation/`, `desktop/`, `editor/`, `workspace/{kinds,reactions,sidebar}/`, `ipc/instructions.ts`, `main/editor/instructions.ts`에 역으로 적용한다(`git show 212513bcb -- <path> | git apply -R --3way`). 지금 코드에서 Operator의 `skills`, grants 화면의 public 거르기, artifact 관련 변경이 같은 file에 있으니 충돌은 새 쪽을 살리고 앱 갈래만 더한다. 되살아나는 것: agent 목록의 앱 place 줄과 App Engineer 줄, Operator 만들기·편집의 place 고르기(project 또는 앱), 알림 카드와 sender chip의 App Engineer 이름, 지침 편집 입구의 앱 층 안내(앱 place에는 project `LOPHN.md`가 없으므로 "앱 층 지침 없음" 안내는 되살리지 않아도 되고, 지침은 agent 본문뿐이라고 적는다. 정해지지 않으면 `212513bcb^`의 문구를 쓴다).
2. grants: `editor/grants-model.ts`의 `appsFor`를 위 계약대로 바꾸고, `source.ts`의 `GrantApp`에서 `project`를 지우고 `core-grants.ts`의 `project: app.project` 줄을 뺀다. `grants-model_test.ts`를 새 규칙으로 쓴다(옛 project 사례는 지운다). `fake-data.ts`의 "다른 project의 앱" 주석과 fixture를 맞춘다.
3. wording: `packages/design/wording/catalog/{agents,conversation,data,workspace-settings}.ts`의 되살아나는 key를 `212513bcb`의 역으로 복원한다. `deno task wording`으로 생성물을 맞춘다.
4. wireframe: `tools/wireframes/mock/agents-data.ts`, `pages/screens/{agent-settings,agents-tab}.tsx`, `agent-setup/agent-setup-pages.tsx`를 되돌린다. `pages/screens/waiting/`은 알림 카드 fixture만 맞춘다.
5. `KindViolationFound`·`PublicToolsChanged`의 알림 문구는 받는 쪽이 PM 또는 App Engineer일 수 있으니 "Project Manager"라고 못 박은 줄이 있으면 role 이름을 데이터에서 받게 한다(`desktop/connection/waiting/model.ts`, `desktop/settings/reactions/model.ts`).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "다른 앱의 비공개 tool은 grant 화면 목록에 나오지 않고, 같은 앱(agent의 place가 그 앱)의 tool은 모두 나온다. project place의 agent에게는 모든 앱의 public tool만 나온다" — `packages/shell/renderer/workspace/agents/editor/grants-model_test.ts`
- 남지 않음: `grep -rn "app.project\|project: app" packages/shell/renderer/workspace/agents`가 0줄이다.
- (화면) `deno task wireframes`가 되고, gallery의 `agentSettingsArea`에서 App Engineer와 앱 place Operator가 든 Agents 화면이 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성물(`deno task wording`)
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: Operator가 domain을 고르는 칸이 없다(`de-shell-operator-domains`)

# dp-shell-agents

agents 화면(편집기, 사이드바, 설정), 대화 탭, 대기 목록·알림, 지침 편집 진입점에서 앱 place와 App Engineer를 지우고 project 층으로 합친다: 내장 agent는 lophn, Project Manager(PM)뿐이고 Operator는 project에만 만든다. Operator·내장 정의 편집기의 skill 칸은 "끌 것"을 고르던 것에서 "받을 것"을 고르는 것(`skills`, 비면 전부)으로 바뀐다. 지침 편집 IPC의 `app` 층을 지운다.

- 단위: shell-place (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/agents/`
  - `packages/shell/renderer/workspace/kinds/agents.tsx`
  - `packages/shell/renderer/workspace/sidebar/sidebar-agent.ts`
  - `packages/shell/renderer/workspace/reactions/toast-handler.ts`
  - `packages/shell/renderer/conversation/`
  - `packages/shell/renderer/desktop/connection/`
  - `packages/shell/renderer/desktop/settings/`
  - `packages/shell/renderer/desktop/main.tsx`
  - `packages/shell/renderer/desktop/intents.tsx`
  - `packages/shell/renderer/desktop/router.ts`
  - `packages/shell/renderer/desktop/entry.tsx`
  - `packages/shell/renderer/desktop/palette/`
  - `packages/shell/renderer/editor/instructions-entry.tsx`
  - `packages/shell/ipc/instructions.ts`
  - `packages/shell/main/editor/instructions.ts`
  - `packages/design/wording/catalog/agents.ts`
  - `packages/design/wording/catalog/data.ts`
  - `packages/design/wording/catalog/conversation.ts`
  - `packages/design/wording/catalog/workspace-settings.ts`
  - `tools/wireframes/pages/screens/agents-tab.tsx`
  - `tools/wireframes/pages/screens/agent-settings.tsx`
  - `tools/wireframes/pages/screens/agent-chat.tsx`
  - `tools/wireframes/pages/screens/agent-setup/`
  - `tools/wireframes/mock/agents-data.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`, `project-docs/architecture/place-session.md`, `project-docs/architecture/workspace-layout.md`, `project-docs/architecture/approval.md`(대기 목록 카드)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
  - 본보기(화면): `tools/wireframes/pages/screens/agents-tab.tsx`, `agent-setup/agent-setup-pages.tsx`, `agent-chat.tsx`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > place / Operator skill", `project-docs/products/AGENT-ROLE.md`의 P1~P7
  - 쓰는 규칙: `.claude/skills/wording/SKILL.md`, `.claude/skills/ui-design/SKILL.md`
- 계약:
  - 쓰는 것: 정의 읽기·쓰기의 칸 이름 `skills`(`dp-operator-skills`. 이 task는 renderer의 `source.ts` 타입으로 받으니 wire 이름만 맞는다), `Role`에 `app_engineer`가 없는 세계(protocol 정리는 `dp-place-protocol`이 마지막에 한다. 그때까지 renderer가 `Role` 값을 import한 곳은 `app_engineer`를 쓰지 않는다)
  - 내놓는 것: `AgentKey`의 내장 key는 `lophn`, `project_manager`뿐이다. place는 `project` 하나다. 지침 편집 IPC `InstructionsPlace`는 `global`·`project` 층만 있다.

## 할 일

1. agents 화면의 앱 place를 지운다: `packages/shell/renderer/workspace/agents/agent-key.ts`(`BUILT_IN`, `isAppPlace`, 30째 줄의 `app_engineer` key), `sidebar-agents.ts`(`ORDER`, 26째 줄), `core-source.ts`(97, 299, 372, 413, 535째 줄의 `isAppPlace`·`app_engineer`·`PlaceChoice.kind: "app"`), `core-grants.ts`(77째 줄), `core-extensions.ts`(173째 줄 `layer: "project" | "app"`), `source.ts`(89, 129째 줄 `kind: "project" | "app"`), `fake-data.ts`, `fake-source.ts`, `packages/shell/renderer/workspace/agents/editor/{definition-form,parts,agent-editor}.tsx`(`owner: … "app"`, role label), `kinds/agents.tsx`(16째 줄 `BUILT_IN_KEYS`), `packages/shell/renderer/workspace/sidebar/sidebar-agent.ts`, `packages/shell/renderer/workspace/reactions/toast-handler.ts`. 새 Operator를 만들 때 고르는 place 목록에서 앱을 뺀다.
2. skill 칸을 바꾼다: `packages/shell/renderer/workspace/agents/source.ts`(73~118째 줄), `core-source.ts`(105, 683째 줄), `fake-data.ts`, `fake-source.ts`(293째 줄), `packages/shell/renderer/workspace/agents/editor/definition-form.tsx`(53, 231, 390째 줄)에서 정의의 `skills_off`를 `skills`(받을 이름 목록)로 바꾸고, 화면 문구와 동작을 "고른 것만 받는다. 아무것도 안 고르면 모두 받는다"로 맞춘다. 전역·project 층의 skill 켜고 끄기(`lophn-agent.extensions.skills_off`, project `extensions.json`의 `skills_off`)는 다른 층이라 그대로 둔다(`packages/shell/renderer/desktop/settings/agents/core-source.ts`의 `SKILLS_OFF`도 그대로).
3. 대화 탭: `packages/shell/renderer/conversation/agent-tab-core-source-env.ts`(20, 37째 줄), `agent-tab-core-source-sessions.ts`(77째 줄), `agent-tab-core-source-calls.ts`(70째 줄: coding agent 호출의 `place.app`은 그대로, 앱 place 갈래만), `agent-tab-source.ts`(48, 582째 줄), `agent-tab-fake-source.ts`(113~116째 줄), `thread/sender-chip.tsx`(23째 줄), `composer/agent-composer.tsx`(66, 287째 줄의 앱 place 아이콘)에서 `app_engineer`와 `kind: "app"` place를 지운다.
4. 대기 목록·알림: `packages/shell/renderer/desktop/connection/waiting/{model.ts(60째 줄), fake-source.ts, cards/head.tsx(18째 줄)}`, `events/{reactions.ts, waiting-store.ts(149, 208째 줄)}`, `toasts/toast-text.ts`, `packages/shell/renderer/desktop/settings/connections/source.ts`에서 App Engineer 항목과 앱 place를 지운다. 앱이 대상인 허락 카드(`waiting.label.place-app`이 쓰이는 app-api·activation 대상 표기)는 앱 place가 아니라 앱 대상이라 그대로 둔다 — 두 가지를 가려서 고친다.
5. `packages/shell/renderer/desktop/main.tsx`(197, 217, 254, 365째 줄)·`intents.tsx`·`router.ts`·`entry.tsx`·`palette/desktop-scope.ts`·`packages/shell/renderer/desktop/settings/settings-space.tsx`: 앱 공간으로 가는 길(`go({ kind: "app" })`, `setRoute(openApp)`)은 그대로 두고, 대화 session의 place가 앱이던 분기(217째 줄 `place?.kind === "app"`)와 앱 지침 편집(`openInstructions({ layer: "app" })`)을 지운다. 앱 공간이 앱의 project id를 필요로 하면(`dp-shell-app-space`의 요청) 앱 행에서 읽어 넘긴다.
6. 지침 IPC: `packages/shell/ipc/instructions.ts`(15~19, 24~27째 줄)와 `packages/shell/main/editor/instructions.ts`(앱 층 null 반환)에서 `app` 층을 지운다. `renderer/editor/instructions-entry.tsx`의 `placeKey`도.
7. wording: `packages/design/wording/catalog/agents.ts`(234째 줄 `project-workspace.label.role-app-engineer`), `data.ts`(48째 줄 `waiting.label.agent-app-engineer`), `conversation.ts`(228째 줄 `conversation.label.sender-role-app-engineer`), `workspace-settings.ts`(49, 162, 173, 182, 186째 줄의 App Engineer 문장)을 PM 기준으로 고치고 안 쓰는 key는 지운다. skill 칸 문구의 "off"를 받는 쪽으로 바꾼다. `deno task wording`으로 생성물을 맞춘다.
8. wireframe: 위 owned wireframe 파일의 App Engineer·앱 place·`skills_off` 표기를 같은 규칙으로 맞춘다. 새로 그리지 않는다.
9. 시험을 맞춘다: `packages/shell/renderer/workspace/agents/core-source_test.ts`, `packages/shell/renderer/workspace/agents/editor/grants-model_test.ts`의 App Engineer·앱 place 사례는 지운다. 위험 test는 두지 않는다.
10. 합집합이 아직 남아 있다: protocol의 `Role`·`Place`는 `dp-place-protocol`이 마지막에 줄인다. 그때까지 `app_engineer`·앱 place가 type에 있어 exhaustive `switch`나 `Record<Role, …>`가 오류를 내면 그 갈래만 새 로직 없이 남긴다(null, 빈 값). 남긴 곳은 보고의 "넘길 줄"에 file:줄로 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(화면·문구다)
- 남지 않음: `grep -rn "app_engineer\|App Engineer" packages/shell/renderer packages/shell/ipc packages/shell/main packages/design/wording/catalog tools/wireframes/pages tools/wireframes/mock`가 `packages/shell/renderer/app-frame`(`dp-shell-app-space`)과 `packages/design/wording/catalog/app-space.ts`를 뺀 곳에서 0줄이다. `grep -rn "isAppPlace" packages/shell`이 0줄이다.
- (화면) `deno task wireframes`가 되고 gallery의 agents 화면(`agents-tab`)과 agent 설정(`agent-setup`)이 바뀐 구성으로 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성물(`deno task wording`)
- 안 쓰게 된 export
- 정한 것: 앱 대상 허락 카드와 앱 place 표기를 어떻게 가렸는지
- 넘길 줄: 앱 공간이 project id를 받는 prop(`dp-shell-app-space`와 맞춤)
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**

# app-agent-sdk

앱이 쓰는 SDK `@lophn/agent`를 만든다. session을 열고, 앱 context를 block으로 싸 보내고, ACP 상태를 React hook으로 받고, 꼴이 있는 답을 꺼내 검사한다. 앱을 짓는 agent가 이것을 알게 template과 skill을 고친다.

- 단위: app-agent (wave 2)
- 선행: app-agent-bridge. 그 task가 더한 `lophnApp.agent`를 쓴다.
- 소유(이 task만 고친다):
  - `packages/sdk/agent/`(새 package: `package.json`, `mod.ts`, `guide.md`, test)
  - `packages/core/apps/releases/ui-build/build.ts`(앱 빌드가 아는 SDK 목록에 한 줄)
  - `packages/core/apps/packages/template/app/{AGENTS.md.tmpl,package.json.tmpl}`
  - `packages/core/agent-places/skills/design-app/SKILL.md`
  - `tools/wireframes/mock/app-space/coding-coach-view.tsx`(새 file)
  - `tools/wireframes/pages/screens/app-space/pages.tsx`
  - 추가 소유(lead가 더함):
    - `packages/core/apps/packages/vendor.ts`: `@lophn/agent` 사본이 `packages/sdk/agent` 밖 소스(`protocol/acp/reduce.ts`와 그 type 등)를 쓰면 그 vendor rule 하나만 더한다. 설치 사본은 앱 bundle 안에서 저장소 없이 읽힌다.
    - `packages/core/apps/packages/template/app/lophn.ts.tmpl`: `sdk_dependencies`가 `package.json.tmpl`의 SDK 의존과 같아야 하므로 그 한 줄만.
    - `package-lock.json`: 새 workspace로 npm이 쓰는 줄만.
- 읽을 것:
  - 계획: `project-docs/plan/app-agent/README.md`의 정한 것 3~5
  - 본보기 SDK: `packages/sdk/app-ui/`(`appBridge()`, `useOperation`, `guide.md`의 꼴)
  - ACP: `packages/protocol/acp/`(`reduceAcp`, 항목 꼴), `project-docs/architecture/acp.md`
  - content block: `packages/protocol/lophn-agent/content-block.ts`
  - 앱 SDK 목록: `packages/core/apps/packages/store.ts`, `packages/core/apps/releases/bundle/manifest.ts`(SDK package가 앱에 실리는 길)
- 계약:
  - 쓰는 것: `lophnApp.agent`(open, snapshot, onUpdate, send)
  - 내놓는 것(`@lophn/agent`):
    - `useAgentSession({agent}) → {session, state: AcpState | null, send(blocks, {reply?}), stop(), answer(...), error}`. 상태는 snapshot 뒤 update를 `reduceAcp`로 쌓는다.
    - `contextBlock({name, mimeType, text}) → ContentBlock`: 앱 context를 `resource` block으로 싼다.
    - `send(blocks, {reply: JSONSchema})`: 꼴을 알리는 글 block을 더해 보낸다. 그 turn의 마지막 agent 메시지 글에서 JSON을 꺼내 꼴을 검사한 값이 `reply`로 나온다(`{ok: true, value} | {ok: false, error}`).

## 할 일

1. package를 만든다. 판은 다른 `packages/sdk/*`의 꼴을 따르고, 의존성 판을 고정한다. 앱 빌드와 앱 package 목록이 이 package를 알게 한다(위 두 file. 다른 길이 필요하면 보고).
2. 꼴 검사는 가장 작은 JSON schema 부분(type, properties, required, items, enum)만 한다. 큰 검사 library를 들이지 않는다.
3. `guide.md`: 코딩 테스트 앱 예(attempt와 코드를 context block으로, 줄 주석 답 꼴, 받은 주석을 textarea 줄에 그리기)로 쓴다.
4. 앱을 짓는 agent가 쓰도록 template의 `AGENTS.md.tmpl`과 `design-app` skill에 "앱 화면에서 agent와 이야기할 때는 `@lophn/agent`" 한 절을 더한다.
5. wireframe: 앱 space에 코치 앱 view 하나(코드 textarea, 줄 주석, 보내기)를 fake 상태로 둔다.

## 끝남

- `npm run check`가 통과한다. `npm run wireframes`가 되고 gallery에 그 view가 보인다.
- 위험 test: "답 꼴에 맞지 않는 agent 답은 값이 아니라 오류로 나온다"(`packages/sdk/agent/` test).
- 남지 않음: 없음.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 특히 "등록할 것"(workspace package 목록, root `package.json`).

# place-declaration

앱 선언의 화면 칸 `sizes: ("full"|"panel"|"card")[]`를 `places: ("tab"|"panel"|"card"|"sidebar"|"tray")[]`로 바꾸고, 화면이 받는 인자 schema `params?`를 더한다. 저장된 release 선언을 옮기는 ledger step, `@lophn/declaration` 4.0.0, 모든 쓰는 곳을 한 변경에 고친다.

- 단위: place (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/declaration/**`
  - `packages/protocol/apps/channel-values.ts`
  - `packages/core/apps/declaration/**`
  - `packages/core/apps/agent-tools/app-card.ts`, `packages/core/apps/agent-tools/visual.ts`
  - `packages/core/apps/releases/activation/desired.ts`, `packages/core/apps/releases/schema.ts`, `packages/core/apps/releases/schema_test.ts`
  - `packages/core/storage/migration/schema-steps.lock.json`
  - `packages/core/apps/runtime/control-protocol.ts`, `packages/core/apps/runtime/supervisor/supervisor.ts`
  - `packages/core/apps/preview/{model.ts,launcher.ts,service.ts}`
  - `packages/core/main/app-supervisor/assembly.ts` (screens 넘기는 줄만)
  - `packages/core/apps/packages/template/app/**`
  - `packages/core/agent-workspaces/skills/design-app/SKILL.md`
  - `packages/sdk/declaration/**`
  - `packages/sdk/app-ui/package.json`, `packages/sdk/app-ui/guide.md` (판과 pin만)
  - `tests/support/app/sample/lophn.ts.tmpl`
  - `tools/wireframes/package.json` (pin만), `package-lock.json`
  - `packages/shell/ipc/app-frame.ts`
  - `packages/shell/main/app-frame/{app-connection.ts,view-model.ts,declaration-source.ts,registry.ts}`와 그 폴더의 `*_test.ts` fixture
  - `packages/shell/renderer/apps/core-source.ts`
  - `packages/shell/renderer/app-frame/{app-views.tsx,embedded-view.tsx,app-window.tsx}`
  - `packages/shell/renderer/workspace/{app-panel-tab.tsx,app-screen-tab.tsx}`
  - `packages/shell/renderer/workspace/visuals/app-card-block.tsx`
  - `packages/shell/renderer/desktop/dev-mock/app-space.ts`
  - `packages/design/i18n/catalog/project.ts` (`app-panel.notice.not-panel`, `app-card.notice.not-card` 문구만)
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`(선언, SDK pin), `project-docs/architecture/workspace-layout.md` 줄 128 근처(앱 전용 창이 고르는 화면)
  - roadmap: `project-docs/products/roadmap/app-place.md`의 "1. 앱 화면 체계"
  - 계획: `project-docs/plan/app-place/README.md`의 정한 것 1, 2
  - 본보기 migration: `packages/core/apps/releases/schema.ts`의 step `apps.releases.declaration-no-domain`과 `packages/core/apps/releases/schema_test.ts`의 그 test
  - SDK 판 규칙: `packages/sdk/declaration/guide.md`와 `packages/sdk/app-ui/guide.md`의 "version 정책", `project-docs/issues/mistakes.md`의 SDK pin을 빠뜨린 일
  - AGENTS.md "호환성"(옛 이름 읽기 금지, 저장 모양이 바뀌면 migration)
- 계약:
  - 쓰는 것: `InputSchema`와 `validateSchemaNode`(`packages/protocol/apps/declaration/schema.ts`)
  - 내놓는 것:
    - `type Place = "tab" | "panel" | "card" | "sidebar" | "tray"`
    - `ScreenDeclaration = {key, label, path, places: Place[], params?: InputSchema}`. `params`의 root type은 object다.
    - shell IPC `appViewOpenSchema`와 `appFrameViewStateSchema`의 `size` 칸은 `place` 칸(같은 다섯 값)이 된다. renderer `EmbeddedView`의 prop `size`는 `place`가 된다. wave 2 `place-params`가 이 위에 `params`, `workspace`를 더한다.

## 할 일

1. **protocol 선언** (`packages/protocol/apps/declaration/`)
   - `types.ts`: `ScreenSize`를 지우고 `Place`를 둔다. `ScreenDeclaration.sizes`를 `places`로 바꾸고 `params?: InputSchema`를 더한다.
   - `read.ts`: zod도 같이 바꾼다.
   - `tools.ts` `validateLayers`: key 목록, 비지 않음, 값, 중복 검사를 `places`로 옮긴다. `params`는 있으면 `validateSchemaNode`로 검사하고 root가 object인지 본다.
   - `value.ts`: 정규화(`places`는 순서 그대로, `params`는 있을 때만)를 맞춘다.
   - `channel-values.ts`의 쓰지 않는 `screenSizeSchema`를 지운다.
2. **core**
   - `describe.ts` gap 검사와 `reads.ts`의 `app.tool` read를 맞춘다. read는 `places`와 `params`를 준다.
   - `app-card.ts` `cardViewDeclared`는 `places.includes("card")`를 본다.
   - `activation/desired.ts`의 `ScreenSizes`와 `screens` 칸을 정한다. 그 값은 control protocol, supervisor, preview, `assembly.ts` `wireOf`를 지나기만 하고 읽는 곳이 없다. 정말 읽는 곳이 없으면 그 길(control-protocol의 `screenSize` enum 포함)을 지운다. 읽는 곳이 있으면 `places`로 바꾸고 보고에 적는다.
3. **ledger step** (`packages/core/apps/releases/schema.ts`)
   - 새 step `apps.releases.declaration-places`를 끝에 더한다. `releases.declaration`의 `$.screens[]`마다 `sizes`를 지우고 `places`를 둔다(`full`→`tab`, `panel`·`card`는 그대로).
   - 본보기처럼 `releases_immutable` trigger를 내렸다 다시 만들고, `declaration_hash`는 그대로 둔다.
   - lock(`schema-steps.lock.json`) 끝에 `{id, sha256}`을 더한다. 이미 낸 step의 SQL은 고치지 않는다.
4. **SDK와 pin**
   - `@lophn/declaration`을 4.0.0으로 올리고 `mod.ts`와 `guide.md`를 맞춘다.
   - `@lophn/app-ui`는 declaration pin만 4.0.0으로 바꾸고 판을 2.3.0으로 올린다. API는 그대로다.
   - pin이 있는 곳을 모두 고친다: app template(`lophn.ts.tmpl`, `package.json.tmpl`, `AGENTS.md.tmpl`), `tests/support/app/sample/lophn.ts.tmpl`, `tools/wireframes/package.json`, `package-lock.json`(`npm install`로 다시 만든다), guide 표와 예.
   - 끝나면 `grep -rn "3\.0\.0\|2\.2\.0" packages/sdk packages/core/apps/packages tests/support tools/wireframes/package.json`로 declaration·app-ui의 옛 판이 남지 않았는지 본다. `installSdkCopies`가 판을 어디서 읽는지도 확인한다.
5. **skill과 template 글**: `design-app/SKILL.md`의 "Where screens open"을 새 자리로 고친다.
   - `tab`: 앱 workspace와 앱 창. 첫 `tab` 화면이 입구다.
   - `panel`: project의 dock·float, 전역 float.
   - `card`: 대화.
   - `sidebar`: 오른쪽 sidebar.
   - `tray`: 작업 표시줄 tray popup.
   - `params`는 화면이 받는 인자다. 한 화면 안 부분을 따로 쓰고 싶으면 화면으로 나눈다는 지침을 같이 쓴다.
   - template `AGENTS.md.tmpl`·`lophn.ts.tmpl`의 예를 맞춘다.
6. **shell**: `size`를 `place`로 바꾸고, `"full"`을 쓰던 곳은 `"tab"`이다.
   - main: `ipc/app-frame.ts`, `app-connection.ts`, `view-model.ts`(`SIZES`, `OPEN_KEYS`, 검사), `registry.ts`(`card` 판정, follow release 판정), `declaration-source.ts` `createEntryScreen`(첫 `tab` 화면).
   - renderer: `core-source.ts` `entryScreen`, `app-views.tsx`, `embedded-view.tsx`, `app-panel-tab.tsx` `panelScreens`, `app-screen-tab.tsx`, `app-window.tsx`, `app-card-block.tsx`, `dev-mock/app-space.ts`.
   - `packages/shell/renderer/workspace/workspace-window.tsx`의 `sizes.includes("panel")` 두 줄(1681, 2355 근처)은 소유 밖이다. 그 두 줄만 `places`로 고치고 "넘길 줄"에 적는다.
7. 옛 이름이 남지 않게 문자열로도 grep한다: `"sizes"`, `sizes:`, `.sizes`, `ScreenSize`, `screenSizeSchema`, `size: "full"`, `"full"`(앱 화면 뜻인 것). `packages/design/components/layout/app-shell/space.ts`의 `ContainerSpace`는 다른 뜻이라 둔다. `tests/eval/`(registry, runs)는 고치지 않는다.

## 끝남

- `npm run check:full`이 통과한다. `node packages/shell/renderer/build.ts`가 된다.
- 위험 test(사람의 저장된 release를 잃거나 망가뜨리면 곤란하다):
  - `packages/core/apps/releases/schema_test.ts`: "`sizes`를 가진 옛 release 행이 step 뒤 `places`(`full`→`tab`)를 갖고, `declaration_hash`가 그대로이고, 새 검사를 통과한다"
- 남지 않음: `grep -rn "ScreenSize\|screenSizeSchema\|\.sizes\b\|\"sizes\"" packages tools tests/support`가 0줄이다(`tests/eval` 제외).
- `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`.

## 보고

brief-template의 보고 꼴. screens 넘기는 길을 지웠는지와 그 근거, `installSdkCopies`가 새 판을 까는지 적는다.

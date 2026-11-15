# mobile-place-decl

앱 선언의 `screens[].places`에 `phone`을 더한다. `phone`은 한 화면의 `places`에 혼자 서는 자리이고(폰 앱이 그리는 React Native 화면), 같은 literal이 적힌 아홉 곳을 맞추고, `@lophn/declaration`을 4.6.0으로, 그것에 정확한 판으로 기대는 `@lophn/app-ui`를 2.15.0으로 올린다.

- 단위: app-place (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/declaration/types.ts`
  - `packages/protocol/apps/declaration/tools.ts`
  - `packages/protocol/apps/declaration/read.ts`
  - `packages/protocol/shell/app-bridge-types.ts`
  - `packages/shell/ipc/app-frame.ts`
  - `packages/shell/main/app-frame/view-model.ts`
  - `packages/shell/main/app-frame/app-connection.ts`
  - `packages/shell/preload/app-tool.ts`
  - `packages/sdk/declaration`
  - `packages/sdk/app-ui`
  - `packages/core/agent-workspaces/skills/migrate-sdk/declaration-4.6.0.md`(새 file)
  - `packages/core/agent-workspaces/skills/migrate-sdk/app-ui-2.15.0.md`(새 file)
  - `packages/core/apps/packages/template/app/lophn.ts.tmpl`
  - `packages/core/apps/packages/template/app/package.json.tmpl`
  - `tests/support/app/sample/lophn.ts.tmpl`
  - `tools/wireframes/package.json`
  - `package-lock.json`
- 공유 줄 허락(한 줄만 고치고 보고의 "넘길 줄"에 적는다):
  - `packages/core/apps/packages/template/app/AGENTS.md.tmpl`: 26행의 `.lophn/sdk/declaration/4.5.1/guide.md`를 새 판으로. 지침 내용은 `mobile-agent-guidance`가 쓴다.
  - `project-docs/architecture/app-call.md`: 35행의 자리 목록(`tab | panel | card | sidebar | tray`)에 `phone`과 "혼자 선다"를 한 줄로. 이 file의 나머지는 `mobile-views-core`가 고친다.
- 읽을 것:
  - skill: `.claude/skills/sdk-note/SKILL.md`(판, pin, 메모, Instruction diff, `supported_from`의 규칙 전부. 그대로 따른다). 본보기 메모: `declaration-4.5.1.md`(patch, Instruction diff), `app-ui-2.14.1.md`(pin만 올린 판)
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/app-place-survey.md`의 1.1(선언)과 3.1
  - architecture: `project-docs/architecture/app-call.md`("선언의 두 층"의 화면 줄), `ui-kit.md`("앱 SDK 판과 지원 하한")
- 계약:
  - 쓰는 것: `Place`와 `validateLayers`가 있는 `packages/protocol/apps/declaration/{types,tools}.ts`
  - 내놓는 것:
    - `type Place = "tab" | "panel" | "card" | "sidebar" | "tray" | "phone"`
    - 규칙: `places`에 `phone`이 있으면 `places`가 정확히 `["phone"]`이다. 다른 자리와 섞으면 `invalid_input`, 메시지 `screen <key>: phone is its own place; it cannot be combined with tab, panel, card, sidebar or tray`. `tray` 칸은 `tray` 자리가 있어야 하므로 `phone`과 같이 쓰면 기존 규칙(`screen <key> tray needs the tray place`)이 이미 막는다
    - `path`의 검사는 바꾸지 않는다(내부 절대 path). 폰 화면의 `path`가 무엇을 가리키는지는 빌드 task가 정한다
    - 이미 저장된 선언은 그대로 읽힌다(additive라 data migration이 없다)

## 할 일

1. `types.ts`의 `Place`와 그 위 주석(자리마다 한 줄: `phone`은 폰 앱이 그리는 React Native 화면)에 `phone`을 더한다. `tools.ts`의 `PLACES`(`:36`)에 더하고 `validateLayers`(`:138-143` 근처, 자리가 비지 않고 알려진 값이고 겹치지 않는지 보는 곳)에 위 혼자 서는 규칙을 더한다. `read.ts`의 zod enum(`:46`)에 더한다(저장된 선언을 읽는 길이라 규칙은 넣지 않고 값만).
2. 같은 literal이 적힌 나머지 여섯 곳도 맞춘다(1과 합쳐 아홉 곳이다): `packages/sdk/app-ui/use-place.ts:3`, `packages/protocol/shell/app-bridge-types.ts:171`, `packages/shell/ipc/app-frame.ts:16`, `packages/shell/main/app-frame/view-model.ts:105`, `packages/shell/main/app-frame/app-connection.ts:46`, `packages/shell/preload/app-tool.ts:105`. 이 file들을 지금 `grep -rn '"sidebar"' packages --include=*.ts --include=*.tsx`로 다시 찾아 빠진 곳이 없는지 본다. shell 쪽을 맞추는 이유: renderer의 `AppViewOpen["place"]`에 선언의 places를 그대로 넘기는 곳(`packages/shell/renderer/app-frame/app-views.tsx:207` 근처)의 type이 `phone`을 모르면 typecheck가 깨진다. desktop은 `phone` view를 열지 않는다(뒤의 preview task가 연다).
3. 모든 `places.includes(...)` 호출(`sidebar-panels.tsx:231`, `quick-launch-editor.tsx:391`, `tray.tsx:86`, `app-panel-tab.tsx:35`, `core-source.ts:219`, `declaration-source.ts`의 `tab` 입구 찾기, core의 `app-card.ts:18`)이 `tab`이 없는 앱(화면이 모두 `phone`)에서 터지지 않고 "화면 없음"으로 읽는지 코드를 열어 본다. 터지는 곳이 소유 밖이면 고치지 않고 보고한다.
4. SDK `@lophn/declaration`: `package.json`을 4.6.0으로(`supported_from`은 4.0.0 그대로), `guide.md`의 "선언의 칸" `screens` 항목에 `phone` 자리 한 항목(혼자 서는 자리, 폰 앱이 그린다, 소스와 빌드는 폰 화면을 지원하는 판의 지침이 말한다)을 더하고 type 목록(`Place`)과 pin 예(`:160`)를 고친다. `@lophn/app-ui`: `package.json`을 2.15.0으로(`@lophn/declaration` 의존을 4.6.0, `supported_from` 2.3.0 그대로), `guide.md`의 peer 표(`:145`)를 고친다.
5. 메모 둘: `declaration-4.6.0.md`(minor, `Breaking: no`, `Move together with @lophn/app-ui 2.15.0`, 옮기는 code 예는 pin 줄, "Nothing is required of an existing app", `## Instruction diff`는 위 `guide.md` 변경의 git diff), `app-ui-2.15.0.md`(minor, `Previous: 2.14.1`, 같이 옮길 판, `Place`에 `phone`이 더해졌다는 것). 메모는 영어, 앱 agent가 이 저장소를 모른 채 읽을 수 있게 쓴다(`sdk-note`).
6. pin을 `sdk-note`의 grep으로 전부 고친다: `packages/core/apps/packages/template/app/{lophn.ts.tmpl,package.json.tmpl}`(declaration 4.6.0, app-ui 2.15.0), `tests/support/app/sample/lophn.ts.tmpl`, `tools/wireframes/package.json`(app-ui), 위 `AGENTS.md.tmpl` 한 줄, `package-lock.json`(workspace 판 줄. `npm install --package-lock-only --offline`을 해 보고 안 되면 `packages/sdk/{declaration,app-ui}`의 `version`과 app-ui의 `@lophn/declaration` 의존 줄만 손으로 고친다. 다른 줄은 건드리지 않는다).

## 끝남

- `npm run check`가 통과한다. 특히 `node tools/check-sdk-notes.ts`(두 판의 메모와 `Previous:`·`Breaking:`·Instruction diff)와 앱 template·sample을 쓰는 test.
- 위험 test: 없음(선언 검사는 기존 `packages/protocol/apps/declaration/validate_test.ts` 등이 그대로 통과해야 하고, 새 규칙의 test는 더하지 않는다).
- 남지 않음: `grep -rn "declaration/4\.5\.1\|lophn/declaration\"[^,]*4\.5\.1\|app-ui/2\.14\.1\|lophn/app-ui\"[^,]*2\.14\.1" packages tools tests --include=*.ts --include=*.tsx --include=*.tmpl --include=*.json --include=*.md`가 `migrate-sdk/`의 옛 메모 말고 0줄이다.
- `project-docs/flows/`: route·CLI·test file을 더하거나 지우지 않으므로 고칠 것 없음. check의 flows가 통과한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 새 판 둘과 pin을 고친 file 목록, `places.includes`를 열어 본 결과(`tab` 없는 앱에서 터지는 곳), `package-lock.json`을 어떻게 고쳤는지.

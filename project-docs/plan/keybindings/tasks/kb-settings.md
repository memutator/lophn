# kb-settings

Settings › Keyboard를 넓힌다: section 묶음, 키 없는 줄에 키 달기, 앱 panel 화면 줄(앱 단축키), 겹침 모아 보기와 풀기, 이미 쓰는 키를 "바꾸기"로 옮기기.

- 단위: kb (wave 2)
- 선행: kb-table
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/keyboard/`
  - `packages/design/i18n/catalog/workspace-settings.ts`
  - `tools/wireframes/pages/screens/settings-pages.tsx`
  - `tools/wireframes/pages/screens/settings-frame.tsx`
- 읽을 것:
  - plan: `project-docs/plan/keybindings/README.md` (정한 것: 앱 단축키, 겹침)
  - architecture: `project-docs/architecture/keybindings.md`의 "사람이 바꾼 키"
  - 지금 코드: `packages/shell/renderer/desktop/settings/keyboard/keyboard-panel.tsx`, `model.ts`, `source.ts`, `testdata/fake-source.ts`
  - 앱 panel 목록: `packages/shell/renderer/workspace/project-settings/quick-launch-editor.tsx`의 `useAppPanelApps`(import만 한다)
  - skill: `.claude/skills/ui-design/SKILL.md` (wireframe gallery)
- 계약:
  - 쓰는 것: `packages/shell/ipc/keybindings.ts`의 `Binding.section`, `findConflicts`, `KeyConflict`, `checkChord`, `appPanelBindingId`, `parseBindingId`, `APP_PANEL`, `resolveBindings`. `WindowCommands.setOverrides`.
  - 내놓는 것: 없음

## 할 일

1. `model.ts`
   - `keyRows`가 section 순서(tab, pane, desk, float, open, view, app)로 묶은 줄을 낸다(section마다 제목 key).
   - 앱 줄: `appRows(apps, platform, overrides)` — `useAppPanelApps`의 앱마다 panel 화면 하나가 한 줄(`app.panel:<app>:<surface>`, 이름 "앱 이름 · 화면 이름"). 저장된 `app.panel:*` 가운데 목록에 없는 것은 "없는 앱" 줄(id를 보이고 지우기만 된다).
   - 겹침: `findConflicts`의 결과를 줄 id → 겹친 상대 이름들로 바꾸는 함수.
   - 바꾸기: 새 chord를 이 id에 달고 그 chord를 가진 다른 id들에서 빼는 `withKeys` 변경 하나를 만드는 함수. 빼는 쪽이 번호 줄의 한 번호면 그 번호의 chord만 뺀다.
2. `keyboard-panel.tsx`
   - section 제목 아래 줄을 그린다. 검색과 "키로 찾기"는 모든 section을 거른다.
   - 키 없는 줄은 흐린 "Not set"과 키 받기 단추.
   - 앱 section은 앱 목록을 읽는 동안 skeleton, 못 읽으면 저장된 앱 줄만.
   - 겹침이 있으면 맨 위에 "N개 키가 겹친다" 줄과 "겹친 것만 보기" 토글. 겹친 줄에는 상대 이름을 보이고 그 줄의 키를 표로 돌리기·빼기를 준다. RESERVED와 겹친 줄은 "lophn이나 OS가 먼저 쓰는 키"라고 적는다.
   - 새 키가 `taken`이면 지금처럼 거절하지 않고 줄 안에 "<키>는 <이름>이 쓴다. [바꾸기] [취소]". 바꾸기는 한 번에 저장한다. `unsupported`·`needs_modifier`·`reserved`는 지금처럼 거절한다.
   - 저장은 지금처럼 `source` 쓰기 뒤 `WindowCommands.setOverrides`.
3. 글은 `packages/design/i18n/catalog/workspace-settings.ts`에 영어로 더한다(section 제목, Not set, 겹침 줄, 바꾸기, 없는 앱). 안 쓰게 된 key는 지운다.
4. gallery: `settings-pages.tsx`의 Keyboard page들을 새 화면으로. page를 둘 더한다: 겹침이 있는 저장 값, 앱 단축키가 달린 저장 값(앱 목록은 fake). `testdata/fake-source.ts`를 고친다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "바꾸기는 새 키를 달고 다른 줄에서 그 키만 빼며, 표와 같아진 줄은 저장에서 빠진다"(`model.ts`의 순수 함수. 한 test). 그 밖은 없음(화면은 test하지 않는다).
- 남지 않음: 지운 i18n key를 `grep -rn "<key>" packages tools`로 0줄.
- `npm run wireframes`가 되고 Settings › Keyboard page 셋이 새 component로 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: gallery `tools/wireframes/pages/index.ts`에 더할 page
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

## lead가 더함 (kb-table 뒤)

- `findConflicts`는 chord마다 `KeyConflict` 하나다. `ids`는 그 chord를 가진 binding id 모두(표 순서), `reserved`는 RESERVED도 그 chord를 쓰면 true다. binding 하나만 가진 chord는 reserved일 때만 나온다. 그래서 `reserved: true`이면서 `ids`가 둘 이상일 수 있다.
- 표(`KEYBINDINGS`)는 이미 section 순서로 놓였다. `keyRows`는 그 순서를 그대로 묶으면 된다.
- 새 command의 이름·설명 key(`settings.label.key-*`, `settings.note.key-*`)는 이미 catalog에 있다. 이 task는 section 제목, Not set, 겹침 줄, 바꾸기, 앱 줄, 없는 앱 글만 더한다. `WORDING`에서 `app.panel`의 help가 화면에 안 쓰이면 지운다.
- 앱 줄 id는 `appPanelBindingId(app, surface)`로 만든다. surface 글자 상한은 80, app은 30자 id다.

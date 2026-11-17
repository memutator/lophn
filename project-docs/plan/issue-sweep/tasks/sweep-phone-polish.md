# sweep-phone-polish

wave 1이 남긴 폰과 kit의 잔손질을 한다.

- 단위: phone-polish (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/design/native/{navigation,feedback}/`
  - `packages/design/native/{guide.md,package.json}`
  - `packages/sdk/`
  - `packages/core/agent-workspaces/skills/`
  - `packages/core/apps/packages/template/`
  - `tests/support/app/sample/`
  - `tools/wireframes/package.json`
  - `packages/mobile/src/shortcuts/`
  - `packages/mobile/src/gallery/`
  - `packages/mobile/modules/lophn-widgets/`
  - `packages/shell/renderer/parts/tab-state-dot/`
- 읽을 것:
  - 고칠 이슈마다 `project-docs/issues/<id>.yaml`의 `now`·`fix`·`decided`(`fix`의 "한 것" 줄이 wave 1이 이미 한 부분이다)와 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`
  - 화면을 바꾸면 `.claude/skills/ui-design/SKILL.md`(wireframe을 먼저 고친다)
- 계약:
  - 이 task는 아래 소유에 든 protocol, IPC, preload를 고쳐도 된다(wave 1이 계약 밖이라 못 한 일이다). 소유 밖의 계약은 고치지 않고 보고에 적는다.
  - i18n catalog(`packages/design/i18n/catalog/`)에는 key를 더하기만 한다.

## 할 일

1. kit `SessionRow`(`packages/design/native/navigation/sidebar.tsx`): tone이 없으면 점을 그리지 않는다(쉬는 session에 회색 점이 남는다). 끝난 session은 회색 점이 남게 tone을 준다. 주석의 "good: working"을 고친다.
2. wave 1이 kit에 더한 `Dot`의 `working` tone과 이 변경을 `sdk-note` skill대로 다룬다(ui-native 0.3.0 메모가 이미 있다. 아직 내지 않은 판이면 그 메모에 더하고, 아니면 판을 올린다).
3. 이슈 `shortcut-keeps-old-label-and-icon`: native `updateShortcuts`를 더하고 `shortcuts/sync.ts`가 정리할 때 이름을 맞춘다. 그림은 폰이 둔 아이콘 file(`data/saved.ts`)과 다르면 바꾼다.
4. 이슈 `phone-guest-can-cover-app`의 남은 부분: guest 안에서 kit `Sidebar`·`Drawer`도 `Modal`을 쓰지 않는다(wave 1의 `SheetLayer`와 같은 길).
5. 폰 gallery(`gallery/parts.tsx`, `gallery/screens.tsx`)의 `TopBar`에 `left="menu"`를 준다(기본값이 바뀌어 단추가 사라졌다).
6. `packages/shell/renderer/parts/tab-state-dot/tab-state-dot.tsx`의 `TabDot`을 `activity.ts`의 `SessionDot`으로 한다(같은 union의 사본이다).
7. `design-app` skill의 `folder-sync.md`: `machine environment`가 이제 싣는 것(held가 남아 있는 동안의 `away`, 앱마다 `follow`·`held`·`machines`, 기계마다 `exchange`)을 읽는 법을 적는다. 앱 agent 지침이라 `sdk-note` skill의 Instruction diff가 든다.

알아 둘 것:
- Kotlin은 여기서 build하지 못한다. 고친 것을 보고에 적는다.
- `packages/mobile/src/data/`는 다른 task의 것이다. 읽기만 한다.

## 끝남

- `npm run check:full`이 통과한다.
- 폰 앱을 고쳤으므로 `cd packages/mobile && npm ci && npm run typecheck && npm test`도 통과한다(root check 밖이다).
- 위험 test: 이슈의 `fix`가 "test를 쓴다"고 한 것과 데이터·권한에 닿는 것만(`write-test` skill). 나머지는 없음
- 항목마다 했는지, 못 했으면 왜인지가 보고에 있다.

## 보고

- 항목마다: 고침 / 일부 / 못 함(이유), 지금 코드가 어떻게 하나 한두 문장, 지키는 test 이름(없으면 없음)
- 바꾼 file, 통과한 check
- 등록할 것, 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것(실제 폰이나 Electron에서 못 본 것 포함). 없으면 "없음"

# mobile-widgets-decl

앱 선언에 두 가지를 더하고 `@lophn/declaration`을 4.7.0으로 올린다: 앱이 내는 위젯 목록 `widgets`와, 폰 기능을 쓰는 permission kind `phone.use`(scope `{capability}`). 둘 다 vendored declaration file(zod 없는 정본 검증기)의 변경이라 한 판에 담는다. `@lophn/app-ui`가 declaration을 정확한 판으로 pin하므로 2.16.0으로 같이 올린다.

- 단위: widgets (wave 2)
- 선행: 없음. **`mobile-user-apps` 계획이 main에 land된 뒤에 띄운다**(그 계획의 `mobile-place-decl`이 같은 file로 declaration 4.6.0과 app-ui 2.15.0, `phone` 자리를 냈다. 이 task는 그 위에 선다)
- 소유(이 task만 고친다):
  - `packages/protocol/apps/declaration/types.ts`
  - `packages/protocol/apps/declaration/tools.ts`
  - `packages/protocol/apps/declaration/scope.ts`
  - `packages/protocol/apps/declaration/value.ts`
  - `packages/protocol/apps/declaration/read.ts`
  - `packages/protocol/apps/declaration/validate_test.ts`
  - `packages/sdk/declaration`
  - `packages/sdk/app-ui/package.json`와 `packages/sdk/app-ui/guide.md`(pin과 peer 표만)
  - `packages/core/agent-workspaces/skills/migrate-sdk/declaration-4.7.0.md`(새 file)
  - `packages/core/agent-workspaces/skills/migrate-sdk/app-ui-2.16.0.md`(새 file)
  - `packages/core/apps/packages/template/app/lophn.ts.tmpl`(pin만)
  - `packages/core/apps/packages/template/app/package.json.tmpl`(pin만)
  - `tests/support/app/sample/lophn.ts.tmpl`(pin만)
  - `tools/wireframes/package.json`(pin만)
  - `package-lock.json`
- 한 줄씩 허락(공유 file. 한 줄만 고치고 보고의 "넘길 줄"에 적는다): `packages/core/apps/packages/template/app/AGENTS.md.tmpl`의 `.lophn/sdk/declaration/4.6.0/guide.md` 줄을 새 판으로. 지침 내용은 `mobile-widgets-guidance`가 쓴다
- 읽을 것:
  - skill `.claude/skills/sdk-note/SKILL.md`(판, pin, 메모, Instruction diff, `supported_from`. 그대로 따른다). 본보기: `migrate-sdk/declaration-4.6.0.md`와 `app-ui-2.15.0.md`(`mobile-user-apps`가 쓴 같은 꼴의 판), 그 계획의 brief `mobile-place-decl.md`(pin을 고친 곳 목록)
  - 선언 정본: `types.ts`의 `DECLARATION_KEYS`·`OPTIONAL_KEYS`(칸이 없는 옛 선언의 hash는 그대로라는 규칙), `PermissionKind`, `PermissionScope`, `scope.ts`(kind마다 scope 검사, `notify.send`와 `secret.use`의 갈래), `tools.ts`(화면과 자리 검사), `read.ts`(저장된 선언을 읽는 zod)
  - vendored file 규칙: `packages/core/apps/packages/vendor.ts`의 `DECLARATION`(이 file들은 서로만 import한다. zod 정본 `packages/protocol/apps/widget.ts`·`packages/protocol/phone`을 import하지 못한다)
  - 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/widgets-survey.md`의 2.1("Where the app declares")과 2.3("Grant model"), 계획 `README.md`의 "정한 것"
- 계약:
  - 쓰는 것: 4.6.0의 `Place`와 `phone` 자리. `mobile-widget-contract`의 key 꼴과 상한(`WIDGET_KEY_PATTERN`, `WIDGETS_MAX = 4`)을 같은 값의 literal로
  - 내놓는 것:
    - `type WidgetDeclaration = {key: string; label: string; screen?: string}`, `AppDeclaration.widgets?: WidgetDeclaration[]`. `DECLARATION_KEYS`와 `OPTIONAL_KEYS`에 `widgets`
    - 규칙: 4개까지, `key`는 `^[a-z][a-z0-9_]{0,31}$`이고 겹치지 않는다, `label`은 1~40자, `screen`이 있으면 이 선언의 `places`가 `["phone"]`인 화면의 key다. 어기면 `invalid_input`(메시지는 다른 칸의 꼴: `widget <key>: ...`)
    - `PermissionKind`에 `"phone.use"`, `PermissionScope`에 `{capability: string}`, `export const PHONE_CAPABILITIES = ["location.get"] as const`(값은 `packages/protocol/apps/phone-request.ts`의 `phoneCapabilitySchema`와 같다. 왜 literal인가를 주석으로). `phone.use`의 scope는 정확히 `{capability}`이고 그 값이 `PHONE_CAPABILITIES` 안이다. 같은 capability를 두 번 선언하면 거절
    - SDK `@lophn/declaration` 4.7.0(`supported_from` 그대로), `@lophn/app-ui` 2.16.0(declaration 의존 4.7.0, `supported_from` 그대로). declaration을 정확한 판으로 pin한 다른 SDK가 있으면(`sdk-note`의 grep으로 찾는다. 예: `mobile-user-apps`의 `@lophn/app-ui-native`) 같은 규칙으로 판을 올리고 메모를 쓴다
    - 이미 저장된 선언은 그대로 읽힌다(additive. data migration 없음)

## 할 일

1. `types.ts`: `WidgetDeclaration`, `widgets` 칸, 두 key 목록, `PermissionKind`, `PermissionScope`, `PHONE_CAPABILITIES`. 주석은 왜만(위젯 목록을 선언하는 이유: 폰이 값이 오기 전에 목록을 보이고 core가 선언 밖 key를 거절한다).
2. `tools.ts`(또는 화면 검사가 있는 곳): `widgets`의 규칙과 `screen`이 `phone` 화면을 가리키는지. `scope.ts`·`value.ts`: `phone.use` scope 검사와 정규화(kind 목록 `value.ts:351` 근처에 `phone.use`). `read.ts`: 저장된 선언의 zod에 `widgets`와 `phone.use` scope(값만, 규칙은 넣지 않는다).
3. `validate_test.ts`의 기존 표에 줄을 더한다(위험 test).
4. SDK: `packages/sdk/declaration/package.json` 4.7.0, `guide.md`의 "선언의 칸"에 `widgets` 항목(무엇인가, 상한, `screen`, 값은 `@lophn/cap-notify`의 `setWidget`으로 낸다는 한 줄)과 `permissions`에 `phone.use` 항목(scope, `reason`, `@lophn/cap-phone`이 요구한다), `mod.ts`의 type 내보내기에 `WidgetDeclaration`. `@lophn/app-ui` 2.16.0(pin과 peer 표).
5. 메모: `declaration-4.7.0.md`(minor, `Breaking: no`, `Previous: 4.6.0`, `Move together with @lophn/app-ui 2.16.0`, 선언 예 둘(`widgets` 한 줄, `phone.use` 한 줄), "Nothing is required of an existing app", `## Instruction diff`는 위 `guide.md` 변경의 git diff), `app-ui-2.16.0.md`(pin만 올린 판).
6. pin을 `sdk-note`의 grep으로 전부 고친다(template 둘, sample, wireframes, `AGENTS.md.tmpl` 한 줄, `package-lock.json`. lock은 `npm install --package-lock-only --offline`을 해 보고 안 되면 판 줄만 손으로).

## 끝남

- `npm run check`가 통과한다. 특히 `node tools/check-sdk-notes.ts`와 앱 template·sample을 쓰는 test.
- 위험 test: "`phone.use`의 scope가 `{capability}` 하나가 아니거나 `PHONE_CAPABILITIES` 밖이면, 그리고 `widgets`의 key가 겹치거나 `screen`이 `phone` 화면이 아니면 선언이 `invalid_input`이다"(기존 `validate_test.ts` 표에 줄로. grant가 될 수 있는 것이 선언 검사에서 정해지는 경계다)
- 남지 않음: `grep -rn "declaration/4\.6\.0\|lophn/declaration\"[^,]*4\.6\.0\|app-ui/2\.15\.0\|lophn/app-ui\"[^,]*2\.15\.0" packages tools tests --include=*.ts --include=*.tsx --include=*.tmpl --include=*.json --include=*.md`가 `migrate-sdk/`의 옛 메모 말고 0줄이다.

- flows catalog: 이 task가 더하거나 지우는 SDK export와 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 새 판과 pin을 고친 file 목록, 거절 메시지 예, `package-lock.json`을 어떻게 고쳤는지. grant 쪽(`packages/protocol/apps/permissions.ts`, core의 grant 표)은 `mobile-phone-use-grant`가 한다. 이 task 뒤 그 사이에 `phone.use`를 선언한 release를 준비하면 어디서 막히는지 보이면 적는다.

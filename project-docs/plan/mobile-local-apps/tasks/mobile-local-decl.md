# mobile-local-decl

앱 선언에 `runs_on`을 더한다: 앱의 backend와 data가 어디서 도는가(`["computer"]` remote, `["computer","phone"]` sync, `["phone"]` standalone). 선언 검사 둘을 더하고 `@lophn/declaration`을 다음 minor로, 그 판에 정확히 기대는 `@lophn/app-ui`와 `@lophn/app-ui-native`를 같이 올린다(메모와 pin).

- 단위: sdk (wave 4)
- 선행: 없음. **중간 land 뒤에 띄운다**(계획 README. `mobile-user-apps`의 declaration 4.6.0과 `@lophn/app-ui-native`가 main에 있어야 한다). `mobile-widgets`의 `mobile-widgets-decl`(같은 file)이 running이면 끝난 뒤에 띄운다
- 소유(이 task만 고친다):
  - `packages/protocol/apps/declaration/types.ts`
  - `packages/protocol/apps/declaration/tools.ts`
  - `packages/protocol/apps/declaration/value.ts`
  - `packages/protocol/apps/declaration/read.ts`
  - `packages/protocol/apps/declaration/validate_test.ts`
  - `packages/sdk/declaration`
  - `packages/sdk/app-ui/package.json`와 `packages/sdk/app-ui/guide.md`(pin과 peer 표만)
  - `packages/sdk/app-ui-native/package.json`와 `packages/sdk/app-ui-native/guide.md`(pin과 peer 표만)
  - `packages/core/agent-workspaces/skills/migrate-sdk/{declaration-4.8.0,app-ui-2.17.0,app-ui-native-1.2.0}.md`(새 file. 아래 "SDK 판"이 다르면 그 판의 이름)
  - `packages/core/apps/packages/template/app/lophn.ts.tmpl`(pin만)
  - `packages/core/apps/packages/template/app/package.json.tmpl`(pin만)
  - `tests/support/app/sample/lophn.ts.tmpl`(pin만)
  - `tools/wireframes/package.json`(pin만)
  - `package-lock.json`
  - `packages/core/apps/runtime/entrypoint/sync.ts`(`runsOnPhone`이 날 JSON 대신 `AppDeclaration.runs_on`을 읽게 하는 만큼)
- 공유 줄 허락(한 줄만, 보고의 "넘길 줄"에): `packages/core/apps/packages/template/app/AGENTS.md.tmpl`의 `.lophn/sdk/declaration/<판>/guide.md` 줄. 지침 내용은 `mobile-local-guidance`가 쓴다
- 읽을 것:
  - skill `.claude/skills/sdk-note/SKILL.md`(판, pin, 메모, Instruction diff, `supported_from`. 그대로 따른다). 본보기: 바로 앞 판의 declaration·app-ui·app-ui-native 메모(main의 `migrate-sdk/`)
  - 선언 정본: `types.ts`의 `AppDeclaration`, `DECLARATION_KEYS`·`OPTIONAL_KEYS`(칸이 없는 옛 선언의 hash는 그대로라는 규칙), `tools.ts`(화면·자리 검사, `phone` 자리), `value.ts`(top-level 칸 검사), `read.ts`(저장된 선언의 zod)
  - vendored file 규칙: `packages/core/apps/packages/vendor.ts`의 `DECLARATION`(이 file들은 서로만 import한다)
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/local-apps-survey.md` 2(a)(한 칸, 검사, 버린 안), 4의 "Declaration"
  - 계획 `README.md` "정한 것"(`runs_on`과 `["phone"]`이 막는 것, 판 매기기)
- 계약:
  - 쓰는 것: 단계 6의 `Place`(`phone` 자리). `mobile-widgets`가 먼저 land되었으면 `widgets` 칸
  - 내놓는 것:
    - `type RunsOn = ("computer" | "phone")[]`, `AppDeclaration.runs_on?: RunsOn`. 없으면 `["computer"]`와 같다. 비어 있지 않고, 겹치지 않고, 순서는 `computer, phone`이다(정규 꼴. 다른 순서는 거절한다). `DECLARATION_KEYS`와 `OPTIONAL_KEYS`에 `runs_on`
    - 검사(어기면 `invalid_input`):
      - `runs_on: phone needs a screen with the phone place`(`phone`이 있는데 `places`가 `["phone"]`인 화면이 없다)
      - `runs_on ["phone"]: commands, subscriptions, external operations, widgets and places other than phone have nothing to run them`(`["phone"]`인데 그것들 가운데 하나가 있다. `widgets` 칸이 아직 없으면 그 낱말만 뺀다)
    - SDK 판: main에 있는 각 판의 다음 minor. 계획대로 `mobile-widgets`가 먼저 land되었으면 `@lophn/declaration` 4.8.0, `@lophn/app-ui` 2.17.0, `@lophn/app-ui-native` 1.2.0(widgets가 app-ui-native를 올리지 않았으면 1.1.0). 아직이면 4.7.0, 2.16.0, 1.1.0으로 쓰고 보고한다(land 순서에 따라 lead가 다시 매긴다). `supported_from`은 그대로
    - 이미 저장된 선언은 그대로 읽힌다(additive. data migration 없음)

## 할 일

1. `types.ts`: `RunsOn`, `runs_on`, 두 key 목록. 주석은 왜만(앱 하나의 backend가 어디서 도는지는 이 칸 하나다. 화면으로 짐작하지 않는다: 폰 화면이 있는 remote 앱이 말없이 sync 앱이 되지 않게).
2. `value.ts`: `runs_on`의 모양 검사와 정규 꼴. `tools.ts`(화면·operation을 보는 곳): 위 두 검사. `read.ts`: 저장된 선언의 zod에 `runs_on`(값만).
3. `validate_test.ts`의 기존 표에 줄을 더한다(위험 test).
4. `packages/core/apps/runtime/entrypoint/sync.ts`의 `runsOnPhone`을 typed 칸으로 바꾼다(동작 같음).
5. SDK: `packages/sdk/declaration/package.json` 새 판, `guide.md`의 "선언의 칸"에 `runs_on` 항목 한 단락(셋의 뜻과 기본, 두 검사). 큰 지침(언제 무엇을 고르나)은 `mobile-local-guidance`가 쓴다. `mod.ts`의 type 내보내기에 `RunsOn`. app-ui와 app-ui-native는 declaration 의존 판과 peer 표만.
6. 메모(`sdk-note` 3): declaration은 minor, `Breaking: no`, `Move together with` 두 SDK, 선언 예 하나(`runs_on: ["computer", "phone"]`), "Nothing is required of an existing app", `## Instruction diff`는 위 `guide.md` 변경의 git diff. app-ui·app-ui-native는 pin만 올린 판.
7. pin을 `sdk-note`의 grep으로 전부 고친다(template 둘, sample, wireframes, `AGENTS.md.tmpl` 한 줄, `package-lock.json`. lock은 `npm install --package-lock-only --offline`을 해 보고 안 되면 판 줄만 손으로).

## 끝남

- `npm run check`가 통과한다. 특히 `node tools/check-sdk-notes.ts`.
- 위험 test: "`runs_on`이 비었거나 겹치거나 순서가 다르면, `phone`이 있는데 폰 화면이 없으면, `["phone"]`인데 command·구독·`external` operation·폰 밖 자리(·widgets)가 있으면 선언이 `invalid_input`이고, `runs_on`이 없는 옛 선언의 hash는 그대로다"(기존 `validate_test.ts` 표에 줄로)
- 남지 않음: `sdk-note` 2의 grep으로 옛 declaration·app-ui·app-ui-native 판이 `migrate-sdk/`의 옛 메모 말고 0줄이다.
- flows catalog: 이 task가 더하거나 지우는 SDK export와 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 고른 판 셋과 이유(main에 무엇이 있었나), pin을 고친 file 목록, 거절 메시지 예.

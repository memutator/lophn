# folder-decl

앱 선언에 `sync_to`를 더한다: 이 앱의 data를 어느 destination으로 내보내는가(없으면 내보내지 않는다). 검사를 더하고, `sync_to`가 있는 앱의 release 준비가 폰 앱과 같은 schema 규칙과 `@lophn/cap-store` 2.0.0 하한을 보게 한다. `@lophn/declaration`을 4.9.0으로, 그 판에 정확히 기대는 `@lophn/app-ui`(2.18.0)와 `@lophn/app-ui-native`(1.4.0)를 같이 올린다(메모와 pin).

- 단위: sdk (wave 1)
- 선행: 없음. 다른 계획의 task가 `packages/protocol/apps/declaration`이나 `packages/sdk/declaration`을 고치는 중이면 끝난 뒤 띄운다
- 소유(이 task만 고친다):
  - `packages/protocol/apps/declaration/types.ts`
  - `packages/protocol/apps/declaration/tools.ts`
  - `packages/protocol/apps/declaration/value.ts`
  - `packages/protocol/apps/declaration/read.ts`
  - `packages/protocol/apps/declaration/mod.ts`
  - `packages/protocol/apps/declaration/validate_test.ts`
  - `packages/sdk/declaration`
  - `packages/sdk/app-ui/package.json`와 `packages/sdk/app-ui/guide.md`(pin과 peer 표만)
  - `packages/sdk/app-ui-native/package.json`와 `packages/sdk/app-ui-native/guide.md`(pin과 peer 표만)
  - `packages/core/agent-workspaces/skills/migrate-sdk/{declaration-4.9.0,app-ui-2.18.0,app-ui-native-1.4.0}.md`(새 file. main의 판이 다르면 그 다음 판 이름)
  - `packages/core/apps/packages/template/app/lophn.ts.tmpl`(pin만)
  - `packages/core/apps/packages/template/app/package.json.tmpl`(pin만)
  - `tests/support/app/sample/lophn.ts.tmpl`(pin만)
  - `tools/wireframes/package.json`(pin만)
  - `package-lock.json`
  - `packages/core/apps/releases/prepare/checks.ts`와 `checks_test.ts`
  - `packages/core/apps/releases/prepare/from-source.ts`(하한을 거는 줄만)
- 공유 줄 허락(한 줄만, 보고의 "넘길 줄"에): `packages/core/apps/packages/template/app/AGENTS.md.tmpl`의 `.lophn/sdk/declaration/<판>/guide.md` 줄. `sync_to` 지침 글은 `folder-guidance`가 쓴다
- 읽을 것:
  - skill `.claude/skills/sdk-note/SKILL.md`(판, pin, 메모, `supported_from`. 그대로 따른다). 본보기: `migrate-sdk/declaration-4.8.0.md`, `app-ui-2.17.0.md`, `app-ui-native-1.3.0.md`
  - 선언 정본: `types.ts`의 `AppDeclaration`, `DECLARATION_KEYS`·`OPTIONAL_KEYS`(칸 없는 옛 선언의 hash는 그대로라는 규칙), `tools.ts`의 `validateRunsOn`(검사의 본보기), `value.ts`, `read.ts`(저장된 선언의 zod)
  - vendored file 규칙: `packages/core/apps/packages/vendor.ts`의 `DECLARATION`(이 file들은 서로만 import한다)
  - 준비의 폰 규칙: `checks.ts`의 `phoneSdkFloorProblem`, `checkMigration`(빈 DB를 target까지 올린 뒤 `phoneSchemaProblemsOfDatabase`), `from-source.ts`의 `runsOnPhone`·`phoneSdkFloorProblem` 호출(~l.364)
  - 계획 `README.md` "정한 것"(`sync_to`, `["phone"]`, schema 규칙과 하한), 계약 5(destination 이름 꼴)
  - architecture: `project-docs/architecture/app-sync.md`(결정: 정수 PK·trigger·UNIQUE·CHECK를 거절하는 이유)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것:
    - `AppDeclaration.sync_to?: string`. 값은 destination 이름 `^[a-z][a-z0-9-]{0,31}$`. 없으면 내보내지 않는다. `DECLARATION_KEYS`와 `OPTIONAL_KEYS`에 `sync_to`. `SYNC_TO_PATTERN`을 export한다(`folder-contract`의 destination 이름과 같은 꼴. `packages/protocol/folder`는 이 file들을 import하지 않으니 값을 두 곳에 두고 서로 주석으로 가리킨다)
    - 검사(어기면 `invalid_input`):
      - `sync_to must be a destination name: lowercase letters, digits and -, starting with a letter, up to 32`
      - `runs_on ["phone"]: sync_to has nothing to send; a phone's data reaches a folder only through a computer`
    - 준비: 활성화될 선언에 `runs_on`의 `phone`이나 `sync_to`가 있으면 `checkMigration`이 schema 규칙을 본다(문구의 "phone"을 "an app whose data syncs (runs_on phone or sync_to)"로). `sync_to`만 있으면 하한은 `@lophn/cap-store` 2.0.0 하나(`runs_on`에 phone이 있으면 지금처럼 둘)
    - SDK 판: main에 있는 판의 다음 minor. 지금 main이면 `@lophn/declaration` 4.9.0, `@lophn/app-ui` 2.18.0, `@lophn/app-ui-native` 1.4.0. `supported_from`은 그대로
    - 이미 저장된 선언은 그대로 읽힌다(더하기. data migration 없음)

## 할 일

1. `types.ts`: `sync_to`와 key 목록. 주석은 왜만(값이 이름뿐인 이유: 경로는 기계마다 다르다).
2. `value.ts`·`tools.ts`: 모양 검사와 `runs_on` 짝 검사(`validateRunsOn` 옆에 `validateSyncTo`). `read.ts`: 저장된 선언의 zod에 `sync_to`. `mod.ts`: 새 export.
3. `validate_test.ts`의 기존 표에 줄을 더한다(위험 test).
4. `checks.ts`: 위 "준비". 하한 함수는 `runs_on`과 `sync_to`를 보고 필요한 하한만 고른다. `checks_test.ts`에 줄을 더한다. `from-source.ts`는 하한을 거는 조건 한 곳만.
5. SDK: `packages/sdk/declaration/package.json` 새 판, `guide.md`의 선언 칸 목록과 `runs_on` 항목 다음에 `sync_to` 한 단락(뜻, 없을 때, destination은 기계마다의 설정이라는 것, `["phone"]`은 못 쓴다는 것, schema 규칙). 언제 무엇을 고르나는 `folder-guidance`가 bundled file에 쓴다. app-ui와 app-ui-native는 declaration 의존 판과 peer 표만.
6. 메모(`sdk-note` 3): declaration minor, `Breaking: no`, `Move together with` 두 SDK, 선언 예 하나(`sync_to: "personal"`), "Nothing is required of an existing app" 그리고 쓰면 좋은 때. `## Instruction diff`는 이 task의 `guide.md` diff로 쓰고, `folder-guidance`가 지침 diff를 같은 메모에 더한다(아직 낸 판이 아니다). app-ui·app-ui-native는 pin만 올린 판.
7. pin을 `sdk-note` 2의 grep으로 전부 고친다(template 둘, sample, wireframes, `AGENTS.md.tmpl` 한 줄, `package-lock.json`).

## 끝남

- `npm run check`가 통과한다. 특히 `node tools/check-sdk-notes.ts`.
- 위험 test: "`sync_to`가 이름 꼴이 아니면, `runs_on ["phone"]`과 같이 있으면 선언이 `invalid_input`이고, `sync_to`가 없는 옛 선언의 hash는 그대로다"(기존 표에 줄로), "`sync_to`가 있는 앱의 정수 PK·trigger migration은 준비에서 실패한다"(`checks_test.ts`에 줄로)
- 남지 않음: `sdk-note` 2의 grep으로 옛 declaration·app-ui·app-ui-native 판이 `migrate-sdk/`의 옛 메모 말고 0줄이다.
- flows catalog: 이 task가 더하거나 지우는 SDK export와 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 고른 판 셋과 이유(main에 무엇이 있었나), pin을 고친 file 목록, 거절 메시지 예.

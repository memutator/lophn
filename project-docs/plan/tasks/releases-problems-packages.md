# releases-problems-packages

사용자 package registry를 S4·S7대로 고친다. App Engineer가 `package.publish`로 자기 앱 code의 일부를 `@me/…` package로 내고, test가 통과한 것만 읽기 전용 사본으로 두어 목록에 올린다. package `kind`와 "개인 등록 거절"을 지운다. 앱 template(`core/apps/packages/template/`)은 `releases-problems-template`이 한다.

- 단위: releases-problems (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/packages/` (`template/` 폴더는 제외. `releases-problems-template`의 것이다)
- 읽을 것:
  - spec: S4 4장(`package.list`, `package.get`, `package.publish`) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S7 4장(의존을 bundle에 넣는다) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/activation.md`
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`): `I1.7#20`, `I1.7#21`, `I2.7#34`, `I2.7#35`, `I2.7#36`, `I2.7#37`, `I3.7#10`, `I3.7#12`(설치 사본 쪽. bundle에 담는 쪽은 `releases-problems-bundle`)
  - 결정: `../README.md` 3장에 해당하는 것이 없다. 근거는 위 inventory와 spec이다.
  - 지금 코드: `packages/core/apps/packages/{commands,model,install,schema,store,rows,reads,blobs,vendor,resolve,mod}.ts`, `packages/core/apps/releases/prepare/git-extract.ts`(commit에서 파일 읽기), `packages/protocol/apps/package-routes.ts`
- 계약:
  - 쓰는 것(contract-releases-problems-releases가 고정): `package.publish`(kind memory, actors agent, 입력 `{ app, name, version, description, commit, path, guide: { purpose, api, examples }, permissions, tests, key }`), `packageSchema`(`kind`는 선택), `packageVersionSchema.permissions`, 내부 등록은 machine route `package.register_version`(`kind` 선택, `permissions` 있음). 테스트 통과 확인은 `protocol/problems`의 `AppTestVerificationLookupPort`(지금 있음)를 쓴다.
  - 내놓는 것: `core/apps/packages/mod.ts`의 `publishPackage(deps)`(memory route handler)와 `packageInstallPath(name, version)`(설치 사본의 위치. `releases-problems-bundle`이 bundle에 담을 때 쓴다).

## 할 일

1. kind를 지운다 (I1.7#20). 개발 data는 지운다(schema step을 그대로 고친다).
   - `schema.ts`: `packages.kind` 열과 CHECK, `packages_no_kind_change` trigger를 뺀다. `package_versions`에 `permissions TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(permissions))`를 더한다.
   - `commands.ts`: `kind` 비교와 "package kind is immutable"을 뺀다. `rows.ts`의 `kind` 조립을 뺀다. 출력의 `kind`는 싣지 않는다.
   - `install.ts`: `installPackage`의 `kind` 인자를 뺀다. `model.ts`의 `PACKAGE_KINDS` 쓰는 곳을 정리한다.
2. 개인 등록을 연다 (I1.7#21). `model.ts`의 `personalRegistrationRejected`와 `commands.ts`의 호출, `reads.ts`의 import, `mod.ts` export를 지운다. `registerVersion`은 machine만 부르는 것은 그대로 두고 `@me/…`를 받는다(`publishPackage`가 내부에서 부른다). 이름 scope `@me`/`@lophn` 검사는 유지한다.
3. `package.publish` (I2.7#34, I3.7#10). 새 file `publish.ts`에 `publishPackage(deps)`를 만든다. async handler이고 순서는 이렇다.
   1. actor가 `agent`이고 그 앱의 App Engineer인지 본다(아니면 `forbidden`). 이름이 `@me/`가 아니면 `invalid_input`.
   2. `tests`의 Verification이 모두 통과한 app test나 test command인지 본다(`AppTestVerificationLookupPort`). 하나라도 아니면 `invalid_input`. 같은 이름·version이 있으면 `register_version`이 `conflict`로 답한다(공개한 version은 바꾸지 않는다).
   3. 앱 source의 `commit`에서 `path` 폴더의 파일을 읽는다(`releases/prepare/git-extract.ts`의 `extractCommit`, `releases/mod.ts`로 import). 폴더가 없거나 비었으면 `invalid_input`.
   4. 안내를 만든다. `guide`의 세 칸(`purpose`, `api`, `examples`)이 모두 공백 아닌 문자열이어야 하고, 글은 `# Purpose` / `# API` / `# Examples` 세 절로 쓴다(바이트가 `guide_hash`가 된다). 이전 `guideBumpSections`·`permissionIncreaseIn`(patch·minor·major 절 검사)은 새 안내 꼴에 없으므로 지운다(정한 것으로 보고).
   5. bundle과 안내 byte를 blob으로 준비하고(`install.ts`의 `prepareBlob` 흐름, 목적 `sdk_bundle`·`sdk_guide`) `package.register_version`을 machine 자격으로 부른다(`permissions`를 싣는다).
   6. 읽기 전용 설치 사본을 `packageInstallPath(name, version)`에 쓴다(`writeInstallCopy`: 파일 0444, 폴더 0555, I2.7#36).
   - 낼 때 사람 승인은 없다. 출력은 `{ package, version }`.
   - 연결: memory route를 어디서 어떻게 붙이는지는 같은 종류인 contract-app-calls의 `app.call_api` 정의와 `core/apps/register.ts`를 읽고 따른다. 붙이는 줄은 소유 밖이라 "등록할 것"에 적는다.
4. 설치 위치 (I3.7#12). `packageInstallPath(name, version)`을 `install.ts`에 두고 `mod.ts`로 내놓는다. `@lophn/…`는 지금 규칙 `<dataRoot>/sdk/<part>/<version>`을 유지하고, `@me/…`는 `<dataRoot>/sdk/@me/<part>/<version>`이다(scope가 다른 같은 part가 부딪치지 않게 한다. 정한 것으로 보고). `splitPackageName`이 scope를 이미 준다.
5. 읽기 (I2.7#35). `reads.ts`/`store.ts`의 `loadUsages`가 release의 고정 의존 목록(`manifest.dependencies`, release 기록의 manifest 사본이나 `declarations`에서 읽는다)에서 `source: "package"`인 의존을 찾아 `@me/…` package의 사용처를 내게 한다. 읽는 곳이 지금 어디서 `sdk_dependencies`를 읽는지 `store.ts`에서 보고 새 `dependencies`로 바꾼다. `packages.list`의 `byCatalogOrder`는 그대로 둔다(`@me` 먼저).
6. 의존 고정 (I2.7#37). package에 새 version이 나와도 기존 앱 release의 고정 의존이 바뀌지 않는지 코드를 읽어 확인한다. 바뀌는 경로가 있으면 고치고, 없으면 "구조상 고정이다"를 보고에 적는다(test는 만들지 않는다).
7. `mod.ts`를 새 export에 맞춘다(`publishPackage`, `packageInstallPath`). `SDK_WITHHELD_NAMES`·`isWithheldPackageName`은 그대로 둔다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "personalRegistrationRejected\|package kind is immutable\|packages_no_kind_change\|guideBumpSections\|permissionIncreaseIn" packages/core/apps/packages --include=*.ts`가 0줄이다(template 폴더 제외).

## 보고

- 바꾼 file
- 등록할 것: `core/apps/register.ts`에 `package.publish` memory route 연결, `sdkSchemaSteps` 변경 반영(app-calls 소유). 필요하면 `main/daemon`의 wiring에 `publishPackage` deps(git 실행, blob 준비, ledger command 호출) 연결
- 안 쓰게 된 export: `PACKAGE_KINDS`·`packageKindSchema`를 쓰던 곳(protocol), `packageRegisterVersion`의 `kind` 입력
- 정한 것: 문서에 답이 없어 worker가 정한 것(안내 세 절의 꼴, `@me` 설치 위치, patch·minor·major 절 검사를 지운 것)
- 계약 바꾸기 요청(wave 3): 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다

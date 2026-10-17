# sdk-install-copies

`packages/sdk/*`와 지원 소스(`packages/design`의 `@lophn/ui`, `packages/design/wording`의 `@lophn/wording`)를 `<dataRoot>/sdk/<이름 뒤쪽>/<판>`에 읽기 전용(file 0444, 폴더 0555)으로 푸는 함수를 git 기록에서 되살려 현재 코드에 맞게 고친다. `packages/sdk/blueprint`·`cap-store`·`cap-problem`이 사본 밖(`../../protocol/…`, `@lophn/protocol/…`)을 가리키는 import는 사본 안 `vendor/`로 함께 담고 specifier를 바꿔 사본만으로 풀리게 한다. 판은 각 `deno.json`의 `version`이다.

- 단위: sdk-install (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/packages/install.ts`
  - `packages/core/apps/packages/vendor.ts`
  - `packages/core/apps/packages/install_test.ts`
  - `packages/design/deno.json`
  - `packages/design/wording/deno.json`
  - `packages/sdk/cap-store/deno.json`
- 읽을 것:
  - 이슈: `project-docs/issues/platform.md`의 "data root에 sdk 설치 사본과 앱 template을 까는 코드가 없다"(닫는 일은 lead가 한다)
  - architecture: `project-docs/architecture/ui-kit.md`("앱 UI가 build되는 길" 1~4. 설치 사본 `sdk/<이름 뒤쪽>/<판>`, read-only, 사본 안 bare import는 앱 import map이 푼다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps`(core 아래), `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - test 기준: `.claude/skills/write-test/SKILL.md`
  - 되살릴 옛 코드(아래 "되살릴 commit")
- 계약:
  - 쓰는 것: `packageInstallPath(name, version)`(`install.ts`, 그대로). `readSdkCopies`(`releases/bundle/lock.ts`)와 `devImportMap`(`template/import-map.ts`)이 `<dataRoot>/<packageInstallPath>`를 읽는다. 사본 모양을 이 둘이 읽는 자리와 같게 둔다.
  - 내놓는 것(`sdk-install-startup`이 부른다):
    ```ts
    export async function installSdkCopies(deps: {
      dataRoot: string;
      packagesRoot: string; // repo의 packages/ 폴더 절대 경로. 기본값을 두지 않는다
    }): Promise<Result<{ name: string; version: string; install_path: string }[]>>;
    ```
    `packages/sdk/*` 중 `deno.json`이 있는 폴더 전부와 지원 소스 둘(`@lophn/ui`, `@lophn/wording`)을 깐다. 이름·판은 그 폴더의 `deno.json`의 `name`·`version`에서 읽는다(없으면 `invalid_input`).

## 되살릴 commit과 path

지운 commit은 `bcb7a9c3d`(Remove unused core exports and the code only they used, 2026-10-16)이고 부모 `bcb7a9c3d^`에서 읽는다. `git show bcb7a9c3d^:<path>`.

- `packages/core/apps/packages/install.ts`: `collectSourceFiles`, `sortFiles`, `vendorFiles`, `installPackage`, `installSupportPackage`. (`removeInstallCopy`·`sameInstallCopy`·`writeInstallCopy`·`bundleBytes`·`packageInstallPath`는 지금 파일에 남아 있다. 지금 파일에는 지워진 함수 자리에 주석만 남았다. 그 고아 주석은 되살린 함수의 주석으로 쓰거나 지운다.)
- `packages/core/apps/packages/vendor.ts`(통째로 지워졌고 지금은 `SourceFile` type만 있다): `VendorRule`, 규칙 `BLUEPRINT`·`CAP_STORE`·`CAP_PROBLEM`을 담은 `VENDOR_RULES`, `SUPPORT_PACKAGES`, `keepSupportFile`, `relativeSpecifier`, `rewriteSpecifiers`.
- 이 코드가 마지막으로 제대로 돌던 판은 `13a7365e9^`(test를 모두 지우기 전)이다. 필요하면 `git show 13a7365e9^:packages/core/apps/packages/testing/mod.ts`가 옛 호출 방법(`installPackage`, `installSupportPackage` 부르는 법)을 보여 준다.

## 겹침

없음. 같은 단위의 `sdk-install-template`은 `install.ts`를 import만 하고(이름·모양을 바꾸지 않는다), `template/`을 고친다. 계획 `agent-place`·`agent-io`는 이 file들을 소유하지 않는다. `packages/design/deno.json`은 이 계획 README가 갖는 곳이다.

## 지켜야 할 것(계획 README 그대로)

- module은 `core/main`을 import하지 않는다. 바닥은 위층을 import하지 않는다. domain끼리는 problems → apps만.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 설치 사본은 읽기 전용이고 release bundle에 굳힌 사본과 섞지 않는다.

이 task에서: 설치 사본은 `<dataRoot>/sdk/…`에만 쓴다. release bundle 안 `sdk/` 사본은 release 준비가 이 자리를 읽어 굳히는 것(`readSdkCopies`)이라, 이 task는 bundle 쪽 file(`releases/`)을 만지지 않는다. `apps/packages`는 `core/main`을 import하지 않는다(`packagesRoot`는 인자로 받는다. `import.meta.url`로 기본값을 두지 않는다: AGENTS.md "파일 시스템은 인자로").

## 할 일

1. `deno.json`에 판이 없는 것을 채운다. 근거: 이슈 "손으로 깔아 보니 더 필요한 것", AGENTS.md "판은 각 `deno.json`의 `version`".
   - `packages/design/deno.json`에 `"version": "1.0.0"` 추가(`name`은 `@lophn/ui`로 이미 있다). `packages/design/wording/deno.json`에도 `"version": "1.0.0"`.
   - `packages/sdk/cap-store/deno.json`을 새로 만든다: `{"name": "@lophn/cap-store", "version": "1.0.0", "exports": "./mod.ts"}`(옆 `cap-problem/deno.json` 꼴). 앱 template이 쓰는데 지금 `deno.json`이 없다.
   - 판 `1.0.0`은 template의 `lophn-sdk:…@1.0.0`(`packages/core/apps/packages/template/app/deno.json.tmpl`)과 같다. `cap-fs`, `cap-net`, `cap-secret`은 `deno.json`이 없고 template이 쓰지 않으므로 이번에는 깔지 않는다(만들지 않는다. "정한 것"에 적는다).
   - 루트 `deno.json`의 workspace가 `./packages/sdk/*`를 담고 `lock.frozen`이라, 새 `deno.json` 때문에 `deno.lock`이 바뀌어야 하면 고치지 말고 보고의 "넘길 줄"에 적는다.
2. `vendor.ts`를 되살린다. 근거: 이슈 "지워진 `vendor.ts` 설치 쪽이 이것을 `vendor/`로 담았다", 옛 코드.
   - `SourceFile`, `VendorRule`, `VENDOR_RULES`, `relativeSpecifier`, `rewriteSpecifiers`를 옛 그대로 되살리고, 지금 코드에 맞게 확인한다:
     - `BLUEPRINT`는 `packages/protocol/apps/blueprint/`의 `mod.ts, types.ts, json.ts, schema.ts, scope.ts, uses.ts, app-api.ts, value.ts`를 `vendor/protocol/apps/blueprint/`에 담고 `../../protocol/apps/blueprint/mod.ts`를 바꾼다(`packages/sdk/blueprint/{mod,define}.ts`가 이것을 import한다). 지금 이 폴더에는 `check.ts`·`read.ts`(zod를 쓴다)도 있다. 담는 목록이 `mod.ts`에서 닿는 파일과 맞는지 import를 따라 확인한다(옛 목록이 그대로 맞는 것을 확인했다. 달라졌으면 목록을 고친다).
     - `CAP_STORE`는 `packages/protocol/apps/activation/migration-sql.ts`와 그것이 쓰는 `packages/base/errors.ts`, `result.ts`를 `vendor/…`에 담고, `vendor/base/mod.ts`(`LophnError`, `err`, `ok`, `Result`만 내보내는 얇은 mod)를 만든다. `migration-sql.ts`가 `../../../base/mod.ts`를 import하기 때문에 사본 안에서도 `vendor/protocol/apps/activation/` 기준 같은 상대 경로가 `vendor/base/mod.ts`로 닿는다. 바꿀 specifier는 `packages/sdk/cap-store/{mod,store}.ts`의 `../../protocol/apps/activation/migration-sql.ts`다.
     - `CAP_PROBLEM`은 `packages/protocol/problems/{sdk-report,sdk-problem}.ts`와 `base/{errors,result}.ts`를 담고, 맨 specifier `@lophn/protocol/problems/sdk-report`·`sdk-problem`을 사본 안 상대 경로로 바꾼다(`packages/sdk/cap-problem/*.ts`가 쓴다). 이 두 protocol 파일이 zod를 import하지 않는지 확인한다(사본에는 zod를 풀 import map이 없다).
   - 옛 `SUPPORT_PACKAGES`는 `@lophn/design`·`@lophn/wording`·`@lophn/chart` 셋이었다. 지금은 `@lophn/ui`(source `design`)와 `@lophn/wording`(source `design/wording`) 둘이다(`packages/design/chart/`는 없다). `@lophn/ui` 사본에서 뺄 것: `wording`(별도 package), `style-check`, `testdata`, `*_test.ts`·`*_test.tsx`. `fonts/`, `generated/`, `base.css`, `components/`, `tokens.ts`는 남긴다(`@lophn/ui/tokens.css`는 `generated/tokens.css`, `base.css`가 글꼴을 가리킨다). `design/generate.ts`·`design/mod.ts`를 사본에 남길지는 `mod.ts`가 닿는 import를 따라 정한다(`generate.ts`가 `postcss`를 쓰면 뺀다). 지원 소스의 이름·판은 표에 박지 않고 `source` 폴더의 `deno.json`에서 읽는다. `SUPPORT_VERSION` 상수는 만들지 않는다.
   - `vendorFiles`(규칙에 따라 `rewriteSpecifiers`로 바꾸고 vendored 원본을 더함)는 `vendor.ts`로 옮긴다(옛 `install.ts`에 있었다). 그러면 `install.ts`는 읽기·쓰기만 한다.
3. `install.ts`를 되살린다. 근거: 이슈 "가장 짧다", 옛 코드.
   - `collectSourceFiles(root, keep)`·`sortFiles`를 되살린다. 모든 sdk·지원 소스에서 `_test.ts(x)`와 `testdata`는 뺀다(옛 `installPackage`는 test 파일도 담았다. 사본에 test가 들 이유가 없다). `guide.md`는 남긴다(바로 쓰지는 않지만 사본과 package 폴더를 같게 둔다).
   - `installPackage`는 `installSdkPackage(dir, deps)` 꼴로 줄인다: catalog 등록(`register_version`), guide blob 준비, `prepareBlob`, `registerVersion`, `isWithheldPackageName`, `installRefused`, `InstallSubmission`을 되살리지 않는다. 지금 `packages/model.ts`에 `isWithheldPackageName`이 없고, 등록은 이 task 범위 밖이다(아래 "정한 것"). `INSTALL_PRINCIPAL`·`PrepareBlob`·`prepareBundleBlobs`는 `publish.ts`가 쓰니 지우지 않는다.
   - `installSupportPackage`도 `source`와 규칙을 받는 같은 꼴로 줄인다.
   - 복사 쓰기: 같은 file 목록·byte의 사본이 이미 있으면 건드리지 않는다(`sameInstallCopy`). 다르면 `removeInstallCopy` 뒤에 `writeInstallCopy`한다. 옛 `installSupportPackage`는 다를 때 `removeInstallCopy` 없이 `writeInstallCopy`만 해서 0555 폴더에 쓰다 실패한다(`installTemplate`만 지우고 썼다). repo 소스를 고친 뒤 다시 띄우면 사본이 바뀌어야 하므로 지우고 쓰는 쪽이 맞다. 사본은 `<dataRoot>/sdk`에 있는 것이고 release bundle에 굳은 사본은 따로 있어(`apps/<app>/bundles/<hash>/sdk/`) 영향이 없다.
   - `installSdkCopies(deps)`를 만든다(위 계약). `packagesRoot/sdk/*` 폴더를 이름 순으로 돌며 `deno.json`이 없는 폴더는 건너뛰고, 이어서 지원 소스 둘을 깐다. 하나라도 실패하면 그 `err`를 돌려준다(다음 것을 계속 깔지 않는다).
   - 코드 길이는 옛 것보다 짧게. 옛 코드의 `InstallDeps`·`SupportInstallResult`·`InstallResult` type 중 쓰지 않는 것은 되살리지 않는다.
4. 위험 test 하나를 `packages/core/apps/packages/install_test.ts`에 쓴다(아래 "끝남"). 근거: `write-test` "사용자 데이터 규칙"과 sandbox 경계(앱이 읽는 사본을 앱이 고칠 수 없음). 실제 repo의 `packages/`를 `packagesRoot`로, 임시 폴더를 `dataRoot`로 쓴다. subprocess·서버를 띄우지 않는다.

## 정한 것(worker가 다시 정하지 않는다)

- **catalog 등록(register_version, guide blob)은 하지 않는다.** 이유: `commands.ts`가 같은 name·version의 bundle hash가 다르면 `conflict`("published version bytes are immutable")로 거절한다. 개발 중 `packages/sdk/*` 소스를 고치고 core를 다시 띄우면 기동이 막힌다. 이 task는 이슈 범위(사본과 template을 `packageInstallPath` 자리에 까는 것)만 한다.
- 깔리는 sdk는 `deno.json`이 있는 폴더 전부(`app-ui`, `blueprint`, `cap-app-api`, `cap-problem`, `cap-project`, `cap-store`). 이유: template이 쓰는 것은 `app-ui`·`blueprint`·`cap-app-api`·`cap-problem`·`cap-store`이고 나머지가 해롭지 않다. `cap-fs`·`cap-net`·`cap-secret`은 판 정의가 없고 아무도 선언하지 않아 이번에 두지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`install_test.ts`, 하나나 둘):
  - "설치 사본은 읽기 전용이고 다시 깔면 같은 내용이다": 임시 `dataRoot`에 `installSdkCopies`를 두 번 돌린다. `sdk/` 아래 모든 file이 0444, 모든 폴더가 0555이고, 두 번째 호출 뒤 file 목록과 byte(hash)가 같다. 소스를 일부러 바꾼 작은 `packagesRoot`로 세 번째를 돌려 사본이 새 byte로 바뀌는 것(0555 폴더를 지우고 다시 씀)도 본다.
  - "깐 blueprint·cap-store·cap-problem 사본이 repo 없이 import된다": 위에서 깐 `<dataRoot>/sdk/{blueprint,cap-store,cap-problem}/1.0.0/mod.ts`를 `await import(file URL)`로 읽는다(같은 process 안 동적 import. 사본이 `../../protocol/…`을 사본 밖으로 가리키면 이 import가 던진다). 글로 검사하지 않고 실제로 import해서 본다. `app-ui`·`ui`는 npm 의존을 풀 import map이 필요해 이 test에서 제외한다.
- 남지 않음:
  - `install.ts`에 함수 없이 제목만 남은 고아 주석(예: "// 검증된 설치 내용만 설치한다."가 함수 없이 홀로 있는 것)이 없다. 눈으로 한 번 훑는다.
  - `grep -rn "SUPPORT_VERSION\|@lophn/chart\|@lophn/design" packages/core/apps/packages`가 0줄이다(`packages/core/apps/packages/template/app/` 안은 `.tmpl`이고 이미 새 이름이다).
- 새 E2E·subprocess·서버 test를 쓰지 않는다. core를 띄워 하는 손 확인도 이 task에 없다(확인은 위 test와 `deno task check`까지).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`installSdkCopies`는 `sdk-install-startup`이 부른다. `apps/packages/mod.ts` barrel에는 더하지 않는다. wiring이 `install.ts`를 직접 import한다)
- 안 쓰게 된 export: 없음 (`publish.ts`가 `INSTALL_PRINCIPAL`·`prepareBundleBlobs`·`bundleBytes`·`packageInstallPath`·`removeInstallCopy`·`sameInstallCopy`·`writeInstallCopy`를 쓰니 지우지 않는다)
- 정한 것
- 넘길 줄: 새 `deno.json`이 `deno.lock`을 바꿔야 하면 그 내용
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: `cap-fs`·`cap-net`·`cap-secret`은 안 깔린다. catalog 등록이 없어 `package show @lophn/…`(coding agent skill `lophn-build-app`이 안내)는 지금 비어 있다. 실제 core를 띄운 확인은 이 계획이 하지 않는다.

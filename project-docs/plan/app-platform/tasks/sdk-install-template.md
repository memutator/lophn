# sdk-install-template

repo의 앱 template(`packages/core/apps/packages/template/app/*.tmpl`)을 읽어 `.tmpl` 접미를 떼고 `<dataRoot>/templates/app/`에 읽기 전용(file 0444, 폴더 0555)으로 두는 함수를 git 기록에서 되살려 현재 코드에 맞게 고친다.

- 단위: sdk-install (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/packages/template/files.ts`
  - `packages/core/apps/packages/template/install.ts`
  - `packages/core/apps/packages/template/mod.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/platform.md`의 "data root에 sdk 설치 사본과 앱 template을 까는 코드가 없다"(닫는 일은 lead가 한다)
  - architecture: `project-docs/architecture/ui-kit.md`("앱 UI가 build되는 길" 1. 앱 template)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps`(core 아래), `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - test 기준: `.claude/skills/write-test/SKILL.md`
  - 되살릴 옛 코드(아래)
- 계약:
  - 쓰는 것: `packages/core/apps/packages/install.ts`의 `bundleBytes`, `removeInstallCopy`, `sameInstallCopy`, `writeInstallCopy`(지금 있는 export 그대로. `sdk-install-copies`가 이 파일을 고치지만 이 export들의 이름·모양은 바꾸지 않는다). `SourceFile` type(`../vendor.ts`).
  - 내놓는 것(`sdk-install-startup`이 부른다):
    ```ts
    // template/install.ts
    export async function installBuiltinTemplate(deps: {
      dataRoot: string;
      directory?: string; // 기본은 files.ts의 BUILTIN_TEMPLATE_DIRECTORY
    }): Promise<Result<{ install_path: string; files: readonly string[] }>>;
    ```

## 되살릴 commit과 path

지운 commit은 `bcb7a9c3d`(Remove unused core exports and the code only they used, 2026-10-16)이고 부모 `bcb7a9c3d^`에서 읽는다.

- `packages/core/apps/packages/template/files.ts`(지금은 type 둘만 남았다): `git show bcb7a9c3d^:packages/core/apps/packages/template/files.ts`에서 `BUILTIN_TEMPLATE_DIRECTORY`, `REQUIRED_TEMPLATE_FILES`, `sortTemplateFiles`, `readTemplateDirectory`, `builtinTemplate`을 되살린다.
- `installTemplate`: `git show bcb7a9c3d^:packages/core/apps/packages/install.ts`의 `installTemplate`(403줄 근처). 같은 파일의 `removeInstallCopy`·`sameInstallCopy`·`writeInstallCopy`는 지금 `install.ts`에 남아 있다.

## 지켜야 할 것(계획 README 그대로)

- module은 `core/main`을 import하지 않는다. 바닥은 위층을 import하지 않는다. domain끼리는 problems → apps만.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 설치 사본은 읽기 전용이고 release bundle에 굳힌 사본과 섞지 않는다.

이 task에서: `templates/app/`은 `sdk/` 사본과 같은 읽기 전용 규칙(0444·0555)이다. template은 release bundle과 관계가 없다.

## 할 일

1. `template/files.ts`를 되살린다. 근거: 옛 코드, `ui-kit.md` 1. 옛 파일에서 가져오되 아래를 다르게 한다.
   - **`templateHash`와 고정 hash(`pin.ts`의 `TEMPLATE_HASH`)는 되살리지 않는다.** 이유: 고정 hash는 template을 고칠 때마다 손으로 갱신해야 하고, 지금 `deno.json.tmpl`·`deno.lock.tmpl`이 자주 바뀐다(UI kit 계획). 설치할 때마다 repo 원본에서 읽어 바이트 비교(`sameInstallCopy`)로 갱신하면 충분하다. `pin.ts`·`resolve.ts`도 되살리지 않는다(`LOPHN_APP_TEMPLATE` override나 설치 사본 우선 선택은 이 task 범위 밖. 부르는 곳이 없다).
   - 지금 `files.ts`가 이미 내놓는 `TemplateFile`·`TemplateFailure` type은 그대로 둔다(`template/scaffold.ts`·`mod.ts`가 쓴다).
   - `readTemplateDirectory`는 옛 코드대로 `entry.isFile`만 읽는다(symlink는 건너뛴다). `REQUIRED_TEMPLATE_FILES`(`main.ts, blueprint.ts, deno.json, deno.lock, AGENTS.md, CLAUDE.md, .gitignore`)가 지금 `template/app/`의 `.tmpl`을 뗀 이름과 맞는지 확인한다(`.gitignore.tmpl`, `deno.lock.tmpl` 모두 있다. 폴더 `ls -a`로 확인했다).
2. `template/install.ts`를 새로 만든다. 근거: 옛 `installTemplate`.
   - `installTemplate(files, deps)`: `expectedHash` 인자를 뺀다. 파일을 경로순으로 정렬해 `<dataRoot>/templates/app`에 둔다. 같은 목록·byte의 사본이 있으면 그대로 두고, 아니면 `removeInstallCopy` 뒤 `writeInstallCopy`로 바꾼다(옛 코드대로).
   - `installBuiltinTemplate({dataRoot, directory})`는 `builtinTemplate(directory)`를 읽어 `installTemplate`에 넘긴다. 읽기 실패(`TemplateFailure`)는 `Result` 오류 코드 일곱 안으로 옮긴다(`not_found`/`invalid_input`/`unavailable`이 이미 일곱 안이다. 같은 code로 돌려준다).
   - 반환은 `{install_path, files}`면 충분하다(옛 `hash`는 쓰는 곳이 없다).
3. `template/mod.ts`에 `installBuiltinTemplate`을 내보낸다. 근거: `packages/core/apps/packages/template/mod.ts`가 template 경계다. `apps/packages/mod.ts`(barrel)는 고치지 않는다(wiring이 파일을 직접 import한다. 다른 task가 같은 barrel을 만지지 않게 하려는 것이다).
4. test는 쓰지 않는다. 이유: 쓰기·비교·읽기 전용은 `sdk-install-copies`의 `install_test.ts`가 `writeInstallCopy`·`sameInstallCopy`로 이미 본다. 이 task에 새로 생기는 규칙은 `.tmpl` 접미를 떼고 읽는 것 하나뿐이고 화면·문구도 아니다. `write-test` "이미 다른 test가 보는 동작은 test하지 않는다".

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(위 할 일 4).
- 남지 않음: `grep -rn "TEMPLATE_HASH\|templateHash\|resolveTemplate" packages/core` 0줄(되살리지 않았다는 확인).
- 새 E2E·subprocess·서버 test를 쓰지 않는다. core를 띄워 하는 손 확인도 이 task에 없다(확인은 `deno task check`까지).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`sdk-install-startup`이 `template/install.ts`를 직접 import한다)
- 안 쓰게 된 export: `scaffoldApp`(`template/scaffold.ts`)은 부르는 곳이 여전히 없다. 이 task는 지우지 않는다(scaffold_test.ts가 있고 앱 만들기에서 쓸 자리). 그대로 보고만 한다.
- 정한 것: 고정 hash를 되살리지 않았다
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: 설치된 `templates/app/`을 읽는 쪽(coding agent가 앱을 만들 때 쓰는 길)은 이 계획 범위 밖이라 없다.

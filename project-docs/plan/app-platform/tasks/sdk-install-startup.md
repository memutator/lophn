# sdk-install-startup

core 기동 때 sdk 설치 사본과 앱 template을 data root에 깔도록 daemon wiring 하나를 새로 만든다. 설치 규칙은 `apps/packages`에 있고 이 wiring은 부르기만 한다.

- 단위: sdk-install (wave 1)
- 선행: sdk-install-copies, sdk-install-template. 둘이 내놓는 `installSdkCopies`와 `installBuiltinTemplate`을 부른다.
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/wiring/sdk-install.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/ui-kit.md`("앱 UI가 build되는 길" 2: 설치 사본 `sdk/<이름 뒤쪽>/<판>`)
  - 조립 순서: `packages/core/main/daemon/wiring/context.ts` 머리 주석(hook 순서 `prepare → openRuntime → records → build → API → start`)과 `Wiring` type
  - 본보기: `packages/core/main/daemon/wiring/config.ts`(`build`에서 `ok({...})`를 돌려주는 가장 작은 wiring)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/main`(조립만 한다. 업무 규칙을 두지 않는다)
- 계약:
  - 쓰는 것: `packages/core/apps/packages/install.ts`의 `installSdkCopies({dataRoot, packagesRoot})`(`sdk-install-copies`). `packages/core/apps/packages/template/install.ts`의 `installBuiltinTemplate({dataRoot})`(`sdk-install-template`). `WiringFactory`(`wiring/context.ts`).
  - 내놓는 것: `export const sdkInstallWiring: WiringFactory`. lead가 `assembly.ts`의 `WIRINGS`에 등록한다.

## 지켜야 할 것(계획 README 그대로)

- module은 `core/main`을 import하지 않는다. 바닥은 위층을 import하지 않는다. domain끼리는 problems → apps만.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 설치 사본은 읽기 전용이고 release bundle에 굳힌 사본과 섞지 않는다.

이 task에서: wiring은 `core/main`이다. `apps/packages`를 import하는 것은 된다(main → domain). 반대 방향 import를 만들지 않는다. 다른 wiring file을 import하지 않는다(`module-catalog`의 `core/main` 노트). 이 task는 `wiring/apps.ts`·`wiring/approval-reads.ts`(계획 `approval-reads`가 고친다)와 `main/daemon/{main,core}.ts`(계획 `crash-log`가 기동 앞쪽을 고친다)를 만지지 않는다.

## 할 일

1. `wiring/sdk-install.ts`를 만든다. 근거: 이슈 "core 기동 때 … 풀고 … 기동 조립에 잇는 것", `wiring/context.ts` hook 순서.
   - `name: "sdk-install"`. `build(ctx)`(async)에서 `installSdkCopies({dataRoot: ctx.root.path, packagesRoot})`, 이어서 `installBuiltinTemplate({dataRoot: ctx.root.path})`를 부른다. 어느 쪽이든 `err`이면 그 `err`을 그대로 돌려준다(`core.ts`가 runtime을 닫고 기동 실패로 올리고, `main.ts`가 `core: <message>`를 찍는다. 설치가 안 된 채 뜨면 앱 release 준비가 나중에 `sdk_not_installed`로 멈춰 원인을 찾기 어렵다). 둘 다 `ok`이면 `ok({})`.
   - `packagesRoot`는 이 파일 위치에서 정한다: `new URL("../../../../", import.meta.url).pathname`(= repo의 `packages/`. `wiring/` → `daemon/` → `main/` → `core/` → `packages/`. 같은 계산이 `releases/prepare/from-source.ts`의 `PACKAGES_URL`에 있다). 값을 이 파일 한 곳에서만 계산한다.
   - 왜 `build`이고 `start`나 `prepare`가 아닌가: `prepare`는 동기이고 runtime 전이다. `start`는 API가 열린 뒤라 그 사이 release 준비 요청이 들어올 수 있다. `build`는 runtime이 열린 뒤 API를 열기 전이고 `Result`를 돌려줄 수 있다. 이 이유를 한 줄 주석으로 남긴다.
   - 주석은 "왜"만. 업무 규칙을 두지 않는다(어느 패키지를 깔지, 판이 무엇인지는 `apps/packages`가 안다).
2. test는 쓰지 않는다. 이유: wiring은 부르기만 하고, 설치의 위험(읽기 전용, 다시 깔면 같은 내용, 사본이 repo 없이 import됨)은 `sdk-install-copies`의 `install_test.ts`가 본다. 새 서버·subprocess test는 쓰지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(위 할 일 2).
- 남지 않음: `grep -rn "sdk-install\|sdkInstallWiring" packages/core/main`이 이 file 하나뿐이다(`assembly.ts` 등록은 lead가 한다).
- core를 띄워 template 앱의 release 준비까지 손으로 확인하는 일은 이 계획이 하지 않는다. 확인은 unit test와 `deno task check`까지다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 `packages/core/main/daemon/assembly.ts`의 `WIRINGS`에 `sdkInstallWiring`을 `configWiring` 뒤에 더한다(import 한 줄과 목록 한 줄. 설치 순서는 `appsWiring`보다 앞이기만 하면 된다). `module-catalog.yaml`·`boundary-catalog.yaml`은 안 바뀐다(`core/main` 안 file).
- 안 쓰게 된 export: 없음
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: 배포판(electron으로 묶인 core)에서 `packages/` 소스가 같이 가는지는 확인하지 않았다. `packagesRoot`는 repo checkout 기준이다. (개발 실행인 `deno task dev`에서 쓰인다.)

# rd-cap-fs

`@lophn/cap-fs`가 기동 때 설치되게 `deno.json`(판 1.0.0)을 둔다. fs는 core 쪽(release 준비의 권한 검사, 앱 process의 Deno flag)이 이미 있어 이것만으로 산다. 지금은 `deno.json`이 없어 `installSdkCopies`가 건너뛰고, blueprint가 이 package를 의존하면 release 준비가 `sdk_not_installed`로 거절한다.

- 단위: rd-cap (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/sdk/cap-fs/**`
- 읽을 것:
  - issue: `project-docs/issues/reuse.md`의 "cap-fs, cap-net, cap-secret이 깔리지 않아…"(정한 것: 셋 다 살린다, 사람)
  - architecture: `project-docs/architecture/app-call.md`, `project-docs/architecture/activation.md`(권한 선언과 approval)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `sdk`(`sdk-api`), `app-capability`, `package-registry`
  - 본보기: `packages/sdk/cap-project/deno.json`; 설치기 `packages/core/apps/packages/install.ts`의 `installSdkCopies`; 권한 규칙 `packages/core/apps/releases/sdk-permissions.ts`(`@lophn/cap-fs`는 `fs.read` 또는 `fs.write`); 앱 process flag `packages/core/apps/permissions/flags.ts`
- 계약:
  - 쓰는 것: 설치기가 `packages/sdk/*/deno.json`의 `name`·`version`·`exports`를 읽는다.
  - 내놓는 것: 설치 사본 `<data root>/sdk/cap-fs/1.0.0`. 앱이 `@lophn/cap-fs`를 의존으로 선언할 수 있다.

## 할 일

1. `packages/sdk/cap-fs/deno.json`을 `cap-project`와 같은 꼴로 둔다: `{ "name": "@lophn/cap-fs", "version": "1.0.0", "exports": "./mod.ts" }`. 루트 `deno.json`의 workspace는 `./packages/sdk/*` glob이라 따로 등록하지 않는다.
2. `deno check packages/sdk/cap-fs`로 workspace 안에서 type check를 통과함을 본다. 안 되면 이 폴더 안에서 import를 고친다.
3. 설치를 본다(commit하지 않는다): `.dev-data/rd-cap-fs/`에 core를 한 번 띄워(orchestrate의 "core 확인" 방법) `<data root>/sdk/cap-fs/1.0.0/mod.ts`와 `guide.md`가 생김을 본다.
4. `guide.md`가 지금 동작과 맞는지 읽고 어긋난 줄만 고친다(앱이 읽고 쓸 수 있는 곳은 사람이 켤 때 허락한 경로뿐이고, 값의 거절이 `CapabilityError`인 것 등). 지금 되는 것을 한 줄로 분명히 적는다: "blueprint에 `fs.read`·`fs.write`와 경로를 선언하고 사람이 허락한 경로만 읽고 쓴다". 구현을 고치는 일은 이 task가 아니다. 어긋난 동작을 발견하면 보고의 "알려진 미완 동작"에 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(설치기의 기존 `install_test.ts`가 설치 동작을 본다).
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음. `deno.lock`이 바뀌면 commit하지 않고 알린다.
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

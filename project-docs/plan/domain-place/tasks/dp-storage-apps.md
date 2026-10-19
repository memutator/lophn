# dp-storage-apps

앱 저장 자리를 `<data>/apps/<app>/`에서 `<data>/projects/<prj>/app/`로 옮긴다. 대상은 운영 data(`data/`), release 사본(`bundles/`), 준비 폴더(`staging/`), preview 영역(`packages/core/apps/preview/`)이다. 앱의 기본 source 자리(`source/`)는 `dp-place-events`가 `scaffold-source.ts`에서 옮긴다. 사람이 이은 source 폴더는 그대로다. 경로는 모두 `dp-app-project`가 만든 `packages/protocol/apps/app-storage.ts`의 함수로 만든다. 개발 data는 새로 만든다(옛 자리를 읽는 장치를 만들지 않는다).

- 단위: storage (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/data/`
  - `packages/core/apps/releases/`
  - `packages/core/apps/preview/`
  - `packages/core/apps/routes.ts`
  - `packages/core/apps/control.ts`
  - `packages/protocol/apps/activation/data-job.ts`
  - `packages/core/main/app-supervisor/`
  - `packages/core/main/daemon/wiring/apps.ts`
  - `packages/core/install-and-update/data-root.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/activation.md`, `project-docs/architecture/app-call.md`, `project-docs/architecture/testing.md`(preview·sandbox 경계)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-releases`, `app-runtime`, `app-data`, `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > 앱 저장 자리"
- 계약:
  - 쓰는 것: `dp-app-project`의 `packages/protocol/apps/app-storage.ts`(`appFolder`, `appDataFolder`, `appBundleCopy`, `appStagingFolder`, `appPreviewFolder`)와 `appProjectOf`(`packages/core/apps/lookups.ts`)
  - 내놓는 것:
    - 앱 운영 data는 `<data>/projects/<prj>/app/data/app.sqlite`, release 사본은 `<data>/projects/<prj>/app/bundles/<hash>`, preview 영역은 `<data>/projects/<prj>/app/preview/<nonce>`다.
    - 앱 id만 받던 입력에 `project`가 더해진다: `PreparationJob`(`packages/core/apps/releases/preparation.ts`), 활성 data job 입력(`packages/protocol/apps/activation/data-job.ts`, `ActivationDataJobInput`), `bundleCopyPath`(`packages/core/apps/releases/bundle/seal.ts`의 시그니처가 `(dataRoot, project, bundleHash)`). `PreviewLaunch`(`packages/core/apps/preview/model.ts`)에는 칸을 더하지 않는다: preview 영역 경로(`dataPath`) 안에 project가 들어 있어 supervisor가 경로에서 읽는다(wire 형태인 `packages/core/apps/runtime/`의 control protocol을 건드리지 않는다). `dp-problems-core`가 이 형태를 따른다.

## 할 일

1. `packages/core/apps/releases/bundle/seal.ts`의 `bundleCopyPath`(23째 줄)를 `(dataRoot, project, bundleHash)`로 바꾸고 `appBundleCopy`를 부른다. 부르는 곳을 고친다: `packages/core/apps/routes.ts`(276째 줄), `packages/core/apps/control.ts`(589째 줄), `packages/core/apps/releases/prepare/flow.ts`(211째 줄), `packages/core/apps/releases/activation/desired.ts`(110째 줄), `packages/core/main/daemon/wiring/apps.ts`(146째 줄). 앱 id만 알면 `appProjectOf(sql, app)`로 project를 읽는다.
2. `packages/core/apps/releases/prepare/from-source.ts`(234째 줄 `staging`)와 `main/app-supervisor/release-runner.ts`(31째 줄 `appRoot`과 `--allow-write=${appRoot}`): `PreparationJob.project`를 더해 `appFolder`로 바꾼다. 읽기 허락 목록(`--allow-read=${job.source_path},${options.dataRoot}/sdk,${appRoot},…`)은 그 앱 폴더만이어야 한다 — 다른 project의 폴더가 들어가지 않는지 확인한다.
3. `packages/core/apps/releases/activation/assembly.ts`: `dataPath`(266째 줄), backup 읽기(496째 줄), migrate의 `bundle_path`(522째 줄)를 `appDataFolder`·`appBundleCopy`로 바꾼다. 보호 root 목록 `[`${deps.dataRoot}/apps`]`(216째 줄)를 `[`${deps.dataRoot}/projects`]`로 바꾼다(앱 permission이 다른 project의 폴더를 요구해도 허락되지 않아야 한다). `data/worker/run.ts`(25, 40째 줄)·`main/app-supervisor/data-runner.ts`(36째 줄)와 `packages/protocol/apps/activation/data-job.ts`는 data job 입력에 `project`를 싣고 bundle 경로 검사(`bundles` 접두)를 새 경로로 맞춘다. `data/worker/paths.ts`도 본다.
4. `packages/core/apps/preview/{area,flags,model,service}.ts`와 `main/app-supervisor/preview-broker.ts`: `/apps/<app>/preview/<nonce>`를 가정한 접미 검사(`flags.ts`의 `liveDataOf`, `preview-broker.ts`의 `marker`)를 `/projects/<prj>/app/preview/<nonce>`로 바꾼다. `discardAll`(`area.ts` 64~74째 줄)은 `<data>/projects/*/app/preview`를 훑는다. preview 자식의 flag가 운영 data(`…/app/data`)와 그 위 폴더를 읽기·쓰기에 넣지 않는다는 검사를 새 경로로 옮겨 살린다.
5. `install-and-update/data-root.ts`의 `MANAGED = ["apps", "run"]`에서 `"apps"`를 뺀다(`projects/`는 쓰는 쪽이 만든다). `apps: ${real}/apps` 반환 칸을 쓰는 곳이 없으면 지운다.
6. 이 폴더들의 App Engineer 주석(`packages/core/apps/releases/commands.ts` 347째 줄, `packages/core/apps/releases/activation/handler.ts` 91째 줄)을 Project Manager로 고친다.
7. `/apps/` 경로를 단언한 시험을 새 경로로 옮긴다(`grep -rn "/apps/" packages/core/apps packages/core/main`). 예외로 `tests/e2e`는 이 계획이 고치지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "preview 자식의 flag가 운영 data(`<data>/projects/<prj>/app/data`)를 읽기·쓰기에 넣으면 위반이다." 기존 test를 새 경로로 옮겨 살린다(새로 만들지 않는다). 앱 permission 보호 root가 `<data>/projects`를 포함하는 것도 같은 test 쪽에서 한 줄로 본다.
- 남지 않음: `grep -rnE '(dataRoot|root|Root)[}]?/apps' packages/core --include=*.ts`가 `packages/core/problems/`(`dp-problems-core`)와 `packages/core/apps/tickets/coding/scaffold-source.ts`(`dp-place-events`)의 줄만 남기고 0줄이다. `grep -rn '/apps/\${' packages/core --include=*.ts`(preview 접미 검사)도 같다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: `bundleCopyPath`의 옛 시그니처
- 정한 것: project를 입력에 싣는 곳과 sql로 읽는 곳
- 넘길 줄: `dp-problems-core`가 쓸 project 얻는 길(예: 이 task가 정하는 port·입력 칸)을 적는다
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: 옛 `<data>/apps/`에 남은 개발 data는 읽지 않는다(지우고 새로 만든다)

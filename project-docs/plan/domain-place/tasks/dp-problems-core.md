# dp-problems-core

problems 모듈이 앱 저장 자리를 새 위치(`<data>/projects/<prj>/app/`)로 읽게 하고, 문제 상태를 바꾸는 agent 판정을 App Engineer 세션에서 Project Manager 자격(담당 앱)으로 옮긴다. release 사본을 읽는 collector·test runner·examples 요청이 대상이다.

- 단위: storage (wave 2)
- 선행: dp-storage-apps. project를 입력에 싣는 방법(`PreparationJob`·활성 job 입력의 `project`)과 `bundleCopyPath`의 새 시그니처를 먼저 정한다.
- 소유(이 task만 고친다):
  - `packages/core/problems/`
- 읽을 것:
  - architecture: `project-docs/architecture/layers.md`(domain끼리 `problems → apps`는 된다), `project-docs/architecture/app-call.md`, `project-docs/architecture/testing.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `problems`, `app-releases`, `project-docs/module-catalog.yaml`의 `packages/core/problems`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > 앱 저장 자리 / PM이 App Engineer의 일을 맡는다", `project-docs/products/AGENT-ROLE.md`의 A2, A16
- 계약:
  - 쓰는 것: `dp-app-project`의 `AppRegistration.project`(`lookupAppRegistration`, `packages/core/apps/registration/mod.ts`), `appProjectOf`(`packages/core/apps/lookups.ts`), `packages/protocol/apps/app-storage.ts`의 `appBundleCopy`, `dp-storage-apps`가 정한 project 전달 방식
  - 내놓는 것: problems가 읽는 release 사본 경로는 모두 `<data>/projects/<prj>/app/bundles/<hash>`다. 문제를 resolved로 바꾸는 agent는 그 문제의 앱을 `conditions.app`으로 가진 agent(PM)뿐이다.

## 할 일

1. `packages/core/problems/snapshots/work.ts`: 자체 `bundleCopyPath`(40째 줄, "seal.ts의 bundleCopyPath와 같은 규칙" 주석)를 project를 받는 `appBundleCopy`로 바꾸고, 이 파일의 `folder.appsRoot`(60, 103째 줄)를 data root(`dataRoot`)와 project를 함께 받게 고친다. evidence에는 앱 id만 있으므로 project는 core가 work를 만들 때 싣는다(`appProjectOf`). `packages/core/problems/snapshots/work_test.ts`를 맞춘다.
2. `packages/core/problems/reporting/worker/collector.ts`: `collectorAppsRoot()`(967째 줄)와 `folder: { appsRoot }`(813째 줄)를 새 구조에 맞춘다. collector 자식은 ledger를 열지 못하고 `LOPHN_HOME`과 credential 조건만 가진다. project를 얻는 길을 읽어 정한다 — 권장은 core가 보고 evidence 입력에 `project`를 싣는 것이고, 안 되면 `<home>/projects/*/app/bundles/<hash>`를 찾는 것이다(같은 hash가 둘이면 거절). 정한 쪽을 보고의 "정한 것"에 적는다. 같은 파일의 `apps/<app>/bundles/<hash>` 주석(965째 줄)도 고친다.
3. `packages/core/problems/tests/examples-request.ts`(44째 줄), `packages/core/problems/tests/runner.ts`(100째 줄 `--allow-read`의 `${input.dataRoot}/apps`), `packages/core/problems/tests/work/runner-service.ts`(360, 576째 줄)의 bundle 경로를 새 위치로 바꾼다. `runner.ts`의 collector spec `allow_read`는 `<data>/projects`로 넓어진다 — bundle 사본(0444)만 읽는다는 주석은 새 위치로 고치고, 쓰기 허락은 계속 비어 있어야 한다. test 요청의 target·job 입력에 `project`가 필요하면 `packages/core/problems/tests/request-ports.ts`의 admission이 `lookupAppRegistration`의 `project`를 싣는다.
4. `packages/core/problems/grouping/commands.ts`의 `mayChange`(21~35째 줄): sessions 표의 `role`·`app`을 읽는 판정을 `ctx.conditions.app === problem.app`(agent 자격)으로 바꾼다. 문서 주석("App Engineer(agent)는 자기 앱의 문제만 바꾼다")도 PM으로 고친다. `repairs/more.ts`(200째 줄), `packages/core/problems/tests/commands.ts`(53째 줄)의 App Engineer 주석도 PM으로.
5. 시험을 새 위치에 맞춘다(`problems/**/_test.ts`의 `/apps/` 단언). 위험 test는 새로 쓰지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(권한 판정은 `conditions.app` 비교 하나이고 기존 test가 본다. 있으면 그 test를 새 자격 이름으로 옮겨 살린다)
- 남지 않음:
  - `grep -rnE '(dataRoot|root|Root)[}]?/apps' packages/core/problems`가 0줄이다.
  - `grep -rn "app_engineer\|App Engineer" packages/core/problems`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: collector가 project를 얻는 길
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**

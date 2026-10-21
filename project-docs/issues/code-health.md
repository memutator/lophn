# code-health

여러 module에 걸친 코드 건강 이슈다(죽은 이름, 긴 파일, test 준비 코드). 짝이 되는 architecture 문서는 없다.

## API server의 worker route 통로가 남았다

```yaml
kind: defect
modules: [packages/core/server, packages/core/supervision, packages/core/main, packages/core/storage, packages/core/apps, packages/protocol]
```

지금: core가 worker 대상을 넘기는 곳이 없다(`packages/core/main/daemon/core.ts`의 `startApiServer` 부르기에 `workers`가 없다). 그래도 worker route 통로가 남아 있다: `packages/core/server/server.ts`의 `ApiServerOptions.workers`와 `adaptedWorkers`, `packages/core/server/dispatch.ts`의 worker 갈래(`deps.workers`를 찾는 곳 셋)와 `isWorkerRoute`(`packages/core/server/routes.ts`), `packages/core/supervision/responsiveness/forward.ts`의 `forwardToWorker`, 등록의 `workerRoutes`(`packages/core/storage/ledger/team-module.ts`, `packages/core/main/daemon/registration.ts`, `packages/core/apps/register.ts`), protocol의 `defineWorker`와 `WorkerRoute`. 쓰는 route는 `packages.guide`(`packages/protocol/apps/package-routes.ts`) 하나이고 늘 `unavailable`("worker unavailable")이다. 안내 원문은 `packages.guide_body`가 읽는다.

영향: 부르면 늘 실패하는 route가 열려 있고, 검토와 고칠 일(dispatch, 등록, 감독)에 죽은 갈래가 낀다.

정한 것: 지운다(잃는 기능이 없는 죽은 코드다. AGENTS.md "속도"). `packages.guide` route와 worker route 종류 전체, `forwardToWorker`를 같이 지운다(중간. 여러 module의 등록 file을 건드린다).

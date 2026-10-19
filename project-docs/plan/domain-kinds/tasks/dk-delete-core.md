# dk-delete-core

core의 context 하위 시스템을 지운다: `packages/core/projects/contexts/` 전체(12,651줄, 115 file: API, ledger 표, worker, index, check, preview, watch, series), 그것을 조립하던 wiring, project module의 context 읽기·port. 새 kind pipeline(`packages/core/projects/kinds/`, `wiring/kinds.ts`)은 건드리지 않는다.

코드 이름은 아직 `project`다.

- 단위: cleanup (wave 3)
- 선행: dk-operator-contexts
- 소유(이 task만 고친다):
  - `packages/core/projects/contexts/`
  - `packages/core/projects/register.ts`
  - `packages/core/projects/lookups.ts`
  - `packages/core/projects/ports.ts`
  - `packages/core/main/worker/main.ts`
  - `packages/core/main/daemon/wiring/projects.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-registration.ts`
- 읽을 것:
  - plan: `project-docs/plan/domain-kinds/README.md`("정한 것": context의 draft·bundle·check·rollback 표와 route는 옮기지 않고 지운다, "context worker의 쓸 수 있는 코드"는 kind module로 옮겨졌다), `project-docs/issues/contexts.md`(lead가 닫는다)
  - architecture: `project-docs/architecture/layers.md`, `tools/check-deps.ts`
  - 남길 것을 정하는 기준: 새 module이 이미 쓰는 것. `packages/core/projects/kinds/`(host·worker)가 `packages/core/projects/contexts/`를 import하지 않는지 먼저 `rg -n "projects/contexts" packages tests tools`로 확인한다. 이 task 밖에서 `contexts/`를 import하는 곳이 남아 있으면 그 file이 소유자가 있는 다른 task의 몫이므로 지우기 전에 보고한다.
  - 지금 조립(고칠 곳): `packages/core/projects/register.ts`(`loadContextsRuntime`, `createContextsRegistration`, `contextsRuntime`, `blobFields`, 반환의 `contexts.schemaSteps/commands/reads/blobFields`, `createReaderRegistration`), `lookups.ts`(`contextProjectOf`, `activeContextIds`, `draftBundles`), `ports.ts`(`ContextAuthority`, `ContextFolders`), `wiring/projects.ts`(context 쪽 전부: `contextsInputReader`, `contextsHost`, `contextsWatch`, `operations`의 `CONTEXT_WORKER_OPERATIONS`, `build`의 `draftContent`·`overlayReads`·`withContextBlobs`, `start`의 context worker, `closeIntake`의 `contextsWatch?.stop()`), `wiring/lophn-agent-registration.ts`(`contextAuthorityPort`, `contextAuthority`와 `createReaderRegistration`의 ports), `main/worker/main.ts`(`CONTEXTS_KIND`, `runContextsWorker`)
  - 남기는 쪽 본보기: `packages/core/main/daemon/wiring/kinds.ts`와 `packages/core/projects/register.ts`의 kind 줄(`dk-kinds-host`가 만들었다)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음(지우기만)

## 할 일

1. `rg -n "projects/contexts" packages tests tools --glob '!packages/core/projects/contexts/**'`로 바깥에서 오는 import를 모두 찾는다. 이 task 소유 밖 file에서 오는 것이 남아 있으면 지우지 말고 보고한다(앞선 task들이 끊었어야 한다).
2. `wiring/projects.ts`에서 context 쪽을 모두 뺀다. 남는 것은 `environment`의 `projectSearch`, `build`의 ledger 읽기 연결과 `projectDirectory` 제공, `closeWork`의 연결 닫기다. 반환에서 `reads`·`writer`가 필요 없어지면 뺀다. `kindsWiring`(`wiring/kinds.ts`)은 건드리지 않는다.
3. `projects/register.ts`에서 context 등록을 뺀다. `LedgerRegistration`의 `blobFields`와 `contextsRuntime` 최상위 await가 필요 없어지는지 확인한다(`createLedgerRegistration`/`createReaderRegistration`의 나머지와 kind의 `memoryRoutes`는 남는다). `lookups.ts`·`ports.ts`에서 위 함수·type을 뺀다. `wiring/lophn-agent-registration.ts`에서 `contextAuthorityPort`와 그 구현을 뺀다(`createReaderRegistration`의 `ports`가 비면 빈 Map으로 둔다). `main/worker/main.ts`에서 `CONTEXTS_KIND`·`runContextsWorker` 줄을 뺀다(`KINDS_WORKER_KIND` 줄은 남긴다).
4. `packages/core/projects/contexts/`를 지운다. 안 쓰게 된 협력자도 지운다: ledger 표를 위한 schema step은 `contexts/ledger/schema.ts`에 있어 같이 간다. 개발 data는 새로 만든다(migration을 만들지 않는다. AGENTS.md "호환성").
5. `deno task check`가 알려 주는 남은 오류를 따라간다. 이 task 소유 밖 file이 깨지면 고치지 말고 보고한다.

## 정한 것

- 옛 ledger 표(`contexts`, `context_bundles`, `context_checks`, glossary, saved view 등)는 migration으로 지우지 않는다. schema step이 사라지면 새 ledger에는 생기지 않는다. 이미 만들어진 개발 ledger는 지우고 새로 만든다.
- 원본에서 쓸 만한 코드는 `kinds/`로 이미 옮겨졌다(`dk-kinds-worker`·`dk-kinds-host`). 더 옮기지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(지운 기능의 test는 같이 지웠다. `contexts_authority_test.ts`의 "PM만 context를 쓴다" 규칙은 `place-folders_test.ts`의 "PM만 `kinds.yaml`을 쓴다"가 대신한다).
- 남지 않음: `rg -n "projects/contexts|createContexts|ContextsHost|contextsRuntime|contextAuthority|CONTEXT_WORKER|runContextsWorker|CONTEXTS_KIND|ContextFolders|ContextAuthority|draftBundles|activeContextIds|contextProjectOf" packages tests tools`가 0줄이다(`packages/core/projects/kinds`에서 `contextsRuntime` 같은 이름을 새로 쓰지 않았다는 확인 포함).
- core 기동: `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 찍는다(옛 route와 표 없이 뜬다. 새 kind route가 `memoryRoutes`로 등록된 채 뜨는지도 이 기동이 본다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음(지우는 task다)
- 정한 것
- 넘길 줄: 소유 밖 file이 깨졌을 때 그 위치
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**

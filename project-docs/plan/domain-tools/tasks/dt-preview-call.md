# dt-preview-call

preview 대상 호출이 그 preview의 bundle에 들어 있는 tool 선언으로 판정되게 하고, "preview만 부를 수 있는 호출"(`previewOnly`)을 호출 길에 둔다. coding agent MCP endpoint(wave 3 `dt-mcp-endpoint`)가 쓸 기반이다. 지금은 preview 호출도 활성 release의 선언으로 `effect`를 찾아서(`appApiLookupOf`, `release`를 `null`로 넘긴다) 아직 release가 없는 새 앱이나 새로 더한 tool은 `not_declared`가 된다.

- 단위: domain-tools (wave 2)
- 선행: dt-invocation-project. `calls/service.ts`, `routes.ts`를 같이 고치므로 순서를 건다.
- 소유(이 task만 고친다):
  - `packages/core/apps/calls/service.ts`
  - `packages/core/apps/calls/caller.ts`
  - `packages/core/apps/calls/calls_test.ts`
  - `packages/core/apps/ports.ts`
  - `packages/core/apps/routes.ts`
  - `packages/core/apps/preview/service.ts`
  - `packages/core/apps/preview/model.ts`
  - `packages/core/apps/preview/mod.ts`
  - `packages/core/apps/releases/activation/desired.ts`
  - `packages/core/main/daemon/wiring/apps.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`("preview는 따로 띄운 process와 일회용 DB로 돈다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps`, `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 계획: `project-docs/plan/domain-tools/README.md`의 "coding agent MCP endpoint"(preview로만 간다, 없으면 `unavailable`, live는 부르지 않는다)
  - 지금 코드: `packages/core/apps/calls/service.ts`의 `call()`(`lookup.find`, 기록 분기), `packages/core/apps/preview/service.ts`의 `createPreviewService`(`live` map이 앱마다 preview 하나를 안다), `packages/core/apps/releases/activation/desired.ts`의 `readBundleCopy`·`createCopyPreviewBundles`
- 계약:
  - 쓰는 것: `ToolDeclaration`(`dt-decl`), `appCallTool` 입력(`dt-call-route`)
  - 내놓는 것:
    - `CallAuth`에 `previewOnly?: true`(`packages/core/apps/calls/caller.ts`). 호출 길의 `auth` 인자다. route 입력이 아니라 core 안 호출자만 쓴다.
    - `PreviewService`(`packages/core/apps/preview/service.ts`)에 core 안에서만 부르는 두 메서드 `current(app): Promise<Result<{ process_nonce: string; ready: boolean; bundle_hash: string; tools: readonly ToolDeclaration[] } | null>>`(그 앱의 지금 preview, 없으면 `null`)와 `declared(app, process_nonce): Promise<Result<readonly ToolDeclaration[] | null>>`(그 nonce가 앱의 지금 preview가 아니면 `null`). route 권한 검사(`gate`)를 거치지 않는다. 부르는 쪽(core 코드)이 앱을 정한다.
    - `AppApiLookup`(`ports.ts`)에 preview용 `findPreview(app, process_nonce, tool): Promise<Result<{ effect } | null>>`.

## 할 일

1. 선언을 preview에 싣는다: `PreviewBundle`(preview/service.ts)에 `tools: readonly ToolDeclaration[]`를 더하고 `createCopyPreviewBundles`·`readBundleCopy`(desired.ts)가 사본의 `blueprint.json`(이미 `validateBlueprint`로 읽는다)에서 채운다. `createPreviewService`의 `live` map 값을 `{ nonce, tools, bundle_hash }`로 바꿔 시작 때 기억하고, `current`·`declared`를 만든다. `get`·`stop`의 기존 동작(앱마다 preview 하나, nonce가 다르면 없는 것)은 그대로다. 막히는 곳이 있으면 `PreviewLaunch`(model.ts) 모양을 건드리지 않고 service 안에서 푼다.
2. `appApiLookupOf`(routes.ts)에 preview 선언을 읽는 길을 더한다: 조립(`wiring/apps.ts`)이 `PreviewService.declared`를 `findPreview`로 잇는다. live는 지금처럼 `find`다. `service.ts`는 target이 preview이면 `findPreview`로 `effect`를 찾고 없으면 `not_declared`다.
3. preview 대상 호출은 ledger를 쓰지 않는다(`service.ts`의 `begin`·`finish`·`recordOnce` 경로 전부. denied·unknown 닫기도 포함). 응답의 `invocation`은 `null`이다. 이유: preview는 일회용 DB라 rewind 대상이 아니고, release가 아직 없는 bundle은 ledger의 `release`(NOT NULL) 칸에 넣을 값이 없다. 활성 release가 있는 앱의 preview 호출이 지금은 `mode: "preview"` 행으로 남는데, 이 task부터 남지 않는다.
4. `previewOnly`: `service.ts`의 `call()`이 `auth.previewOnly`이고 target이 `live`이면 어떤 조회도 하기 전에 `forbidden`("this credential calls previews only")을 돌려준다. `previewOnly`는 `caller.kind === "person"`인 호출에만 허락한다(다른 kind는 `forbidden`). 사람 호출은 Gate를 거치지 않으므로 preview 밖으로 새면 안 되는 호출자를 이 한 줄이 막는다.
5. 위험 test 하나를 `calls_test.ts`에 더한다(아래). 기존 test는 `lookup`·`link` 가짜를 그대로 쓴다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "`previewOnly` 호출은 live target이면 앱 process에 아무것도 보내지 않고 `forbidden`이며, preview target 호출은 그 preview bundle 선언의 effect로 보내지고 ledger에 아무것도 남지 않는다" — `setup()`의 가짜 `link.sent`와 `records`로 판정한다. `write-test`: 권한 경계(운영 data를 AI가 만든 코드와 실수로부터 지킨다)다. 이 한 test 밖에 만들지 않는다.
- 남지 않음: `grep -rn "lookup.find(" packages/core/apps/calls/service.ts`에서 preview target을 `release: null`(활성 release)로 찾는 줄이 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 예상(`wiring/apps.ts` 안의 조립은 이 task가 직접 고친다)
- 안 쓰게 된 export
- 정한 것: preview 호출은 ledger를 남기지 않는다(위 3). 이 결정이 `architecture/app-call.md`의 "preview … 기록은 운영과 구분해 남긴다"와 달라지므로 lead가 문서를 고친다
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**

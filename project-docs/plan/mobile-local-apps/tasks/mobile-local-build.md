# mobile-local-build

폰에서 돌 backend를 만드는 신뢰된 core 쪽 build와 검사를 짓는다: 앱의 `main.ts`를 esbuild로 plain JS 한 file(`phone/backend.js`)과 manifest(`phone/backend.json`)로 묶고, Node 내장 import를 거절하고, 결과를 빈 context에서 실어 선언한 handler를 정확히 등록하는지 보고, 폰용 schema 규칙(정수 PK, AUTOINCREMENT, trigger 금지)을 검사하는 함수. release 준비에 거는 것은 `mobile-local-prepare`가 단계 6이 land된 뒤에 한다. 폰의 guest base와 이 검사가 같이 쓸 host prelude file도 이 task가 만든다.

- 단위: phone-backend (wave 2)
- 선행: mobile-local-sdk. 다른 계획의 land를 기다리지 않는다(새 file뿐이다. 단계 6이 소유한 `prepare/{from-source,flow}.ts`와 `ui-build/`는 고치지 않는다)
- 소유(이 task만 고친다):
  - `packages/core/apps/releases/phone-backend`(새 폴더: `build.ts`, `load-check.ts`, `main.ts`(child process 진입), test)
  - `packages/protocol/apps/phone-backend.ts`(새 file: manifest schema)
  - `packages/protocol/apps/phone-backend-host.ts`(새 file: host prelude. zod 없음)
  - `packages/protocol/apps/activation/{phone-schema,phone-schema_test}.ts`(새 file: 폰 schema 규칙의 순수 함수와 test)
  - `tests/support/app/local`(새 폴더: test가 쓰는 작은 sync 앱 fixture. text id, `newId`, operation 셋(read, write, external))
- 공유 줄 허락(한 줄만 더하고 보고의 "넘길 줄"에 적는다): `packages/protocol/apps/mod.ts`(`export * from "./phone-backend.ts"`)
- 읽을 것:
  - spike: `/home/pyosechang/projects/lophn/reports/mobile-program/local-apps-spike.md`의 "Check 1"(build 설정, bigint literal 경고, prelude가 까는 것), spike code(읽기만) `/home/pyosechang/projects/lophn-worktrees/spike-local-apps/mobile/guest/local/{build-backend.mjs,base-local.ts,app/}`
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/local-apps-survey.md` 2(b)(build와 host가 주는 것), 2(d)(release 검사), 4의 "Phone package"
  - 계획 `README.md` "정한 것"(bundle은 plain JS, bytecode는 fallback, prelude file 하나, load 검사는 child process에서)
  - 지금 준비: `packages/core/apps/releases/prepare/from-source.ts`(`runChild`와 `eval-declaration` child: 앱 code를 core process 밖 짧은 child에서 돌리는 본보기), `packages/core/apps/releases/ui-build/app-build.ts`(esbuild와 `staging-only` import guard plugin), `prepare/checks.ts`(`checkMigration`이 빈 DB를 migration으로 올리는 scratch 길), `packages/protocol/apps/activation/migration-sql.ts`(`tablesWithoutPrimaryKey`. 이 file은 cap-store 사본에 vendor되어 있어 고치지 않는다)
  - 단계 6의 화면 build(main에 아직 없다. 읽기만): `/home/pyosechang/projects/lophn/.claude/worktrees/plan-mobile-user-apps/packages/core/apps/releases/ui-build/phone/build.ts`(같은 esbuild 설정, 거절 plugin의 꼴), `ui-build/staging-guard.ts`
  - SDK: `packages/sdk/cap-store/host.ts`·`packages/sdk/cap-tool/context.ts`(`mobile-local-sdk`가 정한 `CAP_HOST.store.open`·`migrations`, `APP_TOOL_PORT`), 앱 process의 같은 일 `packages/core/apps/runtime/entrypoint/{cap-host.ts,tool-port.ts}`
- 계약:
  - 쓰는 것: SDK의 폰 entry(조건 `lophn-phone`)와 전역 symbol(`lophn.cap-host`, `lophn.cap-store`, `lophn.cap-tool`)
  - 내놓는 것:
    - bundle 배치: `phone/backend.js`(esbuild `platform: "neutral"`, `conditions: ["lophn-phone"]`, `format: "iife"`, `target: "es2015"`, minify, `define process.env.NODE_ENV="production"`, external source map `phone/backend.js.map`), `phone/backend.json`. migration file은 bundle의 `migrations/` 그대로다(backend.js에 넣지 않는다)
    - `phoneBackendManifestSchema`(strict) `{format: 1, entry: "backend.js", size, sha256, data_schema, migrations: [{from, to, file: "migrations/<from>-<to>.sql", sha256}], operations: {[name]: "read" | "write" | "external"}, sdk: {"@lophn/cap-store": x.y.z, "@lophn/cap-tool": x.y.z}}`, `PHONE_BACKEND_FORMAT = 1`, `PHONE_BACKEND_MAX_BYTES`(4 MiB)
    - `phone-backend-host.ts`: `installPhoneBackendHost(global, deps)`. deps는 `{open(): StoreDb, migrations(): {target, steps}, randomBytes(bytes: Uint8Array): void}`. 까는 것: 호출을 하나씩 돌리는 handler port(`APP_TOOL_PORT`), `CAP_HOST`(`mode: "live"`, `dataPath: ""`, `store: {recording: () => false, open, migrations}`, `post`는 늘 `{status: 503, body: {error: {code: "unavailable", message: "this needs the computer"}}}`, `call()`은 지금 호출 문맥), `crypto.getRandomValues`(없을 때만). 돌려주는 것 `{handlers(): string[], run(name, input, context): Promise<unknown>}`. 폰의 guest base(`mobile-local-runtime-phone`)와 load 검사가 같은 함수를 쓴다
    - `buildPhoneBackend(staging, declaration)`: 성공이면 쓴 file 목록과 manifest, 실패면 agent가 고칠 수 있는 영어 한 줄(어느 file의 어느 import인지). child 진입 `phone-backend/main.ts <staging>`이 build와 load 검사를 하고 결과 JSON 한 줄을 stdout에 낸다
    - `phone-schema.ts`: `phoneSchemaProblems(tables: {name, columns: {name, type, pk}[], sql}[], triggers: string[])` → 영어 문장 목록(빈 목록이면 통과). 정수 PK는 PK가 column 하나이고 그 type이 `INTEGER`인 표(rowid alias), `AUTOINCREMENT`는 표 SQL, trigger는 하나라도 있으면

## 할 일

1. `phone-backend/build.ts`: 위 설정으로 staging의 `main.ts`를 묶는다. esbuild `onResolve` plugin이 `node:*`와 Node 내장 이름(`isBuiltin`)을 "a backend that runs on the phone cannot import <name> (<importer>)"로 거절하고, `@lophn/cap-fs`·`@lophn/flow`도 같은 꼴로 거절한다(폰 entry가 없다). import guard는 `app-build.ts`의 `staging-only`와 같은 규칙을 이 폴더에 작게 둔다(단계 6이 그것을 `ui-build/staging-guard.ts`로 꺼냈다. land 뒤 `mobile-local-prepare`가 하나로 합친다). 결과가 4 MiB를 넘으면 실패한다. manifest의 `migrations`는 선언의 `data_changes`(bundle의 `migrations/`)에서, `operations`는 선언의 operation과 effect에서, `sdk`는 staging `.lophn/sdk` 사본의 판에서 채운다.
2. `phone-backend-host.ts`와 `load-check.ts`: child 안에서 `node:vm`의 빈 context(전역은 `vm`이 주는 것뿐)에 `installPhoneBackendHost`를 깔고(driver는 `:memory:`의 `node:sqlite`를 `StoreDb` 꼴로 감싼 것) `backend.js`를 평가한다. 등록된 handler 이름이 선언의 handler 이름(operation, command, 구독 handler `subscriptionHandlerName`)과 같아야 한다. 빠진 것과 남는 것을 이름으로 말한다. 평가가 던지면 그 message 첫 줄로 실패한다. 시간 상한(예: 10 s)을 둔다.
3. `phone-schema.ts`: 위 규칙. 실제 DB에서 표·column·trigger를 읽는 얇은 함수(`pragma table_info`, `sqlite_master`)는 `phone-backend/`에 두고, `checkMigration`과 같은 길로 빈 DB를 target schema까지 올린 scratch DB에서 부를 수 있게 한다(`checks.ts`는 고치지 않는다. 거는 것은 `mobile-local-prepare`).
4. fixture 앱 `tests/support/app/local`: `tests/support/app/sample`의 꼴로 작은 앱(표 하나, text PK, `newId`, read `list_items`, write `add_item`, external `send_report`, 선언에 `runs_on` 칸은 아직 없다. 이 fixture는 build와 load 검사를 보는 데만 쓴다). 
5. test: fixture로 build가 되고 manifest가 schema를 지나고 load 검사가 handler 셋을 본다. 아래 위험 test.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "폰 backend build는 Node 내장(`node:*`, `fs` 같은 이름)과 `@lophn/cap-fs`·`@lophn/flow`를 담지 않는다: 그런 import가 있으면 어느 file의 어느 import인지 말하며 실패하고, 성공한 `backend.js`에는 `require(`와 `node:`가 없다"
  - "load 검사는 선언과 등록한 handler가 다르면(빠지거나 남으면) 실패한다"
  - "폰 schema 검사는 column 하나짜리 `INTEGER` PK, `AUTOINCREMENT`, trigger를 거절하고 text PK와 여러 column PK는 통과시킨다"
- 남지 않음: 없음(새 file뿐).
- flows catalog: 이 task가 더하는 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: fixture의 `backend.js` 크기, build와 load 검사에 걸린 시간, esbuild 경고(spike는 `packages/base`의 bigint literal을 봤다)와 그 출처, `mobile-local-prepare`가 준비에 걸 때 부를 함수와 child 진입의 사용법.

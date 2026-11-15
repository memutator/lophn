# mobile-local-sdk

앱 backend가 폰에서도 실리도록 SDK 셋을 올린다: `@lophn/cap-tool` 2.2.0과 `@lophn/cap-problem` 1.1.0은 Node 전용 부분을 조건부 export(`lophn-phone`) 뒤로 옮기고, `@lophn/cap-store` 2.0.0은 `Store.db`를 SDK가 정한 `StoreDb`로 좁히고 DB를 host가 준 driver로도 열며, 인자 없는 `migrate()`와 `newId()`를 더한다. 컴퓨터 app runtime이 release의 migration을 cap-store에 건네는 길도 이 task가 짓는다. 앱 template의 pin은 고치지 않는다(lead가 중간 land 전에 고친다. 계획 README).

- 단위: sdk (wave 1)
- 선행: 없음. 다른 계획의 land를 기다리지 않는다
- 소유(이 task만 고친다):
  - `packages/sdk/cap-tool`
  - `packages/sdk/cap-problem`
  - `packages/sdk/cap-store`
  - `packages/core/agent-workspaces/skills/migrate-sdk/cap-tool-2.2.0.md`(새 file)
  - `packages/core/agent-workspaces/skills/migrate-sdk/cap-problem-1.1.0.md`(새 file)
  - `packages/core/agent-workspaces/skills/migrate-sdk/cap-store-2.0.0.md`(새 file)
  - `packages/core/apps/runtime/entrypoint/cap-host.ts`
  - `packages/core/apps/runtime/entrypoint/startup.ts`
- 공유 줄 허락(한 줄씩만 고치고 보고의 "넘길 줄"에 적는다): `packages/core/package.json`의 `@lophn/cap-problem` 판 한 줄, `package-lock.json`의 세 workspace 항목의 `version` 줄(`npm install --package-lock-only --offline`이 안 되면 손으로), project-docs/flows의 `areas/sdk.yaml`에서 바뀐 export 줄
- 읽을 것:
  - skill: `.claude/skills/sdk-note/SKILL.md`(판, 메모, `supported_from`. 2의 pin은 앱 template·sample만 빼고 따른다). 본보기 메모: `cap-tool-2.1.0.md`(minor), `declaration-4.0.0.md`(major)
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/local-apps-survey.md`의 1.1(SDK의 Node 내장), 2(b)(host가 backend에 주는 것), 2(e)(SDK 변경 표)
  - spike: `/home/pyosechang/projects/lophn-worktrees/spike-local-apps/mobile/guest/local/shims/`(spike가 Node module을 갈아 끼운 자리. 이 task가 SDK 안에서 없앤다), `base-local.ts`(폰 base가 backend에 깐 것)
  - 지금 SDK: `packages/sdk/cap-tool/{handlers.ts,context.ts,mod.ts,connect.ts,events.ts}`, `packages/sdk/cap-problem/{exception-observer.ts,mod.ts}`, `packages/sdk/cap-store/{store.ts,connection.ts,host.ts,mod.ts}`, 설치 사본 규칙 `packages/core/apps/packages/vendor.ts`(`CAP_STORE`. vendor 규칙을 늘리지 않는다: 새 code는 SDK 폴더 안 file로 둔다)
  - runtime 쪽: `packages/core/apps/runtime/entrypoint/{cap-host.ts,startup.ts,main.ts}`(`bundleDataSchema`가 bundle의 `migrations/`를 읽는다), `tool-port.ts`
  - 계획 `README.md` "정한 것"(SAVEPOINT의 이유)
- 계약:
  - 쓰는 것: 전역 `CAP_HOST`(`Symbol.for("lophn.cap-host")`), `STORE_HOOKS`(`Symbol.for("lophn.cap-store")`), `APP_TOOL_PORT`(cap-tool `context.ts`)
  - 내놓는 것:
    - 세 package의 `exports`: `{".": {"lophn-phone": "./mod.phone.ts", "default": "./mod.ts"}}`. 폰 entry는 Node 내장을 import하지 않고 Node entry와 같은 이름을 export한다(폰에서 안 되는 것은 `unavailable` `CapabilityError`나 `HandlerRejection`으로 던진다)
    - `StoreDb`(cap-store가 export): `exec(sql): void`, `prepare(sql): StoreStatement`. `StoreStatement`: `get(...params)`, `all(...params)`, `run(...params): {changes, lastInsertRowid}`. params는 `null | number | bigint | string | Uint8Array`(위치 인자만). `node:sqlite`의 `DatabaseSync`가 이 모양을 채운다
    - `CAP_HOST.store`에 더하는 칸: `open?(): StoreDb`(있으면 cap-store는 이 driver로 연다. 폰 host가 준다), `migrations?(): {target: number; steps: Migration[]}`(release의 migration 단계)
    - `STORE_HOOKS`에 더하는 칸: `database(): StoreDb | null`(이 process의 앱 DB 연결. 컴퓨터 runtime의 sync 일이 같은 연결에서 돈다)
    - `Store.migrate(steps?, options?)`: steps를 주지 않으면 host의 `migrations()`를 쓰고, host가 없으면(앱 test) 지금 폴더의 `migrations/*.sql`을 읽는다(Node entry만). live에서 schema가 target과 같으면 아무것도 하지 않는다(지금처럼)
    - `Store.transaction(work)`와 `STORE_HOOKS.applyChangesets`: SAVEPOINT로 한다(바깥에 열린 transaction이 있어도 된다. 컴퓨터 runtime이 sync 앱의 호출과 rewind 적용을 바깥 transaction 하나로 감싼다)
    - `newId(prefix?)`: 기기가 달라도 겹치지 않는 text id(시각 순으로 정렬되는 ULID 꼴. 무작위는 `crypto.getRandomValues`)
    - session은 `lophn_data_schema`와 `lophn_sync_`로 시작하는 표에 걸지 않는다

## 할 일

1. cap-tool 2.2.0: `AsyncLocalStorage`를 쓰는 `handlers.ts`의 fallback port를 Node entry 쪽 file로 옮긴다. `mod.phone.ts`는 이미 깔린 `APP_TOOL_PORT`를 쓰고, 없으면 호출 문맥을 변수 하나로 쥐는 한 번에 하나짜리 port를 깐다(폰 host가 호출을 하나씩 돌린다. 조사 2(b)). `connectCommands`, `publish`, `subscribe`는 폰 entry에서 `CAP_HOST.post`를 거쳐 `unavailable`로 끝난다(따로 막지 않아도 그렇게 되면 그대로 둔다).
2. cap-problem 1.1.0: `node:process`를 쓰는 exception observer를 Node entry로 옮긴다. 폰 entry의 `reportProblem` 등은 `CAP_HOST.post`를 거쳐 실패를 삼킨다(지금 deliver의 실패 규칙 그대로). `packages/core/package.json`의 pin 한 줄을 1.1.0으로.
3. cap-store 2.0.0: `node:path`와 `node:sqlite`를 Node entry 쪽 file로 옮기고 위 계약대로 `StoreDb`, `open`, `migrations`, `database()`, SAVEPOINT, `newId`, session 빼기를 짓는다. `migrate`가 쓰는 `crypto.subtle.digest`는 live에서 돌지 않으니(live는 migrate하지 않는다) 폰 entry에서 부르지 않게 한다. `guide.md`의 API와 예를 바꾼다(`store.db`의 type, `newId`, 인자 없는 `migrate()`, `transaction`은 겹쳐도 된다, `BEGIN`/`COMMIT`을 SQL로 직접 쓰지 않는다: 폰과 sync 앱에서는 호출 하나가 이미 transaction 안에서 돈다).
4. runtime(`cap-host.ts`, `startup.ts`): `CAP_HOST.store.migrations()`가 bundle의 `migrations/<from>-<to>.sql`을 읽어 `migrationOfSql` 단계와 target(지금 `bundleDataSchema`와 같은 값)을 준다. preview 앱이 `await store.migrate()`로 schema를 맞출 수 있다.
5. 메모 셋(`sdk-note` 3): cap-store 2.0.0은 `Breaking: yes`(Node 전용 `DatabaseSync` method와 이름 붙인 params가 type 검사를 통과하지 않는다. 옮기는 code를 Before/After로), `supported_from`은 그대로(옛 판으로 봉인한 bundle이 그대로 뜬다). cap-tool 2.2.0, cap-problem 1.1.0은 `Breaking: no`. cap-store guide가 바뀌었으니 cap-store 메모에 `## Instruction diff`를 git diff로 넣는다. cap-store·cap-tool의 guide는 이 task에서 끝낸다: 이 판들은 중간 land로 main에 나가 그 뒤에는 메모를 고칠 수 없다. 언제 폰에서 도는 앱을 고르나 같은 큰 지침은 `mobile-local-guidance`가 declaration guide와 `design-app`에 쓰고 declaration 메모에 diff를 둔다.
6. test: cap-store의 기존 `changeset_test.ts`가 통과하고, SAVEPOINT `transaction`이 바깥 transaction 안에서도 rollback·commit되는 것, session이 `lophn_sync_*` 표 변경을 changeset에 담지 않는 것, host `open()`을 준 store가 그 driver로 읽고 쓰는 것, 인자 없는 `migrate()`를 더한다. esbuild로 `@lophn/cap-store`·`@lophn/cap-tool`·`@lophn/cap-problem`을 `conditions: ["lophn-phone"]`, `platform: "neutral"`로 묶으면 `node:` import가 하나도 남지 않는 것을 test 하나로 본다.

## 끝남

- `npm run check`가 통과한다. `node tools/check-sdk-notes.ts`가 통과한다.
- 위험 test: "cap-store session은 숨은 `lophn_sync_*` 표와 `lophn_data_schema`의 변경을 changeset에 담지 않는다"(담으면 clock이 rewind와 sync로 퍼진다), "세 SDK를 폰 조건으로 묶은 결과에 `node:` import가 없다"
- 남지 않음: `grep -rn "from \"node:" packages/sdk/cap-tool packages/sdk/cap-problem packages/sdk/cap-store`의 결과가 Node entry 쪽 file뿐이다. `grep -rn "DatabaseSync" packages/sdk/cap-store`가 Node entry 쪽 file뿐이다.
- 앱 template(`packages/core/apps/packages/template`)과 `tests/support/app/sample`은 고치지 않았다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 세 package의 Node entry와 폰 entry의 file 목록, `StoreDb`·`CAP_HOST.store`·`STORE_HOOKS`의 최종 모양, lead가 중간 land 전에 고칠 template·sample pin 줄 목록(`sdk-note` 2의 grep 결과).

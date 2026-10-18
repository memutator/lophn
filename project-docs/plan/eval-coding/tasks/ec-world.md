# ec-world

캘린더 단위들이 깔고 시작하는 world의 재료 셋을 손으로 만든다: 켜진 알림 앱 `notify-app@1`(app-api `notify.schedule`), 그 앱이 낸 package `date-range@1`(`@me/date-range`), 그리고 L4-new의 산출물을 손으로 쓴 `calendar-call@1`(등록된 캘린더 앱과 App Engineer에게 간 call 본문). 데이터 file을 쓰는 일이다. 코드는 앱 source뿐이고 제품 길(ec-restore의 `restoreWorld`)로 되살려져 실제로 켜지고 package가 나가는지까지 확인한다.

- 단위: ec-world (wave 3)
- 선행: ec-restore, ec-fix-publish. 되살리기가 fake App Engineer의 `package.publish`로 `@me/date-range`를 낸다.
- 소유(이 task만 고친다):
  - `tests/eval/materials/notify-app/**`
  - `tests/eval/materials/date-range/**`
  - `tests/eval/materials/calendar-call/**`
- 읽을 것:
  - 설계: `project-docs/products/roadmap/eval.md`의 "재료", "캘린더 단위", "재사용 확인"(`notify.schedule`, `@me/date-range`를 깐다)
  - 계획: `project-docs/plan/eval-coding/README.md`의 "정한 것"(`reuse-world@1`을 재료 둘로 둔다, `calendar-call@1`은 손으로 쓴다)
  - 같은 계획의 brief: `ec-restore.md`의 "재료 file 꼴 (정본)"(`active_app`·`package`·`call`의 `files/` 꼴. 이 task가 그대로 따른다), `ec-calendar.md`(같은 "캘린더 app-api 정본"을 쓰는 쪽. 바뀌면 둘이 같이 바뀐다)
  - eval-base brief: `project-docs/plan/eval-base/tasks/ev-restore.md`("재료 넷" 5, `material.json`과 고정 id를 쓰는 방법, `contentHash`)
  - 앱 template: `packages/core/apps/packages/template/app/`(파일 목록: `blueprint.ts.tmpl`, `deno.json.tmpl`, `main.ts.tmpl`, `src/app-api.ts.tmpl`, `src/items.ts.tmpl`, `migrations/0-1.sql.tmpl`, `src/screens/items/*`, `src/wording/*`, `tests/*`, `AGENTS.md.tmpl`), scaffold: `.../template/scaffold.ts`의 `scaffoldApp`, `.../template/files.ts`의 `builtinTemplate`
  - SDK 안내(코드를 쓰기 전에 읽는다): `packages/sdk/cap-app-api/guide.md`, `packages/sdk/cap-store/guide.md`, `packages/sdk/cap-problem/guide.md`, `packages/sdk/blueprint/`
  - 본보기: `tests/support/app/patch-call.ts`(template 위에 app-api를 더하는 모양과 blueprint 선언·handler가 같아야 app test를 통과한다는 주석), `tests/support/coding/prepare-deps.ts`(`installSdkCopies`·`installBuiltinTemplate`·`scaffoldApp({ dataRoot })`로 개발용 import map을 만드는 순서)
  - 제품 규칙(app test): `packages/core/problems/tests/app-test/generate.ts`(필수 검사), `packages/core/problems/tests/harness/checks.ts`, `packages/core/problems/tests/work/app-driver.ts`의 `validValue`·`invalidValue`
- 계약:
  - 쓰는 것:
    - ec-restore의 재료 꼴(`ec-restore.md`)과 `restoreWorld(ctx, refs, root?)`, `deliverCall`, `restoreCoreEnv`. eval-base의 `tests/eval/restore/hash.ts`의 `contentHash`, `manifest.ts`의 `loadMaterial`, `verifyMaterial`.
    - `MaterialManifest`(`tests/eval/types.ts`)와 `MaterialKind`의 `active_app`·`package`·`call`(ec-contract).
  - 내놓는 것:
    - 재료 `notify-app@1`, `date-range@1`, `calendar-call@1`(아래 "할 일"의 자리). 이름과 고정 id가 곧 계약이다. `ec-calendar`와 `ec-scenarios`가 이 이름·id·app-api를 쓴다.

## 정한 것 (이 brief가 정한다. 근거는 코드다)

1. **고정 id**(ULID 26자, `idSchema("app").parse`로 확인했다):
   - 알림 앱 `app_0000000000000000000000ntfy`
   - 캘린더 앱 `app_0000000000000000000000cdr1`
   `ec-calendar`의 `calendar-app` 재료가 알림 앱의 id를 blueprint `app_connections`에 박기 때문에 두 task가 같은 값을 쓴다.
2. **재료 이름과 꼴**: `notify-app@1`(`active_app`, `needs: []`), `date-range@1`(`package`, `needs: ["notify-app@1"]`), `calendar-call@1`(`call`, `needs: ["notify-app@1", "date-range@1"]`). 셋 다 `parent: null`, `produced_by: null`. 앱 source 트리는 template을 scaffold한 결과에 손으로 고친 것을 통째로 담는다(overlay가 아니다). 이유: 재료는 source 수준으로 담고 template이 나중에 바뀌어도 같은 앱이어야 한다.
3. **app 이름과 slug**: 알림 앱은 name `알림`, slug `notify`. 캘린더 앱은 name `캘린더`, slug `calendar`. scaffold의 `title`을 name과 같게 준다(blueprint의 `name`이 된다).
4. **app test가 요구하는 것**(코드로 확인했다. 앱이 app test를 통과해야 켜진다):
   - 선언한 app-api key와 등록한 handler가 같다. 입력 schema를 어긴 입력(`"not-a-valid-value"` 문자열, 입력 없는 app-api에는 `{ unexpected: true }`)은 runtime이 handler 전에 거절한다.
   - write app-api마다 fixture 입력으로 한 번 부른다. fixture는 선언에서 가장 단순하게 만든 값이다(`validValue`): 필수 칸만, 문자열은 `"x"`를 `max(1, minLength)`번, 정수는 `minimum ?? 1`, enum은 첫 값. 이 호출은 성공해야 하고, 빈 DB에서 DB를 바꿔 changeset을 내야 하고, 뒤집어 적용하면 호출 전으로 돌아와야 한다(`rewind` 검사). 그래서 write app-api의 입력 schema는 가장 단순한 값으로도 성공하게 짠다. 날짜를 문자열로 받으면 fixture `"x"`가 거절되어 app test가 떨어진다(정수 칸에 `minimum`을 둔다).
   - 의존: bundle의 모든 import가 선언한 `sdk_dependencies`를 정확한 version으로 가리켜야 하고, `deno.json`의 `lophn-sdk:` 값과 `sdk_dependencies`가 같아야 한다(template의 `tests/blueprint_test.ts`가 본다).
   - 화면이 하나는 있어야 release 준비의 화면 build가 된다(`packages/core/apps/releases/ui-build/build.ts`: 화면이 0개면 거절). template의 `items` 화면을 앱에 맞게 바꿔 쓴다.

## 캘린더와 알림 app-api 정본 (ec-calendar.md와 같은 글)

입력 schema는 위 "정한 것" 4번 때문에 이렇게 짠다. 시각은 앱을 쓰는 사람의 지역 시각이다.

| app | key | effect | 입력 | 출력 |
|---|---|---|---|---|
| 알림 | `notify.schedule` | write | `{ title: string(1~200), at: integer(minimum 0) }` 둘 다 필수. `at`은 epoch 밀리초 | `{ id, title, at }` |
| 알림 | `notify.list` | read | 없음(`input: null`) | 행 `{ id, title, at, at_local }`, `at` 순. `at_local`은 `"YYYY-MM-DDTHH:mm"` |
| 캘린더 | `event.add` | write | `{ title: string(1~200), start: { year(2000~2100), month(1~12), day(1~31), hour(0~23), minute(0~59) } }` 모두 필수 정수 | `{ id, title, start: "YYYY-MM-DDTHH:mm", reminder: "scheduled" \| "failed" }` |
| 캘린더 | `event.list` | read | `{ range?: "all" \| "this_week" \| "next_week" }` (enum의 첫 값이 `all`) | 행 `{ id, title, start }`, `start` 빠른 순 |
| 캘린더 | `event.remove` | write | `{ id: integer(minimum 1) }` | `{ id, removed: boolean }` |

- 이 task가 쓰는 앱은 알림 앱이다. 캘린더 쪽 표는 `calendar-call@1`의 본문이 옮기는 것이다.
- 문제 보고 이름(`reportProblem`)은 캘린더 앱 몫이다(`ec-calendar.md`). 알림 앱은 `store_unavailable`(template의 `withStore`), `reminder_input_invalid`만 쓴다.

## 할 일

근거: `project-docs/products/roadmap/eval.md`의 "재료"·"재사용 확인", `tests/support/app/patch-*.ts`.

1. **`@me/date-range` package의 source**를 먼저 쓴다. 알림 앱 source 안의 폴더 `src/date-range/`에 둔다(낸 앱의 폴더다). import 없는 TypeScript 한 file `mod.ts`다(설치되는 사본에는 이 폴더의 file만 든다. 그래서 `@lophn/*`도 앱 내부 file도 import하지 않는다). export 정본:
   ```ts
   export type DateParts = { year: number; month: number; day: number; hour: number; minute: number };
   // 실제 있는 지역 시각이면 Date, 아니면 null(2월 30일, 24시 등). new Date(y, m-1, d, h, mi)로 만든 뒤 getter 값이 입력과 같은지 본다.
   export function toDate(parts: DateParts): Date | null;
   // 지역 시각 "YYYY-MM-DDTHH:mm".
   export function formatLocal(date: Date): string;
   // now가 든 주(월요일 00:00 지역 시각에서 시작)에서 offsetWeeks주 뒤의 주. from 포함, to 미포함(다음 월요일 00:00). 날짜 칸을 바꿔 새 Date를 만든다(밀리초를 더하지 않는다. DST 때문이다).
   export function weekRange(now: Date, offsetWeeks: number): { from: Date; to: Date };
   ```
   - 앱 안 `tests/date_range_test.ts`를 만든다(아래 5번에서 앱 test에 같이 돈다): `toDate`가 2월 30일에 null, `weekRange(수요일, 0)`이 그 주 월요일 00:00 ~ 다음 월요일 00:00, `weekRange(일요일, 1)`이 다음 주 월요일부터.
2. **알림 앱 source**를 만든다. 임시 script(scratchpad, commit하지 않는다)로 template을 scaffold한다: `installSdkCopies`·`installBuiltinTemplate`·`builtinTemplate`·`scaffoldApp({ files, dir, app: "notify", title: "알림", dataRoot })`(`tests/support/coding/prepare-deps.ts`와 같은 순서. `dataRoot`를 주면 개발용 import map이 `.lophn/`(ignore)에 생겨 앱 안 `deno task check`·`test`를 돌릴 수 있다). 그 위에서 고친다:
   - `migrations/0-1.sql`: 아직 공개 전이니 첫 단계를 고쳐 쓴다. 표 `reminder(id integer primary key, title text not null check (length(title) between 1 and 200), at integer not null check (at >= 0), created_at text not null)`와 `at` 순 index. 모든 표에 primary key를 둔다(rewind가 필요로 한다).
   - `blueprint.ts`: 화면 `reminders`(path `/screens/reminders/index.html`, sizes는 template 그대로), app-api 둘(위 표. `project_scope: false`, `label`·`description`은 en catalog 문구), `app_connections: []`, `sdk_dependencies`는 template 기본 7개 그대로. `notify.schedule`은 DB에 쓰므로 `write`다. 앱이 부르는 경우 Gate는 부르는 앱의 `app.call` grant로만 판정한다(`packages/core/approvals/gate/gate.ts`의 `app_api`). 그 grant는 캘린더 앱의 activation 허락이 준다. agent가 부르는 경우 write의 기본은 묻지 않음이다(`DEFAULT_ASK`).
   - `src/items.ts` → `src/reminders.ts`(스키마 단계, `ensureSchema`, `addReminder`, `listReminders`), `src/app-api.ts`(template의 `withStore`·`Deps`를 그대로 두고 handler 둘). `notify.schedule`은 `new Date(at)`이 유효하지 않으면 `reportProblem("reminder_input_invalid", …)` 뒤 `AppApiRejection("invalid_input", …)`. 읽기 결과는 `readResult(rows, { coverage: "complete", freshness: "fresh" })`. `notify.list`의 `at_local`은 `./date-range/mod.ts`의 `formatLocal`로 만든다(낸 package를 낸 앱도 쓴다).
   - 화면: `src/screens/items/` → `src/screens/reminders/`로 옮기고 `bridge.ts`는 `notify.list`를 읽는 목록만, `app.tsx`는 목록과 `ReadState`만(입력 form 없음). `src/wording/en.ts`를 새 key로 고치고 `deno task wording`으로 `placeholders.ts`를 생성한다. 고정 글을 화면에 직접 쓰지 않는다(template의 `tests/wording_test.ts`가 본다).
   - 앱 안 `tests/`: `blueprint_test.ts`는 그대로. `items_test.ts`·`fixtures/items.json`을 `reminders_test.ts`로 바꾼다(`notify.schedule`이 row를 넣고 `notify.list`가 `at` 순으로 돌려준다, 유효하지 않은 `at`을 거절한다). `wording_test.ts`는 template이 `items.*` key를 박아 둔 곳(`items.label.count`, `items.title.screen`, `blueprint.app_api[0].label` 같은 것)만 새 key로 맞춘다.
   - `AGENTS.md`, `CLAUDE.md`, `scripts/`, `deno.lock` 등 template의 나머지 file은 그대로 둔다.
   - 개발용 import map이 있는 앱 폴더에서 `deno task check`와 `deno task test`가 통과해야 한다(npm·jsr 의존은 `DENO_DIR=<repo>/.dev-data/e2e/deno-dir`을 주고 `--cached-only`로. 그 폴더가 비어 있으면 `deno task e2e:deps`가 먼저다).
3. **material 폴더를 쓴다.** 폴더 `tests/eval/materials/<이름>/1/`:
   - `notify-app/1/`: `material.json` = `{ "kind": "active_app", "ids": { "알림": "app_0000000000000000000000ntfy" }, "needs": [], "parent": null, "produced_by": null, "content_hash": "…" }`. `files/app.json` = `{ "slug": "notify", "name": "알림", "description": "다른 앱이 부를 수 있는 일정 알림 예약 앱" }`. `files/source/**` = 위 앱 source 트리에서 `.lophn/`, `.git/`, `dist/`, `node_modules/`를 뺀 모든 file(`.gitignore` 포함). **file마다 이름 뒤에 `.tmpl`을 붙인다**(`blueprint.ts.tmpl`, `src/app-api.ts.tmpl`, `deno.json.tmpl`, `.gitignore.tmpl`). 이유는 `ec-restore.md`의 "재료 file 꼴" 아래 설명(`deno task check`가 재료 폴더의 `.ts`·`deno.json`을 탐색에 넣는다)이다.
   - `date-range/1/`: `kind: "package"`, `ids: {}`, `needs: ["notify-app@1"]`. `files/publish.json` = `{ "app": "알림", "name": "@me/date-range", "version": "1.0.0", "description": "<한 줄. 지역 시각의 주 범위와 날짜 칸 검사 도우미>", "path": "src/date-range", "permissions": [], "exports": ["toDate", "formatLocal", "weekRange"], "guide": { "purpose": "…", "api": "…", "examples": "…" } }`. `exports`는 되살리기가 읽지 않는 설명 칸이다(값 export 이름, type 제외). 재사용 check와 시나리오(`ec-checks`, `ec-scenarios`)가 "package가 내놓는 이름"으로 읽는다. `guide`의 세 글은 한국어로, 모두 비어 있지 않다. `api`는 위 export 넷의 서명과 뜻, `examples`는 `weekRange`로 이번 주 일정을 거르는 코드 조각이다. 앱 source의 `src/date-range/`가 이 package의 낸 폴더이므로 package 재료에는 code가 없다.
   - `calendar-call/1/`: `kind: "call"`, `ids: { "캘린더": "app_0000000000000000000000cdr1" }`, `needs: ["notify-app@1", "date-range@1"]`. `files/app.json` = `{ "slug": "calendar", "name": "캘린더", "description": "일정을 넣고 보고 지우고, 일정 전에 알림을 받는 캘린더 앱" }`. `files/call.json` = `{ "to": { "role": "app_engineer", "place": { "app": "캘린더" } }, "reply": "none", "body": "…" }`.
   - `calendar-call`의 `body`(한국어. lophn이 사람의 "캘린더 앱 만들어 줘(event.add, event.list, event.remove, 일정 알림)"를 받아 App Engineer에게 보내는 call의 본문이다). 요구는 옮기되 구현 방법(알림 앱이나 package를 쓰라는 말)은 쓰지 않는다. 이유: 재사용 확인은 App Engineer가 스스로 찾는지를 본다. 알림이 10분 전인지, 목록의 한 주가 월~일인지는 쓰지 않는다. 사람 역할의 요구 카드가 `ask`에 답하는 몫이다.
     ```
     캘린더 앱을 만들어 주세요.

     사람이 원하는 것: 일정을 넣고, 목록으로 보고, 지우고, 일정 전에 알림을 받는 것입니다.

     app-api (아래 key와 입력·출력으로 만들어 주세요. 시각은 앱을 쓰는 사람의 지역 시각입니다):
     - event.add (쓰기). 입력 { title: 문자열, start: { year, month, day, hour, minute } } 다섯 칸은 모두 정수입니다. 출력 { id, title, start } 이고 start는 "YYYY-MM-DDTHH:mm" 문자열입니다.
     - event.list (읽기). 입력 { range?: "this_week" | "next_week" | "all" }, 주지 않으면 all입니다. 출력은 { id, title, start } 행의 목록이고 start가 빠른 순입니다.
     - event.remove (쓰기). 입력 { id: 정수 }. 출력 { id, removed: true 또는 false }.

     일정 전에 알림도 받고 싶습니다.
     ```
     (본문은 이 글 그대로 `body`에 넣는다. 줄바꿈은 `\n`이다. 정확한 글을 바꾸면 `ec-scenarios`의 L4-new 사람 말과 어긋나므로 바꾸지 않는다.)
   - 세 `material.json`의 `content_hash`는 `files/`를 다 쓴 뒤 `contentHash`로 잰다(임시 script로 재서 채운다). 모든 data file은 `JSON.stringify(value, null, 2) + "\n"`로 쓴다. 앱 source file은 scaffold가 낸 byte 그대로 둔다(고친 것만 달라진다).
4. **되살려서 확인한다**(임시 script, commit하지 않는다. fake provider만 쓴다. `deno task e2e:deps`가 돌아 있어야 한다):
   1. `createRun` → `bootCore(run, { env: await restoreCoreEnv(refs) })` → `beginRestore` → `restoreWorld(ctx, ["notify-app@1", "date-range@1", "calendar-call@1"])` → `endRestore`.
   2. 알림 앱: `appRuntime`이 running·ready. `appCallApi`(사람 자격)로 `notify.schedule { title: "t", at: 1000 }`이 `succeeded`, `notify.list`에 그 행이 있고 `at_local`이 있다. 입력 `{ title: "t", at: -1 }`은 runtime이 거절한다.
   3. package: `packagesVersions({ name: "@me/date-range" })`에 `1.0.0`이 있고 `<core.run.home>/sdk/@me/date-range/1.0.0/mod.ts`가 있다.
   4. call: `deliverCall(ctx, "calendar-call@1")`이 `ok`이고 `callRead`가 받는 쪽 App Engineer(캘린더 앱의 것)의 `accepted`(그쪽 turn은 model이 없어 `model_required`로 닫힌다. 정상)이며 그 session에 본문이 그대로 있다.
   5. 걸린 시간을 보고에 적는다(알림 앱 하나를 켜는 데 release 준비와 app test가 든다).

## 제품 빈틈 (이 task는 제품 코드를 고치지 않는다)

- **app test의 의존 검사가 `@me` package를 쓰는 앱을 거절한다.** `packages/core/problems/tests/app-test/generate.ts`의 `checkDependencies`는 bundle import map 값 `./sdk/…`를 `SDK_COPY = /^\.\/sdk\/([^/]+)\/([^/]+)\//`로 푼다. 내장 SDK는 `./sdk/<part>/<version>/`라 맞지만 `@me` package는 설치 사본 경로가 `./sdk/@me/<part>/<version>/`(`packageInstallPath`)라서 `copy[1]`이 `@me`, `copy[2]`가 part가 되어, 선언한 의존과 이름·version이 맞지 않아 `undeclared`(= `선언하지 않은 의존을 import한다`)로 떨어진다. 확인한 입력: 의존 `{ name: "@me/date-range", version: "1.0.0", source: "package" }`와 import `./sdk/@me/date-range/1.0.0/mod.ts`(`dependenciesHash`로 맞춘 frozen hash)를 `generateAppTestChecks`에 주면 `dependencies` 검사가 `fail`이다. 고치는 방향은 정규식이 `@me/`를 받는 것이다(`/^\.\/sdk\/(?:@me\/)?([^/]+)\/([^/]+)\//`). 이 task의 앱(알림 앱)은 `@me` package를 import하지 않으므로 영향이 없다. 영향을 받는 것은 `@me/date-range`를 쓰는 캘린더 앱(`ec-calendar`)이다. 이 빈틈이 main에 고쳐지기 전에는 `calendar-app@1`이 켜지지 않는다. 고치는 일은 이 계획 밖의 별도 제품 수정이다(계획 `found-bugs`가 이 wave 전에 main에 넣는다). 이 task는 영향이 없으므로 들어갔는지 확인만 하고, 들어가지 않았으면 보고에 적는다.
- 그 밖에 `package.publish`를 제품 길로 끝까지 지나는 test가 없다(roadmap "제품 빈틈"). ec-restore의 package 되살리기가 처음이다. 막히는 곳(Gate가 묻는지, source commit에 `path`가 없는지)이 있으면 그대로 보고한다.

## 끝남

- `deno task check`가 통과한다(JSON data file은 `fmt.exclude`에 든다. 앱 source file은 `.tmpl`이라 lint·type check·test 탐색에 걸리지 않는다. `git ls-files tests/eval/materials | grep -E '\.(ts|tsx|json)$'`가 `material.json`과 data file 말고는 비어 있다).
- 위험 test: 없음 (이 task는 데이터다. 재료의 hash·고정 id·`needs`는 ec-restore의 `materials_test.ts`가 `deno task check`에서 본다.)
- 위 4번의 확인 다섯 가지가 모두 된다.
- 주석에 task id를 쓰지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`deno.json`의 `fmt.exclude`에 `tests/eval/materials/`는 lead가 이미 넣었는지 확인만 한다)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것(`date-range` export의 세부, 알림 앱의 열 이름, 화면 모양)
- 넘길 줄: 없음
- 계약 바꾸기 요청: `ec-restore.md`의 재료 file 꼴과 다른 곳이 있으면 여기 적는다. `calendar-call` 본문이 `ec-calendar`의 app-api 정본과 어긋나면 적는다.
- 제품 빈틈: 위 두 가지를 실제로 확인한 결과(본 그대로)
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 알림 앱의 `notify.schedule`은 알림을 저장만 하고 시각이 되어 알려 주지 않는다(reuse 확인에 쓰는 app-api라서 저장과 `notify.list`만 있다).

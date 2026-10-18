# ec-calendar

뒤 캘린더 단위들(calendar-api, calendar-maintain, calendar-diagnose)이 고정 전제로 깔고 시작하는 재료 셋을 손으로 만든다: 요구 카드대로 만든 기준 캘린더 앱 `calendar-app@1`(켜진 앱), 거기에 bug 하나를 얹은 `calendar-app-bug@1`, 일정 data `calendar-data@1`(쓰기 app-api 호출 목록). 앱 source를 쓰는 일이고, 제품 길(ec-restore의 `restoreWorld`)로 되살려 실제로 켜지고 app-api가 기대대로 답하는지까지 확인한다.

- 단위: ec-calendar (wave 3)
- 선행: ec-restore, ec-world. 이 앱이 알림 앱 `notify-app@1`의 id와 app-api, package `date-range@1`(`@me/date-range`)에 기대고, 되살려 확인하려면 두 재료가 있어야 한다.
- 소유(이 task만 고친다):
  - `tests/eval/materials/calendar-app/**`
  - `tests/eval/materials/calendar-app-bug/**`
  - `tests/eval/materials/calendar-data/**`
- 읽을 것:
  - 설계: `project-docs/products/roadmap/eval.md`의 "캘린더 단위", "요구 카드", "재사용 확인", "observation 확인", "진단 확인"
  - 계획: `project-docs/plan/eval-coding/README.md`의 "정한 것"(`calendar-app@1`은 손으로 쓴 기준 앱, bug는 재료 `calendar-app-bug@1`, 일정 data는 `calendar-data@1`)
  - 같은 계획의 brief: `ec-world.md`(앱 source를 scaffold해 손보는 순서, "정한 것", "캘린더와 알림 app-api 정본", 제품 빈틈. 이 brief가 같은 글을 쓴다), `ec-restore.md`의 "재료 file 꼴 (정본)"
  - eval-base brief: `project-docs/plan/eval-base/tasks/ev-restore.md`와 landed된 `tests/eval/restore/hash.ts`의 `contentHash`, `manifest.ts`(`material.json` 꼴)
  - 앱 template과 SDK: `packages/core/apps/packages/template/app/`, `packages/sdk/cap-app-api/guide.md`(`connectAppApi`, `readResult`, `AppApiRejection`), `packages/sdk/cap-problem/guide.md`(이름으로 묶기), `packages/sdk/cap-store/guide.md`
  - 본보기: `tests/support/app/patch-report.ts`·`patch-reaction.ts`(template 위에 app-api를 더하고 bug를 심는 모양), `tests/e2e/reaction_test.ts`(`appCallApi`로 problem을 터뜨리는 길)
  - 제품 규칙: `project-docs/architecture/app-call.md`(앱끼리의 호출은 core를 지나고 Gate는 `app.call` grant로 판정한다), `packages/protocol/apps/blueprint/uses.ts`(`app_connections`의 `app`은 앱 id, `app_api`는 정확한 key, `reason` 필수), `packages/core/apps/permissions/effective.ts`(`app.call` grant는 activation 허락이 주고 대상 앱이 live이며 그 app-api가 있을 때만 된다)
- 계약:
  - 쓰는 것:
    - `ec-world`의 재료: `notify-app@1`(고정 id `app_0000000000000000000000ntfy`, app-api `notify.schedule`·`notify.list`), `date-range@1`(`@me/date-range` 1.0.0: `toDate`, `formatLocal`, `weekRange`, `DateParts`).
    - ec-restore의 재료 꼴(`active_app`·`app_data`)과 `restoreWorld(ctx, refs, root?)`, `restoreCoreEnv`.
  - 내놓는 것:
    - 재료 `calendar-app@1`, `calendar-app-bug@1`, `calendar-data@1`. 고정 id(캘린더 앱 `app_0000000000000000000000cdr1`)와 app-api(아래 정본)가 곧 계약이다. `ec-checks`와 `ec-scenarios`가 이 key·입력·출력·문제 이름을 쓴다.

## 캘린더와 알림 app-api 정본 (ec-world.md와 같은 글)

시각은 앱을 쓰는 사람의 지역 시각이다. 입력 schema는 app test의 fixture(필수 칸만, 문자열 `"x"`, 정수는 `minimum`, enum은 첫 값)로도 write가 성공해야 하는 규칙 때문에 이렇게 짠다(`ec-world.md`의 "정한 것" 4번).

| app | key | effect | 입력 | 출력 |
|---|---|---|---|---|
| 알림 | `notify.schedule` | write | `{ title: string(1~200), at: integer(minimum 0) }` 필수. `at`은 epoch 밀리초 | `{ id, title, at }` |
| 알림 | `notify.list` | read | 없음 | 행 `{ id, title, at, at_local }`, `at` 순 |
| 캘린더 | `event.add` | write | `{ title: string(1~200), start: { year(2000~2100), month(1~12), day(1~31), hour(0~23), minute(0~59) } }` 모두 필수 정수 | `{ id, title, start: "YYYY-MM-DDTHH:mm", reminder: "scheduled" \| "failed" }` |
| 캘린더 | `event.list` | read | `{ range?: "all" \| "this_week" \| "next_week" }` (enum의 첫 값이 `all`) | 행 `{ id, title, start }`, `start` 빠른 순 |
| 캘린더 | `event.remove` | write | `{ id: integer(minimum 1) }` | `{ id, removed: boolean }` |

## 정한 것 (이 brief가 정한다. 근거는 코드다)

1. **이름과 id**: 캘린더 앱 name `캘린더`, slug `calendar`, 고정 id `app_0000000000000000000000cdr1`(`ec-world`의 `calendar-call@1`과 같다. 진짜 run이 `calendar-call@1`에서 낸 앱이 `calendar-app@2`가 되므로 id가 같아야 한다). 재료 셋: `calendar-app@1`(`active_app`, `ids: {"캘린더": …cdr1}`, `needs: ["notify-app@1", "date-range@1"]`, `parent: null`, `produced_by: null`), `calendar-app-bug@1`(`active_app`, 같은 `ids`·`needs`, `parent: "calendar-app@1"`, `produced_by: null`), `calendar-data@1`(`app_data`, `ids: {}`, `needs: ["calendar-app@1"]`, `parent: null`, `produced_by: null`).
2. **요구 카드를 이렇게 옮긴다**: 일정 추가·목록·삭제(`event.add`·`event.list`·`event.remove`), 알림은 일정 시작 **10분 전**에 알림 앱의 `notify.schedule`로 예약한다(`at = 시작 epoch ms − 10 × 60 × 1000`), 목록은 이번 주·다음 주로 거른다(`range`, 월요일 00:00 ~ 다음 월요일 00:00), 반복은 없다.
3. **재사용**(check가 program으로 본다):
   - `blueprint.ts`의 `sdk_dependencies`에 template 기본 7개와 `{ name: "@me/date-range", version: "1.0.0" }`, `deno.json`의 imports에 `"@me/date-range": "lophn-sdk:@me/date-range@1.0.0/mod.ts"`(`@luca/…`와 `@radix-ui/…` 사이, 알파벳 순).
   - `app_connections`에 `{ app: "app_0000000000000000000000ntfy", app_api: ["notify.schedule"], reason: "<비지 않은 한 줄>" }`.
   - source가 둘을 실제로 쓴다: `import { formatLocal, toDate, weekRange } from "@me/date-range"`, `connectAppApi("app_0000000000000000000000ntfy", ["notify.schedule"])`. 앱 `src/`에 `toDate`·`formatLocal`·`weekRange`·`DateParts`와 같은 이름의 정의를 새로 만들지 않는다.
4. **문제 보고(observation)**: 실패 분기는 조용히 넘어가지 않고 `reportProblem(name, message, details?)`로 보고한다. 이름은 원인마다 달라야 하고 id·시각 같은 바뀌는 값을 넣지 않는다(바뀌는 값은 `details`).

   | 원인 | name | 그다음 |
   |---|---|---|
   | 잘못된 시각(`toDate`가 null: 2월 30일 등) | `event_input_invalid` | `AppApiRejection("invalid_input", …)` |
   | 저장소를 못 엶, 또는 DB 질의가 실패함(표가 없어지는 등) | `store_unavailable` | `AppApiRejection("unavailable", …)` |
   | 알림 앱 호출 실패(`call`이 `ok: false`이거나 `outcome.status`가 `succeeded`가 아님) | `notify_call_failed` | 일정은 저장하고 응답의 `reminder`를 `"failed"`로 한다 |

   `details`는 `{ api: "event.add" }`처럼 입력·DB 내용 없이 쓴다. 잡히지 않은 예외는 runtime이 저절로 보고하므로 `createExceptionObserver`는 쓰지 않는다. `store_unavailable`은 template의 `withStore`(열기와 `ensureSchema` 실패)에 더해 `work(store)`가 던지는 DB 오류도 잡아 같은 이름으로 보고하게 `withStore`를 넓힌다. 이유: `ec-checks`의 `observe-store`가 앱 DB의 표 이름을 바꿔 질의만 실패시키는데, template 그대로면 이 실패는 이름 없는 예외(runtime이 자동 보고)가 되어 "실패한 분기가 `reportProblem`으로 이름을 단다"를 못 잰다. 대신 DB를 건드리지 않는 계산(`toDate`, `rangeBounds`)은 `withStore` 밖에서 한다. 그래야 7번의 bug가 `store_unavailable`로 삼켜지지 않고 처리되지 않는 예외로 남는다.
5. **`event.remove`는 지운 기록을 남긴다.** 표 `event_removal(id integer primary key, event_id integer not null, title text, removed_at text not null)`에 호출마다 한 줄을 넣고, 같은 `event_id` 행이 있으면 `event`에서 지운다. `removed`는 지운 행이 있었나다. 없는 id를 지워도 오류가 아니다(`removed: false`, problem 없음). 이유(코드로 확인): app test의 `rewind` 검사는 write app-api마다 **빈 DB에서** fixture 입력으로 한 번 불러 DB가 실제로 바뀌고 changeset이 나와야 통과한다(`harness/checks.ts`의 `rewind`, `work/app-driver.ts`의 `rewind`). 빈 DB에서 `event.remove { id: 1 }`이 아무것도 안 바꾸면 "호출이 changeset을 내지 않았다"로 떨어진다. 지운 기록 표는 이 검사를 통과하는 가장 작은 방법이고, 삭제 이력이 남는 앱 동작이라 부자연스럽지 않다.
6. **화면은 하나(`events`)**: 이번 주·다음 주·전체 단추, 일정 목록(각 줄에 삭제), 새 일정 입력(제목과 `datetime-local` 입력 하나를 `start` 다섯 칸으로 나눠 `event.add`로 보낸다). 화면이 반드시 하나 있어야 release 준비의 화면 build가 된다. 화면 문구는 모두 en catalog key다.
7. **`calendar-app-bug@1`의 bug는 한 곳, 호출 하나로 터진다**: `event.list { range: "next_week" }`가 처리되지 않는 `TypeError`를 던진다. `src/events.ts`의 `RANGE_RULES`(주 범위 규칙 표)에서 `next_week` 줄을 빼고, 표의 type을 `Record<string, { offset: number }>`로 넓혀 type check가 통과하게 둔다. `rangeBounds`는 `RANGE_RULES[range].offset`을 읽는다(없는 키는 `undefined.offset`으로 던진다). 이유: 호출로 터지고, runtime이 handler가 던진 `Error`를 저절로 problem으로 보고하며(`apps/runtime/entrypoint/invoke.ts`의 `reportCaught`), 원인이 한 파일 한 곳이라 진단이 가려진다. 이 bug는 app test를 통과한다(`event.list`는 read라 fixture로 불리지 않고, 잘못된 입력은 handler 전에 schema가 거절한다).
8. **일정 data의 시각은 먼 미래로 고정한다**: 이번 주·다음 주 필터에 걸리지 않게 해 오늘이 언제든 `range: "all"`로 같은 결과가 나온다. 세 건: `팀 회의` 2099-03-02 10:00, `점심 약속` 2099-03-04 12:00, `독서 모임` 2099-03-06 19:00(`year`는 최대 2100이라 들어간다).

## 할 일

근거: `project-docs/products/roadmap/eval.md`의 "재료"·"캘린더 단위"·"재사용 확인", `tests/support/app/patch-*.ts`.

1. **캘린더 앱 source를 만든다.** `ec-world.md` "할 일" 2번과 같은 방식으로 임시 script(scratchpad, commit하지 않는다)가 template을 scaffold한다(`app: "calendar"`, `title: "캘린더"`, `dataRoot` 지정). 그 위에서 고친다.
   - 앱 안 개발 확인용으로 `@me/date-range`의 설치 사본이 있어야 한다. `ec-world`의 `notify-app@1` 재료 `files/source/src/date-range/*.tmpl`의 `.tmpl`을 뗀 file들을 임시 `dataRoot`의 `sdk/@me/date-range/1.0.0/`에 먼저 놓은 뒤 scaffold하거나 개발용 import map(`devImportMap`)을 다시 만든다(import map은 파생물이라 늘 다시 쓴다).
   - `migrations/0-1.sql`(첫 단계를 고쳐 쓴다): 표 `event(id integer primary key, title text not null check (length(title) between 1 and 200), start_at text not null, created_at text not null)`, index `event_start (start_at, id)`, 표 `event_removal`(위 5번). `start_at`은 지역 시각 `"YYYY-MM-DDTHH:mm"` 문자열이다(사전순이 시각순이고 주 범위 비교가 문자열 비교로 된다).
   - `blueprint.ts`: 위 3번, app-api 셋(정본 표. 입력 schema의 칸마다 `description`을 비우지 않는다. 검사가 비면 거절한다), 화면 `events`(path `/screens/events/index.html`). `project_scope: false`. `permissions: []`.
   - `deno.json`: 위 3번의 import 한 줄.
   - `src/items.ts` → `src/events.ts`: 스키마 단계와 `ensureSchema`(template 그대로), `EventRange`, `RANGE_RULES`, `rangeBounds`(위 7번), `addEvent`, `listEvents`, `removeEvent`.
   - `src/notify.ts`(새로 만든다): `NOTIFY_APP`, `REMINDER_MINUTES = 10`, `scheduleReminder(client, title, start: Date): Promise<"scheduled" | "failed">`. client는 `Pick<AppApiClient, "call">`이라 test가 가짜를 끼운다. 실패 갈래마다 위 4번 `notify_call_failed`를 보고한다.
   - `src/app-api.ts`: template의 `withStore`·`Deps`를 그대로 두고 `Deps`에 `notify`(client)를 더한다. 기본값은 `connectAppApi(NOTIFY_APP, ["notify.schedule"])`. handler 셋. 입력의 `start`는 `toDate(start)`로 확인한다. 응답 모양은 정본 표 그대로다. `event.list`는 `readResult`.
   - `src/screens/items/` → `src/screens/events/`, `bridge.ts`의 세 호출(`event.list`·`event.add`·`event.remove`)과 `app.tsx`, `src/wording/en.ts`(새 key)와 `deno task wording`으로 만든 `placeholders.ts`.
   - 앱 안 `tests/`: `blueprint_test.ts` 그대로. `items_test.ts`·`fixtures/items.json`을 `events_test.ts`로 바꾼다. 최소한 이것을 본다: ① `event.add`가 일정을 넣고 `notify`로 `시작 − 10분`의 `at`을 보낸다 ② 알림 호출이 실패하면 일정은 남고 `reminder: "failed"`다(`notify_call_failed` 보고가 났다) ③ 없는 시각(2월 30일)은 거절되고 `event_input_invalid`가 보고된다 ④ `range`가 이번 주·다음 주·전체를 가른다(주 경계는 월요일 00:00) ⑤ `event.remove`가 지우고 기록을 남기며 없는 id도 오류가 아니다. `wording_test.ts`는 `items.*` key를 박아 둔 곳만 새 key로 맞춘다. 보고를 가로채려면 `@lophn/cap-problem`의 `installProblemReporter`(단위 test용 전송 대신 쌓는 reporter)를 쓰는 것을 먼저 읽고 정한다.
   - 개발용 import map이 있는 폴더에서 `deno task check`와 `deno task test`가 통과해야 한다(`DENO_DIR=<repo>/.dev-data/e2e/deno-dir`, `--cached-only`).
2. **material 폴더를 쓴다.** 폴더 `tests/eval/materials/<이름>/1/`:
   - `calendar-app/1/`: `files/app.json` = `{ "slug": "calendar", "name": "캘린더", "description": "일정을 넣고 보고 지우고, 일정 전에 알림을 받는 캘린더 앱" }`(`ec-world`의 `calendar-call@1`의 `app.json`과 같다), `files/source/**` = 위 source에서 `.lophn/`, `.git/`, `dist/`, `node_modules/`를 뺀 모든 file. **file마다 이름 뒤에 `.tmpl`을 붙인다**(`ec-restore.md`의 "재료 file 꼴").
   - `calendar-app-bug/1/`: `files/app.json`과 `files/source/**`는 `calendar-app/1`의 것을 복사하고 `src/events.ts.tmpl`만 위 7번대로 고친다. 두 source 트리의 차이는 그 한 file뿐이어야 한다(`diff -r`로 확인해 보고에 붙인다). 추가로 `files/bug.json` = `{ "api": "event.list", "input": { "range": "next_week" }, "expect_after_fix": { "rows": [] }, "files": ["src/events.ts"], "description": "<영어 두세 문장. 증상(다음 주 일정을 보려 하면 event.list가 오류로 끝나고 problem이 열린다)과 진짜 원인(RANGE_RULES에 next_week가 없어 rangeBounds가 undefined.offset을 읽는다)을 함께 쓴다>" }`. 칸은 이 다섯이 전부이고 기계가 읽는다: `api`·`input`은 bug를 터뜨리는 `callApi`의 인자, `expect_after_fix`는 고친 뒤 같은 호출의 실제 답(이 재료의 world에는 일정이 없으므로 `{ "rows": [] }`. `event.list`의 `readResult` 결과에서 `rows`만 본다), `files`는 bug가 있는 앱 source 안 path, `description`은 진단 judge의 입력이다. ec-scenarios가 그대로 옮겨 쓴다. 되살리기는 이 file을 읽지 않는다.
   - `calendar-data/1/`: `files/calls.json` = 위 8번의 `event.add` 세 건(`{ "app": "캘린더", "api": "event.add", "input": { "title": "팀 회의", "start": { "year": 2099, "month": 3, "day": 2, "hour": 10, "minute": 0 } } }` 꼴).
   - 세 `material.json`의 `content_hash`는 `files/`를 다 쓴 뒤 `contentHash`로 잰다(임시 script). 모든 data file은 `JSON.stringify(value, null, 2) + "\n"`.
3. **되살려서 확인한다**(임시 script, commit하지 않는다. fake provider만. `deno task e2e:deps`가 돌아 있어야 한다):
   1. `restoreWorld(ctx, ["calendar-app@1", "calendar-data@1"])` (`notify-app@1`, `date-range@1`이 `needs`로 먼저 되살려진다). 걸린 시간을 보고에 적는다.
   2. `appCallApi`(사람 자격): `event.list {}`가 세 건을 시각순으로 돌려준다. 이번 주 수요일 10:00에 `event.add`를 하면 `reminder: "scheduled"`이고 알림 앱의 `notify.list`에 `시작 − 10분`의 행이 있다(알림 앱도 `appCallApi`로 읽는다). `range: "this_week"`는 그 일정을, `range: "next_week"`는 다음 주 일정만 돌려준다. 2월 30일은 거절되고 `problemList({ app })`에 `event_input_invalid` problem이 열린다. `event.remove`는 처음에 `removed: true`, 다시 부르면 `false`.
   3. 알림 앱 호출 실패 분기: 알림 앱의 실행을 멈춘 채(`appDisableExecution`, `packages/protocol/apps/registry.ts`. `compare: { base_revision }`는 `appGet`의 `revision`. 끝나면 `appEnableExecution`) `event.add`가 `reminder: "failed"`로 답하고 `notify_call_failed` problem이 열리는지 본다. 같은 방식으로 앱 DB의 표 이름을 바꾸면(`ec-checks.md`의 `observe-store`) `event.add`가 `unavailable`로 끝나고 `store_unavailable` problem이 열리는지도 본다. 이 둘의 problem 이름이 서로 다르고 `event_input_invalid`와도 다르다는 것이 확인 대상이다.
   4. `calendar-app-bug@1`을 새 root에서 되살려(`needs`가 같다) `appCallApi` `event.list { range: "next_week" }`가 `failed`이고, 잠시 뒤 `problemList({ app })`에 열린 problem이 하나 있는지 본다. `event.list {}`와 `{ range: "this_week" }`는 정상이다.
   5. 제품 빈틈(아래) 때문에 3·4의 `restoreWorld`가 떨어지면 아래 임시 패치로 확인한다.

## 제품 빈틈 (이 task는 제품 코드를 커밋하지 않는다)

- **app test가 `@me` package를 쓰는 앱을 거절한다**(`ec-world.md`의 "제품 빈틈" 첫 항목이 근거와 재현을 갖는다). `packages/core/problems/tests/app-test/generate.ts`의 `SDK_COPY`가 `./sdk/@me/<part>/<version>/`를 못 풀어 `@me/date-range` import를 "선언하지 않은 의존"으로 본다. 이 앱의 `restoreWorld`가 이 때문에 `app test`가 `fail`이면 `calendar-app@1`은 main에서 켜지지 않는다. 이 수정은 이 계획 밖의 별도 제품 수정으로, 계획 `found-bugs`가 이 wave 전에 main에 넣는다. 먼저 들어갔는지 확인한다.
- 수정이 아직 들어가지 않았을 때만 로컬에서 확인한다(들어갔으면 이 항목은 건너뛴다): `SDK_COPY`를 `/^\.\/sdk\/(?:@me\/)?([^/]+)\/([^/]+)\//`로 임시로 고치고 위 3번을 돌린 뒤 **되돌린다**(`git checkout -- packages/core/problems/tests/app-test/generate.ts`). 임시 고침이 commit이나 보고한 file 목록에 들어가면 안 된다. 이 패치 하나로 나머지가 모두 통과하는지가 보고할 내용이다.
- **write app-api는 빈 DB에서 fixture로 DB를 바꿔야 app test를 통과한다**(위 5번). 삭제·수정처럼 대상 행이 있어야 바뀌는 write는 coding agent가 만들 때도 같은 벽을 만난다. calendar-mvp에서 진짜 coding agent가 `event.remove`를 어떻게 푸는지가 첫 run에서 보일 것이다. 이 벽 자체를 제품 빈틈으로 보고에 적는다.

## 끝남

- `deno task check`가 통과한다(앱 source file은 `.tmpl`이라 탐색에 걸리지 않는다. `git ls-files tests/eval/materials | grep -E '\.(ts|tsx)$'`가 비어 있다).
- 위험 test: 없음 (이 task는 데이터다. 재료의 hash·고정 id·`needs`·`parent`와 `.tmpl` 이름은 ec-restore의 `materials_test.ts`가 `deno task check`에서 본다.)
- 위 3번의 확인이 된다(3번의 3은 갈음 가능).
- 주석에 task id를 쓰지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것(화면 모양, 앱 안 test 범위, 알림 호출 실패 분기의 세부)
- 넘길 줄: 없음
- 계약 바꾸기 요청: `ec-world`의 `calendar-call@1` 본문과 이 앱의 app-api 정본이 어긋나는 곳, `ec-restore.md`의 재료 꼴과 다른 곳
- 제품 빈틈: 위 두 가지를 실제로 확인한 결과(임시 패치를 쓴 경우 그 사실과 되돌렸다는 확인)
- 두 source 트리의 `diff -r` 결과
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 반복 일정과 알림 취소(일정을 지울 때 알림을 지우지 않는다)는 없다. 요구 카드 밖이다.

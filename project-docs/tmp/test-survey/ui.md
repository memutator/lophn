# test-ui: UI 영역 test에서 얻은 교훈

영역: `packages/shell/renderer`(173 file), `packages/shell/main`(99), `packages/design`(64), `packages/sdk`(39), `packages/protocol`(160). 합계 535 file.
본 것: 약 45 file을 직접 읽거나 훑었고, 전체에는 grep과 작은 python 집계(test 본문을 `Deno.test(`/`test(` 기준으로 잘라 정규식으로 분류)를 돌렸다. 정규식 집계라서 숫자는 대략이다.

## 0. 규모

| 영역 | test file | test 줄 | test 수(대략) |
|---|---|---|---|
| shell/renderer | 173 | 47,124 | 1,268 |
| shell/main (node:test) | 99 | 21,913 | 549 |
| design | 64 | 7,192 | 297 |
| sdk | 39 | 4,208 | 119 |
| protocol | 160 | 40,315 | 1,019 |
| 합계 | 535 | 120,752 | 약 3,250 |

저장소 전체 test 줄(약 45만)의 27%, `Deno.test` 8,788개의 약 37%가 이 영역이다. 가장 큰 file은 `packages/shell/renderer/conversation/agent-core-source_test.ts` 2,919줄, `packages/protocol/projects/context-api_test.ts` 2,076줄(test 62개)이다.

## 1. 쓸모없는 test의 종류

### 1.1 test 이름에 요구 ID, 작업 번호가 있음 (거의 전부)
- 이 영역의 test 이름 3,096개 중 3,065개(99%)에 `shell/desktop#R46`, `apps/sdk#R4` 같은 요구 ID가 있다. 그중 약 834개는 `[agent-I33a]`, `[ctx-I48]`, `[agent-RW3e]` 같은 작업 번호 꼬리표도 붙는다. `shell#T57`, `platform#T34`, `shell/desktop#Q18` 같은 T/Q 번호도 약 46개다.
- 예: `packages/shell/renderer/conversation/question-card/question-card_test.tsx:311`, `packages/shell/renderer/workspace/agent/agent-tab_test.tsx:256`(요구 ID 3개 + `[agent-I33c]`), `packages/shell/main/scripts/stage_test.ts:14`(`shell#T57`).
- file 머리 주석도 마찬가지다: `agent-view_test.tsx:1`의 `// agent-I33a: ...`, `build_test.ts`. AGENTS.md가 "테스트 이름과 코드 주석에 요구 ID나 작업 번호를 넣지 않는다"고 했는데 99%가 어긴다. 비율: 약 99%.

### 1.2 문구, 화면 모양, DOM 세부를 확인함 (renderer의 절반 안팎)
- DOM을 render해서 `textContent`/`querySelector`로 보는 test가 renderer 1,267개 중 약 650개(51%)다. 이 영역 test file 전체에서 `[data-...]` selector가 약 2,800번, `textContent` 905줄, `assertStringIncludes`/`.includes("...")` 약 450줄이다.
- 문구를 문자 그대로 박는 예:
  - `packages/shell/renderer/desktop/lophn-space/settings/settings_test.tsx:100-200`: `"Starting with the next call"`, `"The folder wasn't added. Nothing changed. Pick the folder again."`, `"This changed somewhere else. The latest is shown. Try again."`, `"Use letters, numbers, dashes and underscores, up to 32."`. 한 test에서 render를 4번 하고 각각 안내 문장을 비교한다. 문구를 바꾸면 깨지고 동작은 지키지 못한다.
  - `packages/shell/renderer/app-frame/app-detail/app-detail_test.tsx:470-540`: `"The saved value was deleted."`, `"Access was removed."`, `"Last checked"`, `"Every 60 minutes"`. 이 test들은 이름도 `shell/wording#R10`이다(wording 자체를 지키는 test).
  - `packages/shell/renderer/conversation/question-card/question-card_test.tsx:311`: 요약 문장 `Answered 2 questions:` 형식을 확인한다.
  - `packages/shell/renderer/app-frame/app-detail/tasks/tasks_test.tsx:20-60`: 화면 글에 `tkt_`, `ledger`, `snapshot`, `in_progress` 같은 내부 낱말이 없는지 글을 훑는다(`noInternal`). 이건 문구 test이다.
- CSS/치수를 확인하는 예:
  - `packages/design/components/source_test.ts`(285줄): 모든 `.module.css`를 postcss로 읽어 gradient, filter, text-shadow, uppercase, box-shadow가 정해진 file에만 있는지, margin/padding이 정한 space token만 쓰는지 본다. 같은 일을 sdk의 ui-* 11개 package가 `mod_test.ts`로 또 한다(아래 1.3).
  - `packages/design/tokens_test.ts`(363줄, test 23개)와 `layout-tokens_test.ts`: `assertEquals(tokens.table.row, { compact: "36px", comfortable: "44px" })`, `tokens.space`가 `["0px","2px",...,"64px"]` 13개와 같다, `tokens.radius`, `tokens.type`. `tokens.ts`의 상수를 test에 한 번 더 베껴 쓴 것이다. 코드를 바꾸면 test 숫자를 같이 고쳐야 한다. 설계 문서 숫자와 상수가 같다는 걸 확인하는 용도지만 문서와 코드를 둘 다 사람이 쓴다.
  - `packages/design/chart/line-chart_test.tsx:36`: `stroke-width`가 `"2px"`, 축 label이 `"100K"`, `["Sep 24","Sep 25","Sep 26"]`. `chart/narrow_test.tsx`: 96px 폭 SVG의 모든 `foreignObject`/hit rect의 x 범위. 이 영역 chart test는 시각 결과의 세부다.
  - `packages/sdk/tokens/mod_test.ts:25`: 8색 hex 배열 `["#2a78d6","#eb6834",...]`을 그대로 비교한다.
  - style/계산 style을 읽는 test file이 52개(220줄), `"NNpx"` 비교 221줄.
- 비율: renderer test의 약 40~50%, design의 약 60~70%(components/chart/tokens), sdk ui-* 약 절반.
- 가치 있는 쪽 예외도 섞여 있다. 키보드/focus/정렬 같은 상호작용 test(`data-table_test.tsx:76`의 정렬 방향 뒤집기, palette 키보드 선택)는 동작을 본다. 이건 화면이 아니라 동작이다. 다만 대부분 `data-` selector와 문구로 결과를 확인해서 둘이 섞여 있다.

### 1.3 소스나 문서를 글로 읽어 검사함 (AGENTS.md가 금지한 것)
이 영역에서 약 30 file이 `Deno.readTextFile`/`readFileSync`/`readDir`로 소스를 읽는다.
- 옛 설계가 없어졌음을 지키는 test(`*-retired_test`, `*-removed_test`):
  - `packages/shell/renderer/conversation/dock-retired_test.ts`: `dock.tsx` 등 10개 file이 없는지 `Deno.stat`, 세 공간의 소스를 읽어 `"DockToggle"`, `"dockOpen"`이 없는지, `entry.tsx`에 `"#conversation"`이 없는지 본다.
  - `packages/shell/renderer/desktop/roles-removed_test.ts`: `"#roles"`, `"coreRolesSource"`, `"RolesSource"`가 소스에 없는지.
  - `packages/shell/renderer/conversation/question-strip-retired_test.ts`도 같은 종류.
  - 이 영역에서 "~가 없다/옛 ~" 이름의 test가 215개이고 모두 부정 확인은 아니다(권한 test의 "~이 없다" 포함). 다만 `*-retired`, `*-removed` file은 소스 문자열 검사다.
- 소스 import/문자열 경계 검사:
  - `packages/shell/renderer/editor/boundary_test.ts`: renderer·sdk·design·protocol 모든 `.ts/.tsx/.json`을 읽어 `@codemirror/`가 editor 밖에 없는지 정규식으로 본다. 이건 lint나 deps 검사(`tools/check-deps.ts`)가 할 일이다.
  - `packages/protocol/registry_test.ts:40-60`: 모든 contracts file의 상대 import를 정규식으로 읽어 최상위 폴더 사이 그래프를 만든다(deps check와 겹침).
  - `packages/shell/main/desktop/shortcuts_test.ts:119-140`: main의 모든 `.ts`를 읽어 `globalShortcut.\w+` 호출과 `unregisterAll`이 없는지 본다. `packages/shell/main/desktop/headless_test.ts:160`: preload에 `process.env`가 없는지. `app-frame/registry_test.ts`("renderer는 앱 UI 코드를 import하지 않는다")도 같다.
  - `packages/sdk/ui-*/mod_test.ts` 11개 file: 같은 두 test를 복사한다. (a) `deno.json`의 이름이 `@lophn/ui-xxx`, 버전 `1.0.0`, import가 `@N.N.N` 정확한 판인가, (b) 모든 `.tsx` 소스를 `checkSource`(wording lint)에 넣어 error가 없는가. 두 번째는 lint 규칙을 test로 한 번 더 도는 것이고 첫째는 deno.json을 글로 읽는다. 11 package x 2 test = 약 22 test가 거의 복붙이다. `sdk/tokens/mod_test.ts:6`도 `deno.json` `version == "1.0.0"`을 확인한다.
  - `packages/design/wording/format_test.ts:95`, `wording/check_test.ts:11`, `components/source_test.ts`(CSS), `tokens_test.ts:144`(`base.css`에 `https://`가 없고 `font-display: swap`이 정확히 2번, woff2 매직 `"wOF2"`, OFL 라이선스 글에 `"SIL OPEN FONT LICENSE"`가 있다).
- 비율: 이 영역 전체의 약 3~4%지만 AGENTS.md가 금지한 종류라서 전부 지울 대상이다.

### 1.4 같은 동작을 여러 file이 다시 확인함 (겹침)
- 같은 core 통로를 세 겹으로 본다. 예: `conversation/agent-core-source_test.ts`(2,919줄, 가짜 core `contractCore`로 요청 body를 확인) + `conversation/agent-core-source-real-core_test.ts`(진짜 core) + `conversation/testdata/fake-agent-source.ts`(722줄 fake)를 쓰는 `agent-view_test.tsx` 등. `things-to-confirm/core-source_test.ts`(761줄)와 `things-to-confirm/real-core_test.tsx`, `settings/core-source_test.ts`와 `settings/core-source-real-core_test.ts`, `settings/agents/core-source_test.ts`(684줄), `workspace/contexts/core-source-real-core_test.ts`도 짝이 있다. 이 file들 머리 주석이 이미 "fake core는 응답 모양을 잘못 흉내 내도 통과하므로 진짜 core로 본다"(`editor/save-real-core_test.ts:1`)고 인정한다. 진짜 core 쪽을 남기면 가짜 쪽은 중복이다. 렌더러 `*core-source*_test.ts` 합계가 약 9,000줄이다.
- route/event 이름 목록을 코드와 test에 두 번 쓴다: protocol에서 `ROUTES`/`EVENTS`/`routePath`/`.actors`/`.errors`를 확인하는 test가 168개(전체 protocol test의 16%). 예: `protocol/projects/context-api_test.ts:180-230`은 15개 command path, 15개 read path, 16개 event 이름을 `// deno-fmt-ignore` 한 줄 배열로 박아 `CONTEXT_API_*_ROUTES.map(routePath)`와 비교한다. `protocol/apps/grants_test.ts:57`은 `"/v1/grants/create"`, `"GrantCreated"`... 를 베끼고 `grantRevoke.confirmation == "required"`, `grantRevoke.errors == ["conflict","unavailable"]`까지 상수를 다시 확인한다. `protocol/lophn-agent/registry_test.ts`는 event 이름 수십 개를 나열한다. 이 목록은 `tools/contract-coverage.ts`(check 단계 `coverage`)도 이미 센다(architecture 5장 대 protocol).
- 같은 package 목록을 네 곳이 반복: `design/components_test.ts`의 13개 root, `component-tests.ts`의 13개 package, `components/source_test.ts`의 13개 root(`ui-reading` ... `ui-chart`)에 같은 목록이 있다. 새 package를 더하면 셋을 고쳐야 한다.
- 비율: 정확히 센 건 없다. protocol은 route/event 목록이 약 16%, renderer는 core-source 짝이 약 9,000줄(renderer test 줄의 19%).

### 1.5 내부 구현을 mock으로 확인함
- `packages/shell/renderer/conversation/agent-core-source_test.ts`: `contractCore`에 route별 핸들러(`"command:runs/stop": () => ok(...)`)를 심고 호출한 `call.body`의 필드(`input`, `compare`, `idempotency_key`, `state_seq`)를 `assertEquals`로 맞춘다(예: 단락 `lophn-agent/harness/run-loop ... Stop은 run의 state_seq를 비교 기준으로 ...`). source가 어떤 route를 어떤 순서로 부르는지에 묶여서, 내부를 바꾸면 깨진다. `w.verify()`로 "예상한 호출이 다 일어났는가"도 본다.
- `packages/shell/main/desktop/headless_test.ts:100-140`: fake timer map, fake image, `writes` 배열로 `capturePaints`의 호출을 확인한다(timer 한 번만 걸었는지, `timers.size == 1`).
- `packages/shell/main/app-frame/registry_test.ts`(768줄): `FakeSession` + `before`/`headers`/`protocol` 콜백을 직접 호출해 Electron session 정책을 확인. 이 test는 실제 효과(차단되는 URL)를 보지만 mock 틀(`FakeSession`, `AppViewContents` fake)이 구현 모양에 묶여 있다.
- `packages/shell/main/terminal/flood_test.ts`: `HostDeps`의 `pty`, `schedule`을 fake로 넣고 `ticks` 배열로 양보 횟수를 센다.
- 비율: shell/main의 약 절반은 fake 의존성 주입(Electron, PTY, timer)을 쓴다. 그 중 보안 경계(1.9의 3번 항목)는 값지고 나머지는 구현 묶임이다. 대략 shell/main test의 30~40%.

### 1.6 type이나 schema가 이미 보장하는 것을 다시 확인함 (protocol의 큰 부분)
- protocol 1,019개 중 약 787개(77%)가 zod schema를 `safeParse`/`.parse`로 부른다. 대부분이 "이 값은 받고 저 값은 거부한다"이다.
- 예: `packages/protocol/base/values_test.ts`: `atSchema.safeParse("2026-10-04T05:46:07.123Z").success`와 나쁜 입력 5개, `sha256Schema`(소문자 64자 hex), `archiveStateSchema`가 `"active"`/`"archived"`만 받는지(`"platform/ledger#R8: ArchiveState는 active와 archived뿐"`). zod `z.enum(["active","archived"])`를 선언한 그대로 다시 말하는 test다.
- `protocol/projects/context-api_test.ts`는 `accepts(schema, value)`/`rejects(schema, value)` helper와 거대한 fixture 객체(`draftBundle`, `appliedBundle`, `passedCheck`, `view`, `entry`, `ruleViolation`, `brokenLink` ...)를 올리고 `without(value, key)`로 필드 하나씩 빼며 거부를 확인한다.
- 값진 schema test도 있다(3번 참고): 시각/ID/상한이 core 경계 판정을 정하는 곳(예: `lophn-agent/visuals_test.ts:132`의 table·chart bound, `seq`의 2^53 너머, `problems/test-frames_test.ts:43`의 frame 한도 UTF-8 byte). 하지만 "필드 하나 빠지면 거부", "enum에 없는 값 거부"는 zod가 하는 일이다.
- 비율: protocol의 약 60~70%가 이 종류로 보인다(787 중 상당수).

### 1.7 사소한 함수와 상수
- `design/tokens_test.ts`, `layout-tokens_test.ts`의 상수 비교(1.2와 겹침). `protocol/base/values_test.ts`의 `durationMsSchema`(0 이상 정수), `archiveStateSchema`. `sdk/tokens/mod_test.ts:19`의 `assertEquals(sdk.tokens, design.tokens)`(re-export가 같은 객체인지). `shell/renderer/conversation/testdata/shared-view-rules_test.ts:14`는 "renderer가 contracts의 순수 규칙을 import할 수 있는지"를 한 test로 본다(import 되나 보는 test, type check가 이미 한다).
- 비율: design의 약 15~20%(tokens), protocol의 일부.

### 1.8 거대한 fixture, 거대한 기대값
- 전용 fixture 파일: `packages/shell/renderer/conversation/testdata/fake-agent-source.ts` 722줄(fake agent source), `agent-view-harness.tsx` 206줄, `model-picker.ts` 209줄, `slash-menu.ts` 218줄. 상위 `shell/renderer/testdata/agent-core-fixtures.ts`, `rewind-fixtures.ts`, `contract-core.ts`는 `agent-core-source_test.ts` 한 file이 쓰려고 만든 규모이다. 즉 test를 위해 별도 "fake 제품"을 유지한다.
- 거대한 기대값: `design/tokens_test.ts`가 `tokens.type`, `tokens.space`, `tokens.radius`, `tokens.page`, `tokens.tree` 전체 객체를 `assertEquals`한다. `sdk/tokens/mod_test.ts`는 8색 hex를 배열로 박는다. protocol의 route/event 이름 한 줄 배열(`// deno-fmt-ignore`로 포맷도 안 넣는다).
- snapshot 도구(`assertSnapshot`)는 0개. 사실상 snapshot이 객체 literal 형태로 있는 것이다.

### 1.9 옛 설계를 지키는 test
- `*-retired_test.ts`, `*-removed_test.ts`(1.3). 예: `dock-retired_test.ts`는 "dock이 없어졌다"를 지킨다. 설계가 바뀌면 test 이름 그대로 옛 설계를 기억하는 test가 남는다. AGENTS.md는 "옛 설계를 지키는 test는 고치지 말고 지운다"고 한다. 이런 file은 file 이름이 이미 옛 일을 알린다.
- `shell/renderer/desktop/dev-mock/mod_test.tsx`(134줄): dev 전용 mock 서버를 지키는 test.
- `protocol/lophn-agent/registry_test.ts:205`: "the preset routes, events, values and reasoning levels are gone from the public entry". `presets` route가 없다는 확인, `Object.keys(contracts)`에 `"presetList"` 등이 없다는 확인.
- 비율: 몇 file, 몇십 test(1% 미만). 하지만 종류로서는 분명하다.

### 1.10 이 영역에서 새로 본 종류
- **거짓 통과(조건이 안 맞으면 그냥 통과)**: `packages/shell/main/scripts/stage_test.ts`는 `build/stage`가 없으면 `t.skip`하거나 `return`(`if (!isDir(outDir)) return;`)한다. 보통 안 만든 dir이라 거의 항상 아무것도 안 본다.
- **사람이 쓰는 문구 정책 test가 따로 있다**: `design/wording/` 패키지(`check.ts`, `check_test.ts` 211줄, `format_test.ts`)가 UI 문구 lint를 만들고, 그것을 test로 다시 검사하며, sdk ui-* 11개 `mod_test.ts`가 그 lint를 실제 소스에 다시 돈다. 문구 lint는 `deno lint` 같은 도구에 두고 test로 돌리지 않아도 된다.
- **perf 감시 test가 test suite 안에 있다**: `design/chart`의 `"수만 개 시점의 선 차트도 인자 펼치기 없이 유한하게 그린다"`는 혼자 3초(`design/components_test.ts` 185개 test 합 5.3초의 56%)다. `components/data-table`의 `"1,000행 이하는 모두 그리고 자리 행이 없다"`는 286ms.
- **같은 test body 복붙**: sdk ui-* 11개 package `mod_test.ts`의 `sources()` 함수와 두 test가 거의 그대로다(`ui-layout/mod_test.ts`와 `ui-action/mod_test.ts`는 diff가 package 이름뿐).
- **test용 helper에 DOM 쓰기가 반복됨**: `typeInto`가 `agent-view_test.tsx:55`, `tasks_test.tsx`, `lophn-space/testdata/dom.ts`에 각각 있고 `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set`을 직접 호출한다. UI test 틀(`design/components/testing.ts`) 위에 또 틀이 쌓였다.

## 2. 느리고 무거운 것

### 2.1 시간 재기 (이 machine: 24 core, `deno test --allow-all <file>`, 캐시 warm)

| file | test 수 | wall | 최대 RSS | 시간은 어디서 |
|---|---|---|---|---|
| `packages/design/components_test.ts` | 185 | 8.95s | 3.25 GB | file 맨 위에서 `await registerComponentTests(13 root)`: 모든 `*_test.tsx`를 esbuild로 한 bundle로 묶음(tmp dir 쓰고 지움) 후 happy-dom에 올려 import. test 본문은 합 5.3초(중앙값 4ms), 그중 3초가 test 1개(수만 점 차트). 나머지 3.5초는 준비(esbuild + 첫 import). RSS 3.25GB는 esbuild + bundle + happy-dom. |
| `packages/shell/renderer/conversation/conversation_test.ts` | 180 | 9.22s | 637 MB | 위와 같은 bundle 방식(그 폴더 `*_test.tsx`만). test 본문 합 7.5초(중앙값 27ms), 가장 느린 것 약 0.3s. 준비 약 1.7초. |
| `packages/shell/renderer/editor/save-real-core_test.ts` | 1 | 5.52s | 573 MB | test 1개가 실제 core(`deno run --allow-all packages/core/main/daemon/main.ts --port=0`)를 띄우고(hello 대기), 폴링 `until(...)`(200ms 간격)로 core 추적을 기다리고, 끝에 `SIGTERM`으로 끈다. 4초(deno가 보고한) 거의 전부가 core 기동. `sanitizeOps: false, sanitizeResources: false`. |
| `packages/shell/renderer/build_test.ts` | 6 | 6.89s | 525 MB | test 안에서 renderer `build(dir)`(esbuild로 desktop/overlay/confirmation 3 entry)를 3번(`R24`, `R15`, `R17` 각 약 1초) + 단일 bundle(`R43`, `apps/sdk#R4` 0.4~0.6초). tmp dir에 쓰고 happy-dom으로 entry를 import해 본다. |
| `packages/protocol/projects/context-api_test.ts` | 62 | 1.41s | 446 MB | 준비 없음. type check/모듈 로드가 대부분. test 본문은 ms 단위. |
| `packages/protocol/lophn-agent/reverts_test.ts` | 22 | 1.61s | 510 MB | 위와 같음, 본문 19ms. |
| `packages/design/tokens_test.ts` | 23 | 0.59s | 285 MB | 상수 비교. 본문 124ms. |
| `packages/sdk/cap-fs/fs_test.ts` | 5 | 0.59s | 301 MB | `Deno.Command(Deno.execPath(), ...)`로 권한 flag를 준 자식 deno 2개를 띄움(총 40ms 안팎, 캐시가 따뜻하면 싸다). |

- `packages/shell/main`은 `node --test`로 돈다. 대표 file `app-frame/registry_test.ts`(15 test)는 0.20s, 104 MB이고 `duration_ms 168`이다. 다른 file(`terminal/coding/coding-start_test.ts`)은 `precheck`가 만드는 `packages/shell/node_modules/zod` symlink가 없어 이 환경에선 못 돌렸다(저장소를 안 고치는 조건). shell/main의 test 자체는 가볍다. 무거운 건 `npm run check` 전체가 `deno fmt/lint`, `tsc --noEmit`, `node --test`(여러 glob), `e2e/shell/terminal_test.ts`, `deno check`, `deno test`를 줄줄이 돌린다는 점이다(`packages/shell/main/package.json:check`). 즉 같은 `deno fmt/lint`/`deno check`가 루트 check에서 한 번, shell main check에서 또 한 번 돈다.

### 2.2 test 안의 준비
- **esbuild 번들을 test file 안에서(file 맨 위 top-level await)**: `design/component-tests.ts`의 `registerComponentTests`가 호출될 때마다 임시 dir에 `deno.json`과 `entry.ts`를 쓰고 `esbuild.build({ bundle: true, ... denoPlugins })`로 묶는다. 이 호출이 `design/components_test.ts`, `shell/renderer/{desktop,app-frame,terminal,overlay,editor,confirmation,conversation}/*_test.ts`에 7번(+design 1번 = 8 bundle) 있다. 루트 `deno.json`이 `*_test.tsx`를 `deno test`에서 빼고 이 runner file이 대신 등록한다. 각 bundle이 React, Radix, lucide, CodeMirror, xterm을 매번 다시 묶는다. 같은 design 컴포넌트가 renderer bundle에도 다시 묶인다(React 한 벌 체크가 필요해서 `R43` test까지 있다: `components_test.ts:23` "React 한 벌과 scope된 CSS Modules class map").
- **happy-dom**: bundle마다 `Window` 하나를 `installDom`으로 globalThis에 올린다(`sharedDocument`). `build_test.ts`는 별도의 `new Window`를 추가로 연다. happy-dom을 쓰는 file이 20개.
- **진짜 core 기동**: `shell/renderer/testdata/real-core.ts`의 `startRealCore()`가 `Deno.Command(deno run --allow-all packages/core/main/daemon/main.ts --port=0)`를 띄우고 temp `LOPHN_HOME`, hello frame을 stdout에서 파싱, 끝에 SIGTERM. 이 helper를 쓰는 file이 11개(`conversation/agent-core-source-real-core_test.ts`, `editor/{save,instructions,draft-document,versions}-real-core_test.ts`, `editor/reading-width-real-core_test.tsx`, `desktop/launcher/...`, `desktop/lophn-space/{things-to-confirm,settings,settings/providers}/...`, `workspace/{agents,contexts}/...`)이고 `startRealCore()`가 약 17번 불린다(`instructions-real-core_test.ts` 2번, `versions-real-core_test.ts` 2번, `workspace/contexts/core-source-real-core_test.ts` 3번, `workspace/agents/core-source-real-core_test.ts` 2번 ...). 한 번에 4~5초 → 이 영역에서만 약 70~90초(순차 기준 추정, 직접 전부 재진 않음).
- **sanitize 끔**: `sanitizeOps: false, sanitizeResources: false`가 12줄(6 file, 8 test): 모두 `*-real-core_test.ts`. 자식 process와 stdout drain promise가 test 끝에 정리되지 않는다는 뜻이다.
- **긴 timeout 폴링**: `until(label, read, timeoutMs = 60_000)`, 200ms 간격 `setTimeout`이 `*-real-core_test.ts` 6 file에 복붙돼 있다. core가 안 뜨면 60초를 쓴다.
- **subprocess**: `Deno.Command`는 이 영역 test에서 `sdk/cap-fs/fs_test.ts`(권한 flag 확인용 자식 deno, 가치 있음)와 `real-core.ts`뿐이다. shell/main은 `node:child_process`의 `spawn`을 15 file이 쓴다(`terminal/child-group_test.ts`, `child-watch_test.ts`, `flood_test.ts`, `supervisor_test.ts`, `stop_test.ts`, `snapshot_test.ts`, `desktop/core/{integration,byte-routes,supervise}_test.ts`, `app-frame/overlay_test.ts` ...). 이름은 spawn이지만 PTY fake가 많고 실제 process는 `desktop/core/integration_test.ts`, `terminal/child-group_test.ts` 등 일부.
- **실제 timer/sleep**: `setTimeout`이 test 45 file에 98줄. 진짜 대기: `context-tabs_test.tsx:410,437,530` 250ms x 3, `tab-strip_test.tsx:242` 450ms, `desktop/core/integration_test.ts:179,193` 300+200ms, `byte-routes_test.ts:95,168` 200ms x 2, `child-group_test.ts` 50ms x 2. 나머지 `setTimeout(resolve, 0)`/`5`/`20`은 microtask 흘리기용(`flush()`).
- **temp dir I/O**: `makeTempDir`/`mkdtemp` 24 file 59줄.

### 2.3 한 file 안에서 같은 준비를 되풀이함
- renderer `*_test.tsx`는 test마다 `render(<X source={fake.source} />)` 후 `flush()`, 마지막에 unmount. `agent-view_test.tsx`는 test마다 `weekFake()` + `await mount({ fake, session })`, 끝에 `await unmountSettled(view.view)`를 한다. `settings_test.tsx`의 한 test는 `fakeSettings()` → `render()` → `pressTab("Tools and skills")` → `await flush()`를 4번 되풀이한다.
- `startRealCore()`는 file마다 test 1~3개에 core를 하나씩 띄우고 지운다(공유 안 함).
- `tasks_test.tsx`는 `noInternal(root)`가 DOM을 `cloneNode(true)`로 통째 복사해 details를 빼고 textContent를 모은다.

## 3. 값진 test (남길 만한 것)

좋은 모양: 입력과 결과가 사람 기준(데이터, 권한, 되돌림)으로 읽히고, 실제 효과(파일 바이트, 허용/차단, 보낸 요청이 아니라 결과 상태)를 보고, 이름이 한 문장의 결과이며, 몇 줄이다.

- `packages/sdk/cap-fs/fs_test.ts`: 권한 flag를 준 자식 deno를 띄워 "fs.write만 허락한 앱은 못 읽는다", "허용 밖 경로는 PermissionDenied가 정확한 permission/path를 말한다"(`cap-fs refusals name the permission and the exact path`, `fs.write alone does not allow reading`). sandbox 경계를 진짜 deno로 확인한다. 5 test 0.59s. 무거워 보이는 subprocess가 오히려 싸고 값지다.
- `packages/sdk/cap-secret/secret_test.ts`: secret 기능이 "읽기, 만들기, 지우기가 없고 안전한 use 결과만 받는다"(`Object.keys(api).sort()`로 공개 표면을 고정하는 test). secret 경계를 API 모양으로 막는 드문 경우이고 값지다. 다만 `Object.keys` 고정은 새 export를 올릴 때마다 test를 고쳐야 하는 부담이 있다.
- `packages/shell/main/app-frame/network-policy_test.ts`: "자기 scheme과 부여한 fetch host만 통과, 나머지 network는 기본 차단", "플랫폼 port의 loopback은 부여돼도 막는다", "redirect/WebSocket/subframe에도 같은 판정", "앱 응답 CSP는 자기 자원과 부여한 host만". 앱 sandbox 경계 판정이다. 순수 함수로 입출력만 본다.
- `packages/shell/main/app-frame/session-policy_test.ts`, `registry_test.ts`의 일부: "partition은 앱·live·preview로 나뉘고 한 partition에 정책을 한 번만 단다", "닫으면 session의 저장 상태를 지운다", "IPC sender view는 살아 있는 contents의 신원만 돌려준다". (registry의 mock 틀은 무겁다.)
- `packages/shell/main/editor/file-adapter_test.ts`: "저장 버튼 없는 고침은 바이트를 올리고 base_hash·request_key로 파일만 쓴다", "base_hash가 낡으면 conflict이고 파일은 그대로", "결과를 모르는 쓰기는 다시 쓰지 않고 상태로 그 바이트가 있는지 본다", "UTF-8이 아닌 파일과 상한 넘는 파일은 편집으로 열지 않는다". 사용자 파일을 잃거나 덮어쓰지 않는 규칙이다.
- `packages/shell/renderer/editor/save-real-core_test.ts`: 진짜 core, 진짜 temp 폴더에서 "고침은 원자 교체되고, 바깥 변경은 충돌로 멈춘 뒤 사람이 고른 글만 쓴다"(`readTextFile`로 결과 파일 내용 확인). 사용자 데이터 보호이고 진짜 효과를 본다. 다만 한 test가 4개 요구 ID를 묶어 길고(80줄+), 4~5초 core 기동 비용이 든다. `editor/{instructions,draft-document,versions}-real-core_test.ts`와 합쳐서 core 기동 1번으로 공유하면 더 싸다.
- `packages/shell/renderer/editor/save-state_test.ts`, `sessions_test.ts`(순수 상태기계, 입력 멈춤 timer 대신 flush로 경계를 직접 연다: `still: SaveClock`). 결정적이고 가볍다.
- 확인 창: `shell/main/confirmation/kinds/rewind_test.ts`(515줄), `apps_test.ts`(648줄), `renderer/confirmation`: "독립 조회가 끝나기 전에는 제출할 결정이 없다", "대상이 바뀌면 옛 버튼으로 결정하지 못한다", "renderer로 나가는 표시에는 handle 원문이 없다". 권한 확인과 binding 경계이다(이름이 `shell/confirmation-window#R5/R7`). 값지다. 크기에 비해 test 수를 줄일 여지는 있다.
- `packages/protocol`의 경계 판정: `problems/test-frames_test.ts:43`("frame 한도는 JSON overhead를 포함한 UTF-8 byte"), `lophn-agent/visuals_test.ts:132`(table, chart, diagram 상한), `base/values_test.ts`의 `seqSchema`가 `parseSeq`와 같은 판정이며 2^53, 2^63-1 경계를 비교(`MAX_SEQ`, 결정적 판정), `base/envelope`/`route` 관련. 상한과 경계값은 schema 선언만으로 안 보이니 남길 가치가 있다. `lophn-agent/reverts_test.ts`(1,001줄, 22 test, 19ms): 되돌림 규칙(rewind/revert). 되돌림은 사람 기준 핵심이다. 순수 함수 위주라 싸다.
- `packages/design/components/data-table/model_test.ts`, `data-table_test.tsx:76`: 정렬 시 빈 값은 끝에 남고 방향 버튼이 뒤집힌다 같은 순수 모델/상호작용. 화면 모양이 아니라 동작.
- `packages/design/components/*`의 키보드/focus 동작 test(palette 키보드 선택, focus 유지)는 접근성 동작이다. 값진 쪽에 들 수 있지만 screen reader 등 사람 판단이 필요한 수준이므로 어느 만큼 둘지는 사람이 정할 일이다.

공통 좋은 모양을 한 줄로: 결과(파일 바이트, 허용/차단, 남은 상태)를 보고, 입력 설정이 짧고, 한 test가 한 규칙이며, timer는 fake clock이고, 이름에 요구 ID가 없다.

## 4. 느낀 점 정리 (교훈)

1. **이름 규칙부터 어긴다.** test 이름의 99%가 요구 ID, 약 27%가 작업 번호 꼬리표다. 새로 쓸 때 한 문장 결과 이름만 쓰면 이 문제는 한 번에 끝난다.
2. **화면 test가 renderer의 절반 이상이고, 문구와 `data-` attribute에 묶인다.** `data-` selector 2,800번, 안내 문장 literal 수백 개. 문구를 바꾸는 일이 잦은 prototype에서 가장 비싼 test다. 상호작용(focus, 키보드, 선택 상태)과 데이터를 지키는 몇 개만 남기는 게 맞다.
3. **무거운 준비가 제일 큰 시간·메모리이다.** 이 영역의 대표 file 시간은 거의 준비다: esbuild bundle(design 3.25 GB RSS, 8~9초) 8번, 진짜 core 기동 약 17번(번당 4~5초), `build()` 3번. test 본문은 대부분 ms. 이 중 `esbuild`와 `core 기동`을 test 밖에서 한 번 하든지 없애면 시간이 줄어든다. 특히 renderer의 `*-real-core_test`를 한 file/한 core로 모으는 방법이 있다.
4. **중복이 세 겹이다.** 같은 core 통로를 contract mock(`agent-core-source_test`)과 real-core로 두 번 보고 거기에 fake source 위 화면 test(`agent-view_test`)가 또 있다. 한 겹(진짜 core 효과)과 화면의 중요한 동작만 남기고 나머지는 지운다.
5. **protocol은 schema를 다시 말하는 test가 대부분이다.** 약 787개(77%)가 zod `safeParse` 성공/실패이고, route/event 이름 목록 168개는 `tools/contract-coverage.ts`가 이미 센다. 경계값(상한, 2^53, byte 수), 되돌림, 결정적 판정만 남기면 될 것 같다.
6. **소스를 글로 읽는 test가 AGENTS.md 금지에도 약 30 file이다.** `*-retired_test`, `*-removed_test`, `boundary_test`, `sdk/ui-*/mod_test` 11개(복붙), `design/components/source_test`, shell/main의 `globalShortcut`/`process.env` 검사. 이 역할은 lint나 `tools/check-deps.ts`, `deno.json` 설정이 맡아야 한다. 이 영역에서 지울 대상 1순위.
7. **상수 확인(design tokens)은 코드와 test에 숫자를 두 번 쓴다.** `tokens_test.ts`(363줄), `layout-tokens_test.ts`, `sdk/tokens/mod_test.ts`는 값을 바꿀 때 test 숫자도 바꾸게 만들 뿐이다.
8. **진짜로 값진 건 작고 빠르다.** 권한 경계(`cap-fs` 자식 deno 0.59s), 앱 network 정책(순수 함수), 파일 저장 충돌, 확인 창 binding, 되돌림. 모두 결과를 보고 mock이 얕거나 진짜 효과를 쓴다.
9. **거짓 통과도 있다.** `stage_test.ts`는 stage dir이 없으면 skip/return. 의미 없는 초록은 슬롭이다. skip으로 빠지는 test는 만들지 말고 실제로 준비해서 본다.
10. **check 시간 구조.** `npm run check`(shell main)가 루트 check와 같은 도구(`deno fmt`, `deno lint`, `deno check`, `deno test`)를 한 번 더 돌린다. 루트 `deno.json`의 `test.exclude`가 `shell/main`, `*_test.tsx`를 빼고 따로 bundle runner를 쓰는 방식이라, 한 번의 check에 test 실행 경로가 3개(deno test, bundle runner 8개, node --test)로 갈라져 있다.

## 5. 한계
- 맡은 535 file 중 직접 본 건 약 45 file이다. 정규식 집계의 분류(예: "schema 77%", "DOM 51%")는 그 test가 쓸모없다는 뜻이 아니라 그 종류에 속한다는 뜻이다.
- shell/main의 `node --test` 전체 시간은 못 쟀다(`precheck` symlink 필요). `registry_test.ts` 1 file만 쟀다(0.2s).
- real-core 17번 합계는 file 1개(5.5s)로 외삽한 추정이다. 전체 renderer를 순차로 재진 않았다.

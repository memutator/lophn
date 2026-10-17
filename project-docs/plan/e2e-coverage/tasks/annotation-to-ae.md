# annotation-to-ae

사람이 앱 화면에서 보낸 annotation 묶음(`annotation.send`)이 그 앱 App Engineer의 session에 사람 메시지 하나로 들어가고, App Engineer가 `image_read annotation:<id>`로 screenshot을 model에 싣는다. 다른 앱의 App Engineer는 그 annotation을 읽지 못하고, 다른 앱 App Engineer의 session으로는 보낼 수 없다. 화면은 쓰지 않는다. test가 shell main 역할로 route를 직접 부른다. `tests/e2e/annotation_test.ts`를 처음 만든다.

- 단위: annotation-to-ae (wave 2)
- 선행: reply-fn. 함수 대답(메시지 글에서 core가 만든 annotation id를 뽑아 tool 인자에 넣는다)을 쓴다. 앱의 release·source·coding 길이 필요 없어 `test-app`에는 기대지 않는다(앱은 `apps/create`만 한다).
- 소유(이 task만 고친다):
  - `tests/e2e/annotation_test.ts`
  - `tests/support/annotation/upload.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/apps/annotations/`
  - `packages/core/lophn-agent/tools/file/image.ts`
  - `packages/core/main/daemon/wiring/annotations.ts`
  - `packages/core/main/daemon/wiring/router.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 11절 `annotation-to-ae`; `candidates-invariants.md` 후보 27(`annotation-to-app-engineer`)
  - architecture: `project-docs/architecture/annotation.md`("annotation을 받는 것은 그 앱의 App Engineer뿐이다", "받는 session은 사람이 보고 있는 대화여야 한다", "App Engineer는 공통 이미지 읽기 tool로 screenshot을 본다", "annotations.get은 App Engineer role에만 주고 core가 agent 자격의 앱으로 거른다(다른 앱 것은 not_found)", "전달은 사람 메시지 하나다"), `project-docs/products/AGENT-ROLE.md` A3
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps`, `router`, `agent-tools`, `core-api`, `agent-sessions`
  - 코드(경로와 읽은 사실):
    - `packages/protocol/apps/annotation.ts`: `annotationSend`는 memory route이고 actor가 `user`뿐이다. 입력 `{app, session: ses|null, annotations: [{n, kind, note, screenshot: PreparedBlob|null, component, element: {role, name, text}, rect: {x_ratio, width_ratio, y_px, height_px, scroll_x, scroll_y}, view: {screen, path}, release}]}`(`n`은 1..N 순서). 앱 이름·release·화면 이름을 shell main이 sender view로 정하는 규칙은 shell 쪽이라 core에는 값으로만 들어온다. test는 그 값을 직접 준다. `release`는 형식이 맞는 `rel_` id면 된다(`core.ids.newId("rel")`. annotation 표는 releases에 FK가 없고 `persist`도 존재를 보지 않는다). `annotationUploadScreenshot`은 upload route(`/annotations/upload_screenshot`, 사람 자격)이고 출력이 `annotationSend`의 `screenshot` 칸이다. `annotationsGet`(`{annotation}` 또는 `{batch}`)은 user·agent·coding_agent가 부른다.
    - `packages/core/main/daemon/wiring/router.ts`의 `annotationDelivery.deliver`: `session: null`이면 그 앱의 새 App Engineer session을 열고(열린 session이 있어도 새로 연다. 열린 것을 고르는 것은 shell 쪽 몫), `session`을 주면 `agentSessionRead`로 그 앱 App Engineer의 `open` session인지 보고 아니면 `conflict`. 메시지는 `refs: [{kind: "annotation", id}]`를 달아 `sendMessage`(next_turn)로 간다.
    - `packages/core/apps/annotations/{send,commands,reads,message}.ts`(저장과 전달 순서, 보관한 앱이면 `persist`가 `conflict`, `annotationsGet`이 agent 자격의 앱으로 거르는 곳), `packages/core/lophn-agent/tools/file/image.ts`(`annotation:<id>` → `annotationsGet` → `screenshot_path` 파일을 읽어 base64 image 결과)
    - user token만으로 부를 수 있는지: 부를 수 있다고 읽었다(route의 actor가 `user`뿐이고 handler가 Origin·renderer를 따로 보지 않는다. `Core.call`은 user token으로 부른다). 안 되면 "계약 바꾸기 요청"이 아니라 "사람에게 물을 것"으로 보고한다.
    - 업로드: `tests/support/core/mod.ts`의 `Core.upload`(`secrets/put` 전용)가 하는 일을 본보기로 한다: `POST <baseUrl>/annotations/upload_screenshot`, `authorization: Bearer <core.token>`, `x-lophn-input`(`UPLOAD_INPUT_HEADER`) = base64url(JSON `{blob_hash, bytes}`), body는 byte. `blob_hash`는 `sha256Hex(bytes)`(`packages/base`). 응답 JSON을 `annotationUploadScreenshot.output`으로 검사해 돌려준다.
    - model 요청의 이미지 모양: `packages/core/lophn-agent/providers/adapters/messages.ts`(tool_result에 image block이 어떻게 실리는가)
  - main의 `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `tests/support/fake-server/{mod,probe}.ts`(`startFakeServer`, `FakeServer.script(steps, lane?)`, 함수 대답, `journal()`, `lastUserText`, `idIn`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: 위 support의 이름(support brief의 "내놓는 것"에 맞춘다), `appCreate`(user, `{slug, name, description}`)·`appArchive`는 `packages/protocol/apps/mod.ts`, `annotationSend`·`annotationUploadScreenshot`·`annotationsGet`, `receivedMessageList`·`agentSessionRead`·`agentSessionList`·`toolCallList`(`packages/protocol/lophn-agent/mod.ts`)
  - 내놓는 것: `tests/support/annotation/upload.ts`: `uploadScreenshot(core: Core, bytes: Uint8Array): Promise<PreparedBlob>`. 업로드만 하고 단정하지 않는다. 실패하면 code를 담아 던진다. 뒤의 `annotation-archived-app`은 업로드가 필요 없다(screenshot 없이 보낸다).

## 할 일

1. `Deno.test` 하나. `createRun` → `startFakeServer` → `bootCore(run)` → `connectFakeProvider`. 앱 둘 `A`, `B`를 `core.call(appCreate, {slug, name, description})`로 만든다(source 폴더·release 없음). PM이나 project는 만들지 않는다. 행은 `ROWS: { name; run(ctx) }[]` table이고 `t.step`으로 차례로 돈다. `finally`: `core.kill()`, `fake.close()`, `run.remove()`.
2. 공통 값: screenshot은 1x1 PNG 상수 byte열 하나(유효한 PNG). annotation 입력은 test 안의 작은 함수 하나(`annotationOf(release, screenshot)`)가 literal로 만든다: `n: 1`, `kind: "element"`, `note: "NOTE-MARK"`, `component: "List > Card > Button"`, `element: {role: "button", name: "Save", text: "Save"}`, `rect`는 값 여섯, `view: {screen: "home", path: "/"}`. `ship(ctx, app, session, withScreenshot)` 하나가 업로드(필요하면) + `annotationSend`를 묶는다. 행의 단계 수에서는 한 단계로 센다(support가 아니라 test 안의 함수다. 흐름의 단계를 숨기지 않는다).
3. 행 셋. 행 3은 행 1이 만든 A의 annotation id를 쓴다(행 순서에 기댄다. 보고에 적는다).

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `new-session` | `fake.script`(아래) → `ship(A, session: null, screenshot 있음)` → `waitTurnEnd(core, 돌려받은 session, 0)` → 읽기 | ① 함수: 마지막 user 글에서 `idIn(..., "ann")`으로 annotation id를 뽑아 tool `image_read {path: "annotation:<id>"}` ② text | inbox: 돌려받은 session의 `agentSessionRead`가 `app_engineer`이고 A의 것이며, `receivedMessageList`에 사람 메시지 하나가 있고 refs에 그 annotation id가 있다 / fake: 둘째 model 요청의 tool_result에 image block이 있고 그 base64가 업로드한 byte와 같다(upload → blob → `annotationsGet` → `screenshot_path` → runtime 읽기 전부가 지났다) / ledger: `annotationsGet {batch}`(user)가 앱 A, 보낸 `release`, `view.screen`, `screenshot.hash`(= `sha256Hex(bytes)`)를 그대로 돌려준다 | 후보 `annotation-to-ae`(candidates-docs 11절이 적은 252~256, 266행). `session: null`은 새 session이다 |
| `open-session` | `openSession(core, {role: "app_engineer", app: A})` → `fake.script` → `ship(A, session: 그것, screenshot 없음)` → `waitTurnEnd(core, 그것, 0)` → 읽기 | ① text | route: `annotationSend`의 출력 `session`이 준 session과 같다 / inbox: 그 session의 `receivedMessageList`에 이 annotation을 refs로 가진 메시지가 하나이고 `turn`이 이 turn이다 / fake: 그 model 요청의 마지막 user 글에 `NOTE-MARK`가 있다 | 후보 `annotation-to-ae`(candidates-docs 11절이 적은 272행: "지정한 session이 그 앱 App Engineer의 열린 session이면 거기로") |
| `other-app` | `openSession(core, {role: "app_engineer", app: B})` → `fake.script` → `say(core, 그것, "read it")` → `waitTurnEnd` → `core.tryCall(annotationSend, {app: A, session: B의 session, annotations: [...]})` | ① tool `image_read {path: "annotation:<행 1의 id>"}` ② text | ledger: B session의 `toolCallList`에서 `image.read` 호출이 실패로 닫혔고 실패 code가 `not_found`다(`toolOutcomeSchema`에서 칸을 읽는다) / fake: 둘째 model 요청의 tool_result에 image block이 없다 / route: 앱 A로 B의 App Engineer session에 보내면 `conflict`다 | 후보 `annotation-to-ae`("다른 앱의 AE는 not_found", candidates-docs 11절이 적은 254행), 후보 27. 행 1의 annotation은 screenshot이 있으므로 앱 검사가 풀리면 읽힌다(없으면 다른 이유의 `not_found`가 되어 헛통과한다) |

   fake 대답은 행마다 둘 이하다. 행 1의 ① 함수 대답은 reply-fn의 함수 대답이다(core가 만든 annotation id를 tool 인자에 넣는다).
4. 어긋나면 제품 bug다. 의심: App Engineer runtime의 읽기 권한이 blob object 파일(data root)에 닿지 않아 `image_read`가 막히는 것(README "정한 것" 7은 읽기 권한에 data root가 있다고 적는다). 추가 소유 안에서만 고치고 "고치기 전 코드에서 실패"를 보고에 적는다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `apps`(annotation 저장은 앱 하나 범위이고 신원은 shell main이 정한 값으로 들어온다)·`router`(전달은 그 앱 App Engineer에게 사람 메시지 하나다)·`agent-tools`(`image_read`가 `annotation:<id>`를 core가 agent 자격의 앱으로 거른 screenshot으로 연다)·`core-api`.
- 현실적 회귀: 다른 앱의 annotation(앱 화면 속 정보, screenshot)을 다른 앱의 App Engineer가 읽는 것, 보내기가 다른 앱의 session으로 가는 것, 저장한 screenshot이 model에 실리지 않는 것(blob 경로·권한), 사람이 아닌 자격이 저장하는 것.
- 왜 지금 test가 못 잡나: `annotations_test.ts`는 저장과 읽기를 따로 보고, upload → blob → Router → App Engineer turn → runtime의 `image_read` → model 요청까지 이어지는 길은 process를 건너야 한다. 지금 E2E 7개에는 없다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/annotation_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/annotation_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "annotation은 그 앱 App Engineer에게만 가고, screenshot은 그 앱 App Engineer만 model에 싣는다"

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 찾은 제품 bug: 증상, 재현하는 행, 의심 file. 고쳤으면 "고치기 전 코드에서 그 행이 실패한 것"의 출력 한 줄
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

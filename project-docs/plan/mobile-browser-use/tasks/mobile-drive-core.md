# mobile-drive-core

**opus high.** core에 `phone` 탭을 짓는다. `tabs/open`의 `phone` target을 `--preview`와 같은 검사로 받아 core의 탭 표에 올리고(desktop shell에는 보내지 않는다), 그 탭의 `browser/snapshot|act|screenshot|wait|read`를 부를 때마다 그 앱의 preview view를 열어 둔 기기와 view를 골라 `ctx.phoneLink.call`로 `drive.*`를 묻는다. ref 번호, snapshot 글, 폰 오류를 정한 문장으로 바꾸기, 안 되는 동작의 `invalid_input`, secret redaction을 core가 한다.

- 단위: drive-core (wave 2)
- 선행: mobile-drive-contract. **`mobile-app`, `mobile-user-apps`, `mobile-widgets` 계획이 main에 land되고 `mobile-coding-agents`의 `mobile-host-link-cleanup`이 main에 있은 뒤에 띄운다**(아래 host queue file을 cleanup이 고친다. `ctx.phoneLink`는 `mobile-widgets`의 `mobile-phone-link`가 만든다)
- 소유(이 task만 고친다):
  - `packages/core/host-queue/queue.ts`
  - `packages/core/host-queue/queue_test.ts`
  - `packages/core/host-queue/phone.ts`(새 file)
  - `packages/core/host-queue/phone_test.ts`(새 file)
  - `packages/core/main/daemon/wiring/host-queue.ts`
  - `packages/core/main/daemon/wiring/host-queue_test.ts`
  - `packages/core/apps/views/mod.ts`(view 표에서 그 앱의 열린 preview view를 고르는 함수 하나)
- 한 줄씩 허락(공유 file. 줄만 더하고 "넘길 줄"에 적는다): `packages/core/main/daemon/wiring/context.ts`(view module이 아직 ctx에 없으면 늦은 칸 `appViews` 한 줄과 `LATE_KEYS`), `packages/core/main/daemon/wiring/apps.ts`(그 칸을 `ctx.provide`하는 한 줄)
- 읽을 것:
  - 결정과 계약: 계획 `README.md`의 "정한 것" 전부, `packages/protocol/phone/drive.ts`(`mobile-drive-contract`: kind, `driveNodeSchema`, 거절 이유, `PHONE_TAB_TEXT`, snapshot 글 규칙), `packages/protocol/phone/kinds.ts`, `packages/protocol/lophn-agent/host-queue.ts`(`tabsOpen`의 `phone` target, browser route)
  - 지금의 탭: `packages/core/host-queue/queue.ts`(`TabEntry`, `openTab`, `single`, `browserTab`, close·show), `packages/core/main/daemon/wiring/host-queue.ts`(`createTabHandlers`: `owner`, `open`의 `preview` 갈래(앱 workspace 검사, 앱 있음, `deps.preview`의 `conflict` 문장), `call`(주인 대조, `queue.callBrowser`, `deps.redact`), `textOf`·`jsonOf`, 각 browser route), test 꼴 `host-queue_test.ts`
  - 폰 link: `ctx.phoneLink`(`packages/core/remote/phone-link.ts`, `mobile-phone-link`: `call({device, kind, input, deadline_ms})`가 `Result`. `unavailable`의 `details.reason` `phone_unreachable`·`unsupported`·`timeout`·`phone_in_background`), `packages/core/remote/call.ts`(`devicePrincipal` = `device:<id>`)
  - view 표: `packages/core/apps/views/{mod,table}.ts`(`ViewEntry`의 `owner`, `args.mode`·`args.app`·`args.screen`, `lost`, `used`), `packages/core/main/daemon/wiring/apps.ts`(view module을 만드는 곳, `mobile-remote-gate`가 그것을 다른 wiring에 넘긴 길이 있으면 그 길을 쓴다)
  - desktop의 같은 것: `packages/shell/main/browser/agent/snapshot.ts`(줄 쓰기, counter, 자르기), `project-docs/architecture/browser-tab.md`(ref, take control, 정한 문장, 주인)
  - 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/browser-use-survey.md`의 2(a)(d)(e)와 6의 1(위 결정이 이긴다: event·답 route·pending 표는 없다. 기다림은 `PhoneLink`가 한다)
- 계약:
  - 쓰는 것: 위 계약 file, `PhoneLink.call`, view module
  - 내놓는 것: `tabs/open {target: {phone: {app, screen}}}`와 phone 탭의 browser route 동작(아래). 폰 쪽(`mobile-drive-phone`)은 core가 `view`·`by`·`snapshot`을 계약대로 싣는다는 것에만 기댄다

## 할 일

1. view 고르기(`apps/views/mod.ts`): `previewViews(app): {owner, view, screen, used}[]`를 내놓는다. `args.mode === "preview"`, `args.app === app`, `lost === null`이고 owner가 `device:`로 시작하는 view만. live view, shell(사람·desktop) owner의 view는 결코 내지 않는다.
2. 탭(`queue.ts`): `TabEntry.kind`에 `"phone"`과 phone 칸(`app`, `screen`)을 더한다. 열기는 표에만 올리고 shell queue에 요청을 넣지 않는다(`single` = `phone:<app>`. 있으면 그 탭을 돌려주고 주인이 새로 연 쪽이 된다, preview 탭과 같다). `browserTab`은 phone 탭에 `{view: "phone"}`, `tabs/close`는 표에서만 지우고, `tabs/show`는 `invalid_input`(`PHONE_TAB_TEXT.noShow`).
3. 열기(`wiring/host-queue.ts`의 `open`): `phone` 갈래는 `preview` 갈래의 검사를 그대로 쓴다(남의 앱 `not_found`, 없는 앱 `not_found`, 도는 preview가 없으면 같은 `conflict` 문장). 이어서 `previewViews`(screen이 있으면 그 screen만)가 비면 `unavailable`(`notShowing`)로 곧바로 끝낸다(열지 않는다). 탭은 기기·view를 쥐지 않는다.
4. 부르기(`phone.ts`, wiring의 `call`에서 `view === "phone"`이면 이리로): 매번 `previewViews`에서 가장 최근 쓴 것을 골라(없으면 `notShowing`) `device`(owner의 `device:` 뒤)와 `view`를 얻고, `by`(session의 agent 이름. 사람 token이면 "Someone on your computer")를 붙여 `ctx.phoneLink.call`을 부른다(deadline은 `PHONE_KINDS`의 값, wait는 `timeout_ms + 5_000`). 응답 `value`를 kind의 output schema로 검사한다(틀리면 `internal`).
   - snapshot: 탭마다 늘기만 하는 counter로 node마다 `eN`을 매기고 `eN → {view, snapshot, node}` 표를 그 탭의 것으로 간다. 글은 계약의 규칙대로(첫 줄 `screen <key> <w>x<h>dp`). 결과는 `{snapshot}`
   - act: `click|type|fill|press(key Enter만)|scroll`만. ref가 마지막 표에 없거나 표의 view가 지금 고른 view가 아니면 폰에 묻지 않고 `conflict`(`staleRef`). 나머지 act(`hover`, `select`, `fill_login`, Enter 밖의 `press`)는 `invalid_input`(`unsupported(<이름>)`). 결과는 `{url: "phone://<app>/<screen>", title: <screen>}`
   - screenshot: 기본 `format: "jpeg"`. 결과 image의 `media_type`은 폰이 준 값
   - wait: `text`만(`url`은 `invalid_input`). `found: false`면 desktop wait와 같은 `unavailable` 문장(`The condition did not hold within <ms> ms. …`)
   - read: 폰에 묻지 않고 `{url, title, loading: false}`
   - navigate, evaluate, logs, frame_origin 같은 그 밖의 route는 `invalid_input`(`unsupported`)
   - 오류 바꾸기: `unavailable`의 `phone_unreachable`·`no_preview` → `notShowing`, `phone_in_background`·`screen_off` → `notInFront`, `unsupported` → `tooOld`, `timeout` → `timedOut`. `conflict`의 `taken_over` → `takenOver`, `stale_ref` → `staleRef`, `off_screen` → `offScreen`. 그 밖의 폰 오류는 code를 지키고 message를 그대로 둔다
   - 글(snapshot, act·wait의 page)은 desktop처럼 `deps.redact`를 거친다. 못 끝내면 내보내지 않는다
5. test(`phone_test.ts`, `host-queue_test.ts`의 표): 메모리 view 표와 가짜 `phoneLink`로 아래 위험 test와 정상 경로 하나(open → snapshot → click → screenshot)를 쓴다. server, subprocess를 띄우지 않는다.
6. flows catalog: `tabs/open`의 새 갈래와 outcome, phone 탭 browser route의 outcome, 새 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`가 통과한다.
- 위험 test(agent 권한 경계라 둔다):
  - "agent는 자기 앱 workspace가 아닌 앱의 phone 탭을 열지 못하고(`not_found`), 남의 session이 연 phone 탭을 부르지 못한다(`not_found`)"
  - "요청은 그 앱의 preview view를 연 기기에만 가고, live view나 기기가 아닌 owner의 view는 고르지 않으며, preview view가 없으면 폰에 묻지 않고 `unavailable`이다"
  - "마지막 snapshot이 아닌 ref와 다른 view의 ref는 폰에 묻지 않고 `conflict`다"
- 남지 않음: 없음(더하기뿐).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 위험 test의 test 이름, snapshot 글의 예(가짜 node로), 넘길 줄(`context.ts`, `wiring/apps.ts`), `by`를 어디서 읽었는지.

# annotation-core

annotation의 core 쪽을 짓는다: 보낸 묶음과 annotation 저장(screenshot은 blob), 앱 source 위치 풀기, App Engineer에게 들어갈 `<lophn-annotation>` 메시지 만들기와 Router 전달, ticket 근거로 읽기, 남기는 기간. 새 module `core/apps/annotations/`이다.

- 단위: annotation (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/annotations/` (새 폴더. 단 `ports.ts`는 contract-app-calls-annotation 소유다. 읽기만 한다)
  - `packages/core/main/daemon/wiring/annotations.ts` (새 file. `core-wiring-split.md`의 `Wiring` 꼴)
- 읽을 것:
  - spec: S9 5~10장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/annotation.md`
  - spec: S4 5·6장(입력 tag의 escape와 속성 scrub) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`): 이 단위는 assignment.md에 줄이 없다. 이 task가 쓰는 줄은 `I3.12#2`(source 위치 풀기. assignment.md에서는 releases-problems 몫이지만 풀기는 이 task가 한다. 보고에 적혀 있다). 문맥으로 `I3.3#17`(Router가 받는 쪽은 router 단위), `I3.6#21`(ticket 근거는 coding-agent 단위)
  - 결정: `/home/pyosechang/projects/lophn/project-docs/plan/README.md` 3장 #112
  - 지금 코드: 본보기 `packages/core/apps/tickets/{blobs,commands,reads,schema}.ts`(blob 선언, 영구 참조 등록, 표), `packages/core/storage/blobs/mod.ts`(쓰는 법만. platform 소유)
- 계약:
  - 쓰는 것: `protocol/apps/annotation.ts`(값, `annotationSend`·`annotationUploadScreenshot`·`annotationsGet`), `core/apps/annotations/ports.ts`(`AnnotationDelivery`, `ReleaseSourceMaps`를 받고 `AnnotationLookup`을 내놓는다), `protocol/apps/apps.ts`의 `AppRegistrationLookup`(앱 존재와 보관 여부), 입력 tag 상수 `lophn-annotation`(contract-agent-tools가 `protocol/lophn-agent`에 둔다)
  - 내놓는 것: `createAnnotations(deps): {send, lookup, retention}`와 route handler 등록 함수(`annotation.send`, `annotation.upload_screenshot`, `annotations.get`), schema step, blob 선언(`ANNOTATION_BLOB_FIELDS`, `ANNOTATION_BLOB_PURPOSES`), 보관 기간 함수 `retention`(`addRef`, `removeRefs`, `sweep`). lead가 core 조립에 잇고 Router·release 읽기·ticket 쪽 구현을 인자로 넣는다. coding-agent의 `core/apps/tickets`가 `AnnotationLookup`으로 근거를 읽는다.

## 할 일

모두 `packages/core/apps/annotations/` 안의 새 file이다.

1. `schema.ts` — 표 셋 (S9 9장)
   - `annotation_batches`: `id`, `app`, `sent_at`, `sent_by`.
   - `annotations`: `id`, `batch`, `app`, `n`, `kind`, `note`, `screenshot_hash`, `screenshot_size`, `component`, `source_file`, `source_line`, `element`(JSON), `rect`(JSON), `view`(JSON), `release`, `bundle_position`(JSON, 읽을 때 쓰지 않는다. 저장은 풀지 못했을 때 다시 풀 근거로 남긴다).
   - `annotation_refs`: `annotation`, `owner_kind`(`session_message` | `ticket`), `owner_id`. (annotation, owner) 유일.
2. `blobs.ts` — purpose `ANNOTATION_SCREENSHOT_PURPOSE`(최대 `ANNOTATION_SCREENSHOT_MAX_BYTES`), field `annotation.screenshot`(permanent, general_read false). 선언 방식은 `tickets/blobs.ts`와 같다.
3. `source.ts` — source 위치 풀기 (`I3.12#2`, 결정 #112). 순수 함수 `resolveSource(sourceMapJson, line, column): {file, line} | null`과 이를 쓰는 `resolveAll(deps, annotations)`.
   - source map v3의 `mappings`(VLQ)를 직접 읽는다. 의존성을 더하지 않는다. 생성 위치(줄, 열)에 가장 가까운 앞쪽 segment의 원래 `sources` 파일과 줄을 돌려준다. `sources` 항목은 `webpack://`·`file://` 접두와 앞의 `../`를 걷어 앱 source 기준 상대 경로로 만든다.
   - source map 본문은 `ReleaseSourceMaps.sourceMap(app, release, bundle_position.file)`로 받는다. 같은 release·file은 요청 안에서 한 번만 읽는다. 위치가 없거나(`bundle_position` null) map이 없거나 못 풀면 `source`와 `component` 가운데 `source`만 null로 둔다(S9 10장: 못 얻으면 비우고 `element`와 `rect`로 보낸다).
4. `message.ts` — 메시지 만들기 (S9 8장). 순수 함수 `renderAnnotationMessage(batch, annotations, screenshots)`가 `{text, images}`를 돌려준다.
   - annotation마다 블록: `<lophn-annotation n kind app release view>` 안에 `Note:`, `Component:`, `Source:`, `Element:`, `Area:` 줄(값이 없는 줄은 빼고, 메모가 비면 `Note: (none)`), 닫는 tag. 이미지가 있으면 그 블록 바로 뒤에 `[image: Annotation N. ...]` 줄. screenshot이 없으면 그 블록 안에 한 줄 `Screenshot: not captured.`를 넣는다(S9 10장). 묶음의 annotation을 번호 순서로 이어 붙인다. screenshot은 `<lophn-untrusted>`로 감싸지 않는다(S9 13장 3).
   - 메모와 `Element:` 글에 든 닫는 tag(`</lophn-annotation>`)는 escape하고 tag 속성 값은 따옴표·꺾쇠·줄바꿈을 걷는다(S4 6장과 같은 규칙). S4 6장의 공용 helper가 있으면 그것을 쓰고, 아직 없으면 이 file 안에 작게 두고 보고한다.
5. `store.ts`, `commands.ts` — 저장. `persist(input)`: 한 transaction으로 묶음·annotation·screenshot 영구 참조(`registerBlobRef`)를 쓴다. 보관한 앱이면 쓰기 전에 `conflict`. 실패한 뒤 정리하는 `discard(batch)`도 둔다.
6. `send.ts` — `annotation.send` handler (S9 7장)
   - 순서: 앱이 있고 보관되지 않았는지(`AppRegistrationLookup`) → source 풀기(`resolveAll`) → `persist` → 메시지 만들기 → `AnnotationDelivery.deliver`. deliver(입력의 `session`을 그대로 넘긴다)가 실패하면 `discard`하고 그 오류(`conflict`면 "보관한 앱이라 새 입력을 받지 않는다" 이유)를 그대로 돌려준다. 성공하면 `addRef(annotation, "session_message", message)`를 남기고 `{batch, annotations, session, message}`를 돌려준다. 보내기는 사람의 동작이라 Gate를 거치지 않는다.
7. `reads.ts` — `annotations.get` handler와 `AnnotationLookup` 구현. 읽는 쪽 값에 `screenshot_path`를 싣는다(blob store의 object 파일 경로. 경로를 만드는 함수는 `storage/blobs`의 것을 `deps`로 받는다). 범위 밖 앱은 없는 것과 같은 `not_found`.
8. `retention.ts` — 남기는 기간 (S9 9장 끝). `addRef`, `removeRefs(owner_kind, owner_id)`, `sweep()`: ref가 하나도 없는 annotation과 비게 된 묶음을 지우고 blob 참조를 푼다. `sweep`을 언제 부르는지는 lead 조립이 정한다(시작 때와 하루 한 번 정도. 보고).
9. `upload.ts` — `annotation.upload_screenshot` handler. `ticketUploadSummary`의 handler와 같은 방식으로 blob 준비에 올린다.
10. `mod.ts` — 위 내보내기.
    - `wiring/annotations.ts`: `Wiring { name: "annotations" }`. `schemaSteps`, `operations`(`annotation.send`는 user, `annotations.get`은 user·coding agent·agent), `build`(`Built.memory`에 `annotation.send`, `Built.uploads`에 `annotation.upload_screenshot`, `Built.reads`에 `annotations.get`), `start`(`sweep` 한 번). 다른 module에서 받는 `AnnotationDelivery`와 `ReleaseSourceMaps`는 `WiringContext`의 이름 있는 칸으로 읽는다(wiring끼리 import하지 않는다). 칸이 없으면 `wiring/context.ts`(lead)에 더해 달라고 보고한다. `AnnotationLookup`은 coding-agent가 읽도록 `WiringContext` 칸으로 내놓는다고 보고한다.
11. 위험 test 한 file `annotations_test.ts`: 가짜 `AnnotationDelivery`·`ReleaseSourceMaps`·`AppRegistrationLookup`과 in-memory SQLite를 쓴다.
12. (lead가 맞추며 더함) annotation 보내기는 `AnnotationDelivery` port로 받을 session을 찾거나 연다. 구현은 lead가 wiring에서 router와 places-sessions 조각으로 끼운다. 이 task는 port를 부르기만 한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`packages/core/apps/annotations/annotations_test.ts`):
  - "보관한 앱으로 보내면 거절되고 아무것도 저장되지 않는다"
  - "보낸 묶음은 저장되어 id로 읽히고 메모·component·source 위치·screenshot 경로가 나온다"
  - "메모와 요소 글에 든 닫는 tag는 escape되어 메시지의 tag를 닫지 못한다"
- 남지 않음: 해당 없음(새 폴더).

## 보고

- 바꾼 file
- 등록할 것: `assembly.ts`의 `WIRINGS`에 `annotations` 한 줄, `WiringContext`에 더할 칸(`annotationDelivery`, `releaseSourceMaps`, `annotationLookup`)과 그 칸을 채우는 단위(Router/places-sessions, releases-problems, 이 task), `retention.sweep`을 부르는 때. ticket 쪽이 `retention.addRef(…, "ticket", …)`를 부르는 곳(coding-agent)
- 안 쓰게 된 export: 없음
- 정한 것: tag 본문 escape를 이 module 안에 따로 둔 것(core module끼리 직접 import하지 못해 agent-definition의 `annotationBlock`·`escapeTagBody`를 쓸 수 없다. 두 구현이 어긋나지 않는지 lead가 본다), ref가 없는 annotation을 `sweep`으로 지우는 것, source를 풀지 못했을 때 비우는 것, 메시지의 `Note: (none)`·`Screenshot: not captured.` 문구
- 계약 바꾸기 요청(wave 3): `ports.ts`나 route 입력에서 모자란 칸

- (lead가 더함, coding-agent-tickets가 넘긴 것) ticket이 annotation을 읽는 port key `TicketAnnotationLookup`(name "apps.AnnotationLookup")을 `tickets/ports.ts`에 임시로 두었다. annotation이 같은 key로 등록한다. 없으면 ticket의 annotation 값은 null이다.
- (lead가 더함, agent-definition-input-tags가 넘긴 것) annotation 본문의 escape는 `prompt-assembly/input-tags.ts`의 `escapeTagBody`를 쓴다(따로 만들지 않는다).

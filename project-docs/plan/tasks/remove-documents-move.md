# remove-documents-move

지워질 문서 module 안에 있지만 남이 쓰는 것을 먼저 옮기고, 쓰는 곳을 새 위치로 돌린다. 옛 module을 지우는 일은 하지 않는다(`remove-documents-core`가 한다). 옮기는 넷: worker 요청 통로(`DocumentsChannel`), `createProductRedactor`, `exactBytes`, `formatForMediaType`(열기 가능한 형식 판별로). `.gitignore` 일치와 설치 안내 manifest reader는 옮기지 않는다(아래 "정한 것").

- 단위: remove-documents (wave 1)
- 선행: core-wiring, remove-app-extras-tools
- 소유(이 task만 고친다):
  - `packages/base/redaction/`
  - `packages/core/projects/file-tracking/`
  - `packages/core/projects/formats/`
  - `packages/core/projects/outline-and-search/`
- 추가 소유(lead 승인, 2026-10-16. 소유와 같이 고친다. 지운 것을 가리키는 줄만 고친다. core·shell 조립이 wiring file로 쪼개졌으면 그 줄이 옮겨 간 wiring file이 대신한다. "등록 file(lead)"도 지운 것을 가리키는 줄만 뺀다.):
  - 새 file: `packages/core/supervision/responsiveness/worker-channel.ts`와 같은 폴더의 `mod.ts`(export 한 줄)
  - 새 file: `packages/core/storage/blobs/exact-bytes.ts`
  - 새 file: `packages/protocol/projects/openable-format.ts`(`protocol/projects/mod.ts`의 export 한 줄은 "등록할 것")
  - 쓰는 곳 고치기: `packages/core/main/daemon/wiring/context.ts`(`createWorkerChannel`·`createProductRedactor`를 가져오는 단일 import 지점), `packages/core/main/daemon/runtime.ts`, `packages/core/approvals/text-prepare.ts`, `packages/core/apps/revert/caller.ts`, `packages/core/apps/tickets/summary-upload.ts`, `packages/core/problems/repairs/context.ts`, `packages/core/problems/repairs/fix-summary-upload.ts`, `packages/core/problems/reporting/collector.ts`, `packages/core/problems/tests/control.ts`, `packages/core/lophn-agent/observability/trace-export.ts`, `packages/core/lophn-agent/session/message-body.ts`, `packages/core/lophn-agent/tools/handoff/body.ts`, `packages/core/lophn-agent/tools/questions/text-prepare.ts`
- 읽을 것:
  - spec: 없음. 근거는 순서 제약 — `/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md` 6장 첫 네 줄과 "`formats/model.ts`의 `formatForMediaType`", "`exactBytes`"
  - 삭제 목록: `/home/pyosechang/projects/lophn/project-docs/tmp/notes/removed.md` 1장
  - inventory: `I6#1`, `I6#2`, `I6#28`, `I6#31`(lead 몫 줄을 이 task가 한다), `I2.10#11`, `I2.10#13`
  - 이어 받는 brief: `/home/pyosechang/projects/lophn/project-docs/plan/tasks/core-wiring-split.md`(`wiring/context.ts`), `agent-tools-file.md`(`formatForMediaType`를 찾아 쓴다)
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `code-map.md`, `testing.md`
- 계약:
  - 쓰는 것: `packages/protocol/supervision`의 `ChildMessage`, `WorkerRequest`, `WorkerResponse`
  - 내놓는 것(뒤 task와 wave 3 task가 기댄다):
    - `WorkerChannel`, `createWorkerChannel(options?: { drainMs?: number })`, `REPLACE_DRAIN_MS` (`core/supervision/responsiveness/mod.ts`에서 내보낸다). 모양은 옛 `DocumentsChannel`과 같다: `request(op, payload, timeoutMs?)`, `onMessage`, `bind`, `bound`, `replacing`, `failPending`
    - `createProductRedactor(known?)`, `TextRedactor` (`base/redaction/mod.ts`). `known`은 `{ ready: boolean; match(text): { index; length } | undefined }`
    - `exactBytes(source, size, mismatch)` (`core/storage/blobs/exact-bytes.ts`)
    - `formatForMediaType(mediaType): "document" | "pdf" | "image" | "data"`(옛 함수를 그대로)와 `openableKind(path): "text" | "image" | "pdf" | null`(확장자만 보고 가른다. null은 모르는 확장자) (`protocol/projects/openable-format.ts`)

## 할 일

1. **worker 요청 통로** (I6#1)
   - `core/projects/file-tracking/coordinator/serving.ts`에서 `DocumentsChannel` type, `createDocumentsChannel`, `REQUEST_TIMEOUT_MS`, `REPLACE_DRAIN_MS`를 `core/supervision/responsiveness/worker-channel.ts`로 옮기고 `WorkerChannel`, `createWorkerChannel`로 이름을 바꾼다. 메시지 문자열의 "documents worker"는 "worker"로, request id 접두 `documents-request-`는 `worker-request-`로 바꾼다.
   - `responsiveness/mod.ts`에 export를 더한다. serving.ts의 `statusMemoryVia`는 `WorkerChannel`을 받게 한다(이 함수는 file-tracking과 함께 지워진다).
   - 쓰는 곳을 돌린다: `wiring/context.ts`의 `createDocumentsChannel` import(이 한 곳을 고치면 wiring은 따라온다. 변수 이름의 `documents`도 뜻에 맞게 바꾼다), `apps/revert/caller.ts`, `problems/repairs/context.ts`, `problems/reporting/collector.ts`, `problems/tests/control.ts`. coordinator 통로(`documentsChannel`) 변수가 남아 있으면 이름만 바꾼다. 지우는 일은 `remove-documents-core`가 한다.
2. **redactor** (I6#2, I2.10#13)
   - `core/projects/outline-and-search/redactor.ts`를 `base/redaction/product-redactor.ts`로 옮긴다. `DocumentRedactor`는 `TextRedactor`로 이름을 바꾼다. core의 `KnownSecretMatch`는 base가 import할 수 없으니 같은 모양의 type을 base에 둔다(`{ match; readonly ready }`). `base/redaction/mod.ts`에서 내보낸다.
   - 쓰는 곳을 `base/redaction`으로 돌린다: `wiring/context.ts`(단일 import 지점), `main/daemon/runtime.ts`, `approvals/text-prepare.ts`, `lophn-agent/{tools/handoff/body, tools/questions/text-prepare, observability/trace-export, session/message-body}.ts`, `outline-and-search/reader.ts`.
   - `tools/tool-documents.ts`는 `remove-app-extras-tools`가 이미 지웠다. 남아 있으면 멈추고 보고한다.
3. **exactBytes** (I6#31): `file-tracking/routes/upload.ts`의 `exactBytes`를 `core/storage/blobs/exact-bytes.ts`로 옮긴다. `apps/tickets/summary-upload.ts`, `problems/repairs/fix-summary-upload.ts`, `upload.ts` 자신이 새 위치를 import한다.
4. **열기 가능한 형식** (I6#28, I2.10#11): `core/projects/formats/model.ts`의 `formatForMediaType`(와 그것이 쓰는 `DOCUMENT_MEDIA_TYPES`·`PDF_MEDIA_TYPE` 값)을 새 `protocol/projects/openable-format.ts`로 옮긴다. 이 file은 옛 `formats`·`protocol/projects/formats.ts`를 import하지 않는다(값을 이 file 안에 둔다). 같은 file에 `openableKind(path)`를 더한다. 확장자 표만 쓰는 순수 함수다. text(md, txt, html, json, yaml, toml, 코드 확장자 등), image(png, jpg, jpeg, gif, webp, svg), pdf만 가른다. 알 수 없는 확장자는 null이다(text로 열 수 있는지는 부르는 쪽이 byte로 정한다). 옛 `formatForMediaType`의 쓰는 곳은 모두 지워질 module 안(`versions/work.ts`, `outline-and-search/reader.ts`)이다. 옛 정의는 module과 함께 지워진다.
5. **위험 test 하나**: `base/redaction/product-redactor_test.ts`. 순수 함수로 본다. 알려진 secret 값과 고정 prefix credential은 `REDACTION_REPLACEMENT`로 바뀐다. `known.ready`가 false면 null을 돌려 원문이 나가지 않는다.
6. `deno task check`를 돈다. type check가 알려 주지 않는 것은 grep으로 찾는다: `grep -rn "createDocumentsChannel\|DocumentsChannel\|DocumentRedactor\|outline-and-search/redactor" packages`.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "알려진 secret이 가려지고, 알려진 값을 아직 다 모르면 null로 답해 원문이 나가지 않는다"
- 남지 않음: `grep -rn "createDocumentsChannel\|DocumentsChannel\|DocumentRedactor\|outline-and-search/redactor\|file-tracking/routes/upload" packages tools`가 0줄이다. 옛 module 안의 `exactBytes` 정의도 없다.

## 보고

- 바꾼 file
- 등록할 것: `protocol/projects/mod.ts`에 `openable-format.ts` export 한 줄. `core/supervision/responsiveness/mod.ts`는 추가 소유가 승인되지 않았다면 export 한 줄을 여기 적는다
- 안 쓰게 된 export: 옛 module 안의 `formatForMediaType`(module과 함께 지워진다)
- 정한 것:
  - `.gitignore` 일치(I6#29)는 옮기지 않았다. `registry/rules.ts`의 `gitignoreExcludes`·`symlinkEscapesRoot`는 places-sessions-projects가 남기고 `registry/mod.ts`로 내놓으며 places-sessions-search가 쓴다. 폴더 `core/projects/search/`는 그 단위의 새 폴더라 이 task가 만들지 않는다
  - 설치 안내 manifest reader(`versions/guides.ts`, I6#30)는 옮기지 않았다. agent-definition-roles가 안내를 text module(`guideTopics()`·`guideText()`)로 읽게 정해서 쓰는 곳이 없다. `remove-documents-core`가 `versions/`와 함께 지운다. lead가 다르게 정하면 알려 달라
  - 새 file의 위치와 이름, `TextRedactor`, `openableKind`의 확장자 표
- 계약 바꾸기 요청: 없음

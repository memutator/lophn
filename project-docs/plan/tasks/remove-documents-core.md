# remove-documents-core

core의 문서 옛 체계를 통째로 지운다: file-tracking(관측·준비 worker·hash 비교 쓰기·`files.*` handler), versions(판), series, addressing(문서 주소·이름 예약), formats(format module·QuickJS), outline-and-search(목차·FTS·export)와 두 worker 입구. 문서가 디스크 파일 하나가 되어 대체 없이 없어진다. 새 `files.*`와 키워드 검색은 wave 3 places-sessions가 짓는다.

- 단위: remove-documents (wave 1)
- 선행: remove-documents-move, remove-app-extras-tools, core-wiring
- 소유(이 task만 고친다):
  - `packages/core/projects/file-tracking/`
  - `packages/core/projects/versions/`
  - `packages/core/projects/series/`
  - `packages/core/projects/addressing/`
  - `packages/core/projects/formats/`
  - `packages/core/projects/outline-and-search/`
  - `packages/core/main/worker/coordinator-entry.ts`
  - `packages/core/main/worker/preparation-entry.ts`
- 추가 소유(lead 승인, 2026-10-16. 소유와 같이 고친다. 지운 것을 가리키는 줄만 고친다. core·shell 조립이 wiring file로 쪼개졌으면 그 줄이 옮겨 간 wiring file이 대신한다. "등록 file(lead)"도 지운 것을 가리키는 줄만 뺀다. 모두 지운 module을 쓰던 곳이다):
  - projects: `packages/core/projects/register.ts`, `packages/core/projects/mod.ts`, `packages/core/projects/registry/commands.ts`(이름 예약)
  - apps: `packages/core/apps/register.ts`(이름 예약 port 등록), `packages/core/apps/registration/commands.ts`·`mod.ts`(`reserveSlug`)
  - server: `packages/core/server/credentials.ts`(`DOCUMENTS_FEED_PRINCIPAL`)
  - worker: `packages/core/main/worker/main.ts`(coordinator·preparation 입구 분기)
  - 조립: `packages/core/main/daemon/` 아래 문서 module을 아직 import하는 file(core-wiring-trim 뒤에는 거의 없다)
  - blob: `packages/core/storage/blobs/{purposes.ts, child-prepare.ts, prepare-worker-probe.ts}`
- 읽을 것:
  - spec: S1 12장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - 삭제 목록: `/home/pyosechang/projects/lophn/project-docs/tmp/notes/removed.md` 1장
  - inventory: `I1.1#4`(feed.ts 몫만), `I1.1#8`(Document*·Series*·FileWritten 계열 event의 core 쪽 쓰기), `I1.5#19`(이름 예약 부분만), `I1.10#1`, `I1.10#2`, `I1.10#3`, `I1.10#4`, `I1.10#5`, `I1.10#6`, `I1.10#7`, `I1.10#8`, `I1.10#10`, `I1.10#13`, `I2.11#21`(지우는 소유처의 blob 소유 종류 등록만) — `../assignment.md`에서 이 task가 맡은 줄
  - 순서 제약: `/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md` 6장 첫째 줄
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `code-map.md`
- 계약:
  - 쓰는 것: `remove-documents-move`가 내놓은 `WorkerChannel`(`core/supervision/responsiveness`), `createProductRedactor`(`base/redaction`), `exactBytes`
  - 내놓는 것: 없음(지우기만 한다). protocol의 문서 file은 `remove-documents-protocol`이 이어서 지운다

## 할 일

1. 소유 폴더 여섯과 `main/worker/{coordinator-entry,preparation-entry}.ts`를 지운다. (I1.10#1~#8, #10, #13)
   - `file-tracking/`: coordinator, worker(관측·pool·preparation·slots), `routes/{files, file-read, file-windows, prepare, upload, validate, format-validate}.ts`, placement, instruction, feed(`coordinator/feed.ts`, `events.ts`). `feed.ts`는 internal subscription 구독자 여섯 중 하나다. `events/internal-subscription.ts` 자체는 events 단위가 지운다(I1.1#4).
   - `formats/`: `guest/bundle.js`(301KB)와 pinned hash 포함.
   - `versions/guides.ts`(설치 안내 manifest reader)와 `outline-and-search/guides.ts`도 같이 지운다. 안내는 agent-definition-roles가 text module로 새로 읽는다.
2. `main/worker/main.ts`에서 `runCoordinator`·`runPreparation` import와 kind 분기를 걷는다.
3. `projects/register.ts`에서 지운 module의 등록을 걷는다: 문서·series·addressing·format·file command와 read, `workerSpecs`(`documents/worker`, `documents/format-runner`), `documentsWorkerRelaunch`, `connectDocumentsRelaunch`, schema step(`versionsSchemaSteps`, `addressingSchemaSteps`, series·outline 표), blob field(`versionFileField`, `versionFilesField`, `formatModuleField`), event registration(`createDocumentsEventRegistration`). contexts와 registry 등록은 그대로다. `projects/mod.ts`의 `export *` 네 줄 가운데 지운 module 줄을 뺀다. (I1.10#3~#6)
4. 이름 예약을 걷는다. (I1.5#19의 이 부분)
   - `registry/commands.ts`의 `createPlaceNameReservation(tx).reserve`와 `apps/register.ts`의 `placeNameReservation` port 등록, `apps/registration/commands.ts`의 `reserveSlug` 호출과 `mod.ts` export를 지운다. 앱 slug 중복 검사(`SELECT id FROM apps WHERE slug`)와 `apps` 표의 unique는 남긴다.
   - `planning_version` 칸은 건드리지 않는다. `app-calls`와 `contract-app-calls`가 한다.
5. 조립: core-wiring-trim이 documents 조립(`documentsChannel`, `fileWindows`, 문서 worker 시작과 감시, `servedWorkers`, `documentUpload`·`documentPrepare`·`formatValidate` route, `fileReadStreams`, `withDocumentsReader` 등)을 이미 걷었다. 남은 import와 참조가 있으면 걷는다. 남은 것이 없으면 바꿀 것이 없다고 보고한다. `server/credentials.ts`의 `DOCUMENTS_FEED_PRINCIPAL`을 지운다. machine 자격 `machine:documents*`는 core-wiring 몫이다. 남아 있으면 보고만 한다.
6. blob: `storage/blobs/purposes.ts`의 `document_file`·`document_files`, `child-prepare.ts`의 `documents/worker` 허락, `prepare-worker-probe.ts`의 쓰임을 걷는다(I1.10#13). 지운 module이 등록하던 blob 소유 종류(`document_version`, `format_module`)는 module과 함께 사라진다. (I2.11#21의 이 부분)
7. 개발 data: 지운 module의 schema step과 표(`documents`, `versions`, `version_files`, `series*`, `place_names`, `document_names`, `derived_*`, `search_*`)가 사라진다. 새로 만든 data root에서만 열린다(AGENTS.md 호환성). data를 지우거나 migration을 만들지 않는다.
8. type check가 못 잡는 것을 grep으로 찾는다: process kind `documents/worker`·`documents/format-runner`·`documents/preparation`·`documents/prepare`·`documents/save`와 `new URL("…-entry.ts", import.meta.url)` 문자열, route 이름(`document.`, `series.`, `format.`, `outline.`, `search.`)의 core 쪽 handler 등록. `documents/contexts`(context worker)는 남는다.
9. `deno task check`를 돈다. protocol의 문서 file은 아직 있으니 core가 import하던 protocol 쪽은 그대로 둔다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(지우기만 한다)
- 남지 않음: `grep -rn "file-tracking\|outline-and-search\|projects/versions\|projects/series\|projects/addressing\|projects/formats\|coordinator-entry\|preparation-entry\|documents/worker\|documents/format-runner\|createPlaceNameReservation\|DOCUMENTS_FEED" packages tools --include=*.ts --include=*.tsx --include=*.json`이 0줄이다(`deno.lock` 제외).

## 보고

- 바꾼 file
- 등록할 것: core 조립 목록에서 뺀 module·worker kind. `core/deno.json`의 `parse5`, `quickjs-emscripten` 의존 제거(formats가 마지막 사용처인지 grep으로 확인해 적는다). root `deno.json` `fmt`·`lint`의 `exclude`에 있는 `packages/core/projects/formats/guest/bundle.js`. `deno.lock`
- 안 쓰게 된 export: 이 module들이 쓰던 protocol file(`protocol/projects/{documents, versions, series, formats, outline, history, uploads, …}.ts`)은 `remove-documents-protocol`이 지운다. `storage/ledger`의 문서 관련 reader 등록이 남았으면 적는다
- 정한 것: 문서에 답이 없어 정한 것
- 걱정: `files.*` route의 handler가 없어져 편집기의 파일 읽기·쓰기가 wave 3 places-sessions가 새 통로를 만들 때까지 끊긴다. 실행할 때 data root는 새로 만들어야 한다
- 계약 바꾸기 요청: 없음

# carry-contract

폴더로 주고받는 꼴을 기계 사이의 꼴로 쓰기 위한 약속을 고정한다: "내 컴퓨터들" 갈 곳과 그 폴더의 자리, 낸 기계가 서명하는 file 목록(manifest)의 꼴과 서명·검증 순수 함수, file을 주고받는 route 넷의 모양, 폴더의 명단 file과 기계를 건너는 event file의 꼴, "data가 바뀌었다" event의 이름, ledger step 둘, protocol 판. 구현은 순수 함수와 core 안 칸까지이고 route handler는 wave 2가 단다. `architecture/folder-sync.md`를 새 모양으로 초안한다.

- 단위: carry (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/folder/carry.ts`(새 file), `packages/protocol/folder/carry_test.ts`(새 file)
  - `packages/protocol/apps/events.ts`(`data.changed` 이름과 payload만)
  - `packages/protocol/events/changes.ts`(`CHANGE_NAMES`에 한 이름)
  - `packages/protocol/remote/frames.ts`(판 두 줄만)
  - `packages/core/folder/ports.ts`, `packages/core/folder/schema.ts`
  - `packages/core/apps/events/schema.ts`
  - `packages/core/main/daemon/wiring/context.ts`, `packages/core/main/daemon/wiring/remote.ts`(provide 셋만)
  - `project-docs/architecture/folder-sync.md`
  - `project-docs/flows/tests/libs-tooling.yaml`
- 읽을 것:
  - 계획 README "정한 것" 전부(바닥의 생각), roadmap `project-docs/products/roadmap/multi-device.md`의 "길"과 "원칙"
  - architecture: `project-docs/architecture/folder-sync.md`(폴더 배치, 변경 file 꼴, stream과 cursor, release와 source, 기계 기록, 지키는 것 1~4·7·19), `remote.md`("내 기기 명단"의 모델·컴퓨터의 key), `machine.md`, `event.md`("앱 event", 지키는 것 33)
  - 본보기: 서명 `signRoster`·`verifyRoster`·`ROSTER_SIGN_CONTEXT`(`packages/protocol/remote/roster.ts`), 기록 file schema와 한도(`packages/protocol/folder/{records,limits,layout}.ts`), Late 칸 `deviceKind`(`wiring/context.ts`, `wiring/remote.ts`), `call.settled`(`packages/protocol/lophn-agent/app-calls.ts`)
  - 조사 `reports/multi-device/survey-n2-carry-paths.md` 1b·1c·4·5, review `reports/multi-device/review-device-roster.md` F3·F13
  - AGENTS.md "호환성", `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: 폴더 배치와 file 꼴(`packages/protocol/folder/`), `RosterSnapshot`·`RosterView`, `remoteKeyText`, `canonicalize`
  - 내놓는 것: 아래 "고정할 모양". wave 2는 이 이름만 쓴다.

시작 전에 다시 볼 것: `multi-device-fixes`가 main에 올라간 뒤다. `fix-roster`가 `REMOTE_PROTOCOL_VERSION`·`REMOTE_PROTOCOL_MIN_VERSION`을 4로 올렸고 `ROSTER_UNKNOWN_MAX`(512)와 `RosterView.removed[].entry`를 더했다(`packages/protocol/remote/{frames,roster}.ts`). `schema-steps.lock.json`의 마지막 줄과 `WIRINGS` 맨 뒤 wiring을 merge된 code에서 본다.

## 고정할 모양

**갈 곳.** `COMPUTERS_DESTINATION = "computers"`: 앱 선언 `sync_to: "computers"`가 고르는 "내 컴퓨터들". 그 폴더는 `<data root>/computers/`(0700, `COMPUTERS_DIR`)이고 배치와 file 꼴은 지금 폴더 그대로다(`machines/<mch>/…`). 지금 export·import가 이 폴더를 이름 붙인 destination처럼 쓴다. 사람은 `folder.destinations`에 `computers`라는 이름을 쓰지 못한다(사람의 `~/.lophn` 설정에는 destination이 없어 옮길 것이 없다. 손으로 쓴 값은 지금 규칙대로 없는 것이다). 앱 하나는 갈 곳 하나다(`sync_to`가 하나이고 `folder_reads`가 destination 없이 (앱, 출처)마다라서).

**사람의 폴더.** 설정 `SHARED_FOLDER_KEY = "folder.shared"`, 값 `{path} | null`(기본 null, 사람 승인, `folder.destinations`와 같은 겹침 검사). 그 폴더는 `computers` 폴더의 거울이다: 이 기계는 거기에 자기 `machines/<자기>/`만 그대로 복사하고(한 하위 폴더에 쓰는 기계는 하나, 지키는 것 1), 다른 기계의 하위 폴더는 검증해서 `computers` 폴더로 들인다. import는 거울을 바로 읽지 않는다.

**manifest.** `machines/<mch>/manifest.json`(`MANIFEST_MAX_BYTES = 8 MiB`) = `{body, signature}`.
- `body = {format: 1, machine, revision, written_at, files: [{path, size, sha256}]}`. path는 destination 기준이고 모두 `machines/<machine>/`로 시작한다. 싣는 것: `record.json`, `roster.json`, `apps/<app>/app.json`, `apps/<app>/data/<n>.*`, `apps/<app>/source/<n>.json`, `apps/<app>/releases/<hash>/release.json`, `apps/<app>/events/<id>.json`. 싣지 않고 "덮인" file: release의 `files/<path>`(그 `release.json`의 `files[]`가 크기와 sha256을 싣는다), `source/<n>.bundle`(그 `<n>.json`이 싣는다).
- `revision`은 `max(지난 revision + 1, 지금 ms)`다(ledger 없이 늘기만 한다. 지난 것은 자기 manifest file에서 읽는다).
- 서명 bytes: `utf8(MANIFEST_SIGN_CONTEXT + "\n" + canonicalize(body))`, `MANIFEST_SIGN_CONTEXT = "lophn-folder-manifest/1"`, 그 기계의 명단 서명 key(Ed25519, `remote/signing-key.json`), 글자는 `remoteKeyText`.
- 순수 함수(`packages/protocol/folder/carry.ts`, 폰도 읽으니 Node 내장 없이): `signManifest(body, secretKey)`, `verifyManifest(text, signingKeyOf)` → 믿는 `body | null`(signingKeyOf(machine)는 받는 기계의 명단 view에서 `machine`이 그 값인 컴퓨터 항목의 `signing_key`, 없으면 null), `newerManifest(held, incoming)`(revision이 엄격히 클 때만), `expectedFile(body, path, heldBytes)` → `{size, sha256} | null`(목록에 있거나, 받은 쪽이 이미 든 맞는 `release.json`·`source/<n>.json`이 덮는 path).

**받는 쪽 규칙**(carry-folder가 한 자리에서 지킨다. 길과 상관없다):
- 자기 기계(`machine`이 이 기계)의 manifest와 file은 받지 않는다. 자기 하위 폴더는 export만 쓴다(남의 writer 검사가 그대로 맞는다).
- manifest: 서명이 맞고 서명자가 이 기계 명단 view의 컴퓨터일 때만 믿는다. 든 것보다 revision이 크지 않으면 버린다(옛 목록으로 돌아가지 않는다). 받아 들인 manifest가 그 기계의 지금 목록이다.
- file: 그 기계의 지금 manifest에 그 path가 있거나 덮이고 크기와 sha256이 같을 때만 쓴다. 목록에 없으면, 크기나 hash가 다르면 쓰지 않는다(staging에서 지운다). 받는 동안은 `computers` 폴더 밖 staging에 쓰고 맞으면 rename한다(반쯤 받은 file이 import에 보이지 않는다).
- 이 기계에 없는 앱의 file도 받는다(들이기와 따라가기가 그 기록을 읽는다).
- 새 manifest에 없게 된 그 기계의 file(compaction, 지운 release)은 지운다. 명단 view에서 빠진 컴퓨터의 하위 폴더는 통째로 지운다(이미 적용한 data는 남는다).
- `roster.json`은 manifest가 없어도 받아 명단에 넘긴다(아직 믿지 못하는 컴퓨터의 들어오기 statement가 이 길로 온다. 명단 규칙이 스스로 거른다). 하위 폴더에 두는 것은 manifest에 있을 때만이다.

**route**(`packages/protocol/folder/carry.ts`, 모두 actors user, 기기 route 목록에 든다. 등록과 handler는 carry-folder):
- `carry/manifests`(read): `{}` → `{manifests: [{machine, revision, text}]}`. 이 기계 것과 든 다른 기계 것.
- `carry/wants`(read): `{limit?: ≤1000}` → `{files: [{machine, path, size, sha256}]}`. 믿는 manifest가 싣거나 덮는데 아직 없는 file.
- `carry/file`(file): `{machine, path, offset, length ≤ CARRY_CHUNK_MAX_BYTES(8 MiB)}` → bytes. 들고 있고 믿는 manifest가 싣는 file만, 아니면 `not_found`.
- `carry/put`(memory): `{machine, path, size, sha256, offset, bytes: base64(≤ 8 MiB)}` → `{status: "partial" | "accepted" | "have" | "rejected"}`. 첫 조각에서 이미 맞는 entry가 없으면 `rejected`이고 아무것도 쓰지 않는다. path가 `manifest.json`이면 manifest로 본다.
- `CHANGE_NAMES`에 `carry_files`: 이 기계가 든 manifest가 바뀌면 낸다(link의 상대가 이것으로 다시 본다).

**명단 file.** `machines/<mch>/roster.json` = `{format: 1, machine, written_at, roster: RosterSnapshot}`, `ROSTER_FILE_MAX_BYTES = 8 MiB`. 읽은 쪽은 `rosterCarry.receive`에 넘기기만 한다. 믿는 서명이 없는 항목은 명단 규칙(`ROSTER_UNKNOWN_MAX`) 대로이고 기기가 되지 않는다. reach는 서명이 없어 link의 것과 같다.

**기계를 건너는 event file.** `machines/<mch>/apps/<app>/events/<id>.json`(id는 ULID) = `{format: 1, machine, app, id, bundle_hash, name, payload, at}`, `EVENT_FILE_MAX_BYTES = 64 KiB`, `CROSS_EVENT_MAX_AGE_MS = 7일`(쓴 기계는 그보다 옛 자기 file을 지우고, 읽는 기계는 내지 않는다). 낸 적 있는지는 ledger 표 `folder_events_seen`이 든다. 앱 선언 칸 `events[].across_machines`(carry-notify)가 표시한다.

**data.changed.** `APP_DATA_CHANGED_EVENT = "data.changed"`, payload `z.strictObject({})`, 발행자 `lophn`, 받는 쪽 그 앱 하나(`packages/protocol/apps/events.ts`). 내는 것은 carry-notify.

**ledger step**(lead가 `WIRINGS` 맨 뒤 wiring의 `schemaStepsAfterTeams` 끝에 이 순서로 잇고 `schema-steps.lock.json`에 두 줄을 더한다):
- `folder.events-seen`(`FOLDER_EVENTS_SEEN_STEPS`, `packages/core/folder/schema.ts`): `folder_events_seen(machine TEXT, origin TEXT, app TEXT, event TEXT, seen_at TEXT, PRIMARY KEY (machine, origin, app, event)) STRICT`. `machine`은 이 기계 id다.
- `apps.event-publications.machine`(`EVENT_PUBLICATIONS_MACHINE_STEPS`, `packages/core/apps/events/schema.ts`): `ALTER TABLE app_event_publications ADD COLUMN machine TEXT`. NULL은 이 기계에서 난 것.
- `app_sync_log`과 그 밖의 표는 바꾸지 않는다.

**core 안 칸**(`wiring/context.ts`의 Late. 이 task가 `remote`의 셋을 채운다):
- `rosterCarry: {snapshot(): RosterSnapshot | null; receive(s): Promise<Result<void>>}`(remote, 꺼져 있으면 snapshot null)
- `manifestSign(body): string | null`(remote, key가 없으면 null)
- `computerSigningKey(machine): string | null`(remote, `roster.view()`의 컴퓨터 항목)
- `folderReplica: FolderReplica`(folder가 채운다. type은 `packages/core/folder/ports.ts`: `manifests()`, `offerManifest(text, via)`, `wants(limit)`, `holds(machine, path)`, `read(machine, path, offset, length)`, `receive({machine, path, size, sha256, via, chunks})`. `via`는 `link | phone | folder`)
- `crossEvents: {write(app, release, event: {name, payload, at}): Promise<Result<void>>}`(folder), `eventArrived(input: {app, origin, name, payload, at, bundle_hash}): void`(apps, carry-notify)

**protocol 판.** `REMOTE_PROTOCOL_VERSION`·`REMOTE_PROTOCOL_MIN_VERSION`을 4에서 5로 올린다: 판 4 기계는 manifest를 내지 않아 새 기계가 그 file을 받을 수 없으니 조용히 아무것도 오지 않는 대신 "올려야 한다"가 보인다.

## 할 일

1. `packages/protocol/folder/carry.ts`: 위 상수, schema(manifest, 명단 file, event file, route 넷), path 함수, 순수 함수 넷. route 배열 `CARRY_ROUTES`는 만들되 등록하지 않는다(handler를 다는 carry-folder가 보고한다).
2. `packages/protocol/apps/events.ts`에 `data.changed`, `changes.ts`에 `carry_files`, `frames.ts` 판.
3. `packages/core/folder/ports.ts`에 `FolderReplica`와 event port type. `schema.ts`·`events/schema.ts`에 step 하나씩.
4. `wiring/context.ts`의 Late 칸 여섯과 그 표. `wiring/remote.ts`에 `rosterCarry`(`roster.snapshot`·`receive`), `manifestSign`(`keys.signing`), `computerSigningKey`(`roster.view()`) provide.
5. `architecture/folder-sync.md` 초안: `computers` 갈 곳과 그 폴더, 사람의 폴더는 거울, manifest와 받는 쪽 규칙, file을 옮기는 길 셋(link, 폰, 거울), 명단 file, event file. code path는 쓰지 않는다. `app-sync.md` 등 다른 문서는 carry-cleanup이 고친다.
6. `carry_test.ts`를 `project-docs/flows/tests/libs-tooling.yaml`에 올린다(`flows` skill).

### 정한 것
- manifest는 "윗" file만 싣고 release file과 source bundle은 그 목록 file이 덮는다: template 앱의 release 하나가 6,803 file이라 하나씩 실으면 manifest가 release마다 1 MB씩 는다(`folder-sync.md` 결정의 `release.json` 크기).
- revision은 `max(지난 것 + 1, 지금 ms)`다: ledger step 없이 늘기만 하고, data root를 되살려 지난 file을 잃어도 시계가 맞으면 앞 revision보다 크다.
- 거울에는 자기 하위 폴더만 쓴다: 남의 하위 폴더를 쓰면 그 주인의 바깥 도구와 같은 file을 둘이 고치고, 주인이 compaction으로 지운 file이 되살아나 남의 writer 검사에 걸린다.
- `roster.json`은 manifest 없이 받는다: 아직 믿지 않는 컴퓨터(dual boot의 pending)의 들어오기 statement가 이 file로만 오고, statement가 스스로 서명되어 있다.
- 폰과 컴퓨터가 화면 있는 앱을 맞추는 `app_sync`는 건드리지 않는다(README).

## 끝남

- `npm run check`가 통과한다. `node tools/flows.ts check`가 통과한다.
- 위험 test(`carry_test.ts`, 진짜 Ed25519 key로): "명단에 없는 컴퓨터(빠진 컴퓨터 포함)가 서명한 manifest, 서명이 틀리거나 다른 기계 이름을 단 manifest는 믿지 않고, 든 것보다 revision이 크지 않은 manifest는 받지 않으며, manifest에 없거나 덮이지 않는 path와 크기·sha256이 다른 file은 `expectedFile`이 null이거나 어긋난다."
- subprocess·서버 test, E2E는 만들지 않는다.
- 남지 않음: 없음(더하기만 한다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 적어도 step 두 배열의 `schemaStepsAfterTeams` 줄과 lock 두 줄
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

# carry-folder

미리 있는 갈 곳 `computers`를 지금 폴더 길에 붙이고, 다른 길로 온 file이 폴더 길의 읽기(들이기, release, data 적용)로 들어가는 자리 하나를 짓는다. 이 기계는 자기가 낸 file의 manifest에 서명하고, 받은 file은 명단의 컴퓨터가 서명한 manifest에 맞을 때만 `computers` 폴더에 둔다. 사람의 폴더(`folder.shared`)는 같은 file의 거울이다. 명단 file과 기계를 건너는 event file을 쓰고 읽는다. link와 폰은 이 자리에 file을 가져다 놓기만 한다.

- 단위: carry (wave 2)
- 선행: carry-contract
- 소유(이 task만 고친다):
  - `packages/core/folder/destinations.ts`, `packages/core/folder/fs.ts`
  - `packages/core/folder/replica.ts`(새 file: 받는 자리), `packages/core/folder/mirror.ts`(새 file: 사람의 폴더), `packages/core/folder/carry-routes.ts`(새 file: route 넷의 handler)
  - `packages/core/folder/export/`, `packages/core/folder/import/`, `packages/core/folder/folder_test.ts`
  - `packages/protocol/folder/layout.ts`, `packages/protocol/folder/limits.ts`, `packages/protocol/folder/records.ts`
  - `packages/core/main/daemon/wiring/folder.ts`
  - `project-docs/flows/areas/app-runtime.yaml`
- 읽을 것:
  - 계획 README "정한 것" 전부(바닥의 생각, "낸 기계가 서명한다", "사람의 폴더는 맡겨 두는 곳 하나다")
  - `carry-contract` brief의 "고정할 모양" 전부(특히 "받는 쪽 규칙")
  - architecture: `project-docs/architecture/folder-sync.md`(carry-contract가 고친 판, 지키는 것 1~4·7·16·19), `remote.md`("내 기기 명단"), `event.md`("앱 event")
  - review `reports/multi-device/review-device-roster.md` F1·F3·F13
  - 본보기: 자기 하위 폴더에 쓰기와 이름 검사(`fs.ts`), 기록 file 쓰기(`export/record.ts`), 쓴 file의 sha256(`folder_written`, `export/stream.ts`), compaction과 release 지우기(`export/compact.ts`, `apps/releases.ts`의 `pruneReleases`), 읽기 scan과 계기(`wiring/folder.ts`)
- 계약:
  - 쓰는 것: `packages/protocol/folder/carry.ts` 전부, `ctx.peek.rosterCarry`·`manifestSign`·`computerSigningKey`·`eventArrived`, 표 `folder_events_seen`
  - 내놓는 것: `ctx.folderReplica`, `ctx.crossEvents`의 구현, route `carry/manifests|wants|file|put`의 handler. carry-settings가 읽을 `FolderReplica`의 기계마다 상태(받아 들인 revision, 때, 길)

시작 전에 다시 볼 것: `fix-roster`의 `ROSTER_UNKNOWN_MAX`가 `roster.receive`의 keep에 걸렸는지(`packages/protocol/remote/roster.ts`) 본다. 없으면 멈추고 lead에게 알린다: 폴더에 쓸 수 있는 누구나 명단을 상한까지 채울 수 있다(F3). `fix-setup`이 `wiring/remote.ts`의 `machines/*`를 바꿨어도 이 task는 그 file을 고치지 않는다.

## 할 일

1. 갈 곳(`destinations.ts`): `createDestinations`의 `list`·`resolve`가 늘 `{name: "computers", path: <data root>/computers}`를 낸다(폴더는 처음 쓸 때 0700으로 만든다). `folder.destinations`의 check가 이름 `computers`를 거절한다("reserved for your computers"). 설정 `folder.shared`(`destinationsSetting`과 같은 꼴, `approval: "person"`, `describe`, data root·이름 붙인 폴더와 겹치면 거절)를 둔다. 설정 선언 목록에 넣을 줄은 보고에 적는다.
2. 이름 붙인 폴더는 지금 그대로다: export·import·held·따라가기 code에 `computers`만의 갈래를 두지 않는다. 바뀌는 것은 3~6이 `computers` 폴더(와 거울)에만 하는 일이다.
3. manifest 쓰기(`export/`): `computers` 폴더의 자기 하위 폴더에 file을 쓴 내보내기 한 번이 끝날 때마다 `manifest.json`을 새로 쓴다. 목록은 그 하위 폴더의 실을 file(contract의 목록)이고, sha256은 `folder_written`에 있으면 그것, 없으면(작은 기록 file) 읽어 구한다. 서명은 `manifestSign`이고 null이면(remote가 꺼짐) 쓰지 않는다. 쓴 뒤 `StateChanged{carry_files}`.
4. 받는 자리(`replica.ts`, `FolderReplica`): contract의 "받는 쪽 규칙" 그대로. 기계마다 지금 manifest는 `computers` 폴더의 그 기계 `manifest.json`이 든다(ledger 없이). `receive`는 data root의 `carry-staging/`(0700)에 쓰고 크기·sha256이 맞으면 `machines/<그 기계>/…`로 rename한다(자기 기계의 path는 받지 않는다. 쓰는 함수는 `FolderWriter`가 아니라 이 자리만의 것이다). 받아 들인 뒤 읽기 scan을 깨우고, manifest가 바뀌면 `StateChanged{carry_files}`. 새 manifest에 없게 된 file과, `computerSigningKey`가 null이 된 기계(명단에서 빠짐)의 하위 폴더는 지운다(`StateChanged{remote_devices}`에 다시 본다). 기계마다 받아 들인 revision, 때, 마지막 길을 메모리에 든다.
5. route handler(`carry-routes.ts`): 넷을 `FolderReplica`로 단다. `carry/put`은 조각을 staging의 `(machine, path)` file에 offset대로 이어 쓰고, 첫 조각에서 맞는 entry가 없으면 `rejected`, 크기가 차면 `receive`로 넘긴다. 같은 file이 이미 있으면 `have`. 끝나지 않은 staging은 1시간 뒤 지운다.
6. 거울(`mirror.ts`): `folder.shared`가 있으면 내보내기 뒤 자기 하위 폴더의 바뀐 file(manifest 포함)을 그 폴더의 같은 path로 복사하고 manifest에 없는 자기 file을 지운다(쓰기는 그 폴더에 대한 `FolderWriter`). 읽기 scan 때 그 폴더의 다른 기계 `manifest.json`을 `offerManifest(text, "folder")`에 넘기고, `wants`에 있는 file이 거기 있으면 `receive(…, "folder")`. 그 폴더의 `roster.json`도 아래 7처럼 읽는다.
7. 명단 file: `computers` 폴더의 자기 하위 폴더에 `roster.json`을 쓴다(`rosterCarry.snapshot()`이 null이 아닐 때, `StateChanged{remote_devices}`·내보내기 timer·core 시작, bytes가 같으면 쓰지 않는다. 쓴 뒤 manifest에 싣는다). 다른 기계의 `roster.json`(받는 자리로 왔거나 거울에 있는 것)은 크기·schema·`machine`이 폴더 이름과 같은지 보고 `rosterCarry.receive`에 넘긴다. 지난번과 같은 bytes면 넘기지 않는다. 오류 상태를 더하지 않는다(log 한 줄).
8. event file: `crossEvents.write`는 그 앱의 `sync_to` 폴더(이름 붙인 폴더도)의 자기 하위 폴더에 event file을 쓰고 내보내기를 깨운다. 내보내기 때 `CROSS_EVENT_MAX_AGE_MS`가 지난 자기 event file을 지운다. 읽기 scan은 이 기계에 든 앱마다 다른 기계의 `events/`를 나열해 꼴·크기·`app`·`bundle_hash`(이 기계 활성 release와 같아야 한다)·나이가 맞고 `folder_events_seen`에 없는 것을 한 transaction에서 그 표에 적은 뒤 `eventArrived`에 넘긴다. 나이가 지난 행은 지운다.
9. `layout.ts`·`fs.ts`: 새 이름(`manifest.json`, `roster.json`, `events/<id>.json`)을 `listingOf`와 이름 검사에 더한다. `records.ts`·`limits.ts`에 필요한 schema와 한도가 contract에 없으면 여기 둔다.
10. `wiring/folder.ts`: 위를 잇고 `folderReplica`·`crossEvents`를 provide하고 route 넷을 단다. flows: `app-runtime.yaml`에 route 넷의 flow(`flows` skill). 새 test file은 만들지 않는다(`folder_test.ts`, `import/import_test.ts`, `export/export_test.ts`에 둔다).
11. `packages/core/apps/calls/service.ts`에서 고칠 줄이 생기면 고치지 않고 "넘길 줄"에 적는다(carry-notify의 file이다).

### 정한 것
- 받은 file은 `computers` 폴더에 두고 import는 그 폴더만 읽는다: 지금 import의 검사, held, 따라가기, 꼴 판 범위가 그대로 맞고, 거울과 link와 폰이 한 자리로 들어온다.
- staging은 `computers` 폴더 밖 data root에 둔다: import가 반쯤 받은 file을 보지 않고 tmp 이름 규칙에 기대지 않는다.
- event를 낸 적 있는지는 표 하나로 본다: 같은 event file이 여러 길로 오고 순서가 뒤바뀌어도 한 번이다.

## 끝남

- `npm run check`가 통과한다. `node tools/flows.ts check`가 통과한다.
- 위험 test(진짜 ledger sqlite, 임시 폴더, 진짜 Ed25519 key와 명단 code로):
  - "같은 file이 link(`receive(…, "link")`), 폰(`carry/put`), 거울로 다 와도 `computers` 폴더에 한 번 쓰이고 import가 한 번 적용한다."
  - "서명한 manifest에 없는 file, 내용이 manifest와 다른 file, 명단에 없는 컴퓨터가 서명한 manifest는 받지 않는다(폰의 put, link의 receive, 거울의 file 모두)."
  - "사람이 이름 붙인 폴더로 맞추던 앱은 `computers`가 더해져도 그 폴더로 그대로 내보내고 읽는다."
  - "폴더의 명단 file에 믿는 서명이 없는 항목이 있어도 읽은 기계의 명단에 기기로 들지 않는다."
  - "다른 기계에서 온 같은 event file이 두 길로 와도 `eventArrived`가 한 번만 불린다."
- subprocess·서버 test와 E2E는 만들지 않는다. 실제 폴더 도구(Google Drive, Syncthing)와 dual boot의 확인은 lead가 사람에게 부탁한다.
- 남지 않음: 없음(더하기다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 적어도 `CARRY_ROUTES` registry, `REMOTE_ALLOWED_ROUTES`의 route 넷, 설정 선언 목록의 `folder.shared`
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

## (lead가 더함)

`carry-contract`가 review를 거치며 계약이 바뀌었다. 아래가 위 글보다 앞선다. 계약의 글은 `project-docs/architecture/folder-sync.md`의 "내 컴퓨터들"과 `packages/protocol/folder/carry.ts`다.

- 기계마다의 지금 목록: 든 `manifest.json`이 목록이지만 받아들일지는 ledger 표 `folder_carry_marks`(origin, 서명 key마다 가장 높은 revision)가 정한다. 받기 전에 mark를 읽고, 받으면 쓰고, 지우지 않는다. key는 `verifyManifest(...).signingKey`다.
- 자기 manifest가 되돌아오면(연결, 폰, 같이 보는 폴더) 저장하지 않는다. 검증되고 자기 mark보다 높으면 자기 mark만 올린다. 다음 revision은 `nextManifestRevision(max(자기 file의 revision, 자기 mark), now)`다.
- `StateChanged{remote_devices}`마다 든 manifest를 `ctx.computerSigningKey`로 다시 검증한다. 검증되지 않게 된 기계의 새 manifest와 file은 받지 않되 가진 file은 둔다. subtree를 지우는 것은 `ctx.computerRemoved(machine)`이 참일 때뿐이다("`computerSigningKey`가 null이 되면 지운다"를 대신한다).
- manifest 쓰기: manifest는 `record.json`, `roster.json`, 앱마다 `apps/<app>/files.json` 하나만 싣는다. `files.json`이 그 앱의 `app.json`, data(가장 새 snapshot과 그 뒤), `source/<n>.json`, `release.json`, `events/*`를 싣는다. 둘 다 이번 export가 쓴 것(`folder_written` 줄과 이번에 쓴 record file)으로 만들고 폴더를 훑어 만들지 않는다. snapshot 뒤의 data file이 `CARRY_DATA_FILES_MAX`를 넘으면 `computers`에 새 snapshot을 쓴다. 목록이 8 MiB를 넘게 되면 앞의 목록을 두고 그 앱의 stream에 `too_large` 오류를 남긴다.
- 받을 것은 `expectedFiles`(사슬 전체)로 고르고, 첫 조각에서와 자리로 옮기기 바로 전에 `expectedFile`로 크기와 sha256을 다시 본다. 사슬에서 빠진 file(덮던 file이 바뀐 것 포함)은 지운다.
- route: `carry/manifests`는 `{machine, revision, size, sha256}`만 답한다. `carry/file`과 `holds`·`read`는 `machines/<m>/manifest.json`도 준다. `carry/wants`는 `after`를 받고 (machine, path) 순서로 답한다. `carry/put`의 `machines/<m>/manifest.json`은 글을 다 모아 `machine`·`size`·`sha256`이 글과 맞지 않으면 `rejected`, 맞으면 `offerManifest`다.
- 명단 file: `{format, machine, written_at, statements: rosterCarry.statements()}`를 쓴다(null이면 쓰지 않는다). 읽을 때는 statements만 `rosterCarry.receive(statements)`에 넘긴다. 주소(reach)는 폴더에서 읽지 않는다.
- event file: `readEventFile(path, bytes, now)`로 읽고 `bundle_hash`를 지금 release와 댄다. 본 줄은 `CROSS_EVENT_SEEN_KEEP_MS`(14일) 뒤에만 지운다.
- `layout.ts`·`fs.ts`의 이름 검사에 `manifest.json`, `roster.json`, `apps/<app>/files.json`, `events/<id>.json`을 더한다.
- 등록(이미 lead가 넣었다): ledger step `folder.events-seen`, `apps.event-publications.machine`, `folder.carry-marks`. 이 task가 하는 등록은 그대로다: `CARRY_ROUTES`를 등록하고 기기 route 목록에 올릴 이름을 보고에 적기, `folder.shared` 설정, `app-runtime.yaml`의 `ignore:` 줄을 진짜 flow로 바꾸기, `StateChanged{carry_files}`를 낼 때 `tools/check-reads.ts`의 `PUBLISHED_OUTSIDE_ROUTES`에 `"carry_files"`를 더하고 두 읽기 route에 `reads: ["carry_files"]`를 돌려놓기.
- 먼저 확인할 것: 다른 기계가 낸 새 release를 따라갈 때 사람의 확인 없이 code가 깔리는지(`packages/core/folder/apps/`, `architecture/folder-sync.md`). 확인 없이 깔리면 멈추고 보고한다(받는 file의 출처가 이제 연결과 폰까지 넓어진다).
- 지우는 규칙(두 번째 review): 목록 file 아래의 file은 그 목록 file의 지금 판을 가진 뒤에만, 그것이 더는 싣지 않는 것만 지운다. manifest를 받고 새 `files.json`이 아직 오지 않은 사이에는 앞 판 아래의 file을 두고 import도 그대로 한다(위 "덮던 file이 바뀐 것 포함은 지운다"를 이 줄이 대신한다).
- 자리로 옮길 때와 `wants`·`holds`에서, 든 목록은 그것을 검증한 서명 key가 지금의 `computerSigningKey(machine)`와 같을 때만 센다.
- `ctx.computerRemoved(machine)`은 그 기계를 가리키는 정해지지 않은 빼기가 하나라도 있으면 거짓이다(key를 바꿔 다시 든 기계가 다툼에 걸려도 사본을 지우지 않는다).

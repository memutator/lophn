# folder-export

**opus high.** 컴퓨터가 자기 몫을 폴더에 쓴다: `sync_to`가 있는 앱마다 sync log를 data stream(`.changes`, `.snapshot`)으로 내보내고, 자기 하위 폴더만 compaction하고, 자기 하위 폴더에 남이 쓴 file을 알아채면 멈추고, destination마다 기계 기록 `record.json`을 쓴다. 앱마다 `settled`(README 계약 10)를 세어 두고, 이 기계가 horizon 밖이면 정리된 흔적과 부딪힐 자기 변경을 내보내지 않고 held 줄로 바꾼다. 계기(debounce, timer)와 조립은 `folder-surface`가 한다. 이 task는 "한 번 돌기" 함수와 상태를 낸다.

- 단위: folder (wave 2)
- 선행: folder-contract, folder-log, folder-decl. 셋 다 wave 1이다
- 소유(이 task만 고친다):
  - `packages/core/folder/export`(새 폴더: `stream.ts`, `compact.ts`, `record.ts`, `status.ts`, `mod.ts`와 test. 이름은 바꿔도 된다)
- 읽을 것:
  - 계약: 계획 `README.md` "다른 계획이 기대는 계약" 1, 2, 6, 7, 10과 "정한 것"(번호, compaction, 남의 writer, 기계 기록에 싣지 않는 것), `folder-contract`가 낸 `packages/protocol/folder`(layout, container, records, limits)와 `packages/core/folder/{fs,destinations,schema,ports}.ts`
  - sync log(`folder-log`가 고친 것): `packages/core/apps/sync/log.ts`의 `SyncLog.page`·`head`·`readChangeset`, `SyncLogRow`(`origin`, `machine`, `invocation`, `kind`), '다시 snapshot' 줄의 뜻(`schema.ts` 주석)
  - snapshot을 뜨는 지금 길: `packages/core/apps/sync/snapshots.ts`(write 줄을 잡고 log head를 읽고 `link.snapshot`으로 `VACUUM INTO`. 그래서 사본이 그 seq까지를 담는다)
  - invocation의 operation과 시작 시각: `packages/core/apps/invocations/`(`InvocationLedger`의 읽기)
  - release의 bundle hash: `packages/core/apps/releases/store.ts`(`loadRelease`, `loadActiveRelease`, `loadActiveDeclaration`)
  - machine: `project-docs/plan/machine-identity/README.md` 계약 1(`ctx.machine.id`, `status().name`). 이 task는 값만 port로 받는다
  - 조사: `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md` 7.2(한 owner compaction, 자기 이름 file에만 쓰기), 14 (iii) 1·7·8, `mixdog.md` §6.2
- 계약:
  - 쓰는 것: 위 계약과 `FolderLog`, `Id<"mch">`
  - 내놓는 것(`mod.ts`. `folder-surface`가 조립한다):
    - `createFolderExport(deps)`. deps(port, 모두 인자): `machine: () => {id, name}`, `destinations`(`folder-contract`), `apps(): {app, slug, name, description, sync_to, release: {id, bundle_hash, data_schema} | null}[]`(활성 선언에 `sync_to`가 있는 앱), `log: FolderLog`, `releaseKey(rel) → {bundle_hash, data_schema} | null`, `operationOf(invocation) → {name, started_at} | null`, `snapshotAt(app, path) → Result<{seq, size, sha256}>`(write 줄을 잡은 채 log head와 사본을 같이 뜬다. `folder-surface`가 calls의 `exclusive`와 `link.snapshot`으로 꽂는다), `facts(): {addresses, alwaysOn: {keep_running, starts_at_login, keep_awake} | null, lophn: {version, protocol}}`(`lophn.folder`는 이 task가 `FOLDER_FORMAT`으로 채운다), `readsCaughtUp(app) → boolean`(`folder-import`의 상태: 모든 출처의 cursor가 그 앱 기록의 `data.head`에 닿음), `peerHorizons(app) → {machine, horizon}[]`(알려진 기계의 앱 기록 사본에서, `forgotten_at` 없는 것), `log.held(...)`(`folder-log`), ledger `sql`·`transaction`, `clock`, `random`, data root(임시 file)
    - `runApp(app) → Promise<Result<ExportOutcome>>`: 그 앱의 data stream을 따라잡는다(한 번에 64 MiB까지, 남으면 `more: true`)
    - `publishRecords() → Promise<Result<void>>`: destination마다 `record.json`(내용이 바뀌었거나 처음일 때만, `revision` +1)
    - `settledOf(app) → {settled, away_since} | null`(`folder-apps`가 앱 기록에 싣고 `folder-surface`가 정리 식에 쓴다)
    - `status(app) → ExportStatus`(README 계약 7의 `export` 칸: `exported_at`, `head`, `pending`, `error`)
    - `forget(app)`: 그 앱의 `folder_streams`·`folder_written` 행을 지운다(폴더의 file은 그대로 둔다). 앱을 지울 때 `folder-surface`가 부른다

## 할 일

1. stream(`stream.ts`): `folder_streams`의 (이 기계, 앱, destination, `data`) 행을 읽는다(`machine` 칸이 지금 id와 다른 행은 없는 것). 행이 없거나, 이 기계 앱의 release bundle hash가 행의 것과 다르거나, `last_seq` 뒤에 '다시 snapshot' 줄이 있으면 먼저 snapshot을 쓴다: `snapshotAt`으로 data root 아래 임시 file에 뜨고, header를 붙여 `<n>.snapshot`으로 쓰고, `last_seq`를 그 seq로, `last_snapshot_n`을 n으로. 그다음 `last_seq` 뒤의 log 줄을 seq 순서로: origin `machine` 줄과 `skipped` 줄은 넘긴다(다시 내보내지 않는다), '다시 snapshot' 줄은 위처럼 snapshot, `change` 줄은 묶어 `<n>.changes`로(README 계약 2: `id`는 seq, operation과 started_at은 `operationOf`, release는 그 줄의 release의 key). 한 file의 묶음은 한 release의 줄만 담는다.
2. 쓰기 순서(잃지 않고 다시 쓰지 않는다): file bytes의 sha256을 먼저 구해 `folder_written`에 (path, sha256, size)를 적고(의도), writer로 temp에 쓰고 rename하고, 그다음 한 ledger transaction에서 `written_at`과 `folder_streams`(`next_n`, `last_seq`)를 고친다. 다시 돌 때 의도만 있고 끝나지 않은 번호의 file이 있으면: sha256이 같으면 끝난 것으로 적고, 다르면 `foreign_writer`다.
3. 남의 writer(`foreign_writer`): 돌 때마다 자기 `data/` 목록을 읽어 `folder_written`에 없는 번호나 sha256이 다른 file이 있으면 그 앱의 내보내기를 멈추고 오류를 남긴다(사람이 볼 때까지 다시 쓰지 않는다). 알아채지 못한 복제가 같은 하위 폴더에 쓰는 경우다.
4. compaction(`compact.ts`): snapshot m을 쓴 뒤, 그 앞 snapshot의 번호보다 작은 자기 file 가운데 `written_at`이 30일 지난 것만 지우고 `deleted_at`을 적는다. 마지막 snapshot은 지우지 않는다. 남의 폴더는 열지 않는다.
5. settled와 horizon 밖(README 계약 10): 한 번 돌고 나서 `pending`이 0이고 `readsCaughtUp(app)`이면 `folder_streams.settled`를 그때 그 앱 log의 가장 큰 hlc로 올린다(내려가지 않는다). 자기 `settled`가 `peerHorizons`의 가장 큰 값보다 작으면 horizon 밖이다: `away_since`를 적고, 아직 내보내지 않은 `change` 줄 가운데 hlc가 그 값 이하인 것은 file에 쓰지 않고 `log.held(..., "past_horizon")`로 옮긴 뒤 `last_seq`를 넘긴다(지우지 않는다). 그 기계를 따라와 `settled`가 그 값을 넘으면 `away_since`를 지운다.
6. destination 상태: path가 없으면 `destination_missing`(destination 자체를 만들지 않는다: 바깥 도구가 나중에 그 자리에 mount할 수 있다), 쓰지 못하면 `not_writable`. `machines/<id>/` 아래 폴더는 만든다.
7. 기계 기록(`record.ts`): README 계약 6(`lophn.folder = FOLDER_FORMAT`, `always_on` 객체). `facts()`의 주소는 remote가 꺼져 있으면 빈 값이다. 공개 key, pairing code, binding, secret, data root path를 싣지 않는다.
8. 한도: snapshot이 1 GiB를 넘으면 `too_large`로 멈춘다.
9. test(임시 폴더와 test ledger, port는 가짜).

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "기계는 자기 하위 폴더 밖에 쓰지 않는다": 다른 기계 둘의 하위 폴더에 같은 이름의 file들이 있는 destination에서 내보내기·snapshot·compaction·기록 쓰기를 여러 번 돌린 뒤, 자기 하위 폴더 밖의 모든 file의 bytes와 목록이 그대로다
  - "기계 id file과 자격은 폴더에 나오지 않는다": data root에 `machine.json`(binding), `secrets.json`, `remote/host-key.json`이 있고 앱에 secret이 있는 상태에서 snapshot과 변경과 기록을 내보낸 뒤, destination의 어느 file의 bytes에도 binding 값, secret 값, host key의 비밀 key가 없다
  - "horizon 밖의 기계는 정리된 흔적과 부딪힐 자기 변경을 버리지도 내보내지도 않는다": 다른 기계의 horizon보다 옛 hlc의 내보내지 않은 줄은 file에 나오지 않고 같은 bytes의 held 줄이 되며, 그보다 새 줄은 지금처럼 나간다
  - "rename 뒤 기록 전에 죽어도 번호를 다시 쓰지 않고 남의 writer로 오인하지 않는다", "남이 쓴 번호를 보면 쓰지 않고 `foreign_writer`다"
- 남지 않음: 없음(더하기).
- flows catalog: 이 task가 더하는 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `mod.ts`의 이름과 deps(한 줄씩, `folder-surface`가 꽂을 것), 변경 1만 개를 처음 내보내는 시간과 file 수, snapshot 100 MB를 쓰는 시간.

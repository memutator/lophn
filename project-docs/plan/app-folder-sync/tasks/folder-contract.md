# folder-contract

**opus high.**

폴더 계약을 code로 고정한다: 폴더 배치와 file 이름, 변경·snapshot file의 꼴(쓰기와 검사), 기록 file의 schema, 읽기 명령의 출력 schema와 수치(`packages/protocol/folder/`), 그리고 core 쪽 바탕(`packages/core/folder/`): destination 설정, 자기 하위 폴더 밖에는 쓰지 못하는 writer, 이름 꼴로 거르는 reader, local 상태 표의 schema step `folder.tables`, wave 2 task가 기대는 port type. wave 2의 `folder-export`, `folder-import`, `folder-apps`, `folder-runtime`이 이것만 쓴다.

- 단위: folder (wave 1)
- 선행: 없음. `machine-identity` 계획이 main에 land된 뒤 띄운다(`Id<"mch">` 접두사 `mch`)
- 소유(이 task만 고친다):
  - `packages/protocol/folder`(새 폴더: `layout.ts`, `container.ts`, `records.ts`, `status.ts`, `limits.ts`, `mod.ts`와 test. 이름은 바꿔도 된다)
  - `packages/core/folder/destinations.ts`, `packages/core/folder/fs.ts`, `packages/core/folder/schema.ts`, `packages/core/folder/ports.ts`와 그 test(새 file)
- 공유 줄 허락(한 줄씩, 보고의 "넘길 줄"에): `packages/core/main/daemon/wiring/remote.ts`의 `schemaStepsAfterTeams` 끝에 `...FOLDER_SCHEMA_STEPS` 한 줄과 import, `packages/core/storage/migration/schema-steps.lock.json` 끝 `{id, sha256}` 한 항목(같은 wave의 `folder-log`이 `apps.sync-log.machine`을 앞에 붙인다. 순서는 lead가 merge 때 맞춘다), `packages/core/main/daemon/wiring/setting-declarations.ts`의 `settingDeclarations` 목록에 `destinationsSetting` 한 줄, `project-docs/flows/areas.yaml`의 `app-runtime` area `entries`에 `packages/protocol/folder/`와 `owns`에 "앱 data·release·source·기계 기록을 폴더로 내보내고 읽어 들이기" 한 줄
- 읽을 것:
  - 계획 `README.md` "다른 계획이 기대는 계약" 1~7, 9와 "정한 것"(이 task가 그것을 code로 옮긴다. 다르게 해야 하면 고치지 말고 보고의 "계약 바꾸기 요청")
  - 조사 규칙: `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md` 7.2(검증 후 적용, "알 수 없음"과 "없음", 임시 file 이름), 8.3, 14 (iii) 7·8·9·10. `omp.md` §6.1(unpack 검사), `mixdog.md` §7(sync drive 아래 임시 이름)
  - 설정 선언: `packages/protocol/config/declaration.ts`(`declareSetting`, `check`, `locked`), 본보기 `packages/core/lophn-agent/extensions/settings.ts`, 모으는 곳 `packages/core/main/daemon/wiring/setting-declarations.ts`
  - 원자적 쓰기 본보기: `packages/core/config/store.ts`(temp에 쓰고 rename. 단 이 계획은 앞에 점을 붙이지 않는다)
  - schema step 규칙: `AGENTS.md` "호환성", 본보기 `packages/core/apps/sync/schema.ts`(`SYNC_LOG_SCHEMA_STEPS`), 등록 `packages/core/main/daemon/wiring/remote.ts` `schemaStepsAfterTeams`
  - id: `packages/protocol/base/ids.ts`(`idSchema("mch")`, `idSchema("app")`), sha256 `packages/base/hash.ts`, `sha256Schema`(`packages/protocol/base`)
  - 기계 기록의 바탕: `project-docs/plan/machine-identity/README.md` 계약 1(`MachineStatus`, `ctx.machine`)
- 계약:
  - 쓰는 것: `Id<"mch">`(machine-identity)
  - 내놓는 것(wave 2가 이것만 쓴다. 이름은 바꿔도 되지만 보고에 적는다):
    - `packages/protocol/folder/layout.ts`: `machineDir(mch)`, `recordPath(mch)`, `appDir(mch, app)`, `appRecordPath`, `dataEntryPath(mch, app, n, kind)`, `releaseDir(mch, app, bundleHash)`, `sourcePath(mch, app, n, "bundle" | "json")`, `tempName(name, random)`(`<name>.tmp-<16 hex>`), 그리고 이름을 정확히 가르는 `parseDataEntry(name) → {n, kind} | null`, `parseSourceEntry`, `isMachineDirName`, `isAppDirName`. 번호는 12자리 0 채움, 1 이상. 모든 path는 destination 기준 상대 path(`/` 구분)다
    - `packages/protocol/folder/container.ts`: README 계약 2의 꼴. `FOLDER_FORMAT = 1`, `ContainerHeader`(zod, 모르는 칸은 버린다), `encodeChanges({header 칸, changes: {meta, bytes}[]}) → Uint8Array`(작은 file은 메모리에서), `containerPrefix(header) → Uint8Array`(1행과 2행. 큰 snapshot은 부르는 쪽이 payload를 뒤에 이어 쓴다), `readContainerHead(bytes 앞부분) → Result<{header, payloadOffset}>`, `verifyContainer(...)`(전체 크기, 1행 hash, header schema, payload hash), `changesOf(header, payload) → {meta, bytes}[]`. 실패는 `{code: "invalid_file" | "newer_format" | "too_large", message}`. 큰 file의 hash는 부르는 쪽이 stream으로 넘길 수 있게 "payload hash 계산"을 함수 인자로 받거나 incremental hasher를 쓴다(정해서 적는다)
    - `packages/protocol/folder/records.ts`: `machineRecordSchema`, `appRecordSchema`, `releaseRecordSchema`, `sourceMetaSchema`(README 계약 3, 6과 `source/<n>.json` = `{format: 1, machine, app, n, heads: Record<ref, 40 hex>, prerequisites: string[], size, sha256, created_at}`). 모든 schema는 모르는 칸을 버리고 읽는다(strict가 아니다). `format`만 먼저 읽어 이 기계가 읽는 범위 밖이면 `newer_format`. `FOLDER_FORMAT = { version: 1, min_version: 1 }`(기계 기록의 `lophn.folder`에 그대로 싣는다)와 `canRead(peerFolder)`(상대의 `min_version`이 내 `version`보다 크면 false)
    - `packages/protocol/folder/status.ts`: README 계약 7의 출력 schema `machineEnvironmentSchema`(세 단계의 `sections: Record<string, unknown>`, `apps[].away`)와 오류 code 닫힌 집합 `FOLDER_ERROR_CODES`(`away_too_long` 포함), `FolderError = {code, message, at, details?}`(`clock_ahead`의 details `{machine, machine_name, ahead_ms}`)
    - `packages/protocol/folder/limits.ts`: 변경 하나 8 MiB(`CHANGESET_MAX_BYTES`와 같은 값), changes file 1,000개·16 MiB, header 1 MiB, snapshot 1 GiB, 기록 file 256 KiB, git bundle 64 MiB, 미래 clock 한도 5분, tombstone horizon 90일, compaction 보관 30일, debounce·timer·backoff 값(README "정한 것"의 계기)
    - `packages/core/folder/destinations.ts`: `destinationsSetting`(key `folder.destinations`, type `Record<이름, {path}>`, 16개, 이 task에서는 `locked: true`라 agent는 바꾸지 못한다. agent가 요청하고 사람이 허락하는 길은 wave 2의 `folder-approval`이 이 선언을 `approval: "person"`으로 바꾸며 연다. 영어 설명: 기계마다의 이름 → 절대 경로, 앱이 `sync_to`로 이름을 고른다, 사람이 둔다), `check`가 거절하는 것(README 계약 5. data root는 check에 넘어오지 않으면 `createDestinations({dataRoot, settings})` 쪽에서 본다. 어디서 보든 data root와 겹치는 경로는 쓰이지 않는다), `resolve(name) → {path, state: "ok" | "missing" | "not_writable"} | null`
    - `packages/core/folder/fs.ts`: `createFolderWriter({root: destination path, machine})`: 모든 쓰기·지우기·rename이 `machines/<자기 id>/` 아래로만 간다. 그 밖(`..`, 절대 path, symlink로 빠지는 path, 다른 기계 폴더)은 아무것도 하지 않고 오류다. `writeFile(rel, bytes)`·`writeStream`은 temp에 쓰고 fsync 뒤 rename, `remove(rel)`. `createFolderReader(root)`: `listMachines()`, `list(rel)`(이름 꼴로 거르지 않은 날 목록이 아니라 layout의 parse를 통과한 것만), `read(rel, maxBytes)`(크기 한도를 넘으면 읽지 않는다), 없는 file은 `not_found`이지 오류가 아니다
    - `packages/core/folder/schema.ts`: `FOLDER_SCHEMA_STEPS` = step `folder.tables` 하나. 표 다섯, 모두 STRICT이고 첫 칸 `machine`(쓴 기계 id. 지금 id와 다른 행은 없는 것으로 본다):
      - `folder_streams(machine, app, destination, stream CHECK IN ('data','source','record','app'), next_n ≥ 1, last_seq INTEGER NOT NULL DEFAULT 0, bundle_hash, last_snapshot_n, written_at, settled TEXT, horizon TEXT, away_since TEXT, error CHECK json, PK(machine, app, destination, stream))`. 기계 기록은 app `''`. `settled`·`horizon`은 README 계약 10의 HLC(십진 문자열)
      - `folder_written(machine, destination, path, app, stream, n, sha256, size, written_at, deleted_at, PK(machine, destination, path))`: 이 기계가 쓴 file(compaction과 남의 writer 알아채기)
      - `folder_reads(machine, app, origin, stream CHECK IN ('data','source'), cursor INTEGER NOT NULL DEFAULT 0, bundle_hash, read_at, attempts INTEGER NOT NULL DEFAULT 0, next_try_at, waiting_for, error CHECK json, PK(machine, app, origin, stream))`
      - `folder_held`: README 계약 4 그대로
      - `folder_records(machine, origin, kind CHECK IN ('machine','app'), key, revision, record CHECK json, destination, read_at, forgotten_at, PK(machine, origin, kind, key))`. `forgotten_at`이 있는 기계는 알려진 기계에서 빠진다(README 계약 10)
    - `packages/core/folder/ports.ts`: `FolderApply`(core의 calls가 구현하고 `folder-import`가 부른다): `applyChanges({app, release: Id<"rel">, origin: Id<"mch">, changes: {id, hlc, operation, started_at, changeset: Uint8Array}[]}) → Result<{applied: number, skipped: number, duplicate: number, held: number}>`(앱 DB transaction 하나, `conflict`면 release가 바뀜, `unavailable`이면 앱 process 없음), `mergeSnapshot({app, release, origin, n, path, absentDeletes?: {below: hlc, keep: {table, pk}[]}}) → Result<{changed: boolean, deleted: number}>`(`path`는 core가 data root 아래에 payload만 풀어 둔 SQLite file). `FolderLog`(export가 읽는 sync log의 좁은 면: `page`, `readChangeset`, `head`. `folder-log`이 내는 `SyncLog`가 그대로 맞게 type만)

## 할 일

1. `packages/protocol/folder/`: 위 file들. zod 말고는 `packages/base`와 `packages/protocol/base`만 import한다(나중에 API로 옮기는 쪽도 같은 codec을 쓴다). path는 POSIX 꼴로 만들고 core가 OS path로 바꾼다.
2. container: 쓰는 쪽과 읽는 쪽이 같은 함수에서 나오게 한다. header의 `machine`·`app`·`n`·`kind`가 path와 같은지 보는 함수(`matchesPath`)도 여기 둔다. `changes`의 `offset`·`size`가 payload를 겹치지 않고 빈틈없이 덮는지, 개수·크기 한도, `hlc` 꼴(`^(0|[1-9][0-9]{0,18})$`), `id` 꼴을 본다.
3. records: 각 schema는 모르는 칸을 무시하지 않고 거절한다(판이 오르면 `format`이 오른다). `format`만 먼저 읽어 1보다 크면 `newer_format`.
4. core `destinations.ts`, `fs.ts`: 위 계약. writer는 자기 id를 생성 때 받고 path를 resolve한 뒤 `machines/<id>/` 아래인지 본다(realpath로 symlink를 따라간 결과도). temp 이름은 앞에 점이 없다. reader는 layout의 parse를 통과하지 못한 이름을 돌려주지 않는다.
5. `schema.ts`와 등록(공유 줄). lock 항목은 `npm run check:full`의 schema step 검사가 요구하는 값으로 넣는다.
6. `ports.ts`: type만.
7. flows: areas 줄(공유 줄), 이 task의 test file 줄.

## 끝남

- `npm run check`가 통과한다. `npm run check:full`의 schema step lock 검사가 통과한다.
- 위험 test:
  - "깨지거나 반만 쓰인 file은 아무것도 내놓지 않는다": 맞는 changes file을 만든 뒤, 끝을 1 byte부터 절반까지 자른 것, payload 1 byte를 바꾼 것, header 숫자 하나를 바꾼 것, 뒤에 bytes를 더 붙인 것, 1행 판이 2인 것, header의 n이 path와 다른 것이 모두 실패하고(`invalid_file` 또는 `newer_format`) 변경 목록을 하나도 돌려주지 않는다. 맞는 file은 넣은 변경을 bytes 그대로 돌려준다
  - "writer는 자기 하위 폴더 밖에 쓰지 않는다": `..`, 절대 path, 다른 기계 폴더, 자기 폴더 안에서 밖을 가리키는 symlink로 쓰기·지우기·rename을 하면 실패하고 destination 아래의 다른 file이 bytes 그대로다
  - "data root와 겹치는 destination은 거절된다": data root 안, data root를 품은 path, 상대 path, 다른 destination과 겹친 path
  - "schema step이 기존 ledger에 걸려도 다른 표의 행이 그대로다"
  - "agent 자격은 destination을 두지도 지우지도 못한다": agent actor의 `settings/update`가 `folder.destinations`를 바꾸거나 지우려 하면 거절되고 설정 file이 그대로다
  - "모르는 칸이 더해진 header와 기록은 읽힌다": 아는 칸이 맞고 모르는 칸이 더해진 file은 맞는 file이고, 1행 판이나 `format`이 범위 밖이면 `newer_format"
- 남지 않음: 없음(더하기).
- flows catalog: 이 task가 더하는 test file의 줄과 areas 한 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `protocol/folder/mod.ts`와 `core/folder`가 내놓는 이름 목록(한 줄씩), 큰 snapshot의 hash를 어떻게 넘기게 했는지, `folder.tables`의 SQL과 lock 항목, destination check가 data root를 어디서 보는지.

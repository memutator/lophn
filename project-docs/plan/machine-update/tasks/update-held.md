# update-held

**opus high.** 폴더 읽기가 release와 lophn 판이 다른 기계를 다루게 한다. `app-folder-sync`가 다른 release의 file을 data root에 held로 복사해 두는 데서 시작해서: 이 기계의 앱이 그 release가 되면 held를 출처마다 번호 순서로 적용하고, 그 출처의 stream은 held를 다 적용한 뒤에야 잇는다. 같은 출처의 snapshot이 합쳐지거나 held로 들어오면 그보다 옛 held는 지운다(snapshot이 담는다). 한 출처의 held가 한도를 넘으면 더 복사하지 않고 폴더에 둔다. 폴더 꼴 판이 범위 밖인 기계의 data file은 열지 않고 아무것도 지우지 않는다. 그리고 옛 release에서 한 칸 고침이 그 기계가 올라온 뒤의 snapshot으로 살아 오도록, migration 뒤 칸 clock을 지우지 않고 칸 이름으로 옮긴다.

- 단위: held (wave 1)
- 선행: 없음. `app-folder-sync`가 main에 land된 뒤다(계획 README 머리)
- 소유(이 task만 고친다):
  - `packages/core/folder/import/`(`held.ts`, `stream.ts`, `scan.ts`, `status.ts`, `mod.ts`와 test. `folder-import`가 지은 이름이 다르면 lead가 맞춘다)
  - `packages/core/folder/import/drain.ts`, `packages/core/folder/import/compat.ts`(새 file)
  - `packages/protocol/folder/records.ts`, `packages/protocol/folder/container.ts`, `packages/protocol/folder/limits.ts`(판 범위 상수와 기록 칸. `app-folder-sync`가 계약 바꾸기 요청을 이미 받았으면 고치지 않는다)
  - `packages/core/folder/export/record.ts`(기계 기록에 `lophn.folder`를 싣는 만큼. 이미 실으면 고치지 않는다)
  - `packages/core/apps/runtime/entrypoint/sync.ts`(`forgetMovedColumns`만)
  - `packages/core/apps/runtime/entrypoint/sync_test.ts`
- 공유 줄 허락(한 줄씩, 보고의 "넘길 줄"에): `packages/core/main/daemon/wiring/apps.ts` 또는 `folder-surface`가 import를 조립한 wiring file(release 바뀜을 drain 계기로 다는 줄, 상태를 `update-status`에 넘기는 줄)
- 읽을 것:
  - 계획 `README.md`의 "정한 것"(범위로 본다, 범위 밖이면 멈춤, held 적용 순서, 옛 release 변경은 그 기계의 다음 snapshot으로 온다, 칸 clock을 이름으로, 한도), "계약 바꾸기 요청"
  - `project-docs/plan/app-folder-sync/README.md` "다른 계획이 기대는 계약" 1(배치), 2(file 꼴, cursor, "번호 m의 snapshot은 그 stream의 m보다 작은 번호의 변경을 모두 담는다", "주인의 release가 바뀐 뒤의 첫 file은 snapshot"), 4(held 표와 사본, "`machine-update`가 … (origin, n) 순서로 같은 적용 길(`FolderApply`)로 적용하고 성공한 행과 file을 지운다"), 6(기계 기록의 `lophn`), 7(오류 code `newer_format`)과 "정한 것"(snapshot은 덮지 않고 clock으로 합친다, compaction)
  - 그 계획의 code: `packages/protocol/folder/{container,records,limits}.ts`, `packages/core/folder/{ports,schema}.ts`(`FolderApply.applyChanges`·`mergeSnapshot`, `folder_reads`, `folder_held`), `packages/core/folder/import/*`(stream이 held로 넘기고 cursor를 옮기는 곳, snapshot으로 건너뛰는 곳, backoff), `packages/protocol/apps/sync/`의 `mergeSnapshot`
  - 칸 clock: `entrypoint/sync.ts`의 `forgetMovedColumns`(칸 목록이 바뀐 표의 `lophn_sync_col`을 지운다. `lophn_sync_columns`에 표마다 칸 이름 목록이 있다), `packages/protocol/apps/sync/tables.ts`(`lophn_sync_col`은 칸 번호로 적힌다)
  - 비교: `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md` 13.2(범위, 더 새 꼴은 적용하지 않고 "이 기계를 올려라"), 14 (iii) 9·10
  - architecture: `project-docs/architecture/app-sync.md` 지키는 것 2·5·6, `activation.md` 33(칸 clock은 새 release의 첫 시작이 지운다)
- 계약:
  - 쓰는 것: `app-folder-sync`의 위 계약, `FolderApply`, 이 기계 앱의 활성 release(id, `bundle_hash`)
  - 내놓는 것(`update-status`가 기댄다):
    - `FOLDER_FORMAT_MIN`(이 판이 읽는 하한, 지금 1)과 `FOLDER_FORMAT`(쓰는 판). 기계 기록 `lophn.folder: { version, min_version }`.
    - `FolderExchange`(`compat.ts`·`status.ts`): `machines(): [{ machine, name, lophn_version: string | null, folder: { version, min_version } | null, exchange: "ok" | "update_this" | "update_peer" }]`(이 기계도 한 줄, `"ok"`), `held(app): [{ origin, bundle_hash, data_schema, changes: number, bytes: number, full: boolean }]`(출처와 release마다 한 줄. `full`은 한도에 걸려 더 복사하지 않는 중), `onChange(listener)`.
    - 위 값이 바뀌면 `onChange`. `update-status`는 이것만 읽는다.

## 할 일

1. 판 범위(`compat.ts`, `records.ts`, `container.ts`, `limits.ts`, `export/record.ts`):
   - 기계 기록에 `lophn.folder: { version: FOLDER_FORMAT, min_version: FOLDER_FORMAT_MIN }`. 기록과 file header는 모르는 칸을 버리고 읽는다(`z.object`). 꼴 판은 옛 판이 읽으면 틀리는 바꿈에만 올린다(주석에 이 규칙). `app-folder-sync`가 이미 이렇게 했으면 건너뛴다.
   - 남의 기록으로 판정한다: 그 기계의 `folder.version`이 내 `[FOLDER_FORMAT_MIN, FOLDER_FORMAT]` 밖이면 범위 밖. 더 크면 `update_this`, 작으면 `update_peer`. 내 `FOLDER_FORMAT`이 그 기계의 `[min_version, version]` 밖이면(그 기계가 내 file을 못 읽는다) 내 판이 높으면 `update_peer`, 낮으면 `update_this`. `lophn.folder`가 없는 기록은 `{ version: 1, min_version: 1 }`로 본다. 기록 자체가 `newer_format`이면 `update_this`. 비교에 `lophn.version`(제품 판 글)을 쓰지 않는다.
2. 범위 밖 기계(`stream.ts`, `scan.ts`): 그 기계의 data·source·release file을 열지 않는다(기록만 읽는다). cursor를 옮기지 않고 held로 복사하지 않고 아무 file도 지우지 않는다. 오류는 `newer_format`으로 둔다(읽기 명령의 기존 code). 범위 안으로 돌아오면 다음 읽기가 그 cursor부터 잇는다.
3. drain(`drain.ts`, `stream.ts`): 앱의 활성 release가 바뀐 뒤(계기는 release 상태 바뀜과 읽기마다), 앱마다 출처마다 `folder_held`에서 `bundle_hash`가 지금 활성 release와 같은 행을 `n` 순서로 `FolderApply`(changes는 `applyChanges`, snapshot은 data root 아래 임시 file로 풀어 hash를 다시 보고 `mergeSnapshot`)로 적용한다. 행 하나가 성공하면 같은 transaction에서 그 행을 지우고 사본 file을 지운다. 실패하면(`unavailable`, `conflict`) 그 출처는 거기서 멈추고 다음 계기에 같은 행부터 한다. **한 출처에 지금 release의 held가 남아 있는 동안은 그 출처의 stream을 읽지 않는다**(stream의 cursor는 held 뒤에 있어 먼저 읽으면 순서가 뒤집힌다). 사본 file이 없거나 hash가 맞지 않으면 그 행에서 멈추고 오류(`invalid_file`)를 보인다(지우지 않는다).
4. 덮인 held 지우기(`held.ts`, `stream.ts`, `drain.ts`): 출처 X의 snapshot m이 합쳐지거나(stream이든 drain이든) held로 들어오면, 같은 transaction에서 X의 held 가운데 `n < m`인 행과 사본을 지운다(release가 달라도). snapshot m이 그것을 모두 담는다(계약 2). 그 밖에는 held를 지우지 않는다.
5. 한도(`held.ts`, `limits.ts`): `HELD_MAX_BYTES = 128 MiB`(출처 하나, 앱 하나에서 가장 새 held snapshot 뒤 held changes의 합. 주석: 한 release의 changeset 합 한도 `RELEASE_CHANGESET_MAX_BYTES`와 같고 그보다 많으면 snapshot 하나가 더 싸다). 넘을 file은 held로 복사하지 않고 cursor를 옮기지 않는다(폴더에 남는다). 그 출처는 이 기계의 release가 바뀔 때까지 stream을 다시 읽지 않는다(`full`). 이 기계가 그 release에 오면 drain 뒤 stream이 cursor부터 잇고, 그 사이 주인이 compaction했으면 지금 규칙대로 더 뒤의 snapshot으로 건너뛴다.
6. 칸 clock(`entrypoint/sync.ts`의 `forgetMovedColumns`): 칸 목록이 바뀐 표에서 `lophn_sync_col`을 지우지 않고, `lophn_sync_columns`의 옛 이름 목록과 지금 목록으로 칸 번호를 옮긴다. 이름이 없어진 칸의 clock만 지운다. 없어진 표는 지금처럼 지운다. 옮기는 동안 (tbl, pk, col) 열쇠가 겹치지 않게 한다. 함수 이름이 뜻과 맞지 않으면 바꾼다.
7. 위험 test(test ledger, 임시 폴더와 data root, `node:sqlite` adapter `packages/protocol/apps/sync/node-db.ts`. `FolderApply`는 sync core 위의 작은 실제 적용으로 둔다):
   - "다른 release의 held는 이 기계가 그 release가 될 때까지 적용되지 않고, 된 뒤에는 출처마다 번호 순서대로 빠짐없이 적용되며, 그 동안 그 출처의 뒤 file은 적용되지 않는다. 적용이 실패하면 그 행부터 남는다"
   - "출처의 snapshot m이 합쳐지거나 held가 되면 그보다 옛 held만 지워지고, 그 밖의 held는 지워지지 않는다"
   - "폴더 꼴 판이 범위 밖인 기계의 file은 열리지도 복사되지도 지워지지도 않고 cursor가 그대로이며, 범위 안으로 돌아오면 그 cursor부터 잇는다"
   - `sync_test.ts`: "옛 release에서 한 칸 고침은 칸 하나를 더한 migration 뒤에도 그 칸의 clock을 지켜, 먼저 올라간 기계에 그 기계의 새 snapshot을 합치면 그 고침이 남는다"(두 사본 A, B: 같은 base, A가 먼저 migration, B가 옛 꼴에서 칸 하나를 고친 뒤 migration과 첫 시작, A에 B의 snapshot을 `mergeSnapshot`)
   - 표로 묶을 수 있으면 한 file에 둔다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 위 7의 넷.
- 남지 않음: `forgetMovedColumns`의 이름을 바꿨으면 `grep -rn "forgetMovedColumns" packages tests`가 0줄.
- flows catalog: 바뀐 폴더 읽기의 outcome(범위 밖이면 멈춤, held drain, 덮인 held 지우기, 한도)과 칸 clock 옮기기, 새 test file의 줄을 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `app-folder-sync`의 실제 code와 이 brief의 이름이 다른 곳, drain 1,000 변경의 시간(가짜 아닌 sync core 적용), 칸 이름을 바꾸는 migration(지우고 새로 만드는 것으로 보인다)에서 clock이 어떻게 되는지.

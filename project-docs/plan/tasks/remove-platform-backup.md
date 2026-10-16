# remove-platform-backup

ledger 자동 backup과 restore 전체를 지운다: 하루 주기 tick, manifest, 보존 개수, 목록·조회 read, 복원 계획, 확인된 복원, 정지 뒤 복원 process, core 재시작 loop, blob GC의 `backup.pending` 연결. 앱 data를 activation 앞에서 사본으로 두는 복구본(`storage/migration/recovery.ts`)은 다른 것이라 남긴다. shell 쪽 복원 통로와 화면은 앞 task들이 지웠다.

- 단위: remove-platform (wave 1)
- 선행: remove-platform-shell, remove-platform-notifications
- 소유(이 task만 고친다):
  - `packages/core/storage/migration/backup.ts`
  - `packages/core/storage/migration/backup-reads.ts`
  - `packages/core/storage/migration/restore.ts`
  - `packages/core/main/worker/restore-entry.ts`
- 추가 소유(lead 승인, 2026-10-16. 소유와 같이 고친다. 지운 것을 가리키는 줄만 고친다. core·shell 조립이 wiring file로 쪼개졌으면 그 줄이 옮겨 간 wiring file이 대신한다. "등록 file(lead)"도 지운 것을 가리키는 줄만 뺀다. 모두 지운 file을 쓰던 곳이다):
  - storage: `packages/core/storage/migration/mod.ts`(backup·restore export), `packages/core/storage/migration/recovery.ts`(`BACKUP_LEDGER_PATH`), `packages/core/storage/blobs/{gc.ts, mod.ts}`와 `blobs/worker/{gc.ts, maintenance.ts}`(`backupPendingFolders`)
  - worker: `packages/core/main/worker/io.ts`(`createBackupTick`, `BACKUP_CHECK_INTERVAL_MS`, `backupDue`, `backup.pending` 확인)
  - 조립: `packages/core/main/daemon/wiring/storage-restore.ts`(file째 지운다), `packages/core/main/daemon/{core.ts, parent.ts, main.ts, runtime.ts, platform-register.ts}`
  - protocol: `packages/protocol/storage/backups.ts`, `packages/protocol/storage/restore-pipe.ts`, `packages/protocol/storage/mod.ts`, `packages/protocol/supervision/supervision.ts`(`restore*Schema` 다섯)
  - 등록 file(lead): `packages/core/main/daemon/assembly.ts`의 `WIRINGS`에서 storage-restore 한 줄, `packages/protocol/registry.ts`의 `BACKUP_ROUTES`
- 읽을 것:
  - spec: 없음. 삭제 목록 — `/home/pyosechang/projects/lophn/project-docs/tmp/notes/removed.md` 1장(backup, 자동 backup, restore, 복원 뒤 안내)
  - 순서 제약: `/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md` 6장 "blob GC의 `backup.pending` 연결", "`ledger-id.ts`를 쓰는 곳"
  - inventory: `I1.11#1` (`../assignment.md`에서 이 task가 맡은 줄), `I6#33`(lead 몫 줄을 이 task가 한다)
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `code-map.md`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음(지우기만 한다)

## 할 일

1. 소유 file을 지운다: `backup.ts`(`createBackup`, `retainBackups`, `backupDue`, `BackupBlobCopy`, `backupBlobPath`, 보존·주기 상수), `backup-reads.ts`(`/v1/backups/list`·`get`), `restore.ts`(`planRestore`, `restoreFromBackup`, `RestoreStopped`), `main/worker/restore-entry.ts`. (I1.11#1)
2. 쓰던 곳을 걷는다(추가 소유가 승인됐으면).
   - `migration/mod.ts`의 backup·restore export. `ledger-id.ts`와 그 export는 남긴다(`core.ts`가 파생 판 무효화에 쓴다. 쓰임은 lead가 정한다: I6#34).
   - `migration/recovery.ts`가 `protocol/storage/backups.ts`에서 가져오는 `BACKUP_LEDGER_PATH`는 recovery 안에 상수로 옮긴다(복구본은 남는다).
   - blob GC: `backupPendingFolders`와 그것으로 GC·maintenance를 건너뛰는 분기를 걷는다(`blobs/gc.ts`, `blobs/mod.ts`, `blobs/worker/{gc,maintenance}.ts`, `main/worker/io.ts`의 `backup.pending` 확인). (I6#33)
   - `io.ts`: `createBackupTick`과 주기 확인.
   - 조립: `wiring/storage-restore.ts`(`planRestore`, `restoreBinding`, `Core.restore*`, `runStoppedRestore`, `backups` read)를 file째 지우고, `core.ts`에 남은 `Core`의 `restore()`·`restorePlan()`·`restoreStopped()` 세 멤버와 `pendingRestore`를 지운다. `listBackups`·`findBackup`(runtime), `backupReads`(platform-register), `restore_plan_request`·`restore_request` 처리(parent), `for(;;)` 재시작 loop와 `core.restoreStopped()`(main)도 걷는다. 돌던 loop가 없어지므로 `main.ts`는 core를 한 번 띄우고 `core.done`을 기다리는 모양이 된다.
   - protocol: `storage/backups.ts`(`backupsList`, `backupsGet`, `BACKUP_ROUTES`, `BACKUP_EXCLUSIONS`와 manifest schema), `storage/restore-pipe.ts`, `storage/mod.ts`의 export, `supervision/supervision.ts`의 `restorePlanRequestSchema`·`restorePlanSchema`·`restoreRequestSchema`·`restoreResultSchema`·`restoreFailedSchema`와 그것을 묶는 union, `registry.ts`의 `BACKUP_ROUTES`.
3. 문자열로만 남은 것을 grep으로 찾는다: `new URL("../worker/restore-entry.ts", import.meta.url)`(core.ts), route 이름 `backups/`, process kind·메시지 type `restore_`, 데이터 폴더 이름 `backups/`.
4. 개발 data: 지운 코드가 만들던 `backups/` 폴더는 새 data root에서는 생기지 않는다. 지우는 명령을 만들지 않는다.
5. `deno task check`를 돈다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(지우기만 한다)
- 남지 않음: `grep -rn "createBackup\|planRestore\|restoreFromBackup\|backupPendingFolders\|BACKUP_ROUTES\|restore-entry\|restore_plan_request\|restorePlanRequestSchema\|backupsList\|backupsGet" packages tools`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: core 조립 목록과 `protocol/registry.ts`·`protocol/storage/mod.ts`에서 뺀 항목
- 안 쓰게 된 export: `ledger-id.ts`의 쓰임이 남았는지(restore가 새 값을 쓰던 이유가 사라졌다. 새로 만들 때만 바뀌면 되는지 lead가 정한다)
- 정한 것: `BACKUP_LEDGER_PATH`를 옮긴 곳
- 걱정: `core.ts`·`parent.ts`·`main.ts`는 다른 platform task와 같은 file을 고친다. rebase 충돌은 lead가 푼다
- 계약 바꾸기 요청: 없음

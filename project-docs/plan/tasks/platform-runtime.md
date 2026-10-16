# platform-runtime

core 시작·저장·감독 쪽의 platform 몫을 새 설계에 맞춘다. (1) migration 복구본을 "가장 최근 하나만 두고 다음 정상 기동에 지운다"로 바꾸고, (2) migration이 시작하지 못하는 세 경우(높은 schema, hash가 다른 이력, 손상된 원본)를 구별되는 값으로 core가 알리게 하고, (3) 쓰는 곳이 사라진 handoff 자료 봉투를 지운다. 감독의 `responsiveness/`는 요구 하나에 비해 과하지만 코드는 그대로 둔다.

- 단위: platform (wave 3)
- 선행: 계약 고정(contract-platform의 `startFailedSchema`, contract-events의 `ConnectionState.schemaFailure`), core-wiring(wave 0의 core-wiring-split), remove-platform(wave 1의 remove-platform-backup이 `storage/migration/{backup,backup-reads,restore}.ts`, 복구본 상수 이동, blob GC의 `backup.pending`, `io.ts`의 backup tick을 지우고, remove-platform-install이 `install-and-update`의 update 계산을 지운다), platform-secrets(secret-tool 실행 허락을 걷는 일이 그 뒤에 온다)
- 소유(이 task만 고친다):
  - `packages/core/storage/migration/`
  - `packages/core/storage/blobs/`
  - `packages/core/supervision/`
  - `packages/core/install-and-update/` (remove-platform 뒤 남은 것: data root 검사, 단일 instance lock, run metadata)
  - `packages/core/main/worker/maintenance-entry.ts`
  - `packages/core/main/daemon/wiring/storage.ts`, `wiring/supervision.ts` (core-wiring-split이 만든다. `applyMigrations`·`checkRestart`·`runStoppedMaintenance`, `platformIoSpec`·`sessionBusEnv`가 놓인 file이다)
- 읽을 것:
  - spec: 없음. 여기 복구본은 ledger schema를 바꾸기 전의 ledger 사본이다. S7의 복구본(앱 data DB 사본, release activation)과 다르다
  - inventory: `I1.3#13`, `I2.11#12`, `I2.11#13`, `I2.11#20`, `I2.11#23`
    - 같이 볼 줄(배정이 다른 단위인 것): `I1.6#8`(coding token의 keychain 보관·전달. 배정은 remove-platform이다. 이 task는 `core/install-and-update/credential-channel.ts`, `credential-helper.ts`, `credential-helper-main.ts`와 `mod.ts` export를 지운다), `I2.11#22`(blob 정지 유지보수. 배정은 releases-problems지만 file이 `maintenance-entry.ts`·`blobs/worker/maintenance.ts`라 이 task가 backup·restore 조립을 걷는다), `I1.11#1`(backup·restore 삭제. remove-platform이 했는지 확인하고, 남은 `blobs/gc.ts`의 `backupPendingFolders`와 `worker/maintenance.ts`의 backup 연결을 걷는다), `I2.11#21`(blob 소유 종류 등록. 각 소유처의 `blobs.ts`는 그 단위 몫이고 이 task는 `blobs/` 안의 목적 표만 본다)
  - 결정: `../../tmp/inventory/00-decisions.md`의 123~126(단일 instance lock과 data root 권한 검사는 남긴다)
  - 본보기(화면): `tools/wireframes/frames/compositions/workspace/start-failure-page.tsx`(시작 실패 화면. 구별되는 이유 셋)
  - 지금 코드: `core/storage/migration/{recovery,migrations,restart}.ts`, `core/main/daemon/main.ts`(실패 처리 `Deno.exit(1)`), `core/supervision/security/data-summary.ts`(`handoffEnvelope`), `protocol/supervision/supervision.ts`의 `startFailedSchema`(contract-platform)
- 계약:
  - 쓰는 것: `protocol/supervision/supervision.ts`의 `START_FAILURE_REASONS`, `startFailedSchema`(contract-platform)
  - 내놓는 것: `core/storage/migration/mod.ts`가 `startFailureReason(error: LophnError): StartFailureReason`(값은 `newer_schema` | `history_mismatch` | `damaged_original` | `other`)과 `confirmStartup(root)`를 내놓는다. migration 오류는 `details: { start_failure: "newer_schema" | "history_mismatch" | "damaged_original" }`를 싣는다(`LophnError.details`).

## 할 일

1. **복구본 규칙** `core/storage/migration/recovery.ts` — `I2.11#12`
   - 폴더 이름의 `backups/`가 backup 제거 뒤 뜻이 없다. `<data root>/recovery/s<N>-<stamp>/ledger.db`로 바꾼다. (`ledger.db` 상수는 remove-platform-backup이 이미 이 file 안으로 옮겨 두었다.)
   - `createRecoveryCopy`: 새 복구본을 만들고 검사에 성공한 뒤 `<data root>/recovery/`의 이전 복구본을 모두 지운다(가장 최근 하나만 남는다). 만들기나 검사가 실패하면 이전 복구본을 지우지 않는다.
   - `confirmStartup(root)`(새 함수): `<data root>/recovery/`를 지운다. 정상의 기준은 "이번 기동에서 migration이 적용한 step이 0개이고 API가 요청을 받기 시작했다"로 정한다(복구본을 만든 그 기동은 지우지 않고 다음 정상 기동이 지운다). 없는 폴더는 오류가 아니다.
   - `migrations.ts`의 `applyMigrations`가 적용한 step 수를 돌려주게 하고(지금은 `Result<void>`), wiring file이 API ready 직후 `applied === 0`이면 `confirmStartup`을 부른다.
2. **시작 실패 분류** — `I2.11#13`(core 쪽)
   - `migrations.ts`의 `checkHistory`와 무결성 검사 실패가 `details.start_failure`를 싣는다: 설치본보다 높은 schema → `newer_schema`, 적용된 step의 hash가 다름 → `history_mismatch`, `integrityOk()` 실패나 DB를 열지 못함 → `damaged_original`. 원본은 그대로 둔다(지금과 같다).
   - `startFailureReason(error)`: `details.start_failure`가 있으면 그 값, 없으면 `"other"`.
   - core 기동 실패 처리(`core/main/daemon/main.ts`, lead 소유)가 `startFailureReason`으로 `startFailedSchema` frame을 만들어 부모 pipe로 보낸 뒤 종료하게 하는 일은 보고의 "등록할 것"에 적는다. shell main이 이 frame을 받아 `failed-schema`와 `schemaFailure`로 세우는 일은 platform-desktop이 한다.
3. **handoff 자료 봉투** — `I1.3#13`
   - `core/supervision/security/data-summary.ts`의 `handoffEnvelope`와 `security/mod.ts`의 export를 지운다. 입력 꼴은 `<lophn-call>`(S4 6장)로 정했다. `summaryEnvelope`와 `compactedEnvelope`는 compact가 쓰므로 남긴다. 쓰는 곳이 소유 밖에 있으면 남기고 보고한다(`grep -rn handoffEnvelope packages`).
4. **감독 그대로** — `I2.11#20`
   - `core/supervision/responsiveness/`와 `security/`의 나머지는 바꾸지 않는다. 요구 하나(child 하나가 core를 막지 않음)에 비해 과하지만 코드는 그대로 둬도 된다(inventory). 이 줄은 "바꾸지 않음"으로 보고한다.
5. **쓰기 정지** — `I2.11#23`
   - 기동 순서(lock → migration → API server → worker)는 그대로다. `core/storage/migration/restart.ts`의 `RestartOwner`는 소유 concern이 낸다. 이 task는 `checkRestart` 모양을 바꾸지 않는다. 소유처(approvals, invocations, release activations)가 새 설계로 바뀌는 쪽은 02·05·07 단위가 `RestartOwner`를 낸다. 이 줄도 "바꾸지 않음"과 이유로 보고한다.
6. **credential helper** — 같이 볼 줄 `I1.6#8`
   - `core/install-and-update/credential-channel.ts`, `credential-helper.ts`, `credential-helper-main.ts`를 지우고 `mod.ts`에서 뺀다. coding token은 환경 변수로 바뀌므로(`../README.md` #66·67) helper와 unix socket 전달이 필요 없다. 쓰는 곳이 소유 밖에 있으면(`core/server/identity/coding-credential-assembly.ts`, daemon의 `credentialSocket`, CLI의 `connection/credential/`) 지우지 않고 그 목록을 보고한다. 쓰는 단위(events, coding-agent)가 걷은 뒤 cleanup이 지운다.
7. **secret-tool 허락** — platform-secrets 뒤
   - `wiring/supervision.ts`의 `platformIoSpec`에서 `allow_run: [...SECRET_TOOL_PATHS]`와 `DBUS_SESSION_BUS_ADDRESS` env 허락을 걷고, I/O worker용 `sessionBusEnv()`를 지운다(test runner용 `sessionBusEnv()`는 별개라 남는다).
8. **backup 찌꺼기 확인** — `I1.11#1`, `I2.11#22`
   - remove-platform-backup이 지웠어야 하는 `backupPendingFolders`, `createBackupTick`, `runStoppedRestore` 조립이 남았는지 `grep`으로 보고, 남았으면 `blobs/`·`maintenance-entry.ts`·`wiring/storage.ts` 안에서 걷는다. blob GC 자체와 종료 때 GC를 도는 `maintenance-entry` process는 남긴다.
9. (lead가 맞추며 더함) contract-platform의 launch spec `net_any`를 `core/supervision/security/launch-spec.ts`에서 Deno `--allow-net`(host 없음)으로 푼다. agent runtime만 켠다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "backups/migrations\|BACKUP_LEDGER_PATH\|backupPendingFolders\|runStoppedRestore" packages/core`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `core/main/daemon/main.ts`가 시작 실패 때 `startFailedSchema` frame을 보내게 하기(lead), core 조립 목록에 storage·supervision wiring, `protocol/storage/backups.ts`·`restore-pipe.ts` 지우기(cleanup)
- 안 쓰게 된 export: `handoffEnvelope`, 옛 복구본 경로 상수
- 정한 것: 문서에 답이 없어 정한 것(복구본 폴더 이름 `recovery`, 정상 기동의 기준, 새 복구본 성공 뒤에 이전 것을 지우는 순서)
- 걱정: S7의 앱 data 복구본(`core/apps/data`, releases-problems)은 이 task의 ledger 복구본과 다른 것이다. 폴더 이름이 겹치지 않는지(`recovery`) 확인이 필요하다

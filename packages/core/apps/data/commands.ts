// 앱 데이터 결과 기록(apps/data command). DB open·backup·script run·restore는
// transaction 밖 data worker가 하고, 여기 command는 짧은 참조·결과 저장만 한다.
// 업무 저장과 ledger 기록이 함께 rollback된다고 표시하지 않는다.

import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type DataResult,
  releaseBackupRecorded,
  releaseDataChanged,
  releaseDataRestored,
  releaseRecordBackup,
  releaseRecordDataChange,
  releaseRecordDataRestore,
} from "../../../protocol/apps/mod.ts";
import {
  BACKUP_BLOB_FIELD_NAME,
  BACKUP_BLOB_OWNER_KIND,
  BACKUP_BLOB_PURPOSE,
  backupBlobOwnerKey,
} from "./blobs.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";

export type DataRecord = {
  kind: "backup" | "change" | "restore";
  release: string;
  activationSeq: string;
  dataSchema: number;
  // backup·restore만 보호 backup 참조를 가진다.
  backupHash: string | null;
  invocation: string | null;
  integrityOk: boolean;
};

export type DataRecordStore = {
  // 진행 중 시도의 기존 기록. 같은 시도의 재기록은 conflict다.
  find(
    release: string,
    activationSeq: string,
    kind: DataRecord["kind"],
  ): DataRecord | null;
  save(record: DataRecord): void;
};

// 진행 중인 activation 시도인지 확인하고 확정한 참조를 그 시도에 남기는 자리다. releases가 낸다(apps/releases).
// 시도가 아니거나 비교 기준이 다르면 conflict다.
export type AttemptGate = {
  check(
    tx: Tx,
    attempt: {
      kind: DataRecord["kind"];
      release: string;
      activationSeq: string;
      dataSchema: number;
    },
  ): Result<void>;
  record(
    tx: Tx,
    attempt: {
      kind: DataRecord["kind"];
      release: string;
      backupHash: string | null;
      invocation: string | null;
    },
  ): void;
};

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

// machine 통보만 받는다. route actors가 걸러도 여기서 한 번 더 본다.
function requireMachine(ctx: RequestContext): Result<void> {
  return ctx.actor.startsWith("machine")
    ? ok(undefined)
    : conflict("data records are machine notifications only");
}

// 성공 제출은 실제 무결성 확인을 동반해야 한다.
function requireIntegrity(result: DataResult): Result<void> {
  return result.integrity_ok
    ? ok(undefined)
    : invalid("data result without integrity is not a success");
}

const ACCEPTED = { accepted: true as const };

export function createDataCommands(
  records: (tx: Tx) => DataRecordStore,
  gate?: AttemptGate,
): {
  recordBackup: CommandDefinition<typeof releaseRecordBackup>;
  recordDataChange: CommandDefinition<typeof releaseRecordDataChange>;
  recordDataRestore: CommandDefinition<typeof releaseRecordDataRestore>;
} {
  return {
    recordBackup: {
      route: releaseRecordBackup,
      handle(tx, ctx, input, _compare) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const store = records(tx);
        const gated = gate?.check(tx, {
          kind: "backup",
          release: input.release,
          activationSeq: input.activation_seq,
          dataSchema: input.data_schema,
        });
        if (gated !== undefined && !gated.ok) return gated;
        const existing = store.find(
          input.release,
          input.activation_seq,
          "backup",
        );
        if (existing !== null) return conflict("backup is already recorded");
        // ledger에는 실제로 보존한 byte의 hash만 둔다. 보존하지 않은 blob의 hash를 주장할 수 없다.
        if (
          input.blob.hash !== input.backup_hash ||
          input.blob.purpose !== BACKUP_BLOB_PURPOSE
        ) {
          return invalid("backup hash is not the preserved backup blob");
        }
        const record: DataRecord = {
          kind: "backup",
          release: input.release,
          activationSeq: input.activation_seq,
          dataSchema: input.data_schema,
          backupHash: input.backup_hash,
          invocation: null,
          integrityOk: true,
        };
        store.save(record);
        gate?.record(tx, {
          kind: "backup",
          release: input.release,
          backupHash: input.backup_hash,
          invocation: null,
        });
        const seq = tx.emit(releaseBackupRecorded, input.release, {
          activation_seq: input.activation_seq,
          backup_hash: input.backup_hash,
          data_schema: input.data_schema,
        });
        // 보호 blob 참조는 일반 읽기가 없는 field로 같은 transaction에서 등록한다. 실패하면 기록도 없다.
        const registered = tx.registerBlobRef({
          owner_kind: BACKUP_BLOB_OWNER_KIND,
          owner_key: backupBlobOwnerKey(input.release, input.activation_seq),
          field: BACKUP_BLOB_FIELD_NAME,
          registered_seq: seq,
          source: { kind: "prepared", blob: { ...input.blob } },
        });
        if (!registered.ok) {
          // 이 command가 내는 오류 목록 밖의 코드(준비 주체 불일치 등)는 입력 거절이다.
          const code = registered.error.code;
          return code === "conflict" || code === "unavailable" ||
              code === "invalid_input"
            ? registered
            : invalid("backup blob is not a prepared blob of this caller");
        }
        if (registered.value.hash !== input.backup_hash) {
          return conflict("the registered backup blob differs");
        }
        return ok(ACCEPTED);
      },
    },
    recordDataChange: {
      route: releaseRecordDataChange,
      handle(tx, ctx, input, _compare) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const store = records(tx);
        const integrity = requireIntegrity(input.result);
        if (!integrity.ok) return integrity;
        if (input.result.invocation === null) {
          return invalid("data change result needs an invocation");
        }
        const gated = gate?.check(tx, {
          kind: "change",
          release: input.result.release,
          activationSeq: input.result.activation_seq,
          dataSchema: input.result.data_schema,
        });
        if (gated !== undefined && !gated.ok) return gated;
        const backup = store.find(
          input.result.release,
          input.result.activation_seq,
          "backup",
        );
        if (backup === null) {
          return conflict("data change needs a recorded backup");
        }
        const existing = store.find(
          input.result.release,
          input.result.activation_seq,
          "change",
        );
        if (existing !== null) {
          return conflict("data change is already recorded");
        }
        store.save({
          kind: "change",
          release: input.result.release,
          activationSeq: input.result.activation_seq,
          dataSchema: input.result.data_schema,
          backupHash: backup.backupHash,
          invocation: input.result.invocation,
          integrityOk: true,
        });
        gate?.record(tx, {
          kind: "change",
          release: input.result.release,
          backupHash: backup.backupHash,
          invocation: input.result.invocation,
        });
        tx.emit(releaseDataChanged, input.result.release, {
          activation_seq: input.result.activation_seq,
          invocation: input.result.invocation,
          data_schema: input.result.data_schema,
          integrity_ok: true,
        });
        return ok(ACCEPTED);
      },
    },
    recordDataRestore: {
      route: releaseRecordDataRestore,
      handle(tx, ctx, input, _compare) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const store = records(tx);
        const integrity = requireIntegrity(input.result);
        if (!integrity.ok) return integrity;
        const gated = gate?.check(tx, {
          kind: "restore",
          release: input.result.release,
          activationSeq: input.result.activation_seq,
          dataSchema: input.result.data_schema,
        });
        if (gated !== undefined && !gated.ok) return gated;
        const backup = store.find(
          input.result.release,
          input.result.activation_seq,
          "backup",
        );
        if (backup === null || backup.backupHash !== input.backup_hash) {
          return conflict("restore backup does not match the recorded backup");
        }
        // 같은 시도의 같은 복원 보고는 응답을 잃은 재전송이다. 새 사실을 만들지 않는다.
        const restored = store.find(
          input.result.release,
          input.result.activation_seq,
          "restore",
        );
        if (restored !== null) {
          return restored.dataSchema === input.result.data_schema
            ? ok(ACCEPTED)
            : conflict("restore is already recorded with another schema");
        }
        store.save({
          kind: "restore",
          release: input.result.release,
          activationSeq: input.result.activation_seq,
          dataSchema: input.result.data_schema,
          backupHash: input.backup_hash,
          invocation: input.result.invocation,
          integrityOk: true,
        });
        tx.emit(releaseDataRestored, input.result.release, {
          activation_seq: input.result.activation_seq,
          invocation: input.result.invocation,
          backup_hash: input.backup_hash,
          data_schema: input.result.data_schema,
          integrity_ok: true,
        });
        return ok(ACCEPTED);
      },
    },
  };
}

// 업무 저장과 ledger 기록의 경계. 둘은 원자적으로 함께 끝나지 않으며,
// 사이에 실패가 나도 함께 rollback됐다고 말하지 않는다.
export type BoundaryFact = {
  businessSaved: boolean;
  ledgerRecorded: boolean;
  rolledBackTogether: false;
};

export function boundaryFact(
  businessSaved: boolean,
  ledgerRecorded: boolean,
): BoundaryFact {
  return { businessSaved, ledgerRecorded, rolledBackTogether: false };
}

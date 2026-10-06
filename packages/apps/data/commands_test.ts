// 앱 데이터 결과 기록. command는 참조·결과만 저장하고 DB를 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import type { DataResult } from "../../contracts/apps/mod.ts";
import type { RequestContext, Tx } from "../../contracts/platform/mod.ts";
import {
  boundaryFact,
  createDataCommands,
  type DataRecord,
  type DataRecordStore,
} from "./commands.ts";

const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const BACKUP = "a".repeat(64);
const BLOB = {
  preparation: "prep-1",
  principal: "machine",
  purpose: "app_backup",
  hash: BACKUP,
  size_bytes: 10,
};

function memoryStore(): DataRecordStore & { records: DataRecord[] } {
  const records: DataRecord[] = [];
  return {
    records,
    find(release, activationSeq, kind) {
      return records.find((record) =>
        record.release === release && record.activationSeq === activationSeq &&
        record.kind === kind
      ) ?? null;
    },
    save(record) {
      records.push(record);
    },
  };
}

function context(actor: string): RequestContext {
  return { actor } as RequestContext;
}

function tx(): Tx & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    registerBlobRef(reference: { source: { blob: typeof BLOB } }) {
      return {
        ok: true,
        value: { hash: reference.source.blob.hash },
      };
    },
    emit(event: { type: string }, subject: string | null, payload: unknown) {
      events.push({ type: event.type, subject, payload });
      return "1";
    },
  } as unknown as Tx & { events: unknown[] };
}

function result(overrides: Partial<DataResult> = {}): DataResult {
  return {
    release: RELEASE,
    activation_seq: "1",
    invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
    data_schema: 3,
    integrity_ok: true,
    ...overrides,
  };
}

Deno.test(
  "apps/data#R2: 업무 저장과 ledger 기록 사이 실패를 함께 rollback됐다고 하지 않는다",
  () => {
    const fact = boundaryFact(true, false);
    assertEquals(fact.rolledBackTogether, false);
    assertEquals(fact.businessSaved, true);
    assertEquals(fact.ledgerRecorded, false);
  },
);

Deno.test(
  "apps/data#R4: backup 참조가 확정되기 전에는 데이터 변경을 기록하지 않는다",
  () => {
    const store = memoryStore();
    const commands = createDataCommands(() => store);
    const recorded = commands.recordDataChange.handle(
      tx(),
      context("machine"),
      { result: result() },
      {},
    );
    assert(!recorded.ok);
    assertEquals(recorded.error.code, "conflict");
    assertEquals(store.records.length, 0);
  },
);

Deno.test(
  "apps/data#R5: backup 기록은 보호 참조와 실제 schema만 남긴다",
  () => {
    const store = memoryStore();
    const commands = createDataCommands(() => store);
    const recorded = commands.recordBackup.handle(tx(), context("machine"), {
      release: RELEASE,
      activation_seq: "1",
      backup_hash: BACKUP,
      blob: BLOB,
      data_schema: 0,
    }, {});
    assert(recorded.ok);
    assertEquals(store.records[0]?.backupHash, BACKUP);
    assertEquals(store.records[0]?.dataSchema, 0);
    // 같은 시도의 backup 재기록은 conflict다.
    const again = commands.recordBackup.handle(tx(), context("machine"), {
      release: RELEASE,
      activation_seq: "1",
      backup_hash: BACKUP,
      blob: BLOB,
      data_schema: 0,
    }, {});
    assert(!again.ok);
    assertEquals(again.error.code, "conflict");
  },
);

Deno.test(
  "apps/data#R6: 무결성 없는 변경 결과와 invocation 없는 결과는 기록이 아니다",
  () => {
    const store = memoryStore();
    const commands = createDataCommands(() => store);
    commands.recordBackup.handle(tx(), context("machine"), {
      release: RELEASE,
      activation_seq: "1",
      backup_hash: BACKUP,
      blob: BLOB,
      data_schema: 0,
    }, {});
    const noIntegrity = commands.recordDataChange.handle(
      tx(),
      context("machine"),
      { result: result({ integrity_ok: false }) },
      {},
    );
    assert(!noIntegrity.ok);
    assertEquals(noIntegrity.error.code, "invalid_input");
    const noInvocation = commands.recordDataChange.handle(
      tx(),
      context("machine"),
      { result: result({ invocation: null }) },
      {},
    );
    assert(!noInvocation.ok);
    assertEquals(noInvocation.error.code, "invalid_input");
  },
);

Deno.test(
  "apps/data#R11: 복원 기록은 확정된 backup 참조와 같을 때만 받는다",
  () => {
    const store = memoryStore();
    const commands = createDataCommands(() => store);
    const events = tx();
    commands.recordBackup.handle(events, context("machine"), {
      release: RELEASE,
      activation_seq: "1",
      backup_hash: BACKUP,
      blob: BLOB,
      data_schema: 0,
    }, {});
    const mismatch = commands.recordDataRestore.handle(
      events,
      context("machine"),
      { result: result({ data_schema: 0 }), backup_hash: "b".repeat(64) },
      {},
    );
    assert(!mismatch.ok);
    assertEquals(mismatch.error.code, "conflict");
    const restored = commands.recordDataRestore.handle(
      events,
      context("machine"),
      { result: result({ data_schema: 0 }), backup_hash: BACKUP },
      {},
    );
    assert(restored.ok);
    const restoreEvent = events.events.find((event) =>
      (event as { type: string }).type === "ReleaseDataRestored"
    ) as { payload: { backup_hash: string; integrity_ok: boolean } };
    assertEquals(restoreEvent.payload.backup_hash, BACKUP);
    assertEquals(restoreEvent.payload.integrity_ok, true);
  },
);

Deno.test(
  "apps/data#R1: machine이 아닌 actor의 데이터 기록은 거절한다",
  () => {
    const commands = createDataCommands(() => memoryStore());
    const recorded = commands.recordBackup.handle(tx(), context("user"), {
      release: RELEASE,
      activation_seq: "1",
      backup_hash: BACKUP,
      blob: BLOB,
      data_schema: 0,
    }, {});
    assert(!recorded.ok);
    assertEquals(recorded.error.code, "conflict");
  },
);

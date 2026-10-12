// 용량 상한을 넘으면 가장 오래된 첨부부터 정리되고 GetSnapshot이 "정리됨"을 보인다
// (snapshots#R17). 닫힘 근거·고친 기록·확정 Verification 참조는 그 뒤에도 읽힌다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "../../base/mod.ts";
import type {
  ReadSnapshot,
  RequestContext,
  Sql,
  SqlRow,
  Tx,
} from "../../protocol/platform/mod.ts";
import { TargetAuthorization } from "../../protocol/platform/mod.ts";
import {
  closureSchema,
  getSnapshotOutputSchema,
  snapshotInputSchema,
} from "../../protocol/problems/mod.ts";
import { listProblemFixesRead } from "../repairs/mod.ts";
import { REPORTS_SCHEMA_STEPS } from "../reporting/mod.ts";
import { snapshotLogsEnvironment } from "../../../apps/core/problems-logs.ts";
import { type GcDeps, trimCapacity } from "../../../apps/worker/platform/gc.ts";
import {
  insertSnapshot,
  PRUNED_ABSENCE_REASON,
  readLogFragment,
  SNAPSHOTS_SCHEMA_STEPS,
} from "./mod.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const PRB = "prb_01arz3ndektsv4rrffq69g5fav";
const SNP = "snp_01arz3ndektsv4rrffq69g5fav";
const RPT = "rpt_01arz3ndektsv4rrffq69g5fav";
const REL = "rel_01arz3ndektsv4rrffq69g5fav";
const REL_AFTER = "rel_01arz3ndektsv4rrffq69g5faw";
const VRF = "vrf_01arz3ndektsv4rrffq69g5fav";
const AT = "2026-10-04T12:00:01.000Z";
const PNG = "a".repeat(64);
const LOG = "b".repeat(64);
const STACK = "c".repeat(64);
const NEWER = "d".repeat(64);
const FIX = "e".repeat(64);
const VERIFICATION_BLOB = "f".repeat(64);
// platform blob-store의 snapshot_attachment 상한과 같다.
const CAP = 512 * 1024 * 1024;

const ctx: RequestContext = {
  principal: "user-1",
  actor: "user",
  scope: {
    operations: ["GetSnapshot", "ListProblemFixes"],
    targets: {},
  },
  conditions: {},
  credential_ref: "cred-1",
};

type Spec = {
  hash: string;
  sizeBytes: number;
  registeredAtMs: number;
  permanent: boolean;
  bytes: Uint8Array;
};

function blobPath(root: string, hash: string): string {
  return `${root}/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`;
}

async function seed(root: string, spec: Spec): Promise<void> {
  const path = blobPath(root, spec.hash);
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Deno.writeFile(path, spec.bytes);
}

function depsOf(root: string, specs: readonly Spec[]): GcDeps {
  return {
    root,
    listInstalled: () =>
      Promise.resolve(ok(specs.map((spec) => ({
        hash: spec.hash,
        observedAtMs: spec.registeredAtMs,
        sizeBytes: spec.sizeBytes,
        registeredAtMs: spec.registeredAtMs,
      })))),
    listUnreferenced: () => {
      const found = new Map<string, number>();
      for (const spec of specs) found.set(spec.hash, 0);
      return Promise.resolve(ok(found));
    },
    listBackupPending: () => Promise.resolve(ok([])),
    removeBlob: async (hash) => {
      await Deno.remove(blobPath(root, hash));
      return ok(undefined);
    },
    listTmp: () => Promise.resolve(ok([])),
    removeTmp: () => Promise.resolve(ok(undefined)),
    preparationRefs: () => Promise.resolve(ok([])),
    nowMs: () => 10_000,
    graceMs: 0,
  };
}

function sqlOf(db: DatabaseSync): Sql {
  return {
    run(statement, params) {
      const result = db.prepare(statement).run(...params);
      return {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    },
    get(statement, params) {
      return db.prepare(statement).get(...params) as SqlRow | undefined;
    },
    all(statement, params) {
      return db.prepare(statement).all(...params) as SqlRow[];
    },
  };
}

function writeLedger(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec("pragma journal_mode=WAL");
    for (const step of [...REPORTS_SCHEMA_STEPS, ...SNAPSHOTS_SCHEMA_STEPS]) {
      db.exec(step.sql);
    }
    db.exec(`create table events (
      seq integer primary key,
      type text not null,
      subject text,
      actor text not null,
      run text,
      payload text not null,
      at text not null
    )`);
    const sql = sqlOf(db);
    const snapshot = snapshotInputSchema.parse({
      id: SNP,
      captured_at: AT,
      invocation: null,
      invocation_missing_reason: { reason: "연결 없음" },
      error: {
        name: "TypeError",
        message: "boom",
        message_missing_reason: null,
        frames: [{ path: "src/a.ts", function: null, line: 1, column: 1 }],
        source_missing_reason: null,
        stack: STACK,
        stack_missing_reason: null,
        truncation_notes: [],
      },
      error_missing_reason: null,
      logs: {
        blob: LOG,
        line_count: 1,
        truncated: false,
        scope: "앱 로그 조각",
        from_at: null,
        to_at: null,
        collected_at: AT,
      },
      logs_missing_reason: null,
      screen: {
        name: "Editor",
        observed_at: AT,
        state: null,
        state_missing_reason: { reason: "상태 없음" },
        screenshot: PNG,
        screenshot_missing_reason: null,
      },
      screen_missing_reason: null,
    });
    insertSnapshot({ sql } as Tx, snapshot);
    sql.run(
      `insert into problems (id, app, group_key, status, closure) values (?, ?, 'group', 'closed', ?)`,
      [
        PRB,
        APP,
        JSON.stringify(closureSchema.parse({
          reason: "verified",
          basis_seq: "1",
          release: REL,
          verification: VRF,
          confirmation: null,
          last_report: null,
          note: null,
        })),
      ],
    );
    sql.run(
      `insert into reports (
        id, app, problem, source, mode, diagnostic_scope, release,
        release_missing_reason, bundle_hash, code, text, details, snapshot,
        observed_at, principal, content_hash
      ) values (?, ?, ?, 'exception', 'live', null, ?, null, ?, '_exception', null, null, ?, ?, 'user-1', ?)`,
      [RPT, APP, PRB, REL, "1".repeat(64), SNP, AT, "2".repeat(64)],
    );
    sql.run(
      `insert into events (seq, type, subject, actor, payload, at)
       values (1, 'ProblemFixRecorded', ?, 'machine', ?, ?)`,
      [
        PRB,
        JSON.stringify({
          before: REL,
          after: REL_AFTER,
          summary: FIX,
          verification: [VRF],
          ticket: null,
          claim_seq: null,
        }),
        AT,
      ],
    );
  } finally {
    db.close();
  }
}

function readClosed(path: string): {
  basis: string;
  verification: string;
  summary: string;
  verifications: string[];
} {
  const db = new DatabaseSync(path);
  try {
    const sql = sqlOf(db);
    const row = sql.get("select closure from problems where id = ?", [PRB]);
    const closure = closureSchema.parse(JSON.parse(String(row?.["closure"])));
    const snapshot: ReadSnapshot = {
      sql,
      as_of_seq: "1",
      port<T>(key: unknown): T {
        if (!Object.is(key, TargetAuthorization)) {
          throw new Error("등록되지 않은 port다");
        }
        return (() => ok(undefined)) as unknown as T;
      },
    };
    const fixes = listProblemFixesRead.handle(snapshot, ctx, { problem: PRB });
    assert(fixes.ok, fixes.ok ? "" : JSON.stringify(fixes.error));
    assertEquals(fixes.value.fixes.length, 1);
    return {
      basis: closure.basis_seq,
      verification: closure.verification ?? "",
      summary: fixes.value.fixes[0].fix.summary,
      verifications: fixes.value.fixes[0].fix.verification,
    };
  } finally {
    db.close();
  }
}

async function exists(root: string, hash: string): Promise<boolean> {
  try {
    await Deno.stat(blobPath(root, hash));
    return true;
  } catch {
    return false;
  }
}

function reader(
  root: string,
  deleted: ReadonlySet<string>,
): (
  hash: string,
  offset: number,
  length: number,
) => Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>> {
  return async (hash, offset, length) => {
    // 정리된 hash만 store의 pruned 결과다. 파일 부재만으로는 missing이다.
    if (deleted.has(hash)) {
      return err({
        code: "unavailable",
        message: "pruned",
        details: { reason: "pruned" },
      });
    }
    try {
      const bytes = await Deno.readFile(blobPath(root, hash));
      return ok({
        hash,
        sizeBytes: bytes.byteLength,
        bytes: bytes.subarray(offset, offset + length),
      });
    } catch (thrown) {
      if (thrown instanceof Deno.errors.NotFound) {
        return err({ code: "not_found", message: "blob이 없다" });
      }
      return err({ code: "unavailable", message: "blob을 읽지 못했다" });
    }
  };
}

function specs(capacityBytes: number): Spec[] {
  const text = (label: string) => new TextEncoder().encode(label);
  return [
    {
      hash: PNG,
      sizeBytes: capacityBytes,
      registeredAtMs: 1,
      permanent: false,
      bytes: text("png"),
    },
    {
      hash: LOG,
      sizeBytes: capacityBytes,
      registeredAtMs: 2,
      permanent: false,
      bytes: text("log"),
    },
    {
      hash: STACK,
      sizeBytes: capacityBytes,
      registeredAtMs: 3,
      permanent: false,
      bytes: text("stack"),
    },
    {
      hash: NEWER,
      sizeBytes: 1024,
      registeredAtMs: 4,
      permanent: false,
      bytes: text("newer"),
    },
    {
      hash: FIX,
      sizeBytes: 64,
      registeredAtMs: 5,
      permanent: true,
      bytes: text("fix-summary"),
    },
    {
      hash: VERIFICATION_BLOB,
      sizeBytes: 64,
      registeredAtMs: 6,
      permanent: true,
      bytes: text("verification"),
    },
  ];
}

async function trim(root: string, capacityBytes: number): Promise<string[]> {
  const blobs = specs(capacityBytes);
  for (const spec of blobs) await seed(root, spec);
  const trimmed = await trimCapacity(
    depsOf(root, blobs),
    new Map(blobs.map((spec) => [
      spec.hash,
      { category: "snapshot_attachment", permanent: spec.permanent },
    ])),
  );
  assert(trimmed.ok, trimmed.ok ? "" : JSON.stringify(trimmed.error));
  return [...trimmed.value.deleted];
}

Deno.test("problems/snapshots#R17: 용량 상한을 넘으면 가장 오래된 PNG·로그 조각·stack이 정리되고 GetSnapshot이 정리됨을 보인다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-t26-" });
  const ledger = `${root}/ledger.sqlite`;
  try {
    writeLedger(ledger);
    const deleted = await trim(root, CAP);
    assertEquals(deleted, [PNG, LOG, STACK]);
    assertEquals(await exists(root, PNG), false);
    assertEquals(await exists(root, LOG), false);
    assertEquals(await exists(root, STACK), false);
    assertEquals(await exists(root, NEWER), true);
    assertEquals(await exists(root, FIX), true);
    assertEquals(await exists(root, VERIFICATION_BLOB), true);
    assertEquals(
      new TextDecoder().decode(await Deno.readFile(blobPath(root, FIX))),
      "fix-summary",
    );
    assertEquals(
      new TextDecoder().decode(
        await Deno.readFile(blobPath(root, VERIFICATION_BLOB)),
      ),
      "verification",
    );

    const environment = snapshotLogsEnvironment({
      ledgerPath: ledger,
      read: reader(root, new Set(deleted)),
    });
    assert(environment.view);
    const view = environment.view;
    for (const item of ["error", "logs", "screen"] as const) {
      const body = await view(ctx, { snapshot: SNP, item });
      assert(body.ok, body.ok ? "" : JSON.stringify(body.error));
      const parsed = getSnapshotOutputSchema.safeParse(body.value);
      assert(
        parsed.success,
        parsed.success ? "" : JSON.stringify(parsed.error),
      );
      assertEquals(body.value.missing?.reason, PRUNED_ABSENCE_REASON);
      const hashes = new Map(
        body.value.blobs.map((blob) => [blob.purpose, blob.hash]),
      );
      assertEquals(hashes.get("snapshot_stack"), STACK);
      assertEquals(hashes.get("snapshot_logs"), LOG);
      assertEquals(hashes.get("feedback_screenshot"), PNG);
      if (item === "error") {
        assert(body.value.item && "stack" in body.value.item);
        assertEquals(body.value.item.stack, null);
        assertEquals(
          body.value.item.stack_missing_reason?.reason,
          PRUNED_ABSENCE_REASON,
        );
        assertEquals(body.value.snapshot.error?.stack, null);
      }
      if (item === "logs") {
        assertEquals(body.value.item, null);
        assertEquals(body.value.snapshot.logs, null);
        assertEquals(
          body.value.snapshot.logs_missing_reason?.reason,
          PRUNED_ABSENCE_REASON,
        );
      }
      if (item === "screen") {
        assert(body.value.item && "screenshot" in body.value.item);
        assertEquals(body.value.item.screenshot, null);
        assertEquals(
          body.value.item.screenshot_missing_reason?.reason,
          PRUNED_ABSENCE_REASON,
        );
        assertEquals(body.value.snapshot.screen?.screenshot, null);
      }
    }
    const fragment = await readLogFragment({
      actor: "user",
      snapshot: {
        logs: {
          blob: LOG,
          line_count: 1,
          truncated: false,
          scope: "앱 로그 조각",
          from_at: null,
          to_at: null,
          collected_at: AT,
        },
        logs_missing_reason: null,
      },
      read: environment.blobs,
    });
    assert(fragment.ok && fragment.value.kind === "unavailable");
    assertEquals(
      fragment.value.reason,
      "용량 상한을 넘어 오래된 로그 조각이 정리되었다",
    );

    const closed = readClosed(ledger);
    assertEquals(closed.basis, "1");
    assertEquals(closed.verification, VRF);
    assertEquals(closed.summary, FIX);
    assertEquals(closed.verifications, [VRF]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("problems/snapshots#R17: 닫힌 문제의 닫힘 근거·고친 기록·확정 Verification 참조는 정리 뒤에도 읽히고 닫힘은 삭제 계기가 아니다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-t26-" });
  const ledger = `${root}/ledger.sqlite`;
  try {
    writeLedger(ledger);
    const deleted = await trim(root, 1024);
    assertEquals(deleted, []);
    for (const hash of [PNG, LOG, STACK, NEWER, FIX, VERIFICATION_BLOB]) {
      assertEquals(await exists(root, hash), true);
    }
    const environment = snapshotLogsEnvironment({
      ledgerPath: ledger,
      read: reader(root, new Set(deleted)),
    });
    assert(environment.view);
    const body = await environment.view(ctx, { snapshot: SNP, item: "screen" });
    assert(body.ok, body.ok ? "" : JSON.stringify(body.error));
    assertEquals(body.value.missing, null);
    assert(body.value.item && "screenshot" in body.value.item);
    assertEquals(body.value.item.screenshot, PNG);
    const closed = readClosed(ledger);
    assertEquals(closed.basis, "1");
    assertEquals(closed.verification, VRF);
    assertEquals(closed.summary, FIX);
    assertEquals(closed.verifications, [VRF]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

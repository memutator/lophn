// ledger 표의 제약 시험이다. 표 정의(schema.ts)가 domain-model의 ledger 표와 같은 행만 받는지 본다.
import { assert, assertEquals, assertThrows } from "@std/assert";
import type { DatabaseSync } from "node:sqlite";
import { id, ids } from "../api/testing.ts";
import { type LedgerFixture, ledgerFixture } from "./testing.ts";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const AT = "2026-10-12T00:00:00.000Z";

type Row = Record<string, string | number | null>;

function insert(db: DatabaseSync, table: string, row: Row) {
  const columns = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table} (${
      columns.map((c) => `"${c}"`).join(", ")
    }) VALUES (${columns.map(() => "?").join(", ")})`,
  ).run(...Object.values(row));
}

const contextRow = (overrides: Row = {}): Row => ({
  id: ids.context,
  project: ids.project,
  title: "Experiments",
  purpose: "Track experiments",
  status: "drafting",
  applied_bundle: null,
  violation_mark: 0,
  revision: "101",
  ...overrides,
});
const bundleRow = (overrides: Row = {}): Row => ({
  id: ids.bundle,
  context: ids.context,
  number: null,
  parent: null,
  content_hash: SHA_A,
  content_size: 120,
  bundle_hash: null,
  status: "draft",
  check: null,
  created_by: "agent:asg_01arz3ndektsv4rrffq69g0001",
  revision: "102",
  ...overrides,
});
const checkRow = (overrides: Row = {}): Row => ({
  id: ids.check,
  context: ids.context,
  bundle: ids.bundle,
  status: "running",
  snapshot_hash: null,
  findings: "[]",
  violation_count: null,
  started_at: AT,
  finished_at: null,
  ...overrides,
});
const viewRow = (overrides: Row = {}): Row => ({
  id: ids.view,
  context: ids.context,
  name: "Running experiments",
  search: "experiments_by_status",
  inputs: '{"status":["running"]}',
  origin: "user",
  revision: "103",
  ...overrides,
});
const entryRow = (overrides: Row = {}): Row => ({
  id: ids.entry,
  context: ids.context,
  term: "Run",
  meaning: "One trial of an arm",
  set_by: "user",
  updated_at: AT,
  revision: "104",
  ...overrides,
});

function withLedger(body: (ledger: LedgerFixture, db: DatabaseSync) => void) {
  const ledger = ledgerFixture();
  try {
    ledger.seedProject(ids.project);
    ledger.seedProject(ids.otherProject);
    body(ledger, ledger.db);
  } finally {
    ledger.close();
  }
}

// 한 context와 draft 판 하나를 심는다.
function seedBasics(db: DatabaseSync) {
  insert(db, "contexts", contextRow());
  insert(db, "context_bundles", bundleRow());
}

// 번호 있는 판 하나를 만들 수 있도록 draft를 checking으로 올린다.
function submit(db: DatabaseSync, bundle = ids.bundle, number = 1) {
  const checkId = id("chk", Number(bundle.slice(-4)));
  insert(db, "context_checks", checkRow({ id: checkId, bundle }));
  db.prepare(
    `UPDATE context_bundles SET status = 'checking', number = ?, bundle_hash = ?, "check" = ? WHERE id = ?`,
  ).run(number, SHA_B, checkId, bundle);
  return checkId;
}

Deno.test("documents/contexts#R3 [ctx-I24]: the five ledger tables are created as STRICT tables", () => {
  withLedger((_ledger, db) => {
    const tables = db.prepare(
      `SELECT name, strict FROM pragma_table_list WHERE name IN
         ('contexts','context_bundles','context_checks','saved_views','glossary_entries')
       ORDER BY name`,
    ).all() as { name: string; strict: number }[];
    assertEquals(tables.map((t) => t.name), [
      "context_bundles",
      "context_checks",
      "contexts",
      "glossary_entries",
      "saved_views",
    ]);
    assert(tables.every((t) => t.strict === 1));
  });
});

Deno.test("documents/contexts#R1 [ctx-I24]: contexts take a valid row and reject bad ids, blank text, unknown status and bad counters", () => {
  withLedger((_ledger, db) => {
    insert(db, "contexts", contextRow());
    const bad: Row[] = [
      { id: "ctx_short" },
      { id: "cbn_01arz3ndektsv4rrffq69g0002" },
      // 첫 글자는 0~7이고 i·l·o·u가 없는 Crockford 소문자다
      { id: "ctx_91arz3ndektsv4rrffq69g0002" },
      { id: "ctx_01arz3ndektsv4rrffq69g000I" },
      { id: "ctx_01arz3ndektsv4rrffq69g000u" },
      { id: id("ctx", 3), project: "prj_nope" },
      { id: id("ctx", 3), project: "ctx_01arz3ndektsv4rrffq69g0001" },
      { id: id("ctx", 3), title: "" },
      { id: id("ctx", 3), title: "   " },
      { id: id("ctx", 3), title: "\t\n" },
      { id: id("ctx", 3), purpose: "" },
      { id: id("ctx", 3), purpose: " \t " },
      { id: id("ctx", 3), status: "open" },
      { id: id("ctx", 3), status: "Active" },
      { id: id("ctx", 3), violation_mark: -1 },
      { id: id("ctx", 3), revision: "0" },
      { id: id("ctx", 3), revision: "012" },
      { id: id("ctx", 3), revision: "1a" },
      { id: id("ctx", 3), revision: "" },
      { id: id("ctx", 3), revision: "9223372036854775808" },
      { id: id("ctx", 3), applied_bundle: "cbn_short", status: "archived" },
    ];
    for (const overrides of bad) {
      assertThrows(
        () =>
          insert(db, "contexts", contextRow({ title: "Other", ...overrides })),
        Error,
        undefined,
        `should reject ${JSON.stringify(overrides)}`,
      );
    }
    // 같은 모양에서 문제된 값만 고친 행은 받는다
    insert(db, "contexts", contextRow({ id: id("ctx", 3), title: "Other" }));
    assertEquals(
      (db.prepare("SELECT count(*) AS n FROM contexts").get() as { n: number })
        .n,
      2,
    );
  });
});

Deno.test("documents/contexts#R1 [ctx-I24]: a drafting context has no applied bundle and an active one has", () => {
  withLedger((_ledger, db) => {
    assertThrows(() =>
      insert(
        db,
        "contexts",
        contextRow({ status: "drafting", applied_bundle: ids.bundle }),
      )
    );
    assertThrows(() =>
      insert(
        db,
        "contexts",
        contextRow({ status: "active", applied_bundle: null }),
      )
    );
    // archived는 둘 다 가능하다
    insert(db, "contexts", contextRow({ status: "archived" }));
  });
});

Deno.test("documents/contexts#R1 [ctx-I24]: the title is unique per project by its trimmed text and free in another project", () => {
  withLedger((_ledger, db) => {
    insert(db, "contexts", contextRow());
    assertThrows(() =>
      insert(db, "contexts", contextRow({ id: id("ctx", 2) }))
    );
    assertThrows(() =>
      insert(
        db,
        "contexts",
        contextRow({ id: id("ctx", 2), title: "  Experiments\t" }),
      )
    );
    insert(
      db,
      "contexts",
      contextRow({ id: id("ctx", 2), project: ids.otherProject }),
    );
    insert(db, "contexts", contextRow({ id: id("ctx", 3), title: "Findings" }));
  });
});

Deno.test("documents/contexts#R4 [ctx-I24]: a context is archived, never deleted, and keeps its id and project", () => {
  withLedger((_ledger, db) => {
    insert(db, "contexts", contextRow());
    assertThrows(
      () => db.prepare("DELETE FROM contexts").run(),
      Error,
      "archived, not deleted",
    );
    assertThrows(
      () => db.prepare("UPDATE contexts SET id = ?").run(id("ctx", 9)),
      Error,
      "immutable",
    );
    assertThrows(
      () => db.prepare("UPDATE contexts SET project = ?").run(ids.otherProject),
      Error,
      "immutable",
    );
    db.prepare("UPDATE contexts SET status = 'archived', revision = '105'")
      .run();
  });
});

Deno.test("documents/contexts#R19 [ctx-I24]: bundles take a draft row and reject bad ids, hashes, status and sizes", () => {
  withLedger((_ledger, db) => {
    insert(db, "contexts", contextRow());
    // 버린 draft를 바탕으로 쓴다. draft 하나 제한과 겹쳐 거절되는 일이 없다.
    const base = (overrides: Row = {}) =>
      bundleRow({ id: id("cbn", 2), status: "discarded", ...overrides });
    insert(db, "context_bundles", bundleRow());
    const bad: Row[] = [
      { id: "cbn_short" },
      { id: id("chk", 7) },
      { context: id("ctx", 77) },
      { content_hash: "A".repeat(64) },
      { content_hash: "a".repeat(63) },
      { content_hash: "g".repeat(64) },
      { content_size: -1 },
      { status: "open" },
      { bundle_hash: "xyz" },
      { created_by: "" },
      { revision: "0" },
      { parent: id("cbn", 88) },
      { parent: "cbn_short" },
    ];
    for (const overrides of bad) {
      assertThrows(
        () =>
          insert(
            db,
            "context_bundles",
            base(overrides),
          ),
        Error,
        undefined,
        `should reject ${JSON.stringify(overrides)}`,
      );
    }
    insert(db, "context_bundles", base());
    insert(
      db,
      "context_bundles",
      base({ id: id("cbn", 3), parent: ids.bundle }),
    );
  });
});

Deno.test("documents/contexts#R19 [ctx-I24]: number, bundle_hash and check belong to submitted bundles only", () => {
  withLedger((_ledger, db) => {
    insert(db, "contexts", contextRow());
    const checkId = ids.check;
    insert(db, "context_bundles", bundleRow());
    insert(db, "context_checks", checkRow());
    // draft와 discarded는 번호가 없다
    assertThrows(() =>
      insert(db, "context_bundles", bundleRow({ id: id("cbn", 2), number: 1 }))
    );
    assertThrows(() =>
      insert(
        db,
        "context_bundles",
        bundleRow({
          id: id("cbn", 2),
          status: "discarded",
          bundle_hash: SHA_B,
        }),
      )
    );
    // checking·failed·applied·superseded는 셋 다 있어야 한다
    for (const status of ["checking", "failed", "applied", "superseded"]) {
      assertThrows(
        () =>
          insert(
            db,
            "context_bundles",
            bundleRow({ id: id("cbn", 2), status }),
          ),
        Error,
        undefined,
        status,
      );
      assertThrows(
        () =>
          insert(
            db,
            "context_bundles",
            bundleRow({
              id: id("cbn", 2),
              status,
              number: 2,
              bundle_hash: SHA_B,
            }),
          ),
        Error,
        undefined,
        `${status} without check`,
      );
    }
    assertThrows(() =>
      insert(
        db,
        "context_bundles",
        bundleRow({
          id: id("cbn", 2),
          status: "checking",
          number: 0,
          bundle_hash: SHA_B,
          check: checkId,
        }),
      )
    );
  });
});

Deno.test("documents/contexts#R19 [ctx-I24]: a context has at most one draft, one checking and one applied bundle and unique numbers", () => {
  withLedger((_ledger, db) => {
    seedBasics(db);
    // draft는 하나
    assertThrows(() =>
      insert(db, "context_bundles", bundleRow({ id: id("cbn", 2) }))
    );
    // 다른 context의 draft는 된다
    insert(db, "contexts", contextRow({ id: id("ctx", 2), title: "Other" }));
    insert(
      db,
      "context_bundles",
      bundleRow({ id: id("cbn", 3), context: id("ctx", 2) }),
    );

    const c1 = submit(db, ids.bundle, 1);
    // checking은 하나, 번호 중복 금지
    insert(db, "context_bundles", bundleRow({ id: id("cbn", 2) }));
    const c2 = id("chk", 2);
    insert(db, "context_checks", checkRow({ id: c2, bundle: id("cbn", 2) }));
    assertThrows(() =>
      db.prepare(
        `UPDATE context_bundles SET status = 'checking', number = 2, bundle_hash = ?, "check" = ? WHERE id = ?`,
      ).run(SHA_B, c2, id("cbn", 2))
    );
    // 첫 판을 passed로 닫고 적용한 뒤에야 둘째가 checking이 된다
    db.prepare(
      `UPDATE context_checks SET status = 'passed', snapshot_hash = ?, violation_count = 0, finished_at = ? WHERE id = ?`,
    ).run(SHA_A, AT, c1);
    db.prepare(`UPDATE context_bundles SET status = 'applied' WHERE id = ?`)
      .run(ids.bundle);
    db.prepare(
      `UPDATE context_bundles SET status = 'checking', number = 2, bundle_hash = ?, "check" = ? WHERE id = ?`,
    ).run(SHA_B, c2, id("cbn", 2));
    db.prepare(
      `UPDATE context_checks SET status = 'passed', snapshot_hash = ?, violation_count = 0, finished_at = ? WHERE id = ?`,
    ).run(SHA_A, AT, c2);
    // applied는 하나: 물러나기 전에 둘째를 적용하면 거절된다
    assertThrows(() =>
      db.prepare(`UPDATE context_bundles SET status = 'applied' WHERE id = ?`)
        .run(id("cbn", 2))
    );
    db.prepare(`UPDATE context_bundles SET status = 'superseded' WHERE id = ?`)
      .run(ids.bundle);
    db.prepare(`UPDATE context_bundles SET status = 'applied' WHERE id = ?`)
      .run(id("cbn", 2));
  });
});

Deno.test("documents/contexts#R19 [ctx-I24]: bundle status moves only along the allowed transitions", () => {
  withLedger((_ledger, db) => {
    seedBasics(db);
    const setStatus = (status: string, bundle = ids.bundle) =>
      db.prepare("UPDATE context_bundles SET status = ? WHERE id = ?").run(
        status,
        bundle,
      );
    // draft -> applied, failed, superseded는 안 된다
    for (const status of ["applied", "failed", "superseded"]) {
      assertThrows(() => setStatus(status), Error, undefined, status);
    }
    submit(db);
    assertThrows(() => setStatus("discarded"), Error, "transition");
    assertThrows(() => setStatus("draft"), Error, "transition");
    assertThrows(() => setStatus("superseded"), Error, "transition");
    setStatus("applied");
    assertThrows(() => setStatus("checking"), Error, "transition");
    setStatus("superseded");
    // 되돌리기: superseded -> applied
    setStatus("applied");
  });
});

Deno.test("documents/contexts#R19 [ctx-I24]: a failed or discarded bundle does not change any more", () => {
  withLedger((_ledger, db) => {
    seedBasics(db);
    insert(
      db,
      "context_bundles",
      bundleRow({ id: id("cbn", 2), status: "discarded" }),
    );
    assertThrows(() =>
      db.prepare("UPDATE context_bundles SET revision = '200' WHERE id = ?")
        .run(id("cbn", 2))
    );
    submit(db);
    db.prepare("UPDATE context_bundles SET status = 'failed' WHERE id = ?").run(
      ids.bundle,
    );
    assertThrows(() =>
      db.prepare("UPDATE context_bundles SET revision = '201' WHERE id = ?")
        .run(ids.bundle)
    );
  });
});

Deno.test("documents/contexts#R19 [ctx-I24]: a submitted bundle keeps its content, hash, number and check; numbers only grow", () => {
  withLedger((_ledger, db) => {
    seedBasics(db);
    // draft는 content를 다시 쓸 수 있다
    db.prepare(
      "UPDATE context_bundles SET content_hash = ?, content_size = 9, revision = '110'",
    ).run(SHA_B);
    submit(db, ids.bundle, 3);
    for (
      const [column, value] of [
        ["content_hash", SHA_A],
        ["content_size", 1],
        ["bundle_hash", SHA_A],
        ["number", 4],
        ["check", null],
      ] as const
    ) {
      assertThrows(
        () =>
          db.prepare(`UPDATE context_bundles SET "${column}" = ?`).run(value),
        Error,
        "frozen",
        column,
      );
    }
    // 상태와 revision은 바뀐다
    db.prepare(
      "UPDATE context_bundles SET status = 'applied', revision = '120'",
    ).run();
    // 둘째 판 번호는 첫째 번호보다 커야 한다
    insert(
      db,
      "context_bundles",
      bundleRow({ id: id("cbn", 2), parent: ids.bundle }),
    );
    const c2 = id("chk", 2);
    insert(db, "context_checks", checkRow({ id: c2, bundle: id("cbn", 2) }));
    assertThrows(
      () =>
        db.prepare(
          `UPDATE context_bundles SET status = 'checking', number = 3, bundle_hash = ?, "check" = ? WHERE id = ?`,
        ).run(SHA_B, c2, id("cbn", 2)),
      Error,
    );
    db.prepare(
      `UPDATE context_bundles SET status = 'checking', number = 4, bundle_hash = ?, "check" = ? WHERE id = ?`,
    ).run(SHA_B, c2, id("cbn", 2));
  });
});

Deno.test("documents/contexts#R19 [ctx-I24]: bundles are never deleted and keep their id, context and parent", () => {
  withLedger((_ledger, db) => {
    seedBasics(db);
    assertThrows(
      () => db.prepare("DELETE FROM context_bundles").run(),
      Error,
      "never deleted",
    );
    assertThrows(
      () => db.prepare("UPDATE context_bundles SET id = ?").run(id("cbn", 9)),
      Error,
      "immutable",
    );
    assertThrows(
      () =>
        db.prepare("UPDATE context_bundles SET parent = ?").run(id("cbn", 9)),
      Error,
    );
  });
});

Deno.test("documents/contexts#R21 [ctx-I24]: contexts.applied_bundle and bundles.check are checked at commit so one transaction may write them in any order", () => {
  withLedger((ledger, db) => {
    const result = ledger.transaction((tx) => {
      // context(active, applied)를 판보다 먼저 넣는다
      tx.sql.run(
        `INSERT INTO contexts (id, project, title, purpose, status, applied_bundle, violation_mark, revision)
         VALUES (?, ?, 'T', 'P', 'active', ?, 0, '101')`,
        [ids.context, ids.project, ids.bundle],
      );
      tx.sql.run(
        `INSERT INTO context_bundles (id, context, number, parent, content_hash, content_size, bundle_hash, status, "check", created_by, revision)
         VALUES (?, ?, 1, NULL, ?, 1, ?, 'applied', ?, 'machine', '101')`,
        [ids.bundle, ids.context, SHA_A, SHA_B, ids.check],
      );
      tx.sql.run(
        `INSERT INTO context_checks (id, context, bundle, status, snapshot_hash, findings, violation_count, started_at, finished_at)
         VALUES (?, ?, ?, 'passed', ?, '[]', 0, ?, ?)`,
        [ids.check, ids.context, ids.bundle, SHA_A, AT, AT],
      );
      return { ok: true as const, value: true };
    });
    assert(result.ok);
    assertEquals(
      (db.prepare("SELECT count(*) AS n FROM contexts").get() as { n: number })
        .n,
      1,
    );
    // 가리키는 판이 없으면 commit이 거절된다
    assertThrows(() => {
      ledger.transaction((tx) => {
        tx.sql.run(
          `INSERT INTO contexts (id, project, title, purpose, status, applied_bundle, violation_mark, revision)
           VALUES (?, ?, 'T2', 'P', 'active', ?, 0, '102')`,
          [id("ctx", 2), ids.project, id("cbn", 77)],
        );
        return { ok: true as const, value: true };
      });
    });
  });
});

Deno.test("documents/contexts#R20 [ctx-I24]: a check matches its status: running is open, finished has results, failed has findings", () => {
  withLedger((_ledger, db) => {
    seedBasics(db);
    insert(db, "context_checks", checkRow());
    const bad: Row[] = [
      { id: id("chk", 2), bundle: id("cbn", 2), status: "draft" },
      // running은 결과가 없다
      { status: "running", violation_count: 0 },
      { status: "running", finished_at: AT },
      { status: "running", snapshot_hash: SHA_A },
      {
        status: "running",
        findings: '[{"kind":"aborted","target":null,"detail":"x"}]',
      },
      // passed는 결과가 다 있고 findings가 없다
      { status: "passed" },
      {
        status: "passed",
        snapshot_hash: SHA_A,
        violation_count: 0,
        finished_at: AT,
        findings: '[{"kind":"aborted","target":null,"detail":"x"}]',
      },
      // failed는 findings가 하나 이상이다
      {
        status: "failed",
        snapshot_hash: SHA_A,
        violation_count: 0,
        finished_at: AT,
      },
      // 모양
      { findings: "not json" },
      { findings: '{"a":1}' },
      { started_at: "2026-10-12 00:00:00" },
      { started_at: "2026-10-12T00:00:00Z" },
      {
        status: "passed",
        snapshot_hash: "x",
        violation_count: 0,
        finished_at: AT,
      },
      {
        status: "passed",
        snapshot_hash: SHA_A,
        violation_count: -1,
        finished_at: AT,
      },
    ];
    // 판마다 검사는 하나라서 거절되는 검사는 쓰지 않은 판 하나(버린 draft)를 같이 쓴다.
    insert(
      db,
      "context_bundles",
      bundleRow({ id: id("cbn", 2), status: "discarded" }),
    );
    for (const overrides of bad) {
      assertThrows(
        () =>
          insert(
            db,
            "context_checks",
            checkRow({ id: id("chk", 2), bundle: id("cbn", 2), ...overrides }),
          ),
        Error,
        undefined,
        JSON.stringify(overrides),
      );
    }
  });
});

Deno.test("documents/contexts#R20 [ctx-I24]: one check per bundle, and a finished check is frozen", () => {
  withLedger((_ledger, db) => {
    seedBasics(db);
    insert(db, "context_checks", checkRow());
    insert(
      db,
      "context_bundles",
      bundleRow({ id: id("cbn", 2), status: "discarded" }),
    );
    assertThrows(() =>
      insert(
        db,
        "context_checks",
        checkRow({ id: id("chk", 2), bundle: ids.bundle }),
      )
    );
    db.prepare(
      `UPDATE context_checks SET status = 'failed', snapshot_hash = ?, violation_count = 2, finished_at = ?,
         findings = '[{"kind":"example_mismatch","target":"examples/0","detail":"mismatch"}]' WHERE id = ?`,
    ).run(SHA_A, AT, ids.check);
    assertThrows(
      () => db.prepare("UPDATE context_checks SET violation_count = 3").run(),
      Error,
      "finished",
    );
    assertThrows(
      () => db.prepare("DELETE FROM context_checks").run(),
      Error,
      "never deleted",
    );
  });
});

Deno.test("documents/contexts#R20 [ctx-I24]: a check keeps its id, context, bundle and start time", () => {
  withLedger((_ledger, db) => {
    seedBasics(db);
    insert(db, "context_checks", checkRow());
    assertThrows(
      () =>
        db.prepare("UPDATE context_checks SET started_at = ?").run(
          "2026-10-12T00:00:01.000Z",
        ),
      Error,
      "immutable",
    );
    assertThrows(
      () =>
        db.prepare("UPDATE context_checks SET bundle = ?").run(id("cbn", 9)),
      Error,
    );
  });
});

Deno.test("documents/contexts#R18 [ctx-I24]: saved views take a valid row and reject bad names, searches, inputs and origins", () => {
  withLedger((_ledger, db) => {
    insert(db, "contexts", contextRow());
    insert(db, "saved_views", viewRow());
    const bad: Row[] = [
      { id: "viw_short" },
      { id: id("viw", 2), context: id("ctx", 77) },
      { id: id("viw", 2), name: "" },
      { id: id("viw", 2), name: " \t " },
      { id: id("viw", 2), name: "Other", search: "Experiments" },
      { id: id("viw", 2), name: "Other", search: "1abc" },
      { id: id("viw", 2), name: "Other", search: "a-b" },
      { id: id("viw", 2), name: "Other", search: "" },
      { id: id("viw", 2), name: "Other", inputs: "not json" },
      { id: id("viw", 2), name: "Other", inputs: "[]" },
      { id: id("viw", 2), name: "Other", origin: "agent" },
      { id: id("viw", 2), name: "Other", revision: "x" },
      // 같은 context 안에서 이름 유일
      { id: id("viw", 2) },
    ];
    for (const overrides of bad) {
      assertThrows(
        () => insert(db, "saved_views", viewRow(overrides)),
        Error,
        undefined,
        JSON.stringify(overrides),
      );
    }
    // 같은 모양에서 문제된 값만 고친 행은 받는다
    insert(db, "saved_views", viewRow({ id: id("viw", 2), name: "Other" }));
    // 다른 context에서는 같은 이름이 된다
    insert(db, "contexts", contextRow({ id: id("ctx", 2), title: "Other" }));
    insert(
      db,
      "saved_views",
      viewRow({ id: id("viw", 3), context: id("ctx", 2) }),
    );
    // 지울 수 있다. id와 context는 못 바꾼다
    assertThrows(
      () =>
        db.prepare("UPDATE saved_views SET context = ? WHERE id = ?").run(
          id("ctx", 2),
          ids.view,
        ),
      Error,
      "immutable",
    );
    db.prepare("DELETE FROM saved_views WHERE id = ?").run(ids.view);
  });
});

Deno.test("documents/contexts#R26 [ctx-I24]: glossary terms are unique per context ignoring ASCII case only", () => {
  withLedger((_ledger, db) => {
    insert(db, "contexts", contextRow());
    insert(db, "contexts", contextRow({ id: id("ctx", 2), title: "Other" }));
    insert(db, "glossary_entries", entryRow({ term: "Run" }));
    assertThrows(() =>
      insert(
        db,
        "glossary_entries",
        entryRow({ id: id("trm", 2), term: "run" }),
      )
    );
    assertThrows(() =>
      insert(
        db,
        "glossary_entries",
        entryRow({ id: id("trm", 2), term: "RUN" }),
      )
    );
    // 다른 context는 같은 용어를 쓴다
    insert(
      db,
      "glossary_entries",
      entryRow({ id: id("trm", 3), context: id("ctx", 2), term: "run" }),
    );
    // 비ASCII 대소문자는 다른 글자다
    insert(
      db,
      "glossary_entries",
      entryRow({ id: id("trm", 4), term: "Élan" }),
    );
    insert(
      db,
      "glossary_entries",
      entryRow({ id: id("trm", 5), term: "élan" }),
    );
    // 용어는 입력한 대소문자 그대로 저장된다
    assertEquals(
      (db.prepare("SELECT term FROM glossary_entries WHERE id = ?").get(
        ids.entry,
      ) as { term: string }).term,
      "Run",
    );
    // 고쳐서 겹쳐도 거절된다
    assertThrows(() =>
      db.prepare("UPDATE glossary_entries SET term = 'RUN' WHERE id = ?").run(
        id("trm", 4),
      )
    );
  });
});

Deno.test("documents/contexts#R26 [ctx-I24]: glossary terms and meanings are trimmed, nonempty and within 80 and 1000 characters", () => {
  withLedger((_ledger, db) => {
    insert(db, "contexts", contextRow());
    const ok: Row[] = [
      { term: "a".repeat(80) },
      { id: id("trm", 3), term: "가".repeat(80) },
      { id: id("trm", 4), term: "b", meaning: "m".repeat(1000) },
    ];
    for (const overrides of ok) {
      insert(
        db,
        "glossary_entries",
        entryRow({ id: id("trm", 2), ...overrides }),
      );
    }
    const bad: Row[] = [
      { term: "" },
      { term: " " },
      { term: " padded" },
      { term: "padded\t" },
      { term: "x".repeat(81) },
      { term: "가".repeat(81) },
      { meaning: "" },
      { meaning: "\n" },
      { meaning: " padded" },
      { meaning: "m".repeat(1001) },
      { set_by: "machine" },
      { updated_at: "yesterday" },
      { id: "trm_short" },
      { context: id("ctx", 77) },
    ];
    let n = 10;
    for (const overrides of bad) {
      n += 1;
      assertThrows(
        () =>
          insert(
            db,
            "glossary_entries",
            entryRow({ id: id("trm", n), term: `t${n}`, ...overrides }),
          ),
        Error,
        undefined,
        JSON.stringify(overrides),
      );
    }
  });
});

Deno.test("documents/contexts#R26 [ctx-I24]: a context holds at most 200 glossary entries and an entry keeps its context", () => {
  withLedger((_ledger, db) => {
    insert(db, "contexts", contextRow());
    insert(db, "contexts", contextRow({ id: id("ctx", 2), title: "Other" }));
    for (let n = 1; n <= 200; n++) {
      insert(
        db,
        "glossary_entries",
        entryRow({ id: id("trm", n), term: `term ${n}` }),
      );
    }
    assertThrows(
      () =>
        insert(
          db,
          "glossary_entries",
          entryRow({ id: id("trm", 201), term: "one more" }),
        ),
      Error,
      "at most 200",
    );
    // 다른 context는 따로 센다
    insert(
      db,
      "glossary_entries",
      entryRow({ id: id("trm", 202), context: id("ctx", 2), term: "term 1" }),
    );
    // 하나를 지우면 다시 넣을 수 있다
    db.prepare("DELETE FROM glossary_entries WHERE id = ?").run(id("trm", 1));
    insert(
      db,
      "glossary_entries",
      entryRow({ id: id("trm", 201), term: "one more" }),
    );
    assertThrows(
      () =>
        db.prepare("UPDATE glossary_entries SET context = ? WHERE id = ?").run(
          id("ctx", 2),
          id("trm", 2),
        ),
      Error,
      "immutable",
    );
  });
});

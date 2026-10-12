// ledger 표의 행 읽기·쓰기 시험이다. 값을 쓰고 다시 읽으면 같은 값이 나와야 한다.
// 값은 api/testing.ts의 builder와 같은 모양으로 만든다.
import { assertEquals } from "@std/assert";
import { ok } from "../../../../base/mod.ts";
import type {
  CheckReport,
  ContextValue,
  GlossaryEntry,
  SavedViewValue,
} from "../../../../protocol/projects/mod.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";
import { id, ids, T0 } from "../api/testing.ts";
import {
  contextOf,
  deleteEntry,
  deleteView,
  loadBundle,
  loadCheck,
  loadContext,
  loadContextBundles,
  loadContextChecks,
  loadContextEntries,
  loadContextViews,
  loadEntry,
  loadProject,
  loadProjectBundles,
  loadProjectContexts,
  loadView,
  saveBundle,
  saveCheck,
  saveContext,
  saveEntry,
  saveView,
  type StoredBundle,
} from "./rows.ts";
import { type LedgerFixture, ledgerFixture } from "./testing.ts";

const SHA = (letter: string) => letter.repeat(64);

function withLedger(body: (ledger: LedgerFixture) => void) {
  const ledger = ledgerFixture();
  try {
    ledger.seedProject(ids.project);
    ledger.seedProject(ids.otherProject);
    body(ledger);
  } finally {
    ledger.close();
  }
}

// 쓰기는 command처럼 transaction 안에서 한다.
function write(ledger: LedgerFixture, body: (tx: Tx) => void) {
  const result = ledger.transaction((tx) => {
    body(tx);
    return ok(undefined);
  });
  if (!result.ok) throw new Error(result.error.message);
}

const context = (overrides: Partial<ContextValue> = {}): ContextValue => ({
  id: ids.context,
  project: ids.project,
  title: "Experiments",
  purpose: "Track experiments and findings",
  status: "drafting",
  applied_bundle: null,
  violation_mark: 0,
  revision: "101",
  ...overrides,
});

const bundle = (
  n: number,
  overrides: Partial<StoredBundle> = {},
): StoredBundle => ({
  id: id("cbn", n),
  context: ids.context,
  number: null,
  parent: null,
  bundle_hash: null,
  status: "draft",
  check: null,
  created_by: `agent:${id("asg", 1)}`,
  revision: String(110 + n),
  content_ref: { hash: SHA("c"), size_bytes: 321 },
  ...overrides,
});

const numbered = (
  n: number,
  status: "checking" | "failed" | "applied" | "superseded",
  overrides: Partial<StoredBundle> = {},
): StoredBundle =>
  bundle(n, {
    number: n,
    bundle_hash: SHA("b"),
    status,
    check: id("chk", n),
    created_by: "agent:" + id("asg", 1),
    content_ref: { hash: SHA(String(n)), size_bytes: 100 + n },
    ...overrides,
  });

const check = (
  n: number,
  overrides: Partial<CheckReport> = {},
): CheckReport => ({
  id: id("chk", n),
  context: ids.context,
  bundle: id("cbn", n),
  status: "running",
  snapshot_hash: null,
  findings: [],
  violation_count: null,
  started_at: T0,
  finished_at: null,
  ...overrides,
});

const view = (
  n: number,
  overrides: Partial<SavedViewValue> = {},
): SavedViewValue => ({
  id: id("viw", n),
  context: ids.context,
  name: `View ${n}`,
  search: "experiments_by_status",
  inputs: { status: ["running"], nested: { from: 1, to: null }, flag: true },
  origin: "user",
  revision: String(130 + n),
  ...overrides,
});

const entry = (
  n: number,
  overrides: Partial<GlossaryEntry> = {},
): GlossaryEntry => ({
  id: id("trm", n),
  context: ids.context,
  term: `Term ${n}`,
  meaning: `Meaning of term ${n}`,
  set_by: "user",
  updated_at: T0,
  revision: String(140 + n),
  ...overrides,
});

Deno.test("documents/contexts#R1 [ctx-I24]: a context row round-trips in each status and is found by id and by project", () => {
  withLedger((ledger) => {
    const drafting = context();
    const archived = context({
      id: id("ctx", 2),
      title: "Findings",
      status: "archived",
      violation_mark: 4,
      revision: "150",
    });
    const elsewhere = context({
      id: id("ctx", 3),
      project: ids.otherProject,
      title: "Experiments",
    });
    write(ledger, (tx) => {
      for (const value of [elsewhere, archived, drafting]) {
        saveContext(tx.sql, value);
      }
    });
    assertEquals(loadContext(ledger.sql, drafting.id), drafting);
    assertEquals(loadContext(ledger.sql, archived.id), archived);
    assertEquals(loadContext(ledger.sql, id("ctx", 99)), null);
    assertEquals(loadProjectContexts(ledger.sql, ids.project), [
      drafting,
      archived,
    ]);
    assertEquals(loadProjectContexts(ledger.sql, ids.otherProject), [
      elsewhere,
    ]);
  });
});

Deno.test("documents/contexts#R21 [ctx-I24]: an active context with its applied bundle round-trips, and saving again updates the row", () => {
  withLedger((ledger) => {
    const applied = numbered(1, "applied");
    write(ledger, (tx) => {
      saveContext(
        tx.sql,
        context({ status: "active", applied_bundle: applied.id }),
      );
      saveBundle(tx.sql, applied);
      saveCheck(
        tx.sql,
        check(1, {
          status: "passed",
          snapshot_hash: SHA("d"),
          violation_count: 0,
          finished_at: T0,
        }),
      );
    });
    const loaded = loadContext(ledger.sql, ids.context)!;
    assertEquals(loaded.status, "active");
    assertEquals(loaded.applied_bundle, applied.id);

    write(ledger, (tx) => {
      saveContext(tx.sql, { ...loaded, violation_mark: 7, revision: "160" });
    });
    assertEquals(loadContext(ledger.sql, ids.context), {
      ...loaded,
      violation_mark: 7,
      revision: "160",
    });
    assertEquals(loadProjectContexts(ledger.sql, ids.project).length, 1);
  });
});

Deno.test("documents/contexts#R19 [ctx-I24]: bundle rows of every status round-trip with their content reference", () => {
  withLedger((ledger) => {
    const rows: StoredBundle[] = [
      bundle(1, { status: "discarded" }),
      numbered(2, "superseded", { parent: null }),
      numbered(3, "applied", { parent: id("cbn", 2) }),
      numbered(4, "checking", { parent: id("cbn", 3) }),
      numbered(5, "failed", { parent: id("cbn", 3) }),
      bundle(6, { parent: id("cbn", 3) }),
    ];
    write(ledger, (tx) => {
      saveContext(
        tx.sql,
        context({ status: "active", applied_bundle: id("cbn", 3) }),
      );
      for (const row of rows) saveBundle(tx.sql, row);
      for (const n of [2, 3, 4, 5]) {
        saveCheck(
          tx.sql,
          n === 4 ? check(n) : check(n, {
            status: n === 5 ? "failed" : "passed",
            snapshot_hash: SHA("d"),
            violation_count: 0,
            finished_at: T0,
            findings: n === 5
              ? [{ kind: "aborted", target: null, detail: "stopped" }]
              : [],
          }),
        );
      }
    });
    for (const row of rows) assertEquals(loadBundle(ledger.sql, row.id), row);
    assertEquals(loadBundle(ledger.sql, id("cbn", 99)), null);
    // id 순이다
    assertEquals(loadContextBundles(ledger.sql, ids.context), rows);
    assertEquals(loadContextBundles(ledger.sql, id("ctx", 99)), []);
  });
});

Deno.test("documents/contexts#R19 [ctx-I24]: saving a draft again replaces its content reference and revision, and a submit fills number, hash and check", () => {
  withLedger((ledger) => {
    const draft = bundle(1);
    write(ledger, (tx) => {
      saveContext(tx.sql, context());
      saveBundle(tx.sql, draft);
    });
    const rewritten: StoredBundle = {
      ...draft,
      content_ref: { hash: SHA("e"), size_bytes: 999 },
      revision: "170",
    };
    write(ledger, (tx) => saveBundle(tx.sql, rewritten));
    assertEquals(loadBundle(ledger.sql, draft.id), rewritten);

    const submitted: StoredBundle = {
      ...rewritten,
      number: 1,
      bundle_hash: SHA("f"),
      status: "checking",
      check: id("chk", 1),
      revision: "171",
    };
    write(ledger, (tx) => {
      saveCheck(tx.sql, check(1));
      saveBundle(tx.sql, submitted);
    });
    assertEquals(loadBundle(ledger.sql, draft.id), submitted);
  });
});

Deno.test("documents/contexts#R21 [ctx-I24]: replacing the applied bundle works when the retiring row is written first", () => {
  withLedger((ledger) => {
    const first = numbered(1, "applied");
    const second = numbered(2, "checking", { parent: first.id });
    write(ledger, (tx) => {
      saveContext(
        tx.sql,
        context({ status: "active", applied_bundle: first.id }),
      );
      saveBundle(tx.sql, first);
      saveBundle(tx.sql, second);
      saveCheck(
        tx.sql,
        check(1, {
          status: "passed",
          snapshot_hash: SHA("d"),
          violation_count: 0,
          finished_at: T0,
        }),
      );
      saveCheck(tx.sql, check(2));
    });
    write(ledger, (tx) => {
      saveBundle(tx.sql, { ...first, status: "superseded", revision: "180" });
      saveBundle(tx.sql, { ...second, status: "applied", revision: "180" });
      saveContext(tx.sql, {
        ...loadContext(tx.sql, ids.context)!,
        applied_bundle: second.id,
        revision: "180",
      });
    });
    assertEquals(loadBundle(ledger.sql, first.id)?.status, "superseded");
    assertEquals(loadBundle(ledger.sql, second.id)?.status, "applied");
    assertEquals(
      loadContext(ledger.sql, ids.context)?.applied_bundle,
      second.id,
    );
  });
});

Deno.test("documents/contexts#R1 [ctx-I24]: loadProjectBundles gathers the bundles of every context of a project only", () => {
  withLedger((ledger) => {
    const other = context({
      id: id("ctx", 2),
      title: "Findings",
    });
    const foreign = context({
      id: id("ctx", 3),
      project: ids.otherProject,
    });
    const mine = bundle(1);
    const theirs = bundle(2, { context: other.id });
    const away = bundle(3, { context: foreign.id });
    write(ledger, (tx) => {
      for (const value of [context(), other, foreign]) {
        saveContext(tx.sql, value);
      }
      for (const row of [mine, theirs, away]) saveBundle(tx.sql, row);
    });
    assertEquals(loadProjectBundles(ledger.sql, ids.project), [mine, theirs]);
    assertEquals(loadProjectBundles(ledger.sql, ids.otherProject), [away]);
  });
});

Deno.test("documents/contexts#R20 [ctx-I24]: check rows of each status round-trip with their findings", () => {
  withLedger((ledger) => {
    const running = check(1);
    const passed = check(2, {
      status: "passed",
      snapshot_hash: SHA("d"),
      violation_count: 3,
      finished_at: "2026-10-12T00:00:09.000Z",
    });
    const failed = check(3, {
      status: "failed",
      snapshot_hash: SHA("d"),
      violation_count: 0,
      finished_at: "2026-10-12T00:00:10.000Z",
      findings: [
        {
          kind: "example_mismatch",
          target: "examples/0",
          detail: "expected [a, b] but got [b]",
        },
        { kind: "aborted", target: null, detail: "worker stopped" },
      ],
    });
    write(ledger, (tx) => {
      saveContext(tx.sql, context());
      // 검사를 달 판은 버린 draft로 둔다(context마다 draft는 하나다).
      for (const n of [1, 2, 3]) {
        saveBundle(tx.sql, bundle(n, { status: "discarded" }));
      }
      for (const value of [running, passed, failed]) saveCheck(tx.sql, value);
    });
    for (const value of [running, passed, failed]) {
      assertEquals(loadCheck(ledger.sql, value.id), value);
    }
    assertEquals(loadCheck(ledger.sql, id("chk", 99)), null);
    assertEquals(loadContextChecks(ledger.sql, ids.context), [
      running,
      passed,
      failed,
    ]);
    // running 검사가 끝나면 같은 행이 바뀐다
    const finished: CheckReport = {
      ...running,
      status: "passed",
      snapshot_hash: SHA("a"),
      violation_count: 1,
      finished_at: "2026-10-12T00:00:11.000Z",
    };
    write(ledger, (tx) => saveCheck(tx.sql, finished));
    assertEquals(loadCheck(ledger.sql, running.id), finished);
  });
});

Deno.test("documents/contexts#R18 [ctx-I24]: saved views round-trip with nested inputs, update in place and delete", () => {
  withLedger((ledger) => {
    const user = view(1);
    const engineer = view(2, {
      origin: "engineer",
      inputs: {},
      name: "Empty inputs",
    });
    write(ledger, (tx) => {
      saveContext(tx.sql, context());
      saveView(tx.sql, engineer);
      saveView(tx.sql, user);
    });
    assertEquals(loadView(ledger.sql, user.id), user);
    assertEquals(loadView(ledger.sql, engineer.id), engineer);
    assertEquals(loadView(ledger.sql, id("viw", 99)), null);
    assertEquals(loadContextViews(ledger.sql, ids.context), [user, engineer]);

    const renamed = {
      ...user,
      name: "Renamed",
      inputs: { status: ["done"] },
      revision: "190",
    };
    write(ledger, (tx) => saveView(tx.sql, renamed));
    assertEquals(loadView(ledger.sql, user.id), renamed);
    assertEquals(loadContextViews(ledger.sql, ids.context).length, 2);

    write(ledger, (tx) => deleteView(tx.sql, user.id));
    assertEquals(loadView(ledger.sql, user.id), null);
    assertEquals(loadContextViews(ledger.sql, ids.context), [engineer]);
  });
});

Deno.test("documents/contexts#R26 [ctx-I24]: glossary entries round-trip with their set_by, update in place and delete", () => {
  withLedger((ledger) => {
    const byUser = entry(1);
    const byAgent = entry(2, {
      term: "Élan",
      meaning: "한국어 뜻과 emoji-free text",
      set_by: "agent",
      updated_at: "2026-10-12T00:00:05.000Z",
    });
    write(ledger, (tx) => {
      saveContext(tx.sql, context());
      saveEntry(tx.sql, byAgent);
      saveEntry(tx.sql, byUser);
    });
    assertEquals(loadEntry(ledger.sql, byUser.id), byUser);
    assertEquals(loadEntry(ledger.sql, byAgent.id), byAgent);
    assertEquals(loadEntry(ledger.sql, id("trm", 99)), null);
    assertEquals(loadContextEntries(ledger.sql, ids.context), [
      byUser,
      byAgent,
    ]);

    const changed: GlossaryEntry = {
      ...byAgent,
      meaning: "Rewritten",
      set_by: "user",
      revision: "200",
    };
    write(ledger, (tx) => saveEntry(tx.sql, changed));
    assertEquals(loadEntry(ledger.sql, byAgent.id), changed);

    write(ledger, (tx) => deleteEntry(tx.sql, byUser.id));
    assertEquals(loadContextEntries(ledger.sql, ids.context), [changed]);
  });
});

Deno.test("documents/contexts#R3 [ctx-I24]: contextOf finds the context of a bundle, a check, a saved view or a glossary entry", () => {
  withLedger((ledger) => {
    write(ledger, (tx) => {
      saveContext(tx.sql, context());
      saveBundle(tx.sql, bundle(1));
      saveCheck(tx.sql, check(1));
      saveView(tx.sql, view(1));
      saveEntry(tx.sql, entry(1));
    });
    assertEquals(contextOf(ledger.sql, "bundle", id("cbn", 1)), ids.context);
    assertEquals(contextOf(ledger.sql, "check", id("chk", 1)), ids.context);
    assertEquals(contextOf(ledger.sql, "view", id("viw", 1)), ids.context);
    assertEquals(contextOf(ledger.sql, "entry", id("trm", 1)), ids.context);
    assertEquals(contextOf(ledger.sql, "bundle", id("cbn", 99)), null);
    assertEquals(contextOf(ledger.sql, "entry", id("cbn", 1)), null);
  });
});

Deno.test("documents/contexts#R1 [ctx-I24]: loadProject tells active, archived and missing projects apart", () => {
  withLedger((ledger) => {
    ledger.seedProject(id("prj", 3), "archived");
    assertEquals(loadProject(ledger.sql, ids.project), {
      id: ids.project,
      archived: false,
    });
    assertEquals(loadProject(ledger.sql, id("prj", 3)), {
      id: id("prj", 3),
      archived: true,
    });
    assertEquals(loadProject(ledger.sql, id("prj", 99)), null);
  });
});

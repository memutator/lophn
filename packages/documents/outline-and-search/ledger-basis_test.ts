import { assert, assertEquals } from "@std/assert";
import { type DerivedStore, openDerived } from "./adapters/store.ts";
import { reconcileLedgerBasis, recordedLedgerId } from "./ledger-basis.ts";

const A = "ldg_00000000000000000000000000000001";
const B = "ldg_00000000000000000000000000000002";

function openStore(): { store: DerivedStore; directory: string } {
  const directory = Deno.makeTempDirSync({ prefix: "outline-ledger-basis-" });
  const opened = openDerived(`${directory}/documents.sqlite`);
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  return { store: opened.value, directory };
}

// 한 ledger가 만든 index 한 문서와 요약 cache·cursor. 모든 표에 한 행씩 남긴다.
function seed(store: DerivedStore, token: string) {
  const written = store.transaction((tx) => {
    tx.sql.run(
      `INSERT INTO derived_versions
         (version, document, content_hash, module_hash, extraction_status, text_hash, line_count, section_count)
       VALUES (?, ?, 'h', 'm', 'ready', 't', 1, 0)`,
      [`ver_${token}`, `doc_${token}`],
    );
    tx.sql.run(
      `INSERT INTO derived_texts (version, text_hash, text, line_offsets) VALUES (?, 't', ?, '[0]')`,
      [`ver_${token}`, token],
    );
    tx.sql.run(
      `INSERT INTO derived_sections
         (version, key, title, parent, position, level, anchor, own_ranges, subtree_range, characters, estimated_tokens, body_hash, children_count)
       VALUES (?, 's1', 'title', NULL, 0, 1, NULL, '[]', '[]', 1, 1, 'b', 0)`,
      [`ver_${token}`],
    );
    tx.sql.run(
      `INSERT INTO search_documents (document, indexed_version, title, status, saved_seq)
       VALUES (?, ?, ?, 'active', '9')`,
      [`doc_${token}`, `ver_${token}`, `title ${token}`],
    );
    tx.sql.run(
      `INSERT INTO search_rows (document, version, section_key, ranges, title, body)
       VALUES (?, ?, NULL, '[]', ?, ?)`,
      [`doc_${token}`, `ver_${token}`, `title ${token}`, `body ${token}`],
    );
    tx.sql.run(
      `INSERT INTO summary_cache (version, section_key, input_hash, text) VALUES (?, NULL, 'i', 'model summary')`,
      [`ver_${token}`],
    );
    tx.sql.run(
      `INSERT INTO derived_cursors (consumer, processed_seq, rebuilding, rebuild_basis_seq)
       VALUES ('search', '9', 0, NULL)`,
      [],
    );
    return { ok: true as const, value: undefined };
  });
  assert(written.ok, written.ok ? "" : written.error.message);
}

function counts(store: DerivedStore): Record<string, number> {
  const out: Record<string, number> = {};
  for (
    const table of [
      "derived_versions",
      "derived_texts",
      "derived_sections",
      "search_documents",
      "search_rows",
      "summary_cache",
      "derived_cursors",
    ]
  ) {
    out[table] = Number(
      store.read.sql.get(`SELECT count(*) AS n FROM ${table}`, [])?.n,
    );
  }
  return out;
}

function ftsHits(store: DerivedStore, term: string): number {
  return Number(
    store.read.sql.get(
      `SELECT count(*) AS n FROM search_fts WHERE search_fts MATCH ?`,
      [`"${term}"`],
    )?.n,
  );
}

Deno.test("platform/backup-and-migration#R14: 같은 ledger 식별이면 derived를 그대로 두고 처음 쓰는 store는 식별만 적는다", () => {
  const { store, directory } = openStore();
  try {
    assertEquals(recordedLedgerId(store), null);
    const first = reconcileLedgerBasis(store, A);
    assert(first.ok);
    assertEquals(first.value.rebuilt, false);
    assertEquals(recordedLedgerId(store), A);
    seed(store, "kept");
    const again = reconcileLedgerBasis(store, A);
    assert(again.ok);
    assertEquals(again.value.rebuilt, false);
    assertEquals(counts(store)["search_rows"], 1);
    assertEquals(counts(store)["derived_cursors"], 1);
  } finally {
    store.close();
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("platform/backup-and-migration#R14 documents/outline-and-search#R13: 다른 ledger의 derived는 결과·cursor·요약을 모두 버리고 새 식별을 적는다", () => {
  const { store, directory } = openStore();
  try {
    assert(reconcileLedgerBasis(store, A).ok);
    seed(store, "old");
    assertEquals(ftsHits(store, "old"), 1);
    // 복원·새로 만든 ledger. 옛 cursor(9)가 남아 있으면 새 ledger의 seq 1..9를 건너뛰게 된다.
    const changed = reconcileLedgerBasis(store, B);
    assert(changed.ok);
    assertEquals(changed.value.rebuilt, true);
    assertEquals(recordedLedgerId(store), B);
    for (const [table, n] of Object.entries(counts(store))) {
      assertEquals(n, 0, `${table}에 옛 ledger의 행이 남았다`);
    }
    // 전문 검색 index도 옛 행을 내지 않는다.
    assertEquals(ftsHits(store, "old"), 0);
    // 새 ledger의 결과는 이어서 쌓인다.
    seed(store, "new");
    assertEquals(ftsHits(store, "new"), 1);
    assertEquals(ftsHits(store, "old"), 0);
    // 같은 새 식별로 다시 맞추면 새 결과는 그대로다.
    const settled = reconcileLedgerBasis(store, B);
    assert(settled.ok);
    assertEquals(settled.value.rebuilt, false);
    assertEquals(counts(store)["search_rows"], 1);
  } finally {
    store.close();
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("platform/backup-and-migration#R14: 식별을 적지 않고 내용이 있는 옛 store는 출처를 모르므로 버리고 다시 만든다", () => {
  const { store, directory } = openStore();
  try {
    seed(store, "legacy");
    assertEquals(recordedLedgerId(store), null);
    const adopted = reconcileLedgerBasis(store, A);
    assert(adopted.ok);
    assertEquals(adopted.value.rebuilt, true);
    assertEquals(counts(store)["search_rows"], 0);
    assertEquals(recordedLedgerId(store), A);
  } finally {
    store.close();
    Deno.removeSync(directory, { recursive: true });
  }
});

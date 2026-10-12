// derived store가 기록한 ledger 식별 확인(documents#T13의 넘어온 것, platform#T42,
// platform/backup-and-migration#R14). ledger를 새로 만들거나 backup에서 복원하면
// `/v1/platform/status`의 `ledger_id`가 바뀐다. derived는 자기를 만든 ledger의 식별을 같은
// transaction에 적어 두고, 식별이 다르면 그 안의 결과·cursor를 모두 버린다. 그대로 두면
// cursor가 옛 ledger의 seq를 가리켜 복원 ledger의 같은 숫자 seq를 "이미 처리했다"고
// 건너뛰기 때문이다. 버린 뒤 cursor가 없으므로 consumer는 복원 ledger의 처음부터 다시
// 따라잡는다(재생성). ledger에는 아무것도 쓰지 않는다.
//
// 파일을 지우고 다시 만들지 않고 한 transaction에서 비운다. 별도 read 연결이 이미 열려 있어도
// 반쯤 비워진 store나 옛 파일을 보지 않는다.
import { ok, type Result } from "../../../base/mod.ts";
import type { DerivedStore } from "./adapters/store.ts";

const BASIS_KEY = "ledger_id";

// 이 store가 소유한 표 전부. 참조하는 표(search_rows → search_documents)가 앞선다. 요약 cache는
// model 판단이라 같은 출력으로 다시 만들 수 있다고 보지 않으므로 옛 것을 옮기지 않고 비운다.
const OWNED_TABLES = [
  "derived_cursors",
  "summary_cache",
  "search_rows",
  "search_documents",
  "derived_texts",
  "derived_sections",
  "derived_versions",
] as const;

export type LedgerBasisResult = {
  // 옛 ledger의 derived를 버렸는가. 처음 쓰는 빈 store나 같은 ledger면 false다.
  rebuilt: boolean;
};

// 지금 ledger 식별에 맞춘다. 같은 식별이면 아무것도 바꾸지 않는다.
export function reconcileLedgerBasis(
  store: DerivedStore,
  ledgerId: string,
): Result<LedgerBasisResult> {
  return store.transaction((tx) => {
    // 읽는 쪽이 모르는 표라 schema step 밖에서 만든다. 출처는 이 store 안에만 있다.
    tx.sql.run(
      `CREATE TABLE IF NOT EXISTS derived_basis (
         key TEXT PRIMARY KEY NOT NULL,
         value TEXT NOT NULL
       ) STRICT`,
      [],
    );
    const recorded = tx.sql.get(
      `SELECT value FROM derived_basis WHERE key = ?`,
      [BASIS_KEY],
    );
    if (recorded !== undefined && recorded.value === ledgerId) {
      return ok({ rebuilt: false });
    }
    // 식별을 적지 않은 store에 내용이 있으면(식별을 두기 전에 만든 것) 어느 ledger의 것인지
    // 모른다. 모르는 출처를 이어 쓰지 않는다.
    let hadContent = recorded !== undefined;
    for (const table of OWNED_TABLES) {
      const found = tx.sql.get(`SELECT 1 AS present FROM ${table} LIMIT 1`, []);
      if (found !== undefined) hadContent = true;
      tx.sql.run(`DELETE FROM ${table}`, []);
    }
    tx.sql.run(
      `INSERT INTO derived_basis (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [BASIS_KEY, ledgerId],
    );
    return ok({ rebuilt: hadContent });
  });
}

// 기록한 ledger 식별. 적지 않았으면 null이다.
export function recordedLedgerId(store: DerivedStore): string | null {
  try {
    const row = store.read.sql.get(
      `SELECT value FROM derived_basis WHERE key = ?`,
      [BASIS_KEY],
    );
    return row === undefined ? null : String(row.value);
  } catch {
    // 표가 아직 없다(식별을 한 번도 적지 않았다).
    return null;
  }
}

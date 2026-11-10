import type {
  SdkDecision,
  SdkFeatureState,
} from "../../../protocol/apps/sdk-status.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";

type Query = Pick<Sql, "get" | "all">;

export type ReviewRow = {
  id: string;
  app: string;
  decision: SdkDecision;
  through: Record<string, string>;
  at: string;
};

export type FeatureRow = {
  id: string;
  review: string;
  app: string;
  title: string;
  state: SdkFeatureState;
  outcome: string | null;
  state_at: string;
};

// review는 덧붙이기만 한다. 앱의 checkpoint는 마지막 행이다.
export function insertReview(
  tx: Pick<Tx, "sql" | "newId" | "now">,
  input: {
    app: string;
    session: string;
    decision: SdkDecision;
    through: Record<string, string>;
    call: string | null;
  },
): string {
  const id = tx.newId("sdr");
  tx.sql.run(
    `INSERT INTO sdk_reviews (id, app, session, decision, through, call, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.app,
      input.session,
      input.decision,
      JSON.stringify(input.through),
      input.call,
      tx.now(),
    ],
  );
  return id;
}

// id는 handoff 글에 먼저 실려 호출 쪽이 정한다. 처음 state는 open이다. 결과를 안 내면 끝난 것으로 보이지 않는다.
export function insertFeature(
  tx: Pick<Tx, "sql" | "now">,
  input: {
    id: string;
    review: string;
    app: string;
    title: string;
    proposal: string;
    note: string;
  },
): string {
  const { id } = input;
  tx.sql.run(
    `INSERT INTO sdk_features (id, review, app, title, proposal, note_file, state, outcome, state_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', NULL, ?)`,
    [
      id,
      input.review,
      input.app,
      input.title,
      input.proposal,
      input.note,
      tx.now(),
    ],
  );
  return id;
}

export function loadFeature(
  sql: Query,
  id: string,
): { id: string; app: string } | undefined {
  const row = sql.get("SELECT id, app FROM sdk_features WHERE id = ?", [id]);
  return row === undefined
    ? undefined
    : { id: String(row["id"]), app: String(row["app"]) };
}

export function setFeatureState(
  tx: Pick<Tx, "sql" | "now">,
  id: string,
  state: SdkFeatureState,
  outcome: string | null,
): void {
  tx.sql.run(
    "UPDATE sdk_features SET state = ?, outcome = ?, state_at = ? WHERE id = ?",
    [state, outcome, tx.now(), id],
  );
}

export function eraseAppReviews(tx: Pick<Tx, "sql">, app: string): void {
  tx.sql.run("DELETE FROM sdk_features WHERE app = ?", [app]);
  tx.sql.run("DELETE FROM sdk_reviews WHERE app = ?", [app]);
}

// 앱의 마지막 review와 그 feature들이다. 앞선 review의 feature가 아직 open이면 같이 낸다(다음 결정이 덮어 조용히 잊히지 않게).
export function loadLastReview(
  sql: Query,
  app: string,
): (ReviewRow & { features: FeatureRow[] }) | null {
  const row = sql.get(
    `SELECT id, app, decision, through, created_at FROM sdk_reviews
     WHERE app = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    [app],
  );
  if (row === undefined) return null;
  const id = String(row["id"]);
  const features = sql
    .all(
      `SELECT id, review, app, title, state, outcome, state_at FROM sdk_features
       WHERE review = ? OR (app = ? AND state = 'open') ORDER BY rowid`,
      [id, app],
    )
    .map(
      (feature): FeatureRow => ({
        id: String(feature["id"]),
        review: String(feature["review"]),
        app,
        title: String(feature["title"]),
        state: feature["state"] as SdkFeatureState,
        outcome:
          feature["outcome"] === null ? null : String(feature["outcome"]),
        state_at: String(feature["state_at"]),
      }),
    );
  return {
    id,
    app,
    decision: row["decision"] as SdkDecision,
    through: JSON.parse(String(row["through"])) as Record<string, string>,
    at: String(row["created_at"]),
    features,
  };
}

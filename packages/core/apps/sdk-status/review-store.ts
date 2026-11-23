import type {
  SdkDecision,
  SdkFeatureState,
} from "../../../protocol/apps/sdk-status.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import {
  eraseWorkspaceFollowUps,
  insertFollowUp,
  loadFollowUp,
} from "../../follow-ups/mod.ts";

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
  tx: Pick<Tx, "sql" | "newId" | "now">,
  input: {
    id: string;
    review: string;
    app: string;
    title: string;
    proposal: string;
    note: string;
  },
): string {
  const item = insertFollowUp(tx, {
    id: input.id,
    workspace: { kind: "app", id: input.app as Id<"app"> },
    origin: "app_sdk",
    source_ref: input.note,
    title: input.title,
    body: input.proposal,
  });
  return item.id;
}

export function loadFeature(
  sql: Query,
  id: string,
): { id: string; app: string } | undefined {
  const direct = loadFollowUp(sql, id);
  const found =
    direct ??
    (id.startsWith("sdf_")
      ? loadFollowUp(sql, `fup_${id.slice(4)}`)
      : undefined);
  if (
    found === undefined ||
    found.workspace?.kind !== "app" ||
    found.origin !== "app_sdk"
  ) {
    return undefined;
  }
  return { id: found.id, app: found.workspace.id };
}

export function setFeatureState(
  tx: Pick<Tx, "sql" | "now">,
  id: string,
  state: SdkFeatureState,
  outcome: string | null,
): void {
  tx.sql.run(
    "UPDATE follow_up_items SET state = ?, outcome = ?, updated_at = ? WHERE id = ?",
    [state, outcome, tx.now(), id],
  );
}

export function eraseAppReviews(tx: Pick<Tx, "sql">, app: string): void {
  eraseWorkspaceFollowUps(tx, { kind: "app", id: app as Id<"app"> });
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
  const at = String(row["created_at"]);
  const features = sql
    .all(
      `SELECT id, title, state, outcome, updated_at FROM follow_up_items
       WHERE workspace_kind = 'app' AND workspace_id = ? AND origin = 'app_sdk'
         AND (created_at >= ? OR state = 'open')
       ORDER BY created_at ASC, id ASC`,
      [app, at],
    )
    .map(
      (feature): FeatureRow => ({
        id: String(feature["id"]),
        review: id,
        app,
        title: String(feature["title"]),
        state: feature["state"] as SdkFeatureState,
        outcome:
          feature["outcome"] === null ? null : String(feature["outcome"]),
        state_at: String(feature["updated_at"]),
      }),
    );
  return {
    id,
    app,
    decision: row["decision"] as SdkDecision,
    through: JSON.parse(String(row["through"])) as Record<string, string>,
    at,
    features,
  };
}

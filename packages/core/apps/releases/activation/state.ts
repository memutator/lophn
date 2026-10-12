// activation의 ledger 쪽 공통 규칙. start·complete·fail command와
// record_* 시도 확인이 같은 판정을 쓴다. 동기 함수만 있고 파일·process를 열지 않는다.
import { canonicalize, err, ok, type Result } from "../../../../base/mod.ts";
import type { Activation, Release } from "../../../../protocol/apps/mod.ts";
import type { Sql, Tx } from "../../../../protocol/server/mod.ts";
import { migrationPath } from "../../data/mod.ts";
import { loadActiveRelease } from "../store.ts";

export const ACTIVATION_APPROVAL_CONCERN = "apps/releases";
export const START_ACTIVATION_COMMAND = "release.start_activation";

type Query = Pick<Sql, "get" | "all">;

function forbidden(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function tableExists(sql: Query, name: string): boolean {
  return sql.get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [name],
  ) !== undefined;
}

// 앱 DB의 현재 schema로 ledger가 아는 값이다. 채택한 release의 schema이고 없으면 0이다. 시작 때 supervisor가
// 보고한 실제 schema와 이 값이 다르면 앱 DB가 ledger 밖에서 바뀐 것이라 시작하지 않는다.
export function ledgerSchema(sql: Query, app: string): Result<number> {
  const active = loadActiveRelease(sql, app);
  if (!active.ok) return active;
  return ok(active.value === null ? 0 : active.value.data_schema);
}

// 시작 schema에서 release의 목표까지의 연속 경로다. schema가 같으면 빈 경로이고 뒤로 가는 release와
// 이어지지 않는 경로는 invalid_input이다.
export function pathFrom(
  release: Pick<Release, "data_schema" | "data_changes">,
  expectedSchema: number,
): Result<{ steps: number }> {
  const path = migrationPath(
    expectedSchema,
    release.data_schema,
    release.data_changes,
  );
  return path.ok ? ok({ steps: path.value.steps.length }) : path;
}

// 시작을 허락하는 approval이다. 정확한 대상 release와 정확한 입력으로 사람이 허락한 것이어야 하고 한 번
// 쓴 approval이나 같은 release의 실패한 시도가 쓴 approval은 다시 쓰지 못한다.
// 사람의 결정이 없거나 다른 입력이면 forbidden, 기한·재사용은 conflict다.
export function checkStartApproval(
  tx: Tx,
  release: string,
  input: Record<string, unknown> & { approval: string },
): Result<void> {
  const notGranted = () =>
    forbidden("approval is not granted for this activation");
  if (!tableExists(tx.sql, "approval_requests")) {
    return err({ code: "forbidden", message: "approvals are unavailable" });
  }
  const row = tx.sql.get(
    `SELECT status, action, expires_at, closed_seq
     FROM approval_requests WHERE id = ?`,
    [input.approval],
  );
  if (row === undefined || row.status !== "granted") return notGranted();
  let action: {
    concern?: unknown;
    command?: unknown;
    targets?: unknown;
    input?: { kind?: unknown; value?: unknown };
  };
  try {
    action = JSON.parse(String(row.action));
  } catch {
    return notGranted();
  }
  const targets = action.targets;
  if (
    action.concern !== ACTIVATION_APPROVAL_CONCERN ||
    action.command !== START_ACTIVATION_COMMAND ||
    !Array.isArray(targets) || targets.length !== 1 ||
    targets[0] !== release ||
    action.input?.kind !== "inline" ||
    canonicalize(action.input.value) !== canonicalize(input)
  ) {
    return notGranted();
  }
  // 허락한 쪽은 사람이다. 결정 event의 actor로 확인한다. ticket 완료나 agent 채택은 이 결정이 아니다.
  const decided = tx.sql.get("SELECT actor FROM events WHERE seq = ?", [
    row.closed_seq as number | bigint,
  ]);
  if (decided?.actor !== "user") return notGranted();
  if (row.expires_at !== null) {
    const deadline = Date.parse(String(row.expires_at));
    const now = Date.parse(tx.now());
    if (
      !Number.isFinite(deadline) || !Number.isFinite(now) || now >= deadline
    ) {
      return conflict("approval has expired");
    }
  }
  const used = tx.sql.get(
        "SELECT 1 AS found FROM releases WHERE json_extract(activation, '$.approval') = ?",
        [input.approval],
      ) !== undefined ||
    (tableExists(tx.sql, "approval_uses") &&
      tx.sql.get("SELECT 1 AS found FROM approval_uses WHERE approval = ?", [
          input.approval,
        ]) !== undefined);
  return used ? conflict("approval was already used") : ok(undefined);
}

// 시작 event가 자기 seq를 started_seq로 가진다. writer 하나가 transaction 안에서 seq를 배정하므로
// 다음 seq를 미리 알 수 있고, emit이 다른 seq를 돌려주면 시작하지 않는다.
export function nextEventSeq(sql: Query): string {
  const row = sql.get(
    "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM events",
    [],
  );
  return String(row?.next ?? 1);
}

// 진행 중인 시도의 release다. 같은 시도(started_seq)가 아니면 conflict다. 없는 release·범위 밖 앱·다른
// 시도는 같은 답이다.
export function inProgress(
  release: Release | null,
  startedSeq: string,
): Result<Release & { activation: Activation }> {
  if (
    release === null || release.status !== "activating" ||
    release.activation === null ||
    release.activation.started_seq !== startedSeq
  ) {
    return conflict("no such activation is in progress");
  }
  return ok(release as Release & { activation: Activation });
}

export function storeActivation(
  tx: Pick<Tx, "sql">,
  release: string,
  status: Release["status"],
  activation: Activation | null,
  failure: Release["failure"],
): void {
  tx.sql.run(
    "UPDATE releases SET status = ?, activation = ?, failure = ? WHERE id = ?",
    [
      status,
      activation === null ? null : JSON.stringify(activation),
      failure === null ? null : JSON.stringify(failure),
      release,
    ],
  );
}

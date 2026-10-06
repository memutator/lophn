// activation의 실패 복원과 끊긴 시도의 이어받기(apps/data#R9, R11, R12, apps/releases#R15,
// architecture/apps 7.4, 8장). 새 업무 통로를 열기 전의 실패만 backup으로 복원하고, ledger가 이미 새
// release를 채택했으면 옛 backup으로 데이터를 덮지 않는다. 복원이 실패하거나 확인되지 않으면 이전 코드도
// 시작하지 않고 문제로 보고한다.
import type { Sql } from "../../../contracts/platform/mod.ts";
import { migrationPath } from "../../data/mod.ts";
import {
  type ActivationFailure,
  type ActivationOutcome,
  type ActivationPorts,
  type Attempt,
  attemptOf,
  quiesce,
  schemaIsExpected,
  unavailable,
} from "./steps.ts";

type Query = Pick<Sql, "get" | "all">;

// 사용할 수 없게 둔 이유를 문제로 보고하고 unavailable로 끝낸다. 데이터를 더 덮거나 이전 코드를 시작하지 않는다.
async function stuck(
  ports: ActivationPorts,
  attempt: Attempt,
  code: string,
  summary: string,
): Promise<ActivationOutcome> {
  await ports.report({
    app: attempt.app,
    release: attempt.release,
    started_seq: attempt.startedSeq,
    code,
    summary,
  });
  return unavailable(code);
}

// 실패한 시도를 닫는다: 자식 종료 확인 → (backup이 있으면) 복원·실제 무결성·schema 확인과 ledger 확정 →
// fail_activation → 이전 release 다시 준비. 앞 단계가 확인되지 않으면 뒤 단계를 하지 않는다.
export async function rollback(
  ports: ActivationPorts,
  attempt: Attempt,
  failure: ActivationFailure,
  backupHash: string | null,
): Promise<ActivationOutcome> {
  if (!await quiesce(ports, attempt.app)) {
    return await stuck(
      ports,
      attempt,
      "termination_unconfirmed",
      "the app process exit was not confirmed",
    );
  }
  if (backupHash !== null) {
    const restored = await ports.data.restore(attempt, backupHash);
    if (
      !restored.ok || !restored.value.integrity_ok ||
      restored.value.data_schema !== attempt.expectedSchema
    ) {
      return await stuck(
        ports,
        attempt,
        "restore_failed",
        "the app data was not restored from the backup",
      );
    }
    const recorded = await ports.core.recordDataRestore(
      restored.value,
      backupHash,
    );
    if (!recorded.ok) {
      return await stuck(
        ports,
        attempt,
        "restore_not_recorded",
        "the restore result was not confirmed",
      );
    }
  } else if (!await schemaIsExpected(ports, attempt)) {
    // 변경 전에 실패했는데 실제 DB가 시작 때와 다르면 무엇이 바뀌었는지 모른다. 이전 코드를 시작하지 않는다.
    return await stuck(
      ports,
      attempt,
      "schema_unconfirmed",
      "the app data does not match the schema at the start",
    );
  }
  const failed = await ports.core.failActivation({
    release: attempt.release,
    started_seq: attempt.startedSeq,
    failure,
  });
  // 데이터는 복원됐지만 실패 확정을 모른다. ledger는 아직 진행 중이므로 다시 이어받을 수 있다.
  if (!failed.ok) return unavailable("fail_not_recorded");
  return {
    status: "failed",
    code: failure.code,
    previous: await restartPrevious(ports, attempt),
  };
}

async function restartPrevious(
  ports: ActivationPorts,
  attempt: Attempt,
): Promise<"started" | "not_started" | null> {
  if (attempt.previousRelease === null) return null;
  const started = await ports.supervisor.run(
    attempt.app,
    attempt.previousRelease,
  );
  return started.ok ? "started" : "not_started";
}

// 끊긴 시도를 ledger와 실제 관측으로 잇는다(platform#T43의 재시작 점검 뒤, 응답 유실, supervisor·core 재시작).
// ledger가 새 release를 채택했으면 데이터를 복원하지 않고 그 release를 다시 준비한다. 진행 중이면 시도가
// 데이터를 바꿨을 수 있으므로 알려진 backup으로만 복원하고 모르는 script를 다시 적용하지 않는다.
export async function recoverActivation(
  ports: ActivationPorts,
  releaseId: string,
  // 진행 중인 시도를 닫을 때 남길 실패 근거다. 끊긴 시도를 처음 이어받으면 interrupted다.
  failure: ActivationFailure = {
    code: "interrupted",
    summary: "the activation was interrupted",
  },
): Promise<ActivationOutcome> {
  const read = await ports.core.release(releaseId);
  if (!read.ok) return unavailable("core_unreachable");
  const release = read.value;
  if (release === null || release.activation === null) {
    return { status: "none" };
  }
  if (release.status === "active") {
    const started = await ports.supervisor.run(release.app, release.id);
    return { status: "active", opened: started.ok };
  }
  if (release.status === "failed") {
    const previous = release.activation.previous_release;
    if (previous === null) {
      return {
        status: "failed",
        code: release.failure?.code ?? "",
        previous: null,
      };
    }
    const started = await ports.supervisor.run(release.app, previous);
    return {
      status: "failed",
      code: release.failure?.code ?? "",
      previous: started.ok ? "started" : "not_started",
    };
  }
  const attempt = attemptOf(release);
  if (attempt === undefined) return { status: "none" };
  return await rollback(
    ports,
    attempt,
    failure,
    release.activation.backup_hash,
  );
}

// ---- 재시작 점검(platform/backup-and-migration#R16) ----

type Observation = {
  target: string;
  baseSeq: string;
  outcome: "confirmed" | "not_started" | "unknown";
  evidence: readonly string[];
  reason?: string;
};

// core를 다시 띄운 뒤 진행 중으로 남은 activation이다. 점검은 읽기 전용 SQL만 쓰므로 자식·DB를 실제로
// 보지 못한다. 시작했다고도 끝났다고도 추정하지 않고 unknown과 근거를 남기며 실제 관측으로 확정하는 일은
// `recoverActivation`이 supervisor·data worker 관측으로 한다. 같은 일을 다시 시작하지 않는다.
export function observeReleaseActivations(
  sql: Pick<Sql, "all">,
  _now: string,
): Observation[] {
  try {
    const table = sql.all(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'releases'",
      [],
    );
    if (table.length === 0) return [];
    return sql.all(
      `SELECT id, app,
              json_extract(activation, '$.started_seq') AS started_seq,
              json_extract(activation, '$.backup_hash') AS backup_hash
         FROM releases WHERE status = 'activating' ORDER BY id`,
      [],
    ).map((row): Observation => {
      const id = String(row.id);
      const seq = String(row.started_seq);
      return {
        target: id,
        baseSeq: seq,
        outcome: "unknown",
        evidence: [
          `releases:${id}:activating`,
          `releases:${id}:started_seq:${seq}`,
          row.backup_hash === null
            ? `releases:${id}:backup:none`
            : `releases:${id}:backup:recorded`,
        ],
        reason: "activation_not_settled",
      };
    });
  } catch {
    return [{
      target: "releases",
      baseSeq: "0",
      outcome: "unknown",
      evidence: [],
      reason: "release_tables_unreadable",
    }];
  }
}

// ---- migration 이력(apps/data#R9) ----

export type MigrationHistoryEntry = {
  release: string;
  started_seq: string;
  started_at: string;
  from: number;
  to: number;
  // 적용 경로의 각 단계. 설명은 변경과 손실 가능성을 적은 것이다.
  steps: { from: number; to: number; description: string }[];
  backup: { hash: string; at: string } | null;
  change: { invocation: string; data_schema: number; at: string } | null;
  restore: { backup_hash: string; data_schema: number; at: string } | null;
  // applied는 새 release가 채택된 변경, restored는 복원으로 되돌린 변경이다.
  result: "in_progress" | "applied" | "restored" | "failed";
  finished_at: string | null;
};

// 앱의 activation 시도마다 출발·도착 schema, 변경 설명, backup, 실제 결과와 시각을 ledger 사실에서 찾는다.
// 성공 주장이 아니라 당시 event만 근거이고 migration이 없는 시도는 포함하지 않는다.
export function loadMigrationHistory(
  sql: Query,
  app: string,
): MigrationHistoryEntry[] {
  const started = sql.all(
    `SELECT seq, subject, at, payload FROM events
      WHERE type = 'ReleaseActivationStarted'
        AND json_extract(payload, '$.app') = ? ORDER BY seq`,
    [app],
  );
  const entries: MigrationHistoryEntry[] = [];
  for (const event of started) {
    const payload = JSON.parse(String(event.payload)) as {
      expected_schema: number;
    };
    const release = sql.get(
      "SELECT data_schema, data_changes FROM releases WHERE id = ?",
      [String(event.subject)],
    );
    if (release === undefined) continue;
    const target = Number(release.data_schema);
    const path = migrationPath(
      payload.expected_schema,
      target,
      JSON.parse(String(release.data_changes)),
    );
    if (!path.ok || path.value.steps.length === 0) continue;
    const seq = String(event.seq);
    const later = (type: string, key: string) =>
      sql.get(
        `SELECT payload, at FROM events
          WHERE type = ? AND subject = ?
            AND json_extract(payload, '$.${key}') = ?`,
        [type, String(event.subject), seq],
      );
    const backup = later("ReleaseBackupRecorded", "activation_seq");
    const change = later("ReleaseDataChanged", "activation_seq");
    const restore = later("ReleaseDataRestored", "activation_seq");
    const activated = later("ReleaseActivated", "started_seq");
    const failed = later("ReleaseActivationFailed", "started_seq");
    const body = (row: typeof backup) =>
      row === undefined ? undefined : JSON.parse(String(row.payload)) as Record<
        string,
        unknown
      >;
    const [backupBody, changeBody, restoreBody] = [
      body(backup),
      body(change),
      body(restore),
    ];
    const done = activated ?? failed;
    entries.push({
      release: String(event.subject),
      started_seq: seq,
      started_at: String(event.at),
      from: payload.expected_schema,
      to: target,
      steps: path.value.steps.map((step) => ({
        from: step.from,
        to: step.to,
        description: step.description,
      })),
      backup: backup === undefined
        ? null
        : { hash: String(backupBody?.backup_hash), at: String(backup.at) },
      change: change === undefined ? null : {
        invocation: String(changeBody?.invocation),
        data_schema: Number(changeBody?.data_schema),
        at: String(change.at),
      },
      restore: restore === undefined ? null : {
        backup_hash: String(restoreBody?.backup_hash),
        data_schema: Number(restoreBody?.data_schema),
        at: String(restore.at),
      },
      result: activated !== undefined
        ? "applied"
        : restore !== undefined
        ? "restored"
        : failed !== undefined
        ? "failed"
        : "in_progress",
      finished_at: done === undefined ? null : String(done.at),
    });
  }
  return entries;
}

/**
 * activation 한 시도의 대역 세계다(apps#T18). supervisor 자식·앱 DB·backup·ledger의 시도 상태를 메모리로
 * 두고 `ActivationPorts`를 낸다. 실제 core command의 판정(같은 시도·backup 확정 뒤 변경·복원 뒤 실패·
 * 준비 확인 일치)은 apps/core의 HTTP 시험이 따로 본다. 여기서는 단계 순서, 끊김, 복원과 이어받기를 본다.
 * mod.ts에서 내보내지 않는다.
 */
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  DataResult,
  ReadyAttestation,
  Release,
} from "../../../contracts/apps/mod.ts";
import type {
  ActivationPorts,
  ActivationProblem,
  Attempt,
} from "../activation/steps.ts";

export const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
export const PREVIOUS = "rel_01h455vb4pex5v6nkc6gd5fdw1";
export const NEXT = "rel_01h455vb4pex5v6nkc6gd5fdw2";
export const STARTED_SEQ = "42";
export const NEXT_BUNDLE = "b".repeat(64);
export const COMMANDS = ["list", "save"];

// 어느 port 호출에서 어떻게 끊을지다. effect 앞에서 끊는 `error`·`crash`와 효과를 낸 뒤 응답을 잃는
// `lost`·`crash_after`가 있다. `crash`는 부른 process가 죽은 것이라 던지고 나머지는 err을 돌려준다.
export type FaultMode = "error" | "lost" | "crash" | "crash_after";

export class Crash extends Error {}

export type WorldOptions = {
  // 시작 때 앱 DB의 schema와 업무 data. 목표 schema는 targetSchema다.
  schema?: number;
  targetSchema?: number;
  previous?: string | null;
  // migration이 중간 단계에서 실패하고 DB를 반쯤 바꾼 채 끝난다.
  migrateBreaks?: boolean;
  // 새 앱이 준비 확인에서 보고하는 값을 바꾼다.
  attestation?: Partial<ReadyAttestation>;
  // complete_activation을 core가 거절한다(handler·hash·schema 불일치와 같다).
  commitRejected?: boolean;
};

type Records = {
  backup: { hash: string; schema: number } | null;
  change: { invocation: string; schema: number } | null;
  restore: { hash: string; schema: number } | null;
};

export type World = ReturnType<typeof activationWorld>;

export function activationWorld(options: WorldOptions = {}) {
  const start = options.schema ?? 0;
  const target = options.targetSchema ?? start + 1;
  const previous = options.previous === undefined ? PREVIOUS : options.previous;
  const log: string[] = [];
  const problems: ActivationProblem[] = [];
  const faults = new Map<string, FaultMode>();
  const gates = new Map<string, Promise<void>>();
  const db = { schema: start, rows: ["a", "b"] as string[] };
  const backups = new Map<string, { schema: number; rows: string[] }>();
  const children = {
    // 이전 release의 자식이 살아 있는지.
    previous: previous !== null,
    // 후보 자식: 없음 · 준비 확인까지 · 업무 통로 열림.
    candidate: "none" as "none" | "ready" | "open",
    // 이전 release를 다시 연 횟수.
    reopened: 0,
    runs: [] as string[],
  };
  const ledger = {
    release: {
      id: NEXT,
      app: APP,
      number: 2,
      code_commit: "a".repeat(40),
      bundle_hash: NEXT_BUNDLE,
      blueprint_hash: "c".repeat(64),
      data_schema: target,
      data_changes: start === target ? [] : [{
        from: start,
        to: target,
        script_hash: "d".repeat(64),
        description: `step ${start} to ${target}`,
      }],
      tests: ["vrf_01h455vb4pex5v6nkc6gd5fdw1"],
      ticket_source: null,
      created_by: "machine",
      created_at: "2026-10-06T00:00:00.000Z",
      status: "activating",
      activation: {
        started_seq: STARTED_SEQ,
        previous_release: previous,
        approval: "apr_01h455vb4pex5v6nkc6gd5fdw1",
        expected_grants_seq: 0,
        expected_schema: start,
        backup_hash: null,
        data_change_invocation: null,
      },
      failure: null,
    } as Release,
    records: { backup: null, change: null, restore: null } as Records,
    // 채택한 release. 시작 때는 이전 release다.
    active: previous,
    superseded: [] as string[],
  };

  function attempt(): Attempt {
    return {
      app: APP,
      release: NEXT,
      startedSeq: STARTED_SEQ,
      previousRelease: previous,
      expectedSchema: start,
      targetSchema: target,
      bundleHash: NEXT_BUNDLE,
      dataChanges: ledger.release.data_changes,
    };
  }

  // 끊김 주입. 효과 앞에서는 `before`, 효과 뒤에서는 `after`를 부른다.
  async function guarded<T>(
    point: string,
    effect: () => T,
    lost: () => Result<never>,
  ): Promise<Result<Awaited<T>>> {
    log.push(point);
    const gate = gates.get(point);
    if (gate !== undefined) await gate;
    const mode = faults.get(point);
    if (mode === "crash") throw new Crash(point);
    if (mode === "error") {
      return err({ code: "unavailable", message: `${point} is cut` });
    }
    const value = await effect();
    if (mode === "crash_after") throw new Crash(point);
    if (mode === "lost") return lost();
    return ok(value as Awaited<T>);
  }
  const cut = (point: string) => (): Result<never> =>
    err({ code: "unavailable", message: `${point} lost its reply` });

  const ports: ActivationPorts = {
    supervisor: {
      async stopCurrent() {
        const done = await guarded("supervisor.stopCurrent", () => {
          children.previous = false;
          return true;
        }, cut("stopCurrent"));
        return done.ok && done.value;
      },
      async stopCandidate() {
        const done = await guarded("supervisor.stopCandidate", () => {
          children.candidate = "none";
          return true;
        }, cut("stopCandidate"));
        return done.ok && done.value;
      },
      startCandidate() {
        return guarded("supervisor.startCandidate", () => {
          // 이전 자식이 살아 있으면 같은 DB를 둘이 쓴다. 대역이 그 위반을 기록한다.
          if (children.previous) log.push("VIOLATION two writers");
          children.candidate = "ready";
          return {
            nonce: "nonce-1",
            attestation: {
              release: NEXT,
              bundle_hash: NEXT_BUNDLE,
              commands: [...COMMANDS],
              data_schema: db.schema,
              process_nonce: "nonce-1",
              connection_ok: true as const,
              ...options.attestation,
            },
          };
        }, cut("startCandidate"));
      },
      openCandidate() {
        return guarded("supervisor.openCandidate", () => {
          if (ledger.active !== NEXT) {
            log.push("VIOLATION opened before commit");
          }
          children.candidate = "open";
        }, cut("openCandidate"));
      },
      run(_app, release) {
        return guarded("supervisor.run", () => {
          children.runs.push(release);
          if (release === previous) {
            children.reopened += 1;
            children.previous = true;
          } else children.candidate = "open";
        }, cut("run"));
      },
    },
    data: {
      inspect() {
        return guarded("data.inspect", () => ({
          data_schema: db.schema,
          integrity_ok: true,
        }), cut("inspect"));
      },
      backup() {
        return guarded("data.backup", () => {
          const hash = `${"e".repeat(63)}${backups.size}`;
          backups.set(hash, { schema: db.schema, rows: [...db.rows] });
          const result: DataResult = {
            release: NEXT,
            activation_seq: STARTED_SEQ,
            invocation: null,
            data_schema: db.schema,
            integrity_ok: true,
          };
          return { result, backup_hash: hash };
        }, cut("backup"));
      },
      migrate(_attempt, invocation) {
        return guarded("data.migrate", () => {
          if (options.migrateBreaks) {
            db.schema = start + 1;
            db.rows.push("half-migrated");
            return {
              release: NEXT,
              activation_seq: STARTED_SEQ,
              invocation,
              data_schema: db.schema,
              integrity_ok: false,
            } as DataResult;
          }
          db.schema = target;
          db.rows.push("migrated");
          return {
            release: NEXT,
            activation_seq: STARTED_SEQ,
            invocation,
            data_schema: db.schema,
            integrity_ok: true,
          } as DataResult;
        }, cut("migrate"));
      },
      restore(_attempt, hash) {
        return guarded("data.restore", () => {
          const backup = backups.get(hash);
          if (backup === undefined) {
            return {
              release: NEXT,
              activation_seq: STARTED_SEQ,
              invocation: null,
              data_schema: db.schema,
              integrity_ok: false,
            } as DataResult;
          }
          db.schema = backup.schema;
          db.rows = [...backup.rows];
          return {
            release: NEXT,
            activation_seq: STARTED_SEQ,
            invocation: null,
            data_schema: db.schema,
            integrity_ok: true,
          } as DataResult;
        }, cut("restore"));
      },
    },
    core: {
      release() {
        return guarded(
          "core.release",
          () => structuredClone(ledger.release),
          cut("release"),
        );
      },
      recordBackup(input) {
        return guarded("core.recordBackup", () => {
          ledger.records.backup = {
            hash: input.backup_hash,
            schema: input.data_schema,
          };
          ledger.release = {
            ...ledger.release,
            activation: {
              ...ledger.release.activation!,
              backup_hash: input.backup_hash,
            },
          };
        }, cut("recordBackup"));
      },
      recordDataChange(result) {
        return guarded("core.recordDataChange", () => {
          if (ledger.records.backup === null) log.push("VIOLATION no backup");
          ledger.records.change = {
            invocation: result.invocation!,
            schema: result.data_schema,
          };
        }, cut("recordDataChange"));
      },
      recordDataRestore(result, hash) {
        return guarded("core.recordDataRestore", () => {
          ledger.records.restore = { hash, schema: result.data_schema };
        }, cut("recordDataRestore"));
      },
      completeActivation(input) {
        return guarded("core.completeActivation", () => {
          const release = ledger.release;
          const declared = [...COMMANDS].sort().join();
          const reported = [...input.attestation.commands].sort().join();
          const migrating = target !== start;
          const proven = !options.commitRejected &&
            release.status === "activating" &&
            input.started_seq === STARTED_SEQ &&
            input.attestation.release === NEXT &&
            input.attestation.bundle_hash === NEXT_BUNDLE &&
            input.attestation.data_schema === target &&
            declared === reported &&
            input.result.data_schema === target &&
            input.result.integrity_ok &&
            (!migrating || ledger.records.change !== null);
          if (!proven) {
            // 거절은 상태를 바꾸지 않는다.
            throw new Rejected();
          }
          if (ledger.active !== null) ledger.superseded.push(ledger.active);
          ledger.active = NEXT;
          ledger.release = { ...release, status: "active" };
        }, cut("completeActivation")).catch((thrown) => {
          if (thrown instanceof Rejected) {
            return err({ code: "unavailable", message: "not adopted" });
          }
          throw thrown;
        }) as Promise<Result<void>>;
      },
      failActivation(input) {
        return guarded("core.failActivation", () => {
          const release = ledger.release;
          if (
            release.status === "activating" &&
            release.activation!.backup_hash !== null &&
            ledger.records.restore === null
          ) {
            log.push("VIOLATION failed without restore");
            throw new Rejected();
          }
          if (release.status === "activating") {
            ledger.release = {
              ...release,
              status: "failed",
              failure: input.failure,
            };
          }
        }, cut("failActivation")).catch((thrown) => {
          if (thrown instanceof Rejected) {
            return err({ code: "conflict", message: "restore first" });
          }
          throw thrown;
        }) as Promise<Result<void>>;
      },
    },
    report(problem) {
      problems.push(problem);
      return Promise.resolve();
    },
    newInvocation: () => "inv_01h455vb4pex5v6nkc6gd5fdw1",
  };

  return {
    ports,
    log,
    problems,
    db,
    backups,
    children,
    ledger,
    attempt,
    fault(point: string, mode: FaultMode) {
      faults.set(point, mode);
    },
    clearFaults() {
      faults.clear();
    },
    // point 호출을 이 promise가 풀릴 때까지 붙잡는다.
    hold(point: string): () => void {
      let release!: () => void;
      gates.set(
        point,
        new Promise<void>((resolve) => {
          release = () => {
            gates.delete(point);
            resolve();
          };
        }),
      );
      return release;
    },
    // 새 release가 업무를 받은 뒤의 쓰기다.
    businessWrite(row: string) {
      db.rows.push(row);
    },
  };
}

class Rejected extends Error {}

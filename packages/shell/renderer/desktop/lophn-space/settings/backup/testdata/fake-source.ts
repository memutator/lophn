// backup 자리 화면 테스트의 가짜 통로. core를 부르지 않고 부른 것을 모두 기록한다. 복원 계획
// (main pipe)과 제출도 기록한다. secret 값은 이 통로에 없고 보호 창 열기만 기록한다.
import type {
  BackupRow,
  BackupSource,
  NamedRow,
  RestoreOutcome,
  RestorePlanView,
  SourceResult,
} from "../source.ts";

export function backupRow(
  createdAt: string,
  options: Partial<Omit<BackupRow, "createdAt">> = {},
): BackupRow {
  return {
    createdAt,
    throughSeq: "100",
    restoreable: true,
    integrity: "passed",
    sizeBytes: 1024,
    ...options,
  };
}

export const PLAN_OK: RestorePlanView = {
  createdAt: "2026-10-01T00:00:00.000Z",
  throughSeq: "100",
  currentThroughSeq: "150",
  lost: { fromSeq: "101", throughSeq: "150", events: 50 },
};

export const PLAN_NO_LOST: RestorePlanView = {
  createdAt: "2026-10-01T00:00:00.000Z",
  throughSeq: "100",
  currentThroughSeq: "100",
  lost: null,
};

export interface FakeBackupOptions {
  backups?: readonly BackupRow[];
  backupsFail?: boolean;
  plan?: RestorePlanView;
  planCode?: string;
  restoreOutcome?: RestoreOutcome;
  restoreCode?: string;
  windowOpens?: boolean;
  retainedCount?: number;
  apps?: readonly NamedRow[];
  exportCode?: string;
}

export function fakeBackup(options: FakeBackupOptions = {}) {
  const calls: unknown[][] = [];
  const source: BackupSource = {
    watch(listener) {
      listener({ state: "ready" });
      return () => {};
    },
    backups() {
      calls.push(["backups"]);
      return options.backupsFail
        ? Promise.resolve({ ok: false, code: "unavailable" })
        : Promise.resolve({
          ok: true,
          value: options.backups ?? [],
        });
    },
    restorePlan(createdAt) {
      calls.push(["restore-plan", createdAt]);
      if (options.planCode) {
        return Promise.resolve({ ok: false, code: options.planCode });
      }
      return Promise.resolve({
        ok: true,
        value: options.plan ?? PLAN_OK,
      });
    },
    restoreSubmit(createdAt, plan) {
      calls.push(["restore-submit", createdAt, plan]);
      if (options.restoreCode) {
        return Promise.resolve({ ok: false, code: options.restoreCode });
      }
      return Promise.resolve({
        ok: true,
        value: options.restoreOutcome ?? "restored",
      });
    },
    exportSecrets() {
      calls.push(["export-secrets"]);
      return Promise.resolve(
        options.windowOpens === false
          ? { ok: false, code: "unavailable" }
          : { ok: true, value: null } as SourceResult<null>,
      );
    },
    importSecrets() {
      calls.push(["import-secrets"]);
      return Promise.resolve(
        options.windowOpens === false
          ? { ok: false, code: "unavailable" }
          : { ok: true, value: null } as SourceResult<null>,
      );
    },
    apps() {
      calls.push(["apps"]);
      return Promise.resolve({
        ok: true,
        value: options.apps ?? [],
      });
    },
    exportApp(app) {
      calls.push(["export-app", app]);
      if (options.exportCode) {
        return Promise.resolve({
          ok: false as const,
          code: options.exportCode,
        });
      }
      return Promise.resolve({
        ok: true as const,
        value: {
          app,
          state: "ready" as const,
          includesExternalData: false,
        },
      });
    },
  };
  return { source, calls };
}

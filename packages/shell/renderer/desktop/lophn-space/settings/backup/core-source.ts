// BackupSource를 main의 core 통로로 만든다. 묶음 목록은 contract read(backups/list)고 복원
// 계획·제출은 main의 복원 통로(shell:restore-plan·submit)다. 응답은 contract schema 또는 ipc
// reply 모양으로 검사되어 온다. secret 값은 이 파일을 지나지 않는다.
import type { CoreCall } from "../../../../../ipc/core.ts";
import type { CoreSource } from "../../../connection/connection.ts";
import {
  RESTORE_CANCEL_CHANNEL,
  RESTORE_PLAN_CHANNEL,
  RESTORE_SUBMIT_CHANNEL,
  type RestorePlanInput,
  type RestorePlanReply,
  type RestoreSubmitInput,
  type RestoreSubmitReply,
} from "../../../../../ipc/restore.ts";
import type {
  BackupRow,
  BackupSource,
  RestoreOutcome,
  RestorePlanView,
  SourceResult,
} from "./source.ts";

interface ManifestValue {
  created_at: string;
  through_seq: string;
  integrity: "passed" | "failed";
  complete: boolean;
  blobs: { size_bytes: number }[];
}

async function call<T>(
  core: CoreSource,
  kind: CoreCall["kind"],
  resource: string,
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  try {
    const reply = await core.call({ kind, resource, method, body });
    if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
    return { ok: true, value: reply.value as T };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

function rowOf(value: ManifestValue): BackupRow {
  const blobs = Array.isArray(value.blobs) ? value.blobs : [];
  return {
    createdAt: value.created_at,
    throughSeq: value.through_seq,
    restoreable: value.complete && value.integrity === "passed",
    integrity: value.integrity,
    sizeBytes: blobs.reduce(
      (sum, blob) => sum + Number(blob.size_bytes ?? 0),
      0,
    ),
  };
}

/** preload의 복원 통로. 없는 창이면 undefined다. */
export type RestoreTransport = {
  invoke(channel: string, input: unknown): Promise<unknown>;
};

export function windowRestore(): RestoreTransport | undefined {
  const shell = (globalThis as {
    lophnRestore?: {
      plan?: (input: unknown) => Promise<unknown>;
      submit?: (input: unknown) => Promise<unknown>;
      cancel?: (input: unknown) => Promise<unknown>;
    };
  }).lophnRestore;
  const plan = shell?.plan;
  const submit = shell?.submit;
  const cancel = shell?.cancel;
  if (typeof plan !== "function" || typeof submit !== "function") {
    return undefined;
  }
  // preload는 plan·submit 두 함수만 노출한다. channel을 그 함수로 옮긴다.
  return {
    invoke: (channel, input) =>
      channel === RESTORE_PLAN_CHANNEL
        ? plan(input)
        : channel === RESTORE_SUBMIT_CHANNEL
        ? submit(input)
        : channel === RESTORE_CANCEL_CHANNEL && typeof cancel === "function"
        ? cancel(input)
        : Promise.reject(new Error("unknown restore channel")),
  };
}

export interface BackupDeps {
  restore: RestoreTransport | undefined;
  /** 사람이 고른 앱 export. 값은 보호 창만 받는다. */
  openWindow: ((intent: unknown) => Promise<unknown>) | undefined;
}

export function coreBackupSource(
  core: CoreSource,
  deps: Partial<BackupDeps> = {},
): BackupSource {
  const restore = "restore" in deps ? deps.restore : windowRestore();
  const openWindow = "openWindow" in deps ? deps.openWindow : undefined;

  async function askMain(
    channel: string,
    input: RestorePlanInput | RestoreSubmitInput,
  ): Promise<SourceResult<unknown>> {
    if (restore === undefined) return { ok: false, code: "unavailable" };
    try {
      return { ok: true, value: await restore.invoke(channel, input) };
    } catch {
      return { ok: false, code: "unavailable" };
    }
  }

  return {
    watch: (listener) => core.subscribe(listener),

    async backups() {
      const read = await call<{ backups: ManifestValue[] }>(
        core,
        "read",
        "backups",
        "list",
        {},
      );
      if (!read.ok) return read;
      return { ok: true, value: read.value.backups.map(rowOf) };
    },

    async restoreCancel(createdAt) {
      await askMain(RESTORE_CANCEL_CHANNEL, { created_at: createdAt });
    },

    async restorePlan(createdAt) {
      const reply = await askMain(RESTORE_PLAN_CHANNEL, {
        created_at: createdAt,
      });
      if (!reply.ok) return reply;
      const plan = reply.value as RestorePlanReply;
      if (!plan.ok) return { ok: false, code: plan.code };
      return {
        ok: true,
        value: {
          createdAt: plan.created_at,
          throughSeq: plan.through_seq,
          currentThroughSeq: plan.current_through_seq,
          lost: plan.lost === null ? null : {
            fromSeq: plan.lost.from_seq,
            throughSeq: plan.lost.through_seq,
            events: plan.lost.events,
          },
        } satisfies RestorePlanView,
      };
    },

    async restoreSubmit(createdAt) {
      const reply = await askMain(RESTORE_SUBMIT_CHANNEL, {
        created_at: createdAt,
      });
      if (!reply.ok) return reply;
      const result = reply.value as RestoreSubmitReply;
      if (!result.ok) return { ok: false, code: result.code };
      const outcome: RestoreOutcome = result.restarted
        ? "restored"
        : "restored";
      return { ok: true, value: outcome };
    },

    async exportSecrets() {
      if (openWindow === undefined) return { ok: false, code: "unavailable" };
      try {
        await openWindow({ kind: "secret_export" });
        return { ok: true, value: null };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },

    async importSecrets() {
      if (openWindow === undefined) return { ok: false, code: "unavailable" };
      try {
        await openWindow({ kind: "secret_import" });
        return { ok: true, value: null };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },

    async apps() {
      const read = await call<{ apps: { id: string; name: string }[] }>(
        core,
        "read",
        "apps",
        "list",
        {},
      );
      if (!read.ok) return read;
      return {
        ok: true,
        value: read.value.apps.map((app) => ({ id: app.id, name: app.name })),
      };
    },

    async exportApp(app) {
      // 앱 export는 worker route(allowlist에 더한 것)다. 준비는 core 그래프 밖 프로세스가 하고
      // 결과(ready·failed·preparing)만 온다. 자료를 바꾸지 않는다.
      const reply = await call<{
        app: string;
        state: "preparing" | "ready" | "failed";
        reason?: { summary?: string };
        includes_external_data: boolean;
      }>(core, "worker", "apps", "export", { app });
      if (!reply.ok) return reply;
      return {
        ok: true,
        value: {
          app: reply.value.app,
          state: reply.value.state,
          ...(reply.value.reason?.summary === undefined
            ? {}
            : { reason: reply.value.reason.summary }),
          includesExternalData: reply.value.includes_external_data,
        },
      };
    },
  };
}

// 폰이 부르는 push·pull. 컴퓨터가 hub다: 폰에서 온 변경은 차례로 컴퓨터 앱 DB에 적용되며 invocation이 되고, 모든
// 변경은 sync log에 순서대로 남아 다른 기기가 pull한다. core는 HLC를 비교하지 않고 순서를 seq로만 다룬다.
import { Buffer } from "node:buffer";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  APP_SYNC_PULL_DEFAULT_BYTES,
  type appSyncPull,
  type appSyncPush,
} from "../../../protocol/apps/app-sync.ts";
import { idSchema, type Id } from "../../../protocol/base/ids.ts";
import type { z } from "zod";
import type { PhoneApplied, PhoneApply } from "../calls/service.ts";
import type { SyncLog } from "./log.ts";

type PushInput = z.output<typeof appSyncPush.input>;
type PushOutput = z.output<typeof appSyncPush.output>;
type PullInput = z.output<typeof appSyncPull.input>;
type PullOutput = z.output<typeof appSyncPull.output>;

const PAGE_ROWS = 200;

export type AppSyncDeps = {
  log: SyncLog;
  phone: { apply(input: PhoneApply): Promise<Result<PhoneApplied>> };
  activeRelease(app: Id<"app">): Result<Id<"rel"> | null>;
  isSync(app: string, release: string): boolean;
};

/** 짝지은 기기의 자격(principal `device:<id>`)이면 그 기기 id. */
export function deviceOf(principal: string): Id<"dev"> | null {
  if (!principal.startsWith("device:")) return null;
  const parsed = idSchema("dev").safeParse(principal.slice("device:".length));
  return parsed.success ? (parsed.data as Id<"dev">) : null;
}

export function notDevice(): Result<never> {
  return err({ code: "forbidden", message: "only a paired device can sync" });
}

// 앱의 지금 활성 release. 앱이 없거나 release가 없으면 not_found.
export function activeOf(
  deps: Pick<AppSyncDeps, "activeRelease">,
  app: string,
): Result<Id<"rel">> {
  const active = deps.activeRelease(app as Id<"app">);
  if (!active.ok) return active;
  return active.value === null
    ? err({ code: "not_found", message: "app not found" })
    : ok(active.value);
}

export function createAppSync(deps: AppSyncDeps) {
  return {
    async push(
      principal: string,
      input: PushInput,
    ): Promise<Result<PushOutput>> {
      const device = deviceOf(principal);
      if (device === null) return notDevice();
      const app = input.app as Id<"app">;
      const active = activeOf(deps, app);
      if (!active.ok) return active;
      if (active.value !== input.release) {
        return err({
          code: "conflict",
          message: "the release is not active",
          details: { active_release: active.value },
        });
      }
      if (!deps.isSync(app, active.value)) {
        return err({
          code: "invalid_input",
          message: "the app does not run on the phone",
        });
      }
      const results: PushOutput["results"] = [];
      for (const change of input.changes) {
        const done = await deps.phone.apply({
          app,
          release: active.value,
          operation: change.operation,
          started_at: change.started_at,
          change: {
            device,
            id: change.id,
            hlc: change.hlc,
            changeset: new Uint8Array(Buffer.from(change.changeset, "base64")),
          },
        });
        // 멈춘 변경과 그 뒤는 폰의 outbox에 남는다. 이미 된 것은 오류와 같이 돌려준다.
        if (!done.ok) {
          return err({
            ...done.error,
            details: { ...done.error.details, results },
          });
        }
        results.push({ id: change.id, ...done.value });
      }
      return ok({ results, seq: deps.log.head(app) });
    },

    async pull(
      principal: string,
      input: PullInput,
    ): Promise<Result<PullOutput>> {
      const device = deviceOf(principal);
      if (device === null) return notDevice();
      const active = activeOf(deps, input.app);
      if (!active.ok) return active;
      const snapshot: PullOutput = {
        changes: [],
        next: input.after,
        more: false,
        snapshot_needed: true,
      };
      if (
        active.value !== input.release ||
        deps.log.snapshotNeeded(input.app, input.after)
      ) {
        return ok(snapshot);
      }
      const budget = input.max_bytes ?? APP_SYNC_PULL_DEFAULT_BYTES;
      const changes: PullOutput["changes"] = [];
      let next = input.after;
      let used = 0;
      for (;;) {
        const rows = deps.log.page(input.app, next, PAGE_ROWS);
        for (const row of rows) {
          // 읽는 사이에 생긴 '다시 snapshot' 줄이나 다른 release의 줄. 여기서 멈추고 다음 pull이 snapshot을 알린다.
          if (row.kind === "snapshot" || row.release !== input.release) {
            return ok(
              changes.length === 0
                ? snapshot
                : { changes, next, more: true, snapshot_needed: false },
            );
          }
          if (
            row.kind === "change" &&
            row.device !== device &&
            row.changeset !== null &&
            row.hlc !== null
          ) {
            if (changes.length > 0 && used + row.changeset.size > budget) {
              return ok({ changes, next, more: true, snapshot_needed: false });
            }
            const bytes = await deps.log.readChangeset(
              row.changeset.hash,
              row.changeset.size,
            );
            if (!bytes.ok) return bytes;
            changes.push({
              seq: row.seq,
              origin: row.origin,
              hlc: row.hlc,
              changeset: Buffer.from(bytes.value).toString("base64"),
            });
            used += row.changeset.size;
          }
          next = row.seq;
        }
        if (rows.length < PAGE_ROWS) {
          return ok({ changes, next, more: false, snapshot_needed: false });
        }
      }
    },
  };
}

export type AppSync = ReturnType<typeof createAppSync>;

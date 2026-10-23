// releases.list_records·get_record, activations.compare·consents·queue.
// 불변 Release를 준비 순서로 읽고, 이전 release와의 비교를 고정 선언 둘로 만든다.
// 범위 밖 앱의 release는 없는 것과 같다.
import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  activationConsents,
  type ActivationQueueEntry,
  activationsCompare,
  activationsQueue,
  type ReleaseRecord,
  releasesGetRecord,
  releasesListRecords,
} from "../../../protocol/apps/mod.ts";
import type {
  ApiReadDefinition,
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import { appAccessDenied, authorizeApp, loadApp } from "../registration/mod.ts";
import { loadGrants } from "../permissions/mod.ts";
import { compareForActivation } from "./compare.ts";
import { waitingConsents } from "./activation/consents.ts";
import {
  loadActiveRelease,
  loadRelease,
  loadReleases,
  loadStoredDeclaration,
} from "./store.ts";

const PAGE = 50;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "release not found" });
}

const cursorSchema = z.strictObject({
  offset: z.number().int().min(0),
  app: z.string().nullable(),
  status: z.string().nullable(),
  limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

function invalidCursor(): Result<never> {
  return err({
    code: "invalid_input",
    message: "invalid release list cursor",
  });
}

function nextCursor(
  offset: number,
  input: { app?: string; status?: string },
  limit: number,
): string {
  return btoa(JSON.stringify({
    offset,
    app: input.app ?? null,
    status: input.status ?? null,
    limit,
  }));
}

function pageOffset(
  cursor: string | undefined,
  input: { app?: string; status?: string },
  limit: number,
  head: number,
): Result<number> {
  if (cursor === undefined) return ok(0);
  try {
    const decoded = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0)),
      ),
    );
    const parsed = cursorSchema.safeParse(decoded);
    if (!parsed.success) return invalidCursor();
    if (parsed.data.app !== (input.app ?? null)) return invalidCursor();
    if (parsed.data.status !== (input.status ?? null)) return invalidCursor();
    if (parsed.data.limit !== limit) return invalidCursor();
    if (parsed.data.offset >= head) return invalidCursor();
    return ok(parsed.data.offset);
  } catch {
    return invalidCursor();
  }
}

// 이 release의 앱을 읽을 수 있는가. 없는 앱과 범위 밖 앱은 둘 다 false다.
function visible(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  operation: string,
  app: string,
): Result<boolean> {
  const found = loadApp(snapshot.sql, app);
  if (!found.ok) return found;
  if (found.value === null) return ok(false);
  const access = authorizeApp(snapshot.port, ctx, operation, {
    kind: "app",
    app: found.value,
  });
  if (access.ok) return ok(true);
  return appAccessDenied(access) ? ok(false) : access;
}

type ListInput = {
  app?: string;
  status?: string;
  cursor?: string;
  limit?: number;
};

function listRecords(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  operation: string,
  input: ListInput,
) {
  const all = loadReleases(snapshot.sql, {
    ...(input.app === undefined ? {} : { app: input.app }),
    ...(input.status === undefined ? {} : { status: input.status }),
  });
  if (!all.ok) return all;
  const seen = new Map<string, boolean>();
  const shown: ReleaseRecord[] = [];
  for (const release of all.value) {
    let allowed = seen.get(release.app);
    if (allowed === undefined) {
      const checked = visible(snapshot, ctx, operation, release.app);
      if (!checked.ok) return checked;
      allowed = checked.value;
      seen.set(release.app, allowed);
    }
    if (allowed) shown.push(release);
  }
  const limit = input.limit ?? PAGE;
  const offset = pageOffset(input.cursor, input, limit, shown.length);
  if (!offset.ok) return offset;
  const page = shown.slice(offset.value, offset.value + limit);
  const next = offset.value + page.length;
  return ok({
    releases: page,
    as_of_seq: snapshot.as_of_seq,
    next_cursor: next < shown.length ? nextCursor(next, input, limit) : null,
  });
}

function getRecord(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  operation: string,
  id: string,
) {
  const release = loadRelease(snapshot.sql, id);
  if (!release.ok) return release;
  let shown: ReleaseRecord | null = null;
  if (release.value !== null) {
    const allowed = visible(snapshot, ctx, operation, release.value.app);
    if (!allowed.ok) return allowed;
    if (allowed.value) shown = release.value;
  }
  return ok({
    release: shown,
    as_of_seq: snapshot.as_of_seq,
    next_cursor: null,
  });
}

export function createReleaseReads(): {
  listRecords: ReadDefinition<typeof releasesListRecords>;
  getRecord: ReadDefinition<typeof releasesGetRecord>;
  activationCompare: ReadDefinition<typeof activationsCompare>;
  activationConsents: ReadDefinition<typeof activationConsents>;
} {
  return {
    listRecords: {
      route: releasesListRecords,
      handle: (snapshot, ctx, input) =>
        listRecords(snapshot, ctx, releasesListRecords.name, input),
    },
    // 실패 근거(`failure`)도 이 record가 싣는다.
    getRecord: {
      route: releasesGetRecord,
      handle: (snapshot, ctx, input) =>
        getRecord(snapshot, ctx, releasesGetRecord.name, input.release),
    },
    // 동의를 기다리는 줄이다. 읽을 수 없는 앱의 줄은 뺀다.
    activationConsents: {
      route: activationConsents,
      handle(snapshot, ctx, input) {
        const seen = new Map<string, boolean>();
        const consents = [];
        for (const row of waitingConsents(snapshot.sql, input.app)) {
          let allowed = seen.get(row.app);
          if (allowed === undefined) {
            const checked = visible(
              snapshot,
              ctx,
              activationConsents.name,
              row.app,
            );
            if (!checked.ok) return checked;
            allowed = checked.value;
            seen.set(row.app, allowed);
          }
          if (allowed) consents.push(row);
        }
        return ok({
          consents,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    // 지금 활성 release와 견준 activation 비교다. 이미 활성인 release는 자기 앞의 release와 견준다.
    activationCompare: {
      route: activationsCompare,
      handle(snapshot, ctx, input) {
        const stored = loadStoredDeclaration(snapshot.sql, input.release);
        if (!stored.ok) return stored;
        if (stored.value === null) return notFound();
        const { release, facts } = stored.value;
        const allowed = visible(
          snapshot,
          ctx,
          activationsCompare.name,
          release.app,
        );
        if (!allowed.ok) return allowed;
        if (!allowed.value) return notFound();
        const baseId = release.status === "active"
          ? release.activation?.previous_release ?? null
          : null;
        const base = baseId === null
          ? loadActiveRelease(snapshot.sql, release.app)
          : loadRelease(snapshot.sql, baseId);
        if (!base.ok) return base;
        const grants = loadGrants(snapshot.sql, {
          app: release.app,
          status: "active",
        });
        if (!grants.ok) return grants;
        const previous = base.value === null || base.value.id === release.id
          ? null
          : { id: base.value.id, data_schema: base.value.data_schema };
        return ok({
          comparison: compareForActivation({
            previous,
            grants: grants.value,
            facts,
            next: { data_changes: release.data_changes },
          }),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}

// activation 줄의 지금 상태다. 도는 것은 core 메모리라 ledger snapshot이 아니라 driver가 준다.
type ActivationQueueSource = {
  entries(app: string | undefined): Promise<
    Result<{ entries: ActivationQueueEntry[]; as_of_seq: string }>
  >;
};

export function createActivationQueueRead(
  source: ActivationQueueSource,
): ApiReadDefinition<typeof activationsQueue> {
  return {
    route: activationsQueue,
    async handle(_ctx, input) {
      const parsed = activationsQueue.input.safeParse(input);
      if (!parsed.success) {
        return err({ code: "invalid_input", message: "invalid read input" });
      }
      const read = await source.entries(parsed.data.app);
      if (!read.ok) return read;
      return ok({ ...read.value, next_cursor: null });
    },
  };
}

import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type Package,
  packagesList,
  packagesUsage,
  packagesVersions,
} from "../../../protocol/apps/mod.ts";
import type { ReadDefinition } from "../../../protocol/server/mod.ts";
import { byCatalogOrder } from "./model.ts";
import {
  loadAllPackageRows,
  loadPackage,
  loadPackageRow,
  loadUsages,
  loadVersions,
} from "./store.ts";
import { packageFromRow } from "./rows.ts";

const PAGE = 50;

function invalidCursor(): Result<never> {
  return err({
    code: "invalid_input",
    message: "invalid package list cursor",
  });
}

const cursorSchema = z.strictObject({
  offset: z.number().int().min(0),
  name: z.string().nullable(),
  limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

// 목록 page는 같은 조건 안에서만 이어진다. name·limit이 다른 cursor는 invalid_input이다.
export function nextPackageCursor(
  offset: number,
  name: string | undefined,
  limit: number,
): string {
  return btoa(JSON.stringify({ offset, name: name ?? null, limit }));
}

function packageCursorOffset(
  cursor: string | undefined,
  name: string | undefined,
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
    if (parsed.data.name !== (name ?? null)) return invalidCursor();
    if (parsed.data.limit !== limit) return invalidCursor();
    if (parsed.data.offset >= head) return invalidCursor();
    return ok(parsed.data.offset);
  } catch {
    return invalidCursor();
  }
}

export function createSdkReads(): {
  list: ReadDefinition<typeof packagesList>;
  versions: ReadDefinition<typeof packagesVersions>;
  usage: ReadDefinition<typeof packagesUsage>;
} {
  return {
    list: {
      route: packagesList,
      handle(snapshot, ctx, input) {
        void ctx;
        // 이름 filter가 있으면 그 패키지만, 없으면 catalog 전체를 @me 먼저 정렬한다.
        if (input.name !== undefined) {
          const pkg = loadPackage(snapshot.sql, input.name);
          if (!pkg.ok) return pkg;
          return ok({
            packages: pkg.value === null ? [] : [pkg.value],
            as_of_seq: snapshot.as_of_seq,
            next_cursor: null,
          });
        }
        const rows = loadAllPackageRows(snapshot.sql);
        const values: Package[] = [];
        for (const row of rows) {
          const versions = loadVersions(snapshot.sql, row["id"] as string);
          const assembled = packageFromRow(row, versions);
          if (!assembled.ok) return assembled;
          values.push(assembled.value);
        }
        const sorted = values.sort(byCatalogOrder);
        const limit = input.limit ?? PAGE;
        const head = sorted.length;
        const offset = packageCursorOffset(
          input.cursor,
          undefined,
          limit,
          head,
        );
        if (!offset.ok) return offset;
        const start = offset.value;
        const page = sorted.slice(start, start + limit);
        const next = start + page.length;
        return ok({
          packages: page,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: next < head
            ? nextPackageCursor(next, undefined, limit)
            : null,
        });
      },
    },
    versions: {
      route: packagesVersions,
      handle(snapshot, ctx, input) {
        void ctx;
        const pkg = loadPackage(snapshot.sql, input.name);
        if (!pkg.ok) return pkg;
        if (pkg.value === null) {
          return err({ code: "not_found", message: "package not found" });
        }
        return ok({
          name: input.name,
          versions: pkg.value.versions,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    usage: {
      route: packagesUsage,
      handle(snapshot, ctx, input) {
        void ctx;
        const pkg = loadPackageRow(snapshot.sql, input.name);
        if (pkg === undefined) {
          return err({ code: "not_found", message: "package not found" });
        }
        const usages = loadUsages(snapshot.sql, input.name, input.version);
        return ok({
          name: input.name,
          version: input.version,
          usages,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}

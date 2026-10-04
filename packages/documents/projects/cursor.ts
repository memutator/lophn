import { z } from "zod";
import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import {
  documentRefOutputSchema,
  type Project,
} from "../../contracts/documents/mod.ts";
import type {
  ReadSnapshot,
  RequestContext,
} from "../../contracts/platform/mod.ts";

const basisSchema = z.strictObject({
  seq: z.string(),
  projects: z.array(z.strictObject({
    id: z.string(),
    revision: z.string(),
    documents: z.array(documentRefOutputSchema),
  })),
});
const conditionsSchema = z.strictObject({
  status: z.enum(["active", "archived"]).nullable(),
  limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  principal: z.string(),
  actor: z.string(),
  credential: z.string(),
});
const cursorSchema = z.strictObject({
  offset: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  conditions: conditionsSchema,
  basis: basisSchema,
});

type Cursor = z.infer<typeof cursorSchema>;
export type ProjectPageBasis = {
  id: Project["id"];
  revision: Project["revision"];
  documents: z.infer<typeof documentRefOutputSchema>[];
};

export function projectPageBasis(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  status: "active" | "archived" | undefined,
  limit: number,
  projects: ProjectPageBasis[],
): Omit<Cursor, "offset"> {
  return {
    conditions: {
      status: status ?? null,
      limit,
      principal: ctx.principal,
      actor: ctx.actor,
      credential: ctx.credential_ref,
    },
    basis: { seq: snapshot.as_of_seq, projects },
  };
}

export function pageOffset(
  cursor: string | undefined,
  current: Omit<Cursor, "offset">,
): Result<number> {
  if (cursor === undefined) return ok(0);
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = cursorSchema.safeParse(JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ));
    if (!parsed.success) return invalidCursor();
    if (
      canonicalize(parsed.data.conditions) !== canonicalize(current.conditions)
    ) {
      return invalidCursor();
    }
    if (canonicalize(parsed.data.basis) !== canonicalize(current.basis)) {
      return err({ code: "conflict", message: "project page basis changed" });
    }
    if (parsed.data.offset >= current.basis.projects.length) {
      return invalidCursor();
    }
    return ok(parsed.data.offset);
  } catch {
    return invalidCursor();
  }
}

export function nextProjectCursor(
  offset: number,
  current: Omit<Cursor, "offset">,
): string {
  const bytes = new TextEncoder().encode(canonicalize({ offset, ...current }));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

function invalidCursor(): Result<never> {
  return err({ code: "invalid_input", message: "invalid project cursor" });
}

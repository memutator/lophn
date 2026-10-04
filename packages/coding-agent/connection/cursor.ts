import { z } from "zod";
import { canonicalize, err, ok, type Result } from "../../base/mod.ts";

const conditionsSchema = z.strictObject({
  state: z.enum(["active", "revoked"]).nullable(),
  scope_kind: z.enum(["all", "app"]).nullable(),
  scope_app: z.string().nullable(),
  principal: z.string(),
  actor: z.string(),
  credential: z.string(),
});

const cursorSchema = z.strictObject({
  after_id: z.string(),
  conditions: conditionsSchema,
});

export type ConnectionPageConditions = z.infer<typeof conditionsSchema>;

export function pageAfter(
  cursor: string | undefined,
  current: ConnectionPageConditions,
): Result<string | null> {
  if (cursor === undefined) return ok(null);
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = cursorSchema.safeParse(JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ));
    if (!parsed.success) return invalidCursor();
    if (canonicalize(parsed.data.conditions) !== canonicalize(current)) {
      return invalidCursor();
    }
    return ok(parsed.data.after_id);
  } catch {
    return invalidCursor();
  }
}

export function nextConnectionCursor(
  afterId: string,
  conditions: ConnectionPageConditions,
): string {
  const bytes = new TextEncoder().encode(
    canonicalize({ after_id: afterId, conditions }),
  );
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

function invalidCursor(): Result<never> {
  return err({ code: "invalid_input", message: "invalid connection cursor" });
}

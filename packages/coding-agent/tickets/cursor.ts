import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";

const cursorSchema = z.strictObject({ after_id: z.string() });

// ticket cursor는 id cursor만 담는다. 필터가 바뀌면 목록을 다시 읽는다.
export function pageAfter(
  cursor: string | undefined,
  _asOf: string,
): Result<string | null> {
  if (cursor === undefined) return ok(null);
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = cursorSchema.safeParse(JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ));
    if (!parsed.success) return invalid();
    return ok(parsed.data.after_id);
  } catch {
    return invalid();
  }
}

export function nextCursor(afterId: string, _asOf: string): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ after_id: afterId }),
  );
  return btoa(String.fromCharCode(...bytes));
}

export function invalid(): Result<never> {
  return err({ code: "invalid_input", message: "invalid ticket cursor" });
}

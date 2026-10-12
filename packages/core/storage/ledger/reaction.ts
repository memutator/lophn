import {
  canonicalize,
  err,
  ok,
  type Result,
  sha256Hex,
} from "../../../base/mod.ts";
import {
  type ReactionKey,
  reactionKeySchema,
} from "../../../protocol/server/mod.ts";

// command_results의 principal binding과 함께 쓰는 안정된 반응 key다.
export async function reactionIdempotencyKey(
  key: ReactionKey,
): Promise<Result<string>> {
  const parsed = reactionKeySchema.safeParse(key);
  if (!parsed.success) {
    return err({ code: "invalid_input", message: "반응 key가 올바르지 않다" });
  }
  return ok(
    await sha256Hex(new TextEncoder().encode(canonicalize(parsed.data))),
  );
}

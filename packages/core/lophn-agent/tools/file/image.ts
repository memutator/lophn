import { ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import type { ToolContext } from "../tool-context.ts";
import { fail, fsFail, resolveInPlace } from "./scope.ts";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export async function readImage(
  input: { path: string },
  ctx: ToolContext,
): Promise<Result<ToolResult>> {
  const mediaType =
    MEDIA_TYPES[input.path.split(".").pop()?.toLowerCase() ?? ""];
  if (mediaType === undefined) {
    return fail("invalid_input", "image must be png, jpeg, gif or webp");
  }
  const at = await resolveInPlace(ctx.scope, input.path, "read");
  if (!at.ok) return at;
  let bytes: Uint8Array;
  try {
    const stat = await Deno.stat(at.value.path);
    if (!stat.isFile) return fail("invalid_input", "not a file");
    if (stat.size > MAX_IMAGE_BYTES) {
      return fail("invalid_input", "image is larger than 5 MiB");
    }
    bytes = await Deno.readFile(at.value.path);
  } catch (error) {
    return fsFail(error);
  }
  return ok({
    status: "success",
    summary: `read image ${input.path}`,
    content: { image: { media_type: mediaType, data_base64: toBase64(bytes) } },
    complete: true,
    source: null,
    continuation: null,
    pending: [],
  });
}

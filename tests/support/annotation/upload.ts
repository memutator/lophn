// 사람 앱 화면의 screenshot byte를 core에 올려 annotation.send의 screenshot 칸을 받는다. 올리기만 하고 단정하지 않는다.
import { sha256Hex } from "../../../packages/base/mod.ts";
import {
  errorBodySchema,
  UPLOAD_INPUT_HEADER,
} from "../../../packages/protocol/base/mod.ts";
import { annotationUploadScreenshot } from "../../../packages/protocol/apps/annotation.ts";
import type { PreparedBlob } from "../../../packages/protocol/storage/blob.ts";
import type { Core } from "../core/mod.ts";

function encodeInput(input: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function uploadScreenshot(
  core: Core,
  bytes: Uint8Array,
): Promise<PreparedBlob> {
  const response = await fetch(
    `${core.baseUrl}/${annotationUploadScreenshot.resource}/${annotationUploadScreenshot.method}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${core.token}`,
        "content-type": "application/octet-stream",
        [UPLOAD_INPUT_HEADER]: encodeInput({
          blob_hash: await sha256Hex(bytes),
          bytes: bytes.length,
        }),
      },
      body: bytes as Uint8Array<ArrayBuffer>,
    },
  );
  const json = await response.json().catch(() => undefined);
  if (response.status !== 200) {
    const parsed = errorBodySchema.safeParse(json);
    const code = parsed.success ? parsed.data.error.code : response.status;
    throw new Error(`annotation.upload_screenshot: ${code}`);
  }
  return annotationUploadScreenshot.output.parse(json);
}

// `/annotations/upload_screenshot` handler. screenshot 바이트를 core가 해석 없이 blob 준비 중계로
// 흘려 보낸다. 준비 주체는 요청 credential이라 이어지는 annotation.send의 저장이 같은 주체로 영구
// 참조를 등록한다. purpose와 상한은 호출자가 고르지 않는다.
import { err, type Result } from "../../../base/mod.ts";
import {
  ANNOTATION_SCREENSHOT_MAX_BYTES,
  ANNOTATION_SCREENSHOT_PURPOSE,
  annotationUploadScreenshot,
} from "../../../protocol/apps/annotation.ts";
import type { UploadHandler } from "../../server/mod.ts";
import type { BlobPrepareCall } from "../../main/daemon/core.ts";
import type { PreparedRelayResult } from "../../storage/blobs/prepare-relay.ts";
import { exactBytes } from "../../storage/blobs/exact-bytes.ts";

export function annotationUploadHandler(relay: {
  current?: (call: BlobPrepareCall) => Promise<Result<PreparedRelayResult>>;
}): UploadHandler {
  return (ctx, rawInput, body) => {
    const input = annotationUploadScreenshot.input.safeParse(rawInput);
    if (
      !input.success || input.data.bytes > ANNOTATION_SCREENSHOT_MAX_BYTES ||
      (body.length !== undefined && input.data.bytes !== body.length)
    ) {
      body.bytes.cancel().catch(() => {});
      return Promise.resolve(err({
        code: "invalid_input",
        message: "upload input does not match the body",
      }));
    }
    const prepare = relay.current;
    if (!prepare) {
      body.bytes.cancel().catch(() => {});
      return Promise.resolve(err({
        code: "unavailable",
        message: "blob 준비 중계가 아직 없다",
      }));
    }
    const mismatch = { value: false };
    return prepare({
      principal: ctx.principal,
      purpose: ANNOTATION_SCREENSHOT_PURPOSE,
      expectedHash: input.data.blob_hash,
      bytes: exactBytes(body.bytes, input.data.bytes, mismatch),
    }).then((prepared) =>
      !prepared.ok && mismatch.value
        ? err({
          code: "invalid_input" as const,
          message: "upload input does not match the body",
        })
        : prepared
    );
  };
}

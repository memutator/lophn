// `/v1/documents/upload` handler(coding-agent#T14). 제출한 파일 하나의 바이트를 core가
// 해석·hash·보관 없이 blob 준비 중계로 흘려 보낸다. 준비 주체는 요청 credential이라
// 이어지는 document.prepare·document.save가 같은 주체로 준비 참조를 쓴다. purpose는
// 문서 원본 파일(document_file)로 고정이고 호출자가 고르지 않는다.
import { err, type Result } from "../../../../base/mod.ts";
import { documentUpload } from "../../../../protocol/projects/mod.ts";
import type { UploadHandler } from "../../../server/mod.ts";
import type { BlobPrepareCall } from "../../../main/daemon/core.ts";
import type { PreparedRelayResult } from "../../../storage/blobs/prepare-relay.ts";

export const DOCUMENT_FILE_PURPOSE = "document_file";

// 입력이 선언한 크기와 정확히 같은 바이트만 흘린다. 어긋나면 stream을 오류로 끝내 blob을
// 만들지 못하게 하고, 그 사실을 알려 호출자에게 입력 오류로 답한다.
export function exactBytes(
  source: ReadableStream<Uint8Array>,
  size: number,
  mismatch: { value: boolean },
): ReadableStream<Uint8Array> {
  let total = 0;
  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > size) {
          mismatch.value = true;
          throw new Error("body longer than declared");
        }
        controller.enqueue(chunk);
      },
      flush() {
        if (total !== size) {
          mismatch.value = true;
          throw new Error("body shorter than declared");
        }
      },
    }),
  );
}

export function documentUploadHandler(relay: {
  current?: (call: BlobPrepareCall) => Promise<Result<PreparedRelayResult>>;
}): UploadHandler {
  return (ctx, rawInput, body) => {
    const input = documentUpload.input.safeParse(rawInput);
    if (
      !input.success ||
      (body.length !== undefined && input.data.bytes !== body.length)
    ) {
      // 선언한 바이트 수와 입력의 크기가 다르면 바이트를 읽지 않는다.
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
      purpose: DOCUMENT_FILE_PURPOSE,
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

// 제출 파일의 바이트를 core의 `documents/upload` route로 보내 준비된 blob 참조를 받는다
// (mcp#R13, cli#R15, connection#R10). 호출자가 주장하는 hash·크기는 입력으로 가고 실제
// 바이트가 같을 때만 core가 준비를 끝낸다. 준비 주체는 요청 credential이라 이어지는
// document.prepare·document.save가 같은 주체로 참조를 쓴다.
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import { documentUpload } from "../../protocol/projects/mod.ts";
import {
  type PreparedBlob,
  preparedBlobSchema,
  type UploadRoute,
} from "../../protocol/platform/mod.ts";
import type { PrepareBytes } from "./submission.ts";

// core client 중 이 통로가 쓰는 호출이다. client/core.ts는 core module graph 밖에 둔다.
export type UploadClient = {
  upload(
    route: UploadRoute,
    input: unknown,
    bytes: ReadableStream<Uint8Array>,
  ): Promise<Result<unknown, LophnError>>;
};

export function uploadPrepareBytes(client: UploadClient): PrepareBytes {
  return async (file): Promise<Result<PreparedBlob, LophnError>> => {
    const sent = await client.upload(
      documentUpload,
      { blob_hash: file.blob_hash, bytes: file.bytes },
      file.open(),
    );
    if (!sent.ok) return sent;
    const parsed = preparedBlobSchema.safeParse(sent.value);
    if (!parsed.success) {
      return err({ code: "internal", message: "internal error" });
    }
    return ok(parsed.data);
  };
}

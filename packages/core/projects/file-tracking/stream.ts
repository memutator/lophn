// 같은 읽기 stream에서 hash와 blob을 만든다(file-tracking#R6). 파일 전체를 모으지 않는다.
// chunk를 받는 족족 hash에 더하고 sink로 넘긴다. 파일을 여는 것은 호출자다.
import { createHash, type Hash } from "node:crypto";
import { err, ok, type Result } from "../../../base/mod.ts";

export type StreamedBlob = {
  hash: string;
  size_bytes: number;
};

export type BlobSink = {
  // chunk 하나를 staging에 붙인다. 실패하면 그 준비를 버린다.
  write(chunk: Uint8Array): Promise<Result<void>>;
  // staging을 내구 준비로 마감하고 참조를 돌려준다.
  finish(): Promise<Result<{ preparation: string }>>;
};

export type StreamedPreparation = StreamedBlob & { preparation: string };

// 한 stream을 두 갈래로 보낸다. hash는 chunk마다 갱신하고, 바이트는 sink로만 간다.
// stream이 끊기거나 sink가 실패하면 그 준비는 실패다. 부분 hash를 성공으로 주지 않는다.
export async function prepareFromStream(
  bytes: ReadableStream<Uint8Array>,
  sink: BlobSink,
): Promise<Result<StreamedPreparation>> {
  const hash: Hash = createHash("sha256");
  const reader = bytes.getReader();
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      hash.update(next.value);
      size += next.value.length;
      const written = await sink.write(next.value);
      if (!written.ok) return written;
    }
  } catch {
    return err({ code: "unavailable", message: "stream read failed" });
  } finally {
    reader.releaseLock();
  }
  const finished = await sink.finish();
  if (!finished.ok) return finished;
  return ok({
    hash: hash.digest("hex"),
    size_bytes: size,
    preparation: finished.value.preparation,
  });
}

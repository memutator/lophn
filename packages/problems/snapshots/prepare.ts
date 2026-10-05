import type { Result } from "../../base/mod.ts";

export type PreparedSnapshotBlob = {
  preparation: string;
  principal: string;
  purpose: string;
  hash: string;
  size_bytes: number;
};

// 조립에 주입하는 준비 경계. bytes는 platform blob prepare 경계(
// documents가 supervision pipe로 준비하는 것과 같은 갈래)로 간다.
export type SnapshotBlobPrepare = {
  prepare(
    input: { principal: string; purpose: string; expectedHash?: string },
    bytes: ReadableStream<Uint8Array>,
  ): Promise<Result<PreparedSnapshotBlob>>;
};

// 준비 경계는 바이트를 stream으로만 받는다.
export function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      if (bytes.length > 0) controller.enqueue(bytes);
      controller.close();
    },
  });
}

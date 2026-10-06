import { canonicalize, err, ok, type Result } from "../../packages/base/mod.ts";

// run·model call·tool call 기록이 hash로 가리키는 본문을 blob으로 먼저 저장하는 통로다. 준비는 감독 pipe의
// `blob_prepare_request`(child → core, I/O worker가 hash를 계산한다)이고 이 모듈은 그 요청을 부르는
// 쪽이다. 전송 전에 redaction을 거친 바이트만 저장하므로 command가 받는 hash는 저장된 바이트의 hash다.

export type BlobPort = {
  prepare(
    purpose: string,
    bytes: Uint8Array,
  ): Promise<Result<{ hash: string; size_bytes: number }>>;
};

export type StoredBlob = { hash: string; size: number };

const encoder = new TextEncoder();

// 값 하나를 정규 JSON으로 만들어 redaction하고 저장한다. 안전화를 끝내지 못하면 저장도 전송도 없다.
export async function storeValue(
  blobs: BlobPort,
  redact: (text: string) => string | null,
  purpose: string,
  value: unknown,
): Promise<Result<StoredBlob>> {
  const redacted = redact(canonicalize(value));
  if (redacted === null) {
    return err({
      code: "unavailable",
      message: "redaction did not finish",
    });
  }
  const bytes = encoder.encode(redacted);
  const prepared = await blobs.prepare(purpose, bytes);
  if (!prepared.ok) return prepared;
  if (prepared.value.size_bytes !== bytes.length) {
    return err({ code: "internal", message: "stored blob size differs" });
  }
  return ok({ hash: prepared.value.hash, size: prepared.value.size_bytes });
}

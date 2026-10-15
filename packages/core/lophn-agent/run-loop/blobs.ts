import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";

// turn·model call·tool call 기록이 hash로 가리키는 본문을 blob으로 먼저 저장하는 통로다. 준비는 감독 pipe의
// `blob_prepare_request`(child → core, I/O worker가 hash를 계산한다)이고 이 모듈은 그 요청을 부르는
// 쪽이다. 전송 전에 redaction을 거친 바이트만 저장하므로 command가 받는 hash는 저장된 바이트의 hash다.

export type BlobPort = {
  prepare(
    purpose: string,
    bytes: Uint8Array,
  ): Promise<Result<{ hash: string; size_bytes: number }>>;
};

export type StoredBlob = { hash: string; size: number };

// 글을 안전화한다. 끝내지 못하면 null이다(model로도 blob으로도 보내지 않는다).
export type RedactText = (
  text: string,
) => string | null | Promise<string | null>;

const encoder = new TextEncoder();

// 값 안의 글(문자열)을 모두 안전화한다. 키와 구조는 그대로다. 정규 JSON 글 전체를 안전화하면 값이
// JSON 이스케이프된 모양으로 놓여 알려진 값이 보이지 않을 수 있으므로 글 하나씩 본다. 하나라도 끝내지
// 못하면 값 전체가 안전화되지 않은 것이다.
export async function redactValue(
  redact: RedactText,
  value: unknown,
): Promise<Result<unknown>> {
  const unavailable = () =>
    err({ code: "unavailable" as const, message: "redaction did not finish" });
  async function walk(node: unknown): Promise<{ value: unknown } | null> {
    if (typeof node === "string") {
      const safe = await redact(node);
      return safe === null ? null : { value: safe };
    }
    if (Array.isArray(node)) {
      const items = await Promise.all(node.map(walk));
      return items.some((item) => item === null)
        ? null
        : { value: items.map((item) => item!.value) };
    }
    if (node !== null && typeof node === "object") {
      const entries = Object.entries(node);
      const items = await Promise.all(entries.map(([, item]) => walk(item)));
      if (items.some((item) => item === null)) return null;
      return {
        value: Object.fromEntries(
          entries.map(([key], index) => [key, items[index]!.value]),
        ),
      };
    }
    return { value: node };
  }
  const safe = await walk(value);
  return safe === null ? unavailable() : ok(safe.value);
}

// 안전화한 값을 정규 JSON으로 저장한다. 저장한 바이트의 hash를 돌려준다.
export async function storeRedacted(
  blobs: BlobPort,
  purpose: string,
  safe: unknown,
): Promise<Result<StoredBlob>> {
  const bytes = encoder.encode(canonicalize(safe));
  const prepared = await blobs.prepare(purpose, bytes);
  if (!prepared.ok) return prepared;
  if (prepared.value.size_bytes !== bytes.length) {
    return err({ code: "internal", message: "stored blob size differs" });
  }
  return ok({ hash: prepared.value.hash, size: prepared.value.size_bytes });
}

// 값 하나를 안전화하고 저장한다. 안전화를 끝내지 못하면 저장도 전송도 없다.
export async function storeValue(
  blobs: BlobPort,
  redact: RedactText,
  purpose: string,
  value: unknown,
): Promise<Result<StoredBlob>> {
  const safe = await redactValue(redact, value);
  if (!safe.ok) return safe;
  return await storeRedacted(blobs, purpose, safe.value);
}

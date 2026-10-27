import { err, ok, type Result, sha256Hex } from "../../../base/mod.ts";
import {
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
  MESSAGE_CONTENT_MAX_BYTES,
  messageBody,
  messageBodyInputSchema,
  messageContentSchema,
} from "../../../protocol/lophn-agent/mod.ts";
import type { ApiReadDefinition, Sql } from "../../../protocol/server/mod.ts";
import { BLOB_READ_MAX_BYTES } from "../../../protocol/storage/mod.ts";
import { sessionVisible } from "./guards.ts";
import { loadMessage, loadSession } from "./model.ts";

// ReadMessageBody. 참조 행 판정은 ledger snapshot에서 짧게 하고, blob 바이트는 그 뒤에
// 읽는다(바이트를 기다리며 snapshot을 잡고 있지 않는다). 사람·그 assignment의
// agent·machine만 읽고, 그 밖 메시지는 없는 메시지와 똑같이 not_found다.

export type MessageBodyEnvironment = {
  // ledger snapshot 하나에서 판정한다. 연결은 판정을 마치면 닫는다.
  snapshot<T>(
    read: (sql: Pick<Sql, "get" | "all">, asOfSeq: string) => Result<T>,
  ): Result<T>;
  // blob store의 그 구간. 없거나 관측 hash가 다르면 err다.
  bytes(
    hash: string,
    offset: number,
    length: number,
  ): Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>>;
};

type Found = {
  session: string;
  hash: string;
  size: number;
  asOf: string;
};

function absent(): Result<never> {
  return err({ code: "not_found", message: "message not found" });
}

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

export function messageBodyRead(
  environment: MessageBodyEnvironment,
): ApiReadDefinition<typeof messageBody> {
  return {
    route: messageBody,
    async handle(ctx, input) {
      const parsed = messageBodyInputSchema.safeParse(input);
      if (!parsed.success) {
        return err({ code: "invalid_input", message: "invalid read input" });
      }
      const id = parsed.data.message;
      const found = environment.snapshot<Found | undefined>((sql, asOfSeq) => {
        const lookup = { sql };
        const message = loadMessage(lookup, id);
        if (message === undefined) return ok(undefined);
        const session = loadSession(lookup, message.session);
        if (session === undefined || !sessionVisible(ctx, session)) {
          return ok(undefined);
        }
        const ref = sql.get(
          `select hash, size_bytes from blob_refs
           where owner_kind = ? and owner_key = ? and field = ?`,
          [MESSAGE_BODY_OWNER_KIND, message.id, MESSAGE_BODY_FIELD],
        );
        const hash = ref?.["hash"];
        const size = ref?.["size_bytes"];
        if (
          typeof hash !== "string" ||
          hash !== message.body ||
          (typeof size !== "bigint" && typeof size !== "number")
        ) {
          return unavailable("message body is not available");
        }
        return ok({
          session: message.session,
          hash,
          size: Number(size),
          asOf: asOfSeq,
        });
      });
      if (!found.ok) return found;
      if (found.value === undefined) return absent();
      const { session, hash, size, asOf } = found.value;
      if (size < 1 || size > MESSAGE_CONTENT_MAX_BYTES) {
        return unavailable("message body is not available");
      }
      const bytes = await readBodyBytes(environment, hash, size);
      if (!bytes.ok) return bytes;
      const content = bodyContentOf(bytes.value);
      if (!content.ok) return content;
      return ok({
        message: id,
        session,
        body: hash,
        size_bytes: size,
        content: content.value,
        as_of_seq: asOf,
        next_cursor: null,
      });
    },
  };
}

// blob.read의 한 번 상한(256KiB) 단위로 이어 읽고 전체 hash를 다시 확인한다.
// 없거나 어긋난 바이트는 빈 내용이 아니라 unavailable이다.
export async function readBodyBytes(
  environment: MessageBodyEnvironment,
  hash: string,
  size: number,
): Promise<Result<Uint8Array>> {
  const whole = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    const length = Math.min(BLOB_READ_MAX_BYTES, size - offset);
    const read = await environment.bytes(hash, offset, length);
    if (
      !read.ok ||
      read.value.hash !== hash ||
      read.value.sizeBytes !== size ||
      read.value.bytes.length !== length
    ) {
      return unavailable("message body is not available");
    }
    whole.set(read.value.bytes, offset);
    offset += length;
  }
  if ((await sha256Hex(whole)) !== hash) {
    return unavailable("message body is not available");
  }
  return ok(whole);
}

// 본문 값. JSON 값이 아닌 기존 text blob은 글 하나로 읽는다.
function bodyContentOf(bytes: Uint8Array) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return unavailable("message body is not available");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return ok({
      schema_version: 1 as const,
      parts: [{ kind: "text" as const, text }],
    });
  }
  const checked = messageContentSchema.safeParse(value);
  return checked.success
    ? ok(checked.data)
    : unavailable("message body is not available");
}

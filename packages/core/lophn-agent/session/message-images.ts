import { ok, type Result } from "../../../base/mod.ts";
import {
  type ContentBlock,
  MESSAGE_BODY_OWNER_KIND,
  MESSAGE_IMAGE_FIELD,
  MESSAGE_IMAGE_PURPOSE,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";

// image block이 가리키는 blob의 영구 참조다. 참조는 그 블록을 담은 메시지가 갖는다: 이미지는 그 참조가 있는
// 메시지의 session에서만 읽히므로, 다른 session은 hash를 알아도 읽지 못한다.

export function imageBlobsOf(blocks: readonly ContentBlock[]): string[] {
  return [
    ...new Set(
      blocks.flatMap((block) => (block.type === "image" ? [block.blob] : [])),
    ),
  ];
}

// 보낸 쪽이 올린 blob(`principal`의 준비)을 메시지에 건다. block은 hash만 싣고 크기를 모른다. 크기는 어디서도
// 읽지 않아 0으로 적는다. `skip`은 이미 걸린 hash다.
export function registerImageRefs(
  tx: Tx,
  message: string,
  seq: string,
  principal: string,
  blocks: readonly ContentBlock[],
  skip: ReadonlySet<string> = new Set(),
): Result<void> {
  for (const hash of imageBlobsOf(blocks)) {
    if (skip.has(hash)) continue;
    const registered = tx.registerBlobRef({
      owner_kind: MESSAGE_BODY_OWNER_KIND,
      owner_key: message,
      field: MESSAGE_IMAGE_FIELD,
      registered_seq: seq,
      source: {
        kind: "prepared",
        blob: {
          preparation: hash,
          principal,
          purpose: MESSAGE_IMAGE_PURPOSE,
          hash,
          size_bytes: 0,
        },
      },
    });
    if (!registered.ok) return registered;
  }
  return ok(undefined);
}

type Query = Pick<Sql, "get" | "all">;

export function imageRefsOf(sql: Query, message: string): string[] {
  return sql
    .all(
      `select hash from blob_refs
       where owner_kind = ? and owner_key = ? and field = ?`,
      [MESSAGE_BODY_OWNER_KIND, message, MESSAGE_IMAGE_FIELD],
    )
    .map((row) => String(row["hash"]));
}

// 이 session의 메시지가 그 blob을 참조하는지. 이미지 bytes를 읽는 길은 모두 이것을 먼저 본다.
export function imageReferenced(
  sql: Query,
  session: string,
  blob: string,
): boolean {
  return (
    sql.get(
      `select 1 as found from blob_refs b join messages m on m.id = b.owner_key
       where b.owner_kind = ? and b.field = ? and b.hash = ? and m.session = ?
       limit 1`,
      [MESSAGE_BODY_OWNER_KIND, MESSAGE_IMAGE_FIELD, blob, session],
    ) !== undefined
  );
}

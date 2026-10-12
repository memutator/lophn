// ReadApprovalText(platform/approvals#R14, R17). 결정 화면이 보는 설명 글(이유·변경·외부 영향·
// 되돌림)과 거절·취소에 적은 종료 이유를 돌려준다. 메시지 본문·질문 글 읽기와 같은 길이다: 참조 행 판정은 ledger
// snapshot에서 짧게 하고, blob 바이트는 그 뒤에 읽는다. 글은 준비 단계에서 이미 redaction을
// 거쳤다. request를 볼 수 있는 쪽(사람·machine·요청한 자격)만 읽고, 그 밖은 없는 request와
// 똑같이 not_found다. 참조가 없거나 바이트를 읽지 못하거나 hash가 다르면 일부만 돌려주지 않고
// unavailable이다.

import { err, ok, type Result, sha256Hex } from "../../base/mod.ts";
import type { ApiReadDefinition, Sql } from "../../protocol/server/mod.ts";
import {
  APPROVAL_BLOB_OWNER_KIND,
  APPROVAL_TEXT_FIELDS,
  APPROVAL_TEXT_MAX_BYTES,
  approvalsText,
  approvalsTextInputSchema,
} from "../../protocol/approvals/mod.ts";
import { BLOB_READ_MAX_BYTES } from "../../protocol/storage/mod.ts";
import { visible } from "./reads.ts";

export type ApprovalTextEnvironment = {
  // ledger snapshot 하나에서 판정한다. 연결은 판정을 마치면 닫는다.
  snapshot<T>(
    read: (sql: Pick<Sql, "get">, asOfSeq: string) => Result<T>,
  ): Result<T>;
  // blob store의 그 구간. 없거나 관측 hash가 다르면 err다.
  bytes(
    hash: string,
    offset: number,
    length: number,
  ): Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>>;
};

type Need = { field: string; hash: string; size: number };

const UNAVAILABLE = "approval text is not available";

function absent(): Result<never> {
  return err({ code: "not_found", message: "approval request가 없다" });
}

function unavailable(): Result<never> {
  return err({ code: "unavailable", message: UNAVAILABLE });
}

async function readText(
  environment: ApprovalTextEnvironment,
  need: Need,
): Promise<Result<string>> {
  if (need.size < 1 || need.size > APPROVAL_TEXT_MAX_BYTES) {
    return unavailable();
  }
  const whole = new Uint8Array(need.size);
  let offset = 0;
  while (offset < need.size) {
    const length = Math.min(BLOB_READ_MAX_BYTES, need.size - offset);
    const read = await environment.bytes(need.hash, offset, length);
    if (
      !read.ok || read.value.hash !== need.hash ||
      read.value.sizeBytes !== need.size ||
      read.value.bytes.length !== length
    ) return unavailable();
    whole.set(read.value.bytes, offset);
    offset += length;
  }
  if (await sha256Hex(whole) !== need.hash) return unavailable();
  try {
    return ok(new TextDecoder("utf-8", { fatal: true }).decode(whole));
  } catch {
    return unavailable();
  }
}

export function approvalsTextRead(
  environment: ApprovalTextEnvironment,
): ApiReadDefinition<typeof approvalsText> {
  return {
    route: approvalsText,
    async handle(ctx, input) {
      const parsed = approvalsTextInputSchema.safeParse(input);
      if (!parsed.success) {
        return err({ code: "invalid_input", message: "invalid read input" });
      }
      const id = parsed.data.approval;
      const found = environment.snapshot<
        { needs: Map<string, Need>; asOf: string } | undefined
      >((sql, asOfSeq) => {
        const row = sql.get(
          "select requester, reason_blob, effect, closed_reason_blob from approval_requests where id = ?",
          [id],
        );
        if (row === undefined || !visible(ctx, String(row["requester"]))) {
          return ok(undefined);
        }
        let effect: {
          changes_blob?: unknown;
          external_blob?: unknown;
          reversibility_blob?: unknown;
        };
        try {
          effect = JSON.parse(String(row["effect"]));
        } catch {
          return unavailable();
        }
        const wanted: [string, unknown][] = [
          [APPROVAL_TEXT_FIELDS.reason, row["reason_blob"]],
          [APPROVAL_TEXT_FIELDS.changes, effect.changes_blob],
          [APPROVAL_TEXT_FIELDS.external, effect.external_blob],
          [APPROVAL_TEXT_FIELDS.reversibility, effect.reversibility_blob],
          [APPROVAL_TEXT_FIELDS.closed, row["closed_reason_blob"]],
        ];
        const needs = new Map<string, Need>();
        for (const [field, hash] of wanted) {
          // 외부 영향이 없는 request는 external 글이 없고, 이유 없이 끝났거나 끝나지 않은
          // request는 종료 이유 글이 없다.
          if (
            hash === null &&
            (field === APPROVAL_TEXT_FIELDS.external ||
              field === APPROVAL_TEXT_FIELDS.closed)
          ) continue;
          if (typeof hash !== "string") return unavailable();
          const ref = sql.get(
            `select size_bytes from blob_refs
             where owner_kind = ? and owner_key = ? and field = ? and hash = ?`,
            [APPROVAL_BLOB_OWNER_KIND, id, field, hash],
          );
          const size = ref?.["size_bytes"];
          if (typeof size !== "bigint" && typeof size !== "number") {
            return unavailable();
          }
          needs.set(field, { field, hash, size: Number(size) });
        }
        return ok({ needs, asOf: asOfSeq });
      });
      if (!found.ok) return found;
      if (found.value === undefined) return absent();
      const texts = new Map<string, string>();
      // 같은 글(같은 hash)은 한 번만 읽는다.
      const byHash = new Map<string, string>();
      for (const need of found.value.needs.values()) {
        let text = byHash.get(need.hash);
        if (text === undefined) {
          const read = await readText(environment, need);
          if (!read.ok) return read;
          text = read.value;
          byHash.set(need.hash, text);
        }
        texts.set(need.field, text);
      }
      return ok({
        approval: id,
        reason: texts.get(APPROVAL_TEXT_FIELDS.reason)!,
        changes: texts.get(APPROVAL_TEXT_FIELDS.changes)!,
        external: texts.get(APPROVAL_TEXT_FIELDS.external) ?? null,
        reversibility: texts.get(APPROVAL_TEXT_FIELDS.reversibility)!,
        closed_reason: texts.get(APPROVAL_TEXT_FIELDS.closed) ?? null,
        as_of_seq: found.value.asOf,
        next_cursor: null,
      });
    },
  };
}

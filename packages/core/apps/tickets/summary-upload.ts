// `/tickets/upload_summary` handler. 완료 보고의 summary 바이트를 core가
// 해석·hash·보관 없이 blob 준비 중계로 흘려 보낸다. 준비 주체는 요청 credential이라 이어지는
// report_completion이 같은 주체로 준비 참조를 영구 참조로 등록한다(저장 안 된 blob의 hash는
// 만들지 않는다). purpose와 상한은 ticket concern이 등록한 값(`ticketDefinitions.blobPurposes`)이고
// 호출자가 고르지 않는다.
import { err, type Result } from "../../../base/mod.ts";
import { ticketUploadSummary } from "../../../protocol/coding-agent/ticket/mod.ts";
import type { UploadHandler } from "../../server/mod.ts";
import type { BlobPrepareCall } from "../../main/daemon/core.ts";
import type { PreparedRelayResult } from "../../storage/blobs/prepare-relay.ts";
import { exactBytes } from "../../storage/blobs/exact-bytes.ts";
import { ticketDefinitions } from "./register.ts";

const SUMMARY = ticketDefinitions.blobPurposes.find((purpose) =>
  purpose.purpose === "ticket_summary"
)!;

export function ticketSummaryUploadHandler(relay: {
  current?: (call: BlobPrepareCall) => Promise<Result<PreparedRelayResult>>;
}): UploadHandler {
  return (ctx, rawInput, body) => {
    const input = ticketUploadSummary.input.safeParse(rawInput);
    if (
      !input.success || input.data.bytes > SUMMARY.max_size_bytes ||
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
      purpose: SUMMARY.purpose,
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

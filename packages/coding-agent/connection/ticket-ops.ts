// `ticket report`: summary 본문을 올려 준비 참조를 받고 그 참조로 완료 보고를 보낸다.
// completion seq는 core가 부여한다. 통로는 claim을 갱신하지 않는다: 만료·반납·취소 뒤 보고는
// core의 거절이 그대로 나온다.
import type { LophnError, Result } from "../../base/mod.ts";
import {
  ticketReportCompletion,
  ticketSummaryBlobSchema,
  ticketUploadSummary,
} from "../../protocol/coding-agent/ticket/mod.ts";
import type { CoreClient } from "./client/core.ts";
import { callRoute, uploadText } from "./call.ts";

export async function reportTicket(
  client: CoreClient,
  input: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Result<unknown, LophnError>> {
  const uploaded = await uploadText(
    client,
    ticketUploadSummary,
    String(input.summary),
  );
  if (!uploaded.ok) return uploaded;
  const blob = ticketSummaryBlobSchema.parse(uploaded.value.blob);
  return await callRoute(client, {
    route: ticketReportCompletion,
    input: {
      ticket: input.ticket,
      base_revision: input.base_revision,
      claim_seq: input.claim_seq,
      completion: {
        release: input.release,
        summary_hash: uploaded.value.hash,
        verifications: input.verifications ?? [],
      },
      summary_blob: blob,
    },
    idempotencyKey,
    prepared: [blob.preparation],
  });
}

// `problem record-fix`: summary 본문을 올려 준비 참조를 받고 그 참조로 고친 기록을 보낸다.
// hash만 싣는 기록은 core가 거절하므로 모델이 hash나 준비 증거를 만들지 않는다.
import type { LophnError, Result } from "../../base/mod.ts";
import {
  fixSummaryBlobSchema,
  problemsUploadFixSummary,
  recordProblemFix,
} from "../../protocol/problems/mod.ts";
import type { CoreClient } from "./client/core.ts";
import { callRoute, uploadText } from "./call.ts";

export async function recordFix(
  client: CoreClient,
  input: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Result<unknown, LophnError>> {
  const uploaded = await uploadText(
    client,
    problemsUploadFixSummary,
    String(input.summary),
  );
  if (!uploaded.ok) return uploaded;
  const blob = fixSummaryBlobSchema.parse(uploaded.value.blob);
  const key = idempotencyKey ?? crypto.randomUUID();
  const fix = input.fix as Record<string, unknown>;
  return await callRoute(client, {
    route: recordProblemFix,
    input: {
      problem: input.problem,
      idempotency_key: key,
      fix: { ...fix, summary: uploaded.value.hash },
      summary_blob: blob,
    },
    idempotencyKey: key,
    compare: { problem_seq: input.problem_seq },
    prepared: [blob.preparation],
  });
}

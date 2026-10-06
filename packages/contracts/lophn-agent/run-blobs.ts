import { z } from "zod";
import { ok, type Result } from "../../base/mod.ts";
import type { RequestContext, Tx } from "../platform/mod.ts";

// run·model call·tool call이 hash로 가리키는 본문의 blob 준비 용도와 크기 입력이다. hash만 싣는 기록은
// 가리키는 바이트가 저장된 blob이어야 한다: 준비한 쪽이 `*_size`를 함께 보내면 command가 같은
// transaction에서 영구 참조를 등록하고, 준비하지 않은 hash는 참조가 되지 못한다.
export const RUN_BLOB_PURPOSES = {
  run_basis: "run_basis",
  run_result: "run_result",
  model_call_input: "model_call_input",
  model_call_basis: "model_call_basis",
  model_call_output: "model_call_output",
  tool_call_input: "tool_call_input",
  tool_call_output: "tool_call_output",
} as const;

// core가 agent runtime에 주는 machine credential의 principal이다. runtime이 감독 pipe로 준비하는
// blob의 준비 주체와 같아야 StartRun·StartModelCall 같은 command가 영구 참조를 등록한다.
export const AGENT_RUNTIME_PRINCIPAL = "machine:agent-runtime";

export const blobSizeSchema = z.number().int().nonnegative().max(
  Number.MAX_SAFE_INTEGER,
);

// 준비 증거. 같은 주체·용도·hash의 살아 있는 준비가 있을 때만 등록된다(platform/blob-store).
export function preparedEvidence(
  principal: string,
  purpose: string,
  hash: string,
  size: number,
) {
  return {
    preparation: hash,
    principal,
    purpose,
    hash,
    size_bytes: size,
  };
}

// 소유 변경과 같은 transaction에서 준비한 blob의 영구 참조를 등록한다. 등록이 거절되면 호출한 command
// 전체가 거절된다(준비하지 않은 hash는 남지 않는다).
export function registerPreparedBlob(
  tx: Tx,
  ctx: RequestContext,
  blob: {
    owner_kind: string;
    owner_key: string;
    field: string;
    hash: string;
    size: number;
    purpose: string;
    seq: string;
  },
): Result<void> {
  const registered = tx.registerBlobRef({
    owner_kind: blob.owner_kind,
    owner_key: blob.owner_key,
    field: blob.field,
    registered_seq: blob.seq,
    source: {
      kind: "prepared",
      blob: preparedEvidence(ctx.principal, blob.purpose, blob.hash, blob.size),
    },
  });
  return registered.ok ? ok(undefined) : registered;
}

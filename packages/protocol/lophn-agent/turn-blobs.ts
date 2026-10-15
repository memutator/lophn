// turn·model call·tool call이 hash로 가리키는 본문의 blob 준비 용도다. 준비 증거와 등록 helper
// (`blobSizeSchema`, `registerPreparedBlob`, `AGENT_RUNTIME_PRINCIPAL`)는 `run-blobs.ts`에 있다.
export const TURN_BLOB_PURPOSES = {
  turn_basis: "turn_basis",
  turn_resolved: "turn_resolved",
  turn_result: "turn_result",
  model_call_input: "model_call_input",
  model_call_basis: "model_call_basis",
  model_call_output: "model_call_output",
  tool_call_input: "tool_call_input",
  tool_call_output: "tool_call_output",
} as const;

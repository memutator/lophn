// call 상태 읽기와 취소. 상태 구독은 없고 블록이 취소한 뒤 읽는다. 블록 자체는 ACP의 `call` tool 항목이다.
import {
  agentCallRead,
  callCancel,
} from "../../../protocol/lophn-agent/calls.ts";
import type { CallStatus, SourceResult } from "./agent-tab-source.ts";
import { dropValue, type Env } from "./agent-tab-core-source-env.ts";

export async function readCallState(
  env: Env,
  call: string,
): Promise<SourceResult<CallStatus>> {
  const read = await env.read(agentCallRead, { call });
  if (!read.ok) return read;
  const { state, fail_reason } = read.value.call;
  return { ok: true, value: { state, reason: fail_reason } };
}

/** 끝나지 않은 call을 취소한다. 끝난 call은 core가 conflict로 답한다. */
export function cancelCallOf(
  env: Env,
  call: string,
): Promise<SourceResult<void>> {
  return env
    .command(callCancel, {
      input: { call },
      compare: {},
      key: `calls-cancel-${call}`,
    })
    .then(dropValue);
}

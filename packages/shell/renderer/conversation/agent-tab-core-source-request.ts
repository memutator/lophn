// agent의 입력 요청 card가 읽고 접는 route. 보호 창을 여는 것은 card의 [Enter]가 shell main에 보내는 IPC다.
import {
  inputRequestCancel,
  inputRequestRead,
} from "../../../protocol/lophn-agent/input-request.ts";
import { dropValue, type Env } from "./agent-tab-core-source-env.ts";
import type { InputRequestView } from "../../../protocol/lophn-agent/input-request.ts";
import type { SourceResult } from "./agent-tab-source.ts";

export function readInputRequest(
  env: Env,
  input: { session: string; toolCall: string },
): Promise<SourceResult<InputRequestView>> {
  return env.read(inputRequestRead, {
    session: input.session,
    tool_call: input.toolCall,
  });
}

export async function cancelInputRequest(
  env: Env,
  input: { session: string; toolCall: string },
): Promise<SourceResult<void>> {
  return dropValue(
    await env.read(inputRequestCancel, {
      session: input.session,
      tool_call: input.toolCall,
    }),
  );
}

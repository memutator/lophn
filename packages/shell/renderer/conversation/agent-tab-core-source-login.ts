// agent의 login 요청 card가 읽고 접는 route. 보호 창을 여는 것은 card의 [Enter]가 shell main에 보내는 IPC다.
import {
  loginRequestCancel,
  loginRequestRead,
} from "../../../protocol/lophn-agent/login-request.ts";
import { dropValue, type Env } from "./agent-tab-core-source-env.ts";
import type { LoginRequestView } from "../../../protocol/lophn-agent/login-request.ts";
import type { SourceResult } from "./agent-tab-source.ts";

export function readLoginRequest(
  env: Env,
  input: { session: string; toolCall: string },
): Promise<SourceResult<LoginRequestView>> {
  return env.read(loginRequestRead, {
    session: input.session,
    tool_call: input.toolCall,
  });
}

export async function cancelLoginRequest(
  env: Env,
  input: { session: string; toolCall: string },
): Promise<SourceResult<void>> {
  return dropValue(
    await env.read(loginRequestCancel, {
      session: input.session,
      tool_call: input.toolCall,
    }),
  );
}

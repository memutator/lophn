// coding agent 연결 회수. 연결의 현재 판을 `ShowCodingAgentConnection`으로 독립해 읽어 정본을 만든다.
// handle은 연결과 base_revision에 묶이므로 다른 연결·낡은 판은 core가 거절한다.
import {
  bindingOf,
  type DecisionCore,
  failed,
  type Read,
  readFailure,
  record,
  text,
} from "./core.ts";

export const CONNECTION_CONCERN = "coding-agent/connection";
export const CONNECTION_REVOKE = "coding_agent_connection_revoke";
/** `RevokeCodingAgentConnection`의 route 이름. */
export const REVOKE_CONNECTION = "RevokeCodingAgentConnection";

/** `RevokeCodingAgentConnection`의 binding. 첫 field가 대상이다. */
const BINDING = ["connection", "base_revision"] as const;

export async function readConnectionRevoke(
  core: DecisionCore,
  request: { targets?: string[] },
): Promise<Read> {
  const connection = request.targets?.[0];
  if (connection === undefined || request.targets?.length !== 1) {
    return failed("invalid_input", "연결 하나를 가리켜야 한다");
  }
  const got = await core.internal("read", "coding_agent_connections", "show", {
    connection,
  });
  if (!got.ok) return readFailure(got);
  const shown = record(record(got.value).connection);
  const revision = text(shown.revision);
  if (shown.id !== connection || revision === null) {
    return failed("not_found", "이 연결을 찾지 못했다");
  }
  const bound = bindingOf(BINDING, { connection, base_revision: revision });
  return {
    ok: true,
    value: {
      targetRef: bound.target,
      content: bound.content,
      // 이미 회수된 연결에는 고를 결정이 없다.
      allowed: shown.state === "revoked" ? [] : [REVOKE_CONNECTION],
      expiresAt: null,
    },
  };
}

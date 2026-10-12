// coding agent 연결 회수. CLI는 창을 열지 않고 결정 화면 링크만
// 낸다. 사람이 연결 화면에서 [Revoke]를 누르면 이 종류가 연결의 현재 판을 `ShowCodingAgentConnection`으로
// 독립해 다시 읽어 정본을 만든다. 표시와 제출은 같은 정본(연결·base_revision)에 묶이고 renderer가 보낸 값은
// 쓰지 않는다. 다른 연결·낡은 판·닫힌 창의 handle은 core가 거절한다. 회수는 결정 자체가 적용이다.
import { type LiveHandle } from "../handle.ts";
import {
  bindingOf,
  failed,
  type KindCore,
  type Read,
  readFailure,
  record,
  sendCommand,
  type Sent,
  text,
} from "./core.ts";

/** contracts CODING_AGENT_CONNECTION_REVOKE(= decision 이름). */
export const CONNECTION_REVOKE = "coding_agent_connection_revoke";
export const CONNECTION_CONCERN = "coding-agent/connection";

/** `RevokeCodingAgentConnection`의 binding. 첫 field가 대상이다. */
const BINDING = ["connection", "base_revision"] as const;

export async function readConnectionRevoke(
  core: KindCore,
  connection: string,
): Promise<Read> {
  const got = await core.internal("read", "coding_agent_connections", "show", {
    connection,
  });
  if (!got.ok) return readFailure(got);
  const shown = record(record(got.value).connection);
  const revision = text(shown.revision);
  const label = text(shown.label);
  if (shown.id !== connection || revision === null || label === null) {
    return failed("not_found", "이 연결을 찾지 못했다");
  }
  const scope = record(shown.scope);
  const appId = text(scope.app);
  let appName: string | null = null;
  if (appId !== null) {
    const app = await core.internal("read", "apps", "get", { app: appId });
    // 이름은 식별 보조다. 못 읽어도 결정 표시는 막지 않고 정확한 ID가 따로 보인다.
    if (app.ok) appName = text(record(record(app.value).app).name);
  }
  const revoked = shown.state === "revoked";
  const bound = bindingOf(BINDING, {
    connection,
    base_revision: revision,
  });
  return {
    ok: true,
    value: {
      targetRef: bound.target,
      content: bound.content,
      // 이미 회수된 연결에는 고를 결정이 없다.
      allowed: revoked ? [] : [CONNECTION_REVOKE],
      expiresAt: null,
      secondConfirm: false,
      request: {
        kind: "owner_decision",
        concern: CONNECTION_CONCERN,
        decision: CONNECTION_REVOKE,
        targets: [connection],
        input: { kind: "inline", value: bound.content },
        comparison: { base_revision: revision },
      },
      view: {
        kind: "connection_revoke",
        label,
        scope: scope.kind === "app" ? "app" : "all",
        app: appId,
        app_name: appName,
        connection,
        revoked,
      },
    },
  };
}

/** 회수는 결정 자체가 적용이다. 응답 직후 그 credential의 모든 새 요청을 core가 거절한다. */
export async function submitConnectionRevoke(
  core: KindCore,
  input: {
    handle: LiveHandle;
    content: Record<string, unknown>;
  },
): Promise<Sent> {
  const connection = String(input.content.connection);
  const revision = String(input.content.base_revision);
  const sent = await sendCommand(core, "coding_agent_connections", "revoke", {
    input: { connection, base_revision: revision },
    idempotency_key: `confirmation:${input.handle.ref}`,
    compare: { base_revision: revision },
    prepared: [],
    confirmation: input.handle.ref,
  });
  if (!sent.ok) return sent;
  return {
    ok: true,
    value: {
      receipt: { kind: "entity", id: connection },
      result: "applied",
    },
  };
}

import { ok, type Result } from "../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import {
  secretSendRequestSchema,
  type SecretSendResponse,
} from "../../../protocol/supervision/mod.ts";
import type {
  SecretAttachPort,
  SecretFileUse,
  SecretValue,
} from "../../../protocol/secrets/mod.ts";
import type { KnownSecretMatch } from "../../storage/ledger/mod.ts";
import { SECRET_SEND } from "../../secrets/mod.ts";

// agent runtime의 secret 전송 부착 요청(감독 pipe `secret_send_request`)을 core가 답한다. 요청은 `secrets.json`의
// 이름과 목적지를 싣고, core의 `attach`가 machine 자격·process 생존·이름 공간의 목적지를 대조한다. 통과했을 때만
// 읽은 값을 응답 하나로 child의 전송 callback에 준다. 값은 ledger·event·log·오류에 남지 않는다. 대조에 실패하거나
// 값을 읽을 수 없으면 값 없는 오류이고 child는 요청을 보내지 않는다(fail-closed).
//
// 값을 core의 알려진 값 registry가 전부 알고 있을 때만 준다. 알려진 값은 core의 안전화
// (`redact_request`)가 model로 갈 글과 저장할 글에서 지우는 근거라서, 모르는 값이 child로 가면 그 값이
// 어딘가에 섞여도 지울 수 없다.

export type AgentRuntimeSecrets = {
  // 부른 시점에 감독 중인 child가 같은 generation인지. 끝났으면 답하지 않는다.
  answer(
    message: unknown,
    alive: () => boolean,
  ): Promise<SecretSendResponse | undefined>;
};

export function createAgentRuntimeSecrets(deps: {
  attach: SecretAttachPort;
  known: () => KnownSecretMatch | undefined;
  // child kind·task. machine 자격을 만드는 근거이고 child가 정하지 못한다.
  process: string;
  task: string;
  // MCP OAuth 접근 token이면 보내기 전에 서버 설정과 대조하고 만료가 가까우면 갱신한다. OAuth token 이름이
  // 아니면 undefined다.
  mcpOAuth?: (use: SecretFileUse) => Promise<Result<void> | undefined>;
}): AgentRuntimeSecrets {
  const context: AuthenticatedContext = {
    principal: "machine:agent-runtime-secret",
    actor: "machine",
    scope: {
      operations: [SECRET_SEND],
      targets: { process: deps.process, task: deps.task },
    },
    conditions: { process: deps.process, task: deps.task },
    credential_ref: "machine:agent-runtime-secret",
  };

  return {
    async answer(message, alive) {
      const parsed = secretSendRequestSchema.safeParse(message);
      if (!parsed.success) return undefined;
      const request = parsed.data;
      const failed = (
        error: { code: string; message: string },
      ): SecretSendResponse => ({
        type: "secret_send_response",
        request_id: request.request_id,
        ok: false,
        error: {
          code: error.code === "forbidden" || error.code === "conflict" ||
              error.code === "invalid_input"
            ? error.code
            : "unavailable",
          message: error.message.slice(0, 200),
        },
      });

      // 같은 generation의 child만 받는다.
      if (!alive()) {
        return failed({
          code: "forbidden",
          message: "secret 전송을 허용하지 않는다",
        });
      }
      const prepared = await deps.mcpOAuth?.(request.use);
      if (prepared !== undefined && !prepared.ok) return failed(prepared.error);
      let value: SecretValue | undefined;
      const sent = await deps.attach.send(
        {
          context,
          use: request.use,
          operation: request.operation,
          body: { url: request.url, method: request.method },
        },
        (loaded) => {
          value = loaded;
          return Promise.resolve(ok({ sent: true }));
        },
      );
      if (!sent.ok) return failed(sent.error);
      const text = typeof value === "string"
        ? value
        : value === undefined
        ? ""
        : new TextDecoder().decode(value);
      value = undefined;
      if (text === "" || !wholly(deps.known(), text)) {
        return failed({
          code: "unavailable",
          message: "credential is not registered as a known value",
        });
      }
      return {
        type: "secret_send_response",
        request_id: request.request_id,
        ok: true,
        value: text,
      };
    },
  };
}

// 알려진 값 registry가 이 값 전체를 알고 있는가.
function wholly(known: KnownSecretMatch | undefined, text: string): boolean {
  if (known === undefined || !known.ready) return false;
  const found = known.match(text);
  return found !== undefined && found.index === 0 &&
    found.length === text.length;
}

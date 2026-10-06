import { err, ok } from "../../packages/base/mod.ts";
import {
  type AuthenticatedContext,
  secretSendRequestSchema,
  type SecretSendResponse,
  type SecretValue,
} from "../../packages/contracts/platform/mod.ts";
import { lookupProviderSecretUse } from "../../packages/lophn-agent/harness/provider/mod.ts";
import {
  type KnownSecretMatch,
  openConnection,
} from "../../packages/platform/ledger/mod.ts";
import {
  createSecretAttach,
  type KeychainAdapter,
  SECRET_SEND,
} from "../../packages/platform/secrets/mod.ts";

// agent runtime의 secret 전송 부착 요청(감독 pipe `secret_send_request`)을 core가 답한다
// (lophn-agent/harness/provider#R7, platform/secrets#R5). platform의 `createSecretAttach`가 machine
// 자격·process 생존·현재 참조와 판·용도·고정 목적지를 대조하고, 통과했을 때만 keychain에서 읽은 값을
// 응답 하나로 child의 전송 callback에 준다. 값은 ledger·event·log·오류에 남지 않는다. 대조에 실패하거나
// keychain을 읽을 수 없으면 값 없는 오류이고 child는 요청을 보내지 않는다(fail-closed).
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
  ledgerPath: string;
  keychain: () => KeychainAdapter;
  known: () => KnownSecretMatch | undefined;
  // child kind·task. machine 자격을 만드는 근거이고 child가 정하지 못한다.
  process: string;
  task: string;
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

      let value: SecretValue | undefined;
      const sent = await createSecretAttach({
        keychain: deps.keychain(),
        references: {
          current(use) {
            const opened = openConnection(deps.ledgerPath);
            if (!opened.ok) return Promise.resolve(opened);
            try {
              return Promise.resolve(
                lookupProviderSecretUse(opened.value.sql, use),
              );
            } finally {
              opened.value.close();
            }
          },
        },
        // provider credential은 apps의 grant가 아니라 provider 참조의 현재 상태로 허용한다(조회가 판정).
        allowance: (allowed) =>
          allowed.purpose === "provider_credential" ? ok(undefined) : err({
            code: "forbidden",
            message: "secret 전송을 허용하지 않는다",
          }),
        processes: alive,
      }).send(
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

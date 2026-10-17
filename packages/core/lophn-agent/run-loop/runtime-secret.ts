import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  AuthenticatedContext,
  Sql,
} from "../../../protocol/server/mod.ts";
import {
  secretSendRequestSchema,
  type SecretSendResponse,
} from "../../../protocol/supervision/mod.ts";
import type {
  SecretAttachPort,
  SecretUse,
  SecretValue,
} from "../../../protocol/secrets/mod.ts";
import { lookupMcpSecretUse } from "../extensions/mod.ts";
import {
  type KnownSecretMatch,
  openConnection,
} from "../../storage/ledger/mod.ts";
import {
  createSecretAttach,
  type KeychainAdapter,
  SECRET_SEND,
} from "../../secrets/mod.ts";
import type { McpTokenUse } from "../extensions/mcp-auth-control.ts";

// agent runtime의 secret 전송 부착 요청(감독 pipe `secret_send_request`)을 core가 답한다
// provider는 이름(`use.name`)을 싣고 `fileAttach`(secrets.json)가, MCP는 옛 참조를 싣고 platform의
// `createSecretAttach`(keychain)가 machine 자격·process 생존·고정 목적지를 대조한다. 통과했을 때만
// 읽은 값을 응답 하나로 child의 전송 callback에 준다. 값은 ledger·event·log·오류에 남지 않는다. 대조에 실패하거나
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
  // provider API key. secrets.json에서 이름으로 읽고 목적지는 그 이름의 provider endpoint다.
  fileAttach: SecretAttachPort;
  known: () => KnownSecretMatch | undefined;
  // child kind·task. machine 자격을 만드는 근거이고 child가 정하지 못한다.
  process: string;
  task: string;
  // MCP OAuth token의 대조다. OAuth token 참조가 아니면 undefined를 돌려 아래 설정 대조가 맡는다.
  // 만료가 가까우면 여기서 갱신한 뒤 현재 접근 token의 참조를 준다.
  mcpOAuth?: (use: SecretUse) => Promise<Result<McpTokenUse> | undefined>;
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

      const lookupCurrent = <T>(
        read: (sql: Pick<Sql, "all">) => Result<T>,
      ): Result<T> => {
        const opened = openConnection(deps.ledgerPath);
        if (!opened.ok) return opened;
        try {
          return read(opened.value.sql);
        } finally {
          opened.value.close();
        }
      };

      let value: SecretValue | undefined;
      const take = (loaded: SecretValue) => {
        value = loaded;
        return Promise.resolve(ok({ sent: true }));
      };
      const body = { url: request.url, method: request.method };
      let sent: Result<{ sent: boolean }>;
      if ("name" in request.use) {
        // 같은 generation의 child만 받는다. 목적지는 attach가 그 이름의 provider endpoint와 대조한다.
        if (!alive()) {
          return failed({
            code: "forbidden",
            message: "secret 전송을 허용하지 않는다",
          });
        }
        sent = await deps.fileAttach.send(
          { context, use: request.use, operation: request.operation, body },
          take,
        );
      } else {
        // MCP 인증 비밀은 설정의 이름(`sec:...`)으로 청해 오므로 현재 참조·판을 채워 대조한다.
        let use: SecretUse = request.use;
        let mcp: ReturnType<typeof lookupMcpSecretUse> | undefined;
        if (use.purpose === "external_mcp_credential") {
          const requested = use;
          const looked = (await deps.mcpOAuth?.(requested)) ??
            lookupCurrent((sql) => lookupMcpSecretUse(sql, requested));
          if (!looked.ok) return failed(looked.error);
          mcp = looked;
          use = {
            ...use,
            sealed_ref: looked.value.sealedRef,
            revision: looked.value.revision,
          };
        }
        sent = await createSecretAttach({
          keychain: deps.keychain(),
          references: {
            current() {
              return Promise.resolve(
                mcp ?? err({
                  code: "forbidden" as const,
                  message: "secret 전송을 허용하지 않는다",
                }),
              );
            },
          },
          // MCP credential은 apps의 grant가 아니라 그 참조의 현재 상태로 허용한다(조회가 판정).
          allowance: (allowed) =>
            allowed.purpose === "external_mcp_credential"
              ? ok(undefined)
              : err({
                code: "forbidden",
                message: "secret 전송을 허용하지 않는다",
              }),
          processes: alive,
        }).send({ context, use, operation: request.operation, body }, take);
      }
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

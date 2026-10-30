// OAuth 로그인 command의 HTTP 요청을 core가 답한다.
// 사람의 요청만 이 route에 닿는다(route actors가 user). ledger이 아니라 writer queue
// 앞의 처리기로 돈다: 발급자 network(token 교환·JWKS·device poll)와 callback listener가
// ledger transaction 안에 있을 수 없다.
// 로그인은 provider가 등록되기 전에 시작한다. complete가 token을 받으면 이 처리기가 token 셋을
// `secrets.json`에 쓰고 사람의 context 그대로 ConnectProvider를 부른다. token은 renderer를 지나지 않는다.
// login 세션(state·nonce·verifier·device_code)은 oauth.ts의 메모리에만 있고 ledger·event·log에는 남지 않는다.

import { err, ok, type Result } from "../../../base/mod.ts";
import type { RandomSource } from "../../../base/mod.ts";
import {
  connectProvider,
  loginBegin,
  loginBeginInputSchema,
  loginBeginOutputSchema,
  loginCancel,
  loginCancelInputSchema,
  loginComplete,
  loginCompleteInputSchema,
  loginCompleteOutputSchema,
  type ProviderDefinition,
  type ProviderRecord,
  recordProviderModels,
} from "../../../protocol/lophn-agent/mod.ts";
import type { SecretStorePort } from "../../../protocol/secrets/secret-file.ts";
import type { CallbackListener, CallbackOptions } from "../extensions/mod.ts";
import { readAccountModels, readsAccountModels } from "./reported-models.ts";
import { createProviderOAuth } from "./oauth.ts";
import type { IssuerFetch } from "./issuer-http.ts";
import {
  providerSecretName,
  removeProviderTokens,
  saveProviderTokens,
} from "./oauth-secrets.ts";
import type { CommandSuccess, Writer } from "../../storage/ledger/mod.ts";

type Target = {
  name: string;
  definition: ProviderDefinition;
  endpoint: string;
  protocol: string;
};

export type ProviderLoginDeps = {
  http: IssuerFetch;
  openListener(options?: CallbackOptions): Promise<Result<CallbackListener>>;
  secrets: Pick<SecretStorePort, "get" | "put" | "delete">;
  newKey(): string;
  nowMs(): number;
  random: RandomSource;
  // 계정 준비(onboarding)를 다시 볼 때까지 쉰다. test가 바로 돌아오게 한다.
  wait?: (ms: number) => Promise<void>;
};

// writer queue 앞의 처리기. login 세 command만 가로채고 나머지 command와 Writer
// 동작은 그대로다. endAll은 core가 멈출 때 열린 listener를 닫는다.
export function withProviderLogin(
  writer: Writer,
  deps: ProviderLoginDeps,
): Writer & { endAll(): Promise<void> } {
  const login = createProviderOAuth<Target>({
    http: deps.http,
    openListener: deps.openListener,
    nowMs: deps.nowMs,
    random: deps.random,
    ...(deps.wait === undefined ? {} : { wait: deps.wait }),
  });
  const at = (ms: number) => new Date(ms).toISOString();

  async function begin(input: unknown): Promise<Result<unknown>> {
    const parsed = loginBeginInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "login begin input is wrong",
      });
    }
    const { provider, definition, ...target } = parsed.data;
    const begun = await login.begin(provider, definition.oauth!, {
      ...target,
      definition,
    });
    if (!begun.ok) return begun;
    return ok(
      loginBeginOutputSchema.parse({
        login: begun.value.login,
        flow: begun.value.flow,
        interval_ms: begun.value.interval_ms,
        expires_at: at(begun.value.expires_at_ms),
        sign_in: begun.value.sign_in,
      }),
    );
  }

  async function complete(
    ctx: Parameters<Writer["command"]>[0],
    input: unknown,
  ): Promise<Result<unknown>> {
    const parsed = loginCompleteInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "login complete input is wrong",
      });
    }
    const { provider } = parsed.data;
    const step = await login.complete(provider, parsed.data.login);
    if (!step.ok) return step;
    if (step.value.state === "pending") return ok(step.value);
    const { tokens, target } = step.value;
    const saved = await saveProviderTokens(deps.secrets, provider, tokens);
    if (!saved.ok) return saved;
    const connected = await writer.command(ctx, {
      command: connectProvider.name,
      input: {
        id: provider,
        ...target,
        auth_kind: "oauth",
        credential: { secret: providerSecretName(provider) },
        expires_at: at(tokens.expires_at_ms),
        ...(tokens.account === null ? {} : { account: tokens.account }),
      },
      idempotency_key: deps.newKey(),
      compare: {},
      prepared: [],
    });
    if (!connected.ok) {
      // conflict는 같은 id의 provider가 이미 있다는 뜻이다. 그 이름은 그 provider의 token이라 지우지 않는다.
      if (connected.error.code !== "conflict") {
        await removeProviderTokens(deps.secrets, provider);
      }
      return connected;
    }
    const record = (connected.value.result as { provider: unknown }).provider;
    // 계정 model 목록은 로그인 결과를 기다리게 하지 않고 뒤에서 읽는다. 실패하면 token을 처음 건넬 때(prepareToken) 다시 읽는다.
    const source = { ...target, account: tokens.account };
    if (readsAccountModels(source)) {
      void readAccountModels(deps.http, source, tokens.access)
        .then((models) =>
          models === null
            ? undefined
            : writer.command(ctx, {
                command: recordProviderModels.name,
                input: { provider, models },
                idempotency_key: deps.newKey(),
                compare: { revision: (record as ProviderRecord).revision },
                prepared: [],
              }),
        )
        .catch(() => {});
    }
    return ok(
      loginCompleteOutputSchema.parse({ state: "connected", provider: record }),
    );
  }

  async function cancel(input: unknown): Promise<Result<unknown>> {
    const parsed = loginCancelInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "login cancel input is wrong",
      });
    }
    const cancelled = await login.cancel(
      parsed.data.provider,
      parsed.data.login,
    );
    if (!cancelled.ok) return cancelled;
    return ok({ cancelled: true });
  }

  return {
    ...writer,
    async command(ctx, envelope): Promise<Result<CommandSuccess>> {
      if (envelope.command === loginBegin.name) {
        return wrapped(await begin(envelope.input));
      }
      if (envelope.command === loginComplete.name) {
        return wrapped(await complete(ctx, envelope.input));
      }
      if (envelope.command === loginCancel.name) {
        return wrapped(await cancel(envelope.input));
      }
      return await writer.command(ctx, envelope);
    },
    endAll: () => login.endAll(),
  };
}

function wrapped(result: Result<unknown>): Result<CommandSuccess> {
  return result.ok
    ? ok({
        result: result.value,
        replayed: false,
        first_seq: null,
        last_seq: null,
      })
    : result;
}

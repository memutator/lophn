// OAuth 로그인 command(provider#R1, R12–R16, D31)의 HTTP 요청을 core가 답한다.
// 사람의 요청만 이 route에 닿는다(route actors가 user). ledger이 아니라 writer queue
// 앞의 처리기로 돈다: OAuth network(등록·token 교환·device poll)와 callback listener가
// 기다리므로 ledger transaction 안에 있을 수 없다.
// Connect가 credential까지 받는 RegisterProvider 하나라 로그인은 provider가 등록되기 전에 시작한다:
// begin은 만들 provider의 ID와 내장 정의 key를 받고 정의는 내장 목록에서 찾는다(provider#R12).
// login 세션(state·nonce·verifier·device_code)은 이 처리기의 메모리에만 있고
// ledger·event·log에는 남지 않는다(R6, R7). 활성 gate(D31)는 verified_for_lophn과
// live 확인 env(LOPHN_LIVE_PROVIDER=1) 둘이 모두 열려 있을 때만 통과한다.

import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  loginBeginInputSchema,
  loginBeginOutputSchema,
  loginCancelInputSchema,
  loginCompleteInputSchema,
} from "../../packages/protocol/lophn-agent/mod.ts";
import {
  builtinProviderDefinition,
  createProviderOAuth,
  type OAuthBegin,
} from "../../packages/lophn-agent/harness/provider/mod.ts";
import type {
  OAuthListener,
} from "../../packages/lophn-agent/harness/provider/mod.ts";
import {
  openCallbackListener,
} from "../../packages/lophn-agent/harness/provider/mod.ts";
import type {
  CommandSuccess,
  Writer,
} from "../../packages/platform/ledger/mod.ts";

export const PROVIDER_LOGIN_LIVE_ENV = "LOPHN_LIVE_PROVIDER";

// D31 활성 gate다. 사람이 LOPHN_LIVE_PROVIDER=1로 실제 계정 확인을 시작했을 때만
// 열린다. 테스트가 이 판정을 대신 준다.
function liveGateOf(env = Deno.env.get(PROVIDER_LOGIN_LIVE_ENV)): boolean {
  return env === "1";
}

export type ProviderLoginWriterDeps = {
  // 테스트가 D31 활성 gate와 OAuth HTTP를 대신 준다. 없으면 제품 env 판정과
  // 실제 network(비활성)다.
  liveGate?: () => boolean;
  http?: (url: string, init: RequestInit) => Promise<Response>;
  nowMs?: () => number;
};

// writer queue 앞의 처리기. login 세 command만 가로채고 나머지 command와 Writer
// 동작은 그대로다.
export function withProviderLogin(
  writer: Writer,
  deps: ProviderLoginWriterDeps = {},
): Writer {
  const gate = deps.liveGate ?? liveGateOf;
  const login = createProviderOAuth({
    liveGate: gate,
    nowMs: deps.nowMs ?? Date.now,
    at: (ms) => new Date(ms).toISOString(),
    ...(deps.http === undefined ? {} : { http: deps.http }),
  });
  return {
    ...writer,
    async command(
      ctx,
      envelope,
    ): Promise<Result<CommandSuccess>> {
      if (envelope.command === "BeginProviderLogin") {
        return await loginResult(beginCommand(login, envelope.input));
      }
      if (envelope.command === "CompleteProviderLogin") {
        return await loginResult(completeCommand(login, envelope.input));
      }
      if (envelope.command === "CancelProviderLogin") {
        return await loginResult(cancelCommand(login, envelope.input));
      }
      return await writer.command(ctx, envelope);
    },
  };
}

function loginResult(
  handled: Promise<Result<unknown>>,
): Promise<Result<CommandSuccess>> {
  return handled.then((result) =>
    result.ok
      ? ok({
        result: result.value,
        replayed: false,
        first_seq: null,
        last_seq: null,
        wake: false,
      })
      : result
  );
}

async function beginCommand(
  login: ReturnType<typeof createProviderOAuth>,
  input: unknown,
): Promise<Result<unknown>> {
  const parsed = loginBeginInputSchema.safeParse(input);
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message: "login begin input is wrong",
    });
  }
  const definition = builtinProviderDefinition(parsed.data.definition);
  if (!definition.ok) return definition;
  const begun = await login.begin(parsed.data.provider, definition.value);
  if (!begun.ok) return begun;
  return ok(parseBeginOutput(begun.value));
}

function parseBeginOutput(begun: OAuthBegin): unknown {
  const parsed = loginBeginOutputSchema.safeParse({
    login: begun.login,
    flow: begun.flow,
    interval_ms: begun.interval_ms,
    expires_at: begun.expires_at,
    ...(begun.sign_in === null ? {} : { sign_in: begun.sign_in }),
  });
  if (!parsed.success) {
    return {
      login: begun.login,
      flow: begun.flow,
      interval_ms: begun.interval_ms,
      expires_at: begun.expires_at,
    };
  }
  return parsed.data;
}

async function completeCommand(
  login: ReturnType<typeof createProviderOAuth>,
  input: unknown,
): Promise<Result<unknown>> {
  const parsed = loginCompleteInputSchema.safeParse(input);
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message: "login complete input is wrong",
    });
  }
  const bundle = await login.complete(
    parsed.data.provider,
    parsed.data.login,
    parsed.data.submission,
  );
  if (!bundle.ok) return bundle;
  return ok({ completed: true });
}

async function cancelCommand(
  login: ReturnType<typeof createProviderOAuth>,
  input: unknown,
): Promise<Result<unknown>> {
  const parsed = loginCancelInputSchema.safeParse(input);
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message: "login cancel input is wrong",
    });
  }
  const cancelled = await login.cancel(parsed.data.provider, parsed.data.login);
  if (!cancelled.ok) return cancelled;
  return ok({ cancelled: true });
}

// loopback callback listener의 제품 open port다(127.0.0.1 실제 listener, R12).
export const providerLoginListenerOpener = (): Promise<Result<OAuthListener>> =>
  openCallbackListener();

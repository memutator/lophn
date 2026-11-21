// 구독 로그인과 provider 연결의 secret 값을 core가 다룬다. ledger이 아니라 writer queue 앞의 처리기로 돈다: 발급자
// network(token 교환·JWKS·device poll)와 callback listener가 ledger transaction 안에 있을 수 없다.
// 로그인은 provider가 등록되기 전에 시작한다(`providers/sign-in`). 시작한 뒤 발급자를 기다리는 것도 core다: 정한 간격마다
// 한 번 보고, token을 받으면 시작한 사람의 context 그대로 ConnectProvider를 부르고, 연결이 성공한 뒤에만 token 셋을
// `secrets.json`에 쓴다. 화면은 상태(`providers/sign-in-state`)만 읽는다. token은 화면을 지나지 않는다.
// login 세션(state·nonce·verifier·device_code)은 oauth.ts의 메모리에만 있고 ledger·event·log에는 남지 않는다.
//
// 같은 까닭으로 Connect·Disconnect의 secret 값도 여기서 다룬다. `provider.<id>`는 연결된 provider의 값 자리라서
// 연결이 성공하기 전에는 쓰지 않는다: 같은 id가 이미 이어져 있으면 Connect는 conflict로 끝나는데 그때 값이 이미
// 덮였으면 쓰던 provider의 key·token이 바뀐다. Disconnect는 commit 뒤 그 provider의 값을 지운다.

import { err, ok, type Result } from "../../../base/mod.ts";
import type { RandomSource } from "../../../base/mod.ts";
import {
  addProviderCredential,
  addProviderCredentialInputSchema,
  connectProvider,
  connectProviderInputSchema,
  disconnectProvider,
  disconnectProviderInputSchema,
  type InputRequestResult,
  type InputRequestView,
  loginCancel,
  loginCancelInputSchema,
  oauthFlowOf,
  type ProviderRecord,
  providerSignIn,
  providerSignInState,
  type ProviderSignInState,
  recordProviderModels,
  removeProviderCredential,
  removeProviderCredentialInputSchema,
  providerSignInCallbackInputSchema,
  providerSignInOutputSchema,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { SecretStorePort } from "../../../protocol/secrets/secret-file.ts";
import type { CallbackListener, CallbackOptions } from "../extensions/mod.ts";
import { readProviderModels, readsModels } from "./reported-models.ts";
import { createProviderOAuth } from "./oauth.ts";
import type { IssuerFetch } from "./issuer-http.ts";
import {
  defaultCredentialId,
  isStagedProviderSecret,
  providerSecretName,
  removeProviderTokens,
  saveProviderTokens,
} from "./oauth-secrets.ts";
import type { CommandSuccess, Writer } from "../../storage/ledger/mod.ts";
import {
  providerTargetOf,
  type ConnectTarget,
  type ConnectWay,
} from "./connect-key.ts";
import type { z } from "zod";

// complete가 발급자에 닿지 못해 연달아 실패해도 다시 보는 횟수다.
const COMPLETE_MISSES = 3;
// agent에게 주는 고정 문장이다. 발급자나 core 오류 원문은 싣지 않는다.
const NOT_FINISHED = "The sign-in did not finish.";

type SignInOutput = z.output<typeof providerSignInOutputSchema>;

// 로그인 하나. key는 정의 key다. request는 agent의 sign_in 요청으로 시작했을 때의 그 요청이다.
// adding이 true면 이미 연결된 provider에 계정을 추가하는 로그인이다.
type Login = {
  key: string;
  adding: boolean;
  state: ProviderSignInState;
  request: { session: string; tool_call: string } | null;
};

export type ProviderLoginDeps = {
  http: IssuerFetch;
  openListener(options?: CallbackOptions): Promise<Result<CallbackListener>>;
  secrets: Pick<SecretStorePort, "get" | "put" | "delete">;
  newKey(): string;
  newCredentialId?: () => string;
  nowMs(): number;
  random: RandomSource;
  // 계정 준비(onboarding)와 로그인의 다음 확인까지 쉰다. test가 바로 돌아오게 한다.
  wait?: (ms: number) => Promise<void>;
  // 정의 key의 연결 대상(connect-key.ts). 모르는 key는 not_found다.
  target(key: string, way: ConnectWay): Result<ConnectTarget>;
  // 이을 id(connect-key.ts). 이미 이어진 정의면 conflict다.
  freshId(
    who: AuthenticatedContext,
    key: string,
    given?: string,
  ): Promise<Result<string>>;
  // agent의 입력 요청 대기(questionWaits). sign_in 요청은 core의 로그인이 끝낸다.
  requests: {
    readRequest(session: string, toolCall: string): Result<InputRequestView>;
    finishRequest(
      session: string,
      toolCall: string,
      result: Result<InputRequestResult>,
    ): Result<void>;
  };
  // 로그인 상태가 바뀌었다(`StateChanged{providers, <provider>}`).
  changed(provider: string): void;
  // 기기 principal이 지금 터미널 입력 허락을 가졌는가(기기의 call이 보는 것과 같은 허락).
  granted(principal: string): boolean;
  // Disconnect 직전에 provider의 정의 key를 읽어 id 재사용 표에 남긴다.
  readProvider?: (
    who: AuthenticatedContext,
    provider: string,
  ) => Promise<Result<ProviderRecord | null>>;
  rememberId?: (key: string, id: string) => void;
};

// writer queue 앞의 처리기. 로그인 취소와 Connect·Disconnect만 가로채고 나머지 command와 Writer 동작은 그대로다.
// signIn·signInState는 `providers/sign-in`·`sign-in-state` handler다. endAll은 core가 멈출 때 기다림과 열린 listener를 닫는다.
export function withProviderLogin(
  writer: Writer,
  deps: ProviderLoginDeps,
): Writer & {
  endAll(): Promise<void>;
  signIn(who: AuthenticatedContext, input: unknown): Promise<Result<unknown>>;
  signInState(input: unknown): Result<unknown>;
  signInCallback(input: unknown): Result<unknown>;
} {
  const login = createProviderOAuth<ConnectTarget>({
    http: deps.http,
    openListener: deps.openListener,
    nowMs: deps.nowMs,
    random: deps.random,
    ...(deps.wait === undefined ? {} : { wait: deps.wait }),
  });
  const at = (ms: number) => new Date(ms).toISOString();

  const wait =
    deps.wait ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const logins = new Map<string, Login>();

  // 한 번 본다. 아직이면 pending과 다음 간격을, token을 받았으면 잇고 저장한 뒤 connected를 낸다.
  async function complete(
    ctx: AuthenticatedContext,
    provider: string,
    id: string,
    adding: boolean,
  ): Promise<
    Result<{ state: "pending"; interval_ms: number } | { state: "connected" }>
  > {
    const step = await login.complete(provider, id);
    if (!step.ok) return step;
    if (step.value.state === "pending") return ok(step.value);
    const { tokens, target } = step.value;
    // 기기가 시작한 로그인은 잇기 직전에 허락을 다시 본다. writer는 기기 자격의 scope만 보므로, 기다리는 사이 사람이 그 기기의
    // 터미널 입력 허락을 껐으면 여기서 막는다. 받은 token은 버린다(아직 어디에도 쓰지 않았다).
    if (ctx.principal.startsWith("device:") && !deps.granted(ctx.principal)) {
      return err({
        code: "forbidden",
        message: "the device lost its terminal input grant during sign-in",
      });
    }
    let record: ProviderRecord;
    let credentialId: string;
    if (adding) {
      if (deps.readProvider === undefined) {
        return err({
          code: "unavailable",
          message: "provider lookup unavailable",
        });
      }
      const existing = await deps.readProvider(ctx, provider);
      if (!existing.ok) return existing;
      if (existing.value === null) {
        return err({ code: "not_found", message: "provider not found" });
      }
      const candidateId =
        deps.newCredentialId?.() ?? defaultCredentialId(provider);
      const added = await writer.command(ctx, {
        command: addProviderCredential.name,
        input: {
          provider,
          credential_id: candidateId,
          auth_kind: "oauth",
          credential: { secret: providerSecretName(candidateId) },
          expires_at: at(tokens.expires_at_ms),
          ...(tokens.account === null ? {} : { account: tokens.account }),
          activate: true,
        },
        idempotency_key: deps.newKey(),
        compare: { revision: existing.value.revision },
        prepared: [],
      });
      if (!added.ok) return added;
      const result = added.value.result as {
        provider: ProviderRecord;
        credential_id: string;
      };
      record = result.provider;
      credentialId = result.credential_id;
    } else {
      credentialId = defaultCredentialId(provider);
      const connected = await writer.command(ctx, {
        command: connectProvider.name,
        input: {
          id: provider,
          ...target,
          credential_id: credentialId,
          auth_kind: "oauth",
          credential: { secret: providerSecretName(credentialId) },
          expires_at: at(tokens.expires_at_ms),
          ...(tokens.account === null ? {} : { account: tokens.account }),
        },
        idempotency_key: deps.newKey(),
        compare: {},
        prepared: [],
      });
      if (!connected.ok) return connected;
      record = (connected.value.result as { provider: ProviderRecord })
        .provider;
    }
    // 연결된 뒤에 쓴다. 못 쓰면 provider는 token 없이 남고 첫 turn이 인증 오류를 낸다. 사람은 끊고 다시 잇는다.
    const saved = await saveProviderTokens(deps.secrets, credentialId, tokens);
    if (!saved.ok) return saved;
    // 계정 model 목록은 로그인 결과를 기다리게 하지 않고 뒤에서 읽는다. 실패하면 token을 처음 건넬 때(prepareToken) 다시 읽는다.
    const source = { ...target, kind: "oauth", account: tokens.account };
    if (readsModels(source)) {
      void readProviderModels(deps.http, source, tokens.access)
        .then((roster) =>
          roster === null
            ? undefined
            : writer.command(ctx, {
                command: recordProviderModels.name,
                input: {
                  provider,
                  credential: credentialId,
                  models: roster.models,
                  model_limits: roster.limits,
                },
                idempotency_key: deps.newKey(),
                compare: { revision: record.revision },
                prepared: [],
              }),
        )
        .catch(() => {});
    }
    return ok({ state: "connected" });
  }

  // 상태를 끝으로 바꾸고 알린다. agent의 요청으로 시작했으면 그 요청도 끝낸다(이미 풀렸으면 할 일이 없다).
  function settle(id: string, entry: Login, state: ProviderSignInState): void {
    if (entry.state.state !== "waiting" || logins.get(id) !== entry) return;
    entry.state = state;
    deps.changed(state.provider);
    if (entry.request === null) return;
    const result: Result<InputRequestResult> =
      state.state === "connected"
        ? ok({ signed_in: true })
        : state.state === "cancelled"
          ? ok({ cancelled: true })
          : err({
              code: state.state === "failed" ? state.code : "internal",
              message: NOT_FINISHED,
            });
    deps.requests.finishRequest(
      entry.request.session,
      entry.request.tool_call,
      result,
    );
  }

  // 발급자를 기다린다. 규칙은 지난 화면의 poll 그대로다: 간격마다 complete, unavailable은 연달아 COMPLETE_MISSES번까지
  // 다시, 한 번 놓친 뒤의 not_found(세션이 이미 끝났다)는 unavailable, 기한이 지나면 not_found로 실패다.
  async function follow(
    ctx: AuthenticatedContext,
    id: string,
    entry: Login,
    first: number,
  ): Promise<void> {
    let interval = first;
    let misses = 0;
    for (;;) {
      await wait(interval);
      const state = entry.state;
      if (state.state !== "waiting") return;
      const fail = (code: ProviderSignInFailure) =>
        settle(id, entry, { state: "failed", provider: state.provider, code });
      if (deps.nowMs() >= Date.parse(state.expires_at)) {
        await login.cancel(state.provider, id);
        return fail("not_found");
      }
      let step: Awaited<ReturnType<typeof complete>>;
      try {
        step = await complete(ctx, state.provider, id, entry.adding);
      } catch {
        await login.cancel(state.provider, id);
        return fail("internal");
      }
      if (!step.ok) {
        const code = step.error.code;
        if (code === "unavailable" && ++misses < COMPLETE_MISSES) continue;
        if (code === "not_found" && misses > 0) return fail("unavailable");
        if (code === "unavailable") await login.cancel(state.provider, id);
        return fail(code);
      }
      misses = 0;
      if (step.value.state === "connected") {
        return settle(id, entry, {
          state: "connected",
          provider: state.provider,
        });
      }
      interval = step.value.interval_ms;
    }
  }

  // 같은 정의의 앞 로그인을 치운다: 끝난 상태는 지우고 기다리던 것은 그만둔다(port를 쥔 loopback 로그인이 새 시작을 막지 않게).
  // 같은 요청으로 다시 시작한 것이면 그 요청은 새 로그인이 끝낸다.
  async function clear(key: string, again: Login["request"]): Promise<void> {
    for (const [id, entry] of [...logins]) {
      if (entry.key !== key) continue;
      if (
        again !== null &&
        entry.request?.session === again.session &&
        entry.request.tool_call === again.tool_call
      ) {
        entry.request = null;
      }
      if (entry.state.state === "waiting") {
        await login.cancel(entry.state.provider, id);
        settle(id, entry, {
          state: "cancelled",
          provider: entry.state.provider,
        });
      }
      logins.delete(id);
    }
  }

  async function signIn(
    who: AuthenticatedContext,
    raw: unknown,
  ): Promise<Result<SignInOutput>> {
    const input = providerSignIn.input.safeParse(raw);
    if (!input.success) {
      return err({ code: "invalid_input", message: "sign-in input is wrong" });
    }
    let target: ConnectTarget & { provider: string };
    let request: Login["request"] = null;
    let adding = false;
    // agent의 요청으로 시작한 로그인이 시작부터 실패하면 그 요청도 그 오류로 끝낸다(기다리는 agent가 알게).
    const failed = <T>(result: Result<T>): Result<T> => {
      if (!result.ok && request !== null) {
        deps.requests.finishRequest(
          request.session,
          request.tool_call,
          err({ code: result.error.code, message: NOT_FINISHED }),
        );
      }
      return result;
    };
    if ("definition" in input.data) {
      const found = deps.target(input.data.definition, "oauth");
      if (!found.ok) return found;
      const id = await deps.freshId(who, found.value.definition.key);
      if (!id.ok) return id;
      target = { ...found.value, provider: id.value };
    } else if ("provider" in input.data) {
      if (deps.readProvider === undefined) {
        return err({
          code: "unavailable",
          message: "provider lookup unavailable",
        });
      }
      const existing = await deps.readProvider(who, input.data.provider);
      if (!existing.ok) return existing;
      if (existing.value === null) {
        return err({ code: "not_found", message: "provider not found" });
      }
      const found = providerTargetOf(existing.value.definition, "oauth");
      if (
        found === null ||
        !existing.value.definition.auth_kinds.includes("oauth")
      ) {
        return err({
          code: "invalid_input",
          message: "no sign-in for this provider",
        });
      }
      adding = true;
      target = { ...found, provider: existing.value.id };
    } else {
      const asking = input.data.request;
      const view = deps.requests.readRequest(asking.session, asking.tool_call);
      if (!view.ok) return view;
      if (
        view.value.kind !== "sign_in" ||
        view.value.target.type !== "provider"
      ) {
        return err({
          code: "invalid_input",
          message: "the request is not a provider sign-in",
        });
      }
      request = asking;
      const asked = view.value.target.login;
      const id = await deps.freshId(who, asked.definition.key, asked.provider);
      if (!id.ok) return failed(id);
      target = asked as ConnectTarget & { provider: string };
    }
    const { provider, ...connect } = target;
    const oauth = connect.definition.oauth;
    if (oauth === null) {
      return failed(
        err({ code: "invalid_input", message: "no sign-in for this provider" }),
      );
    }
    // 기기(폰, 다른 컴퓨터)가 시작한 loopback 로그인은 이 기계에 browser가 없어도 끝나야 한다. port를 쥐지 않고 PKCE·state만
    // 만들어 주소를 내주고, 그 기기가 사람이 돌아온 주소를 `providers/sign-in-callback`으로 건넨다(교환과 저장은 이 core다).
    const handoff =
      who.principal.startsWith("device:") &&
      oauthFlowOf(oauth.product) !== "device_code";
    await clear(connect.definition.key, request);
    const begun = await login.begin(provider, oauth, connect, handoff);
    if (!begun.ok) return failed(begun);
    const expires_at = at(begun.value.expires_at_ms);
    const entry: Login = {
      key: connect.definition.key,
      adding,
      request,
      state: {
        state: "waiting",
        provider,
        flow: begun.value.flow,
        expires_at,
        sign_in: begun.value.sign_in,
        callback_mode: begun.value.callback_mode,
        redirect_uri: begun.value.redirect_uri,
      },
    };
    logins.set(begun.value.login, entry);
    deps.changed(provider);
    void follow(who, begun.value.login, entry, begun.value.interval_ms);
    return ok(
      providerSignInOutputSchema.parse({
        provider,
        login: begun.value.login,
        flow: begun.value.flow,
        interval_ms: begun.value.interval_ms,
        expires_at,
        sign_in: begun.value.sign_in,
        callback_mode: begun.value.callback_mode,
        redirect_uri: begun.value.redirect_uri,
      }),
    );
  }

  // 다른 기기가 건넨 callback이다. state 대조와 token 교환은 follow가 이어서 한다.
  function signInCallback(raw: unknown): Result<{ accepted: true }> {
    const input = providerSignInCallbackInputSchema.safeParse(raw);
    if (!input.success) {
      return err({ code: "invalid_input", message: "callback input is wrong" });
    }
    const { provider, login: id, callback_url } = input.data;
    const entry = logins.get(id);
    if (
      entry === undefined ||
      entry.state.state !== "waiting" ||
      entry.state.provider !== provider
    ) {
      return err({ code: "not_found", message: "login not found" });
    }
    const delivered = login.deliver(provider, id, callback_url);
    return delivered.ok ? ok({ accepted: true }) : delivered;
  }

  function signInState(raw: unknown): Result<ProviderSignInState> {
    const input = providerSignInState.input.safeParse(raw);
    if (!input.success) {
      return err({ code: "invalid_input", message: "sign-in input is wrong" });
    }
    const entry = logins.get(input.data.login);
    return entry === undefined
      ? err({ code: "not_found", message: "login not found" })
      : ok(entry.state);
  }

  // API key 연결. 값은 `provider.<crd_id>.new.<무작위>`에 먼저 올라와 있다. 연결이 성공하면 `provider.<crd_id>`로 옮기고,
  // 실패하면 버린다.
  async function connect(
    ctx: Parameters<Writer["command"]>[0],
    envelope: Parameters<Writer["command"]>[1],
  ): Promise<Result<CommandSuccess>> {
    const parsed = connectProviderInputSchema.safeParse(envelope.input);
    const staged = parsed.success ? parsed.data.credential?.secret : undefined;
    const credentialId = parsed.success
      ? (parsed.data.credential_id ?? defaultCredentialId(parsed.data.id))
      : undefined;
    if (
      !parsed.success ||
      staged === undefined ||
      credentialId === undefined ||
      !isStagedProviderSecret(credentialId, staged)
    ) {
      return await writer.command(ctx, envelope);
    }
    const value = deps.secrets.get(staged);
    if (!value.ok) {
      return err({ code: "invalid_input", message: "staged key is missing" });
    }
    const secret = providerSecretName(credentialId);
    const connected = await writer.command(ctx, {
      ...envelope,
      input: {
        ...parsed.data,
        credential_id: credentialId,
        credential: { secret },
      },
    });
    if (connected.ok) {
      const put = await deps.secrets.put(secret, value.value);
      if (!put.ok) {
        await deps.secrets.delete(staged);
        return err({ code: "unavailable", message: "key를 저장하지 못했다" });
      }
    }
    await deps.secrets.delete(staged);
    return connected;
  }

  // 기존 provider에 API key 추가. 임시 이름을 `provider.<crd_id>`로 옮긴다.
  async function addCredential(
    ctx: Parameters<Writer["command"]>[0],
    envelope: Parameters<Writer["command"]>[1],
  ): Promise<Result<CommandSuccess>> {
    const parsed = addProviderCredentialInputSchema.safeParse(envelope.input);
    const staged = parsed.success ? parsed.data.credential?.secret : undefined;
    if (
      !parsed.success ||
      staged === undefined ||
      !isStagedProviderSecret(parsed.data.credential_id, staged)
    ) {
      return await writer.command(ctx, envelope);
    }
    const value = deps.secrets.get(staged);
    if (!value.ok) {
      return err({ code: "invalid_input", message: "staged key is missing" });
    }
    const secret = providerSecretName(parsed.data.credential_id);
    const added = await writer.command(ctx, {
      ...envelope,
      input: { ...parsed.data, credential: { secret } },
    });
    if (added.ok) {
      const put = await deps.secrets.put(secret, value.value);
      if (!put.ok) {
        await deps.secrets.delete(staged);
        return err({ code: "unavailable", message: "key를 저장하지 못했다" });
      }
    }
    await deps.secrets.delete(staged);
    return added;
  }

  async function removeCredential(
    ctx: Parameters<Writer["command"]>[0],
    envelope: Parameters<Writer["command"]>[1],
  ): Promise<Result<CommandSuccess>> {
    const parsed = removeProviderCredentialInputSchema.safeParse(
      envelope.input,
    );
    const done = await writer.command(ctx, envelope);
    if (done.ok && !done.value.replayed && parsed.success) {
      await removeProviderTokens(deps.secrets, parsed.data.credential);
    }
    return done;
  }

  async function disconnect(
    ctx: Parameters<Writer["command"]>[0],
    envelope: Parameters<Writer["command"]>[1],
  ): Promise<Result<CommandSuccess>> {
    const parsed = disconnectProviderInputSchema.safeParse(envelope.input);
    const existing =
      parsed.success && deps.readProvider !== undefined
        ? await deps.readProvider(ctx, parsed.data.provider).catch(() => null)
        : null;
    const done = await writer.command(ctx, envelope);
    // 다시 보낸 같은 요청(replayed)은 그 사이 다시 이은 provider의 값을 지우지 않게 건너뛴다.
    if (done.ok && !done.value.replayed && parsed.success) {
      if (existing !== null && existing.ok && existing.value !== null) {
        deps.rememberId?.(existing.value.definition.key, existing.value.id);
        for (const cred of existing.value.credentials) {
          await removeProviderTokens(deps.secrets, cred.id);
        }
      } else {
        await removeProviderTokens(deps.secrets, parsed.data.provider);
      }
    }
    return done;
  }

  async function cancel(input: unknown): Promise<Result<unknown>> {
    const parsed = loginCancelInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "login cancel input is wrong",
      });
    }
    const { provider, login: id } = parsed.data;
    const cancelled = await login.cancel(provider, id);
    if (!cancelled.ok) return cancelled;
    const entry = logins.get(id);
    if (entry !== undefined) {
      settle(id, entry, { state: "cancelled", provider });
    }
    return ok({ cancelled: true });
  }

  return {
    ...writer,
    async command(ctx, envelope): Promise<Result<CommandSuccess>> {
      if (envelope.command === loginCancel.name) {
        return wrapped(await cancel(envelope.input));
      }
      if (envelope.command === connectProvider.name) {
        return await connect(ctx, envelope);
      }
      if (envelope.command === addProviderCredential.name) {
        return await addCredential(ctx, envelope);
      }
      if (envelope.command === removeProviderCredential.name) {
        return await removeCredential(ctx, envelope);
      }
      if (envelope.command === disconnectProvider.name) {
        return await disconnect(ctx, envelope);
      }
      return await writer.command(ctx, envelope);
    },
    signIn,
    signInState,
    signInCallback,
    // 기다림을 멈춘다. 끝나는 core라 요청을 끝내거나 알리지 않는다.
    async endAll() {
      for (const entry of logins.values()) {
        if (entry.state.state === "waiting") {
          entry.state = { state: "cancelled", provider: entry.state.provider };
        }
      }
      await login.endAll();
    },
  };
}

type ProviderSignInFailure = Extract<
  ProviderSignInState,
  { state: "failed" }
>["code"];

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

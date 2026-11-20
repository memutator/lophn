// 로그인 흐름의 한 곳이다. 구독 provider와 앱 OAuth의 시작과 따라가기는 Settings › Providers, 앱 상세 › Access, 대화의
// sign_in card가 같이 쓴다(MCP OAuth는 workspace/agents/core-extensions.ts의 signInMcpServer가 같은 자리 역할이다).
// token은 이 파일을 지나지 않는다: core가 발급자에게 받아 저장한다. 구독 provider는 발급자를 기다리는 것도 core라
// 여기서는 주소를 열고 상태(`providers/sign-in-state`)를 `StateChanged`로 다시 읽어 따라간다.
// 다른 컴퓨터의 loopback 로그인(`callback_mode: remote_handoff`)이면 shell main의 임시 loopback listener를 먼저 열어
// 자동 전달을 시도하고, port가 바쁘거나 다른 browser에서 로그인한 경우를 위해 사람이 주소를 붙여 넣는 길도 함께 준다.
import type { z } from "zod";

import type { OAuthHandoffApi } from "../../../ipc/oauth-handoff.ts";
import type { OpenExternalApi } from "../../../ipc/open-external.ts";
import { appsOAuthState } from "../../../../protocol/apps/oauth.ts";
import {
  loginCancel,
  type providerSignIn,
  providerSignInState,
} from "../../../../protocol/lophn-agent/providers.ts";
import type { SourceResult } from "../../source-result.ts";
import { call, command, windowOAuthHandoff } from "./core-call.ts";
import type { CoreSource } from "../connection/connection.ts";
import { followCoreRead } from "../connection/core-read.ts";
import type { EventClient } from "../connection/events/client.ts";

/** 다른 컴퓨터의 loopback 로그인을 이 창에서 끝내는 handoff 상태다. */
export interface SignInHandoff {
  /** 이 컴퓨터에서 redirect port를 열어 자동 전달을 기다리고 있는가. */
  readonly autoListening: boolean;
  /** browser에서 돌아온 주소(또는 쿼리)를 대상 컴퓨터의 core에 건넨다. 잘못된 주소면 invalid_input이다. */
  submitCallback(callbackUrl: string): Promise<SourceResult<null>>;
}

/** 구독 로그인의 진행. 흐름이 browser를 연 뒤 started를 한 번 부르고, signal이 끊기면 로그인을 그만둔다. */
export interface SignInProgress {
  readonly signal: AbortSignal;
  /** device code 로그인이면 userCode, 원격 loopback 로그인이면 handoff가 온다. */
  started(info: {
    readonly userCode: string | null;
    readonly handoff?: SignInHandoff | null;
  }): void;
  /** 로그인 상태를 따라갈 창의 event 연결. Settings가 싣는다(card는 따로 넘긴다). */
  readonly events?: EventClient | null;
}

type OpenLink = OpenExternalApi["openExternal"] | undefined;
type OAuthHandoff = OAuthHandoffApi["oauthHandoff"] | undefined;

const UNAVAILABLE = { ok: false, code: "unavailable" } as const;

/** 주소를 OS browser로 연다. 열 곳이 없거나 열기가 실패하면 false다. */
async function openUrl(openLink: OpenLink, url: string): Promise<boolean> {
  if (openLink === undefined) return false;
  try {
    return (await openLink(url)).ok;
  } catch {
    return false;
  }
}

/** authorize URL에서 state 쿼리 값을 읽는다. */
function stateParamOf(url: string): string | null {
  try {
    return new URL(url).searchParams.get("state");
  } catch {
    return null;
  }
}

/**
 * 구독 계정으로 로그인한다. core가 로그인을 시작해(id와 대상은 core가 정한다) 발급자를 기다리고, 끝나면 token을 저장하고
 * Connect까지 한다. 여기서는 주소를 OS browser로 열고 상태를 끝까지 따라간다. signal이 끊기면 로그인을 그만둔다.
 * agent의 요청(`{request}`)으로 시작했으면 요청을 끝내는 것도 core다.
 */
export async function followProviderSignIn(
  events: EventClient | null,
  openLink: OpenLink,
  input: z.input<typeof providerSignIn.input>,
  progress: SignInProgress | undefined,
  handoffApi: OAuthHandoff = windowOAuthHandoff(),
): Promise<SourceResult<null>> {
  if (events === null) return UNAVAILABLE;
  const core = events.core;
  const begun = await call<z.output<typeof providerSignIn.output>>(
    core,
    "memory",
    "providers",
    "sign-in",
    input,
  );
  if (!begun.ok) return begun;
  const { provider, login, callback_mode, redirect_uri } = begun.value;
  const cancel = () =>
    command(core, loginCancel, {
      input: { provider, login },
      compare: {},
      key: `login-cancel-${crypto.randomUUID().slice(0, 8)}`,
    });

  // remote_handoff면 browser를 열기 전에 이 컴퓨터의 loopback port를 먼저 잡아 둔다(자동 전달).
  const isHandoff = callback_mode === "remote_handoff" && redirect_uri !== null;
  let handoffId: string | null = null;
  let autoListening = false;
  if (isHandoff && handoffApi !== undefined) {
    const state = stateParamOf(begun.value.sign_in.url);
    if (state !== null) {
      const id = crypto.randomUUID();
      const started = await handoffApi({
        action: "start",
        id,
        redirectUri: redirect_uri,
        state,
      });
      if (started.ok) {
        handoffId = id;
        autoListening = true;
      }
    }
  }
  const stopLocalListener = () => {
    if (handoffId === null || handoffApi === undefined) return;
    const id = handoffId;
    handoffId = null;
    void handoffApi({ action: "cancel", id });
  };

  if (!(await openUrl(openLink, begun.value.sign_in.url))) {
    // 열 곳이 없으면 시작한 로그인이 남지 않게 닫는다.
    stopLocalListener();
    await cancel();
    return UNAVAILABLE;
  }

  const deliverCallback = async (
    callbackUrl: string,
  ): Promise<SourceResult<null>> => {
    const sent = await call(core, "memory", "providers", "sign-in-callback", {
      provider,
      login,
      callback_url: callbackUrl,
    });
    if (!sent.ok) return sent;
    stopLocalListener();
    return { ok: true, value: null };
  };

  if (handoffId !== null && handoffApi !== undefined) {
    const waitId = handoffId;
    void handoffApi({ action: "wait", id: waitId }).then((captured) => {
      if (captured.ok && captured.callbackUrl !== undefined) {
        void deliverCallback(captured.callbackUrl);
      }
    });
  }

  progress?.started({
    userCode: begun.value.sign_in.user_code,
    handoff: isHandoff
      ? { autoListening, submitCallback: deliverCallback }
      : null,
  });
  const signal = progress?.signal;
  const outcome = await new Promise<SourceResult<null> | "stop">((resolve) => {
    let done = false;
    let follow: { stop(): void } | null = null;
    const finish = (result: SourceResult<null> | "stop") => {
      if (done) return;
      done = true;
      follow?.stop();
      signal?.removeEventListener("abort", abort);
      resolve(result);
    };
    const abort = () => finish("stop");
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    follow = followCoreRead<z.output<typeof providerSignInState.output>>(
      events,
      providerSignInState,
      { login },
      (loaded) => {
        if (loaded.state === "loading" || done) return;
        // 상태를 읽지 못하면 따라갈 수 없다. 기다리는 로그인은 닫는다.
        if (loaded.state === "failed") return finish("stop");
        const state = loaded.value;
        if (state.state === "connected") finish({ ok: true, value: null });
        else if (state.state === "failed") {
          finish({ ok: false, code: state.code });
        } else if (state.state === "cancelled") {
          finish({ ok: false, code: "cancelled" });
        }
      },
      () => new Date(),
    );
    if (done) follow.stop();
  });
  stopLocalListener();
  if (outcome !== "stop") return outcome;
  await cancel();
  return signal?.aborted === true
    ? { ok: false, code: "cancelled" }
    : UNAVAILABLE;
}

// 진행 중인 원격 앱 OAuth의 로컬 loopback listener id. 취소·재시작 시 닫는다.
const appHandoffs = new Map<string, string>();
const appHandoffKey = (app: string, name: string) => `${app}\0${name}`;

function stopAppLocalListener(
  app: string,
  name: string,
  handoffApi: OAuthHandoff = windowOAuthHandoff(),
): void {
  const key = appHandoffKey(app, name);
  const id = appHandoffs.get(key);
  if (id === undefined) return;
  appHandoffs.delete(key);
  if (handoffApi !== undefined) void handoffApi({ action: "cancel", id });
}

/** 앱 OAuth 로그인을 시작해 authorize 주소를 OS browser로 연다. 열 곳이 없거나 열기가 실패하면 시작한 로그인을 닫는다. */
export async function beginAppSignIn(
  core: CoreSource,
  openLink: OpenLink,
  app: string,
  name: string,
  handoffApi: OAuthHandoff = windowOAuthHandoff(),
): Promise<SourceResult<true>> {
  stopAppLocalListener(app, name, handoffApi);
  const begun = await call<{
    url: string;
    callback_mode?: "local" | "remote_handoff";
    redirect_uri?: string;
  }>(core, "memory", "apps", "oauth_begin", { app, name });
  if (!begun.ok) return begun;
  const isHandoff =
    begun.value.callback_mode === "remote_handoff" &&
    begun.value.redirect_uri !== undefined;
  let handoffId: string | null = null;
  if (isHandoff && handoffApi !== undefined) {
    const state = stateParamOf(begun.value.url);
    if (state !== null) {
      const id = crypto.randomUUID();
      const started = await handoffApi({
        action: "start",
        id,
        redirectUri: begun.value.redirect_uri!,
        state,
      });
      if (started.ok) {
        handoffId = id;
        appHandoffs.set(appHandoffKey(app, name), id);
      }
    }
  }
  if (await openUrl(openLink, begun.value.url)) {
    if (handoffId !== null && handoffApi !== undefined) {
      const waitId = handoffId;
      void handoffApi({ action: "wait", id: waitId }).then((captured) => {
        if (appHandoffs.get(appHandoffKey(app, name)) === waitId) {
          appHandoffs.delete(appHandoffKey(app, name));
        }
        if (captured.ok && captured.callbackUrl !== undefined) {
          void call(core, "memory", "apps", "oauth_callback", {
            app,
            name,
            callback_url: captured.callbackUrl,
          });
        }
      });
    }
    return { ok: true, value: true };
  }
  stopAppLocalListener(app, name, handoffApi);
  await call(core, "memory", "apps", "oauth_cancel", { app, name });
  return UNAVAILABLE;
}

/** 앱 OAuth 로그인을 그만두고 이 컴퓨터에 열려 있던 임시 handoff listener도 닫는다. */
export async function cancelAppSignIn(
  core: CoreSource,
  app: string,
  name: string,
  handoffApi: OAuthHandoff = windowOAuthHandoff(),
): Promise<SourceResult<true>> {
  stopAppLocalListener(app, name, handoffApi);
  const done = await call(core, "memory", "apps", "oauth_cancel", {
    app,
    name,
  });
  return done.ok ? { ok: true, value: true } : done;
}

/**
 * 앱 OAuth 로그인이 끝날 때까지 상태를 따라간다. core가 callback을 받아 token을 저장하고 `secrets` 변경을 내면
 * 상태를 다시 읽는다. signal이 끊기면 그만둔다.
 */
export async function signInApp(
  events: EventClient,
  openLink: OpenLink,
  app: string,
  name: string,
  signal: AbortSignal,
  handoffApi: OAuthHandoff = windowOAuthHandoff(),
): Promise<SourceResult<null>> {
  const core = events.core;
  const begun = await beginAppSignIn(core, openLink, app, name, handoffApi);
  if (!begun.ok) return begun;
  const outcome = await new Promise<SourceResult<null> | "cancelled">(
    (resolve) => {
      let done = false;
      let follow: { stop(): void } | null = null;
      const finish = (result: SourceResult<null> | "cancelled") => {
        if (done) return;
        done = true;
        follow?.stop();
        signal.removeEventListener("abort", abort);
        resolve(result);
      };
      const abort = () => finish("cancelled");
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      follow = followCoreRead<z.output<typeof appsOAuthState.output>>(
        events,
        appsOAuthState,
        { app },
        (loaded) => {
          if (loaded.state === "loading" || done) return;
          if (loaded.state === "failed") {
            finish({ ok: false, code: "unavailable" });
          } else {
            const mine = loaded.value.secrets.find(
              (line) => line.name === name,
            );
            if (mine?.state === "signed_in") finish({ ok: true, value: null });
            else if (mine?.state !== "in_progress") {
              finish({ ok: false, code: "unavailable" });
            }
          }
        },
        () => new Date(),
      );
      if (done) follow.stop();
    },
  );
  stopAppLocalListener(app, name, handoffApi);
  if (outcome !== "cancelled") return outcome;
  await cancelAppSignIn(core, app, name, handoffApi);
  return { ok: false, code: "cancelled" };
}

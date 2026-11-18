// 로그인 흐름의 한 곳이다. 구독 provider와 앱 OAuth의 시작과 따라가기는 Settings › Providers, 앱 상세 › Access, 대화의
// sign_in card가 같이 쓴다(MCP OAuth는 workspace/agents/core-extensions.ts의 signInMcpServer가 같은 자리 역할이다).
// token은 이 파일을 지나지 않는다: core가 발급자에게 받아 저장한다. 구독 provider는 발급자를 기다리는 것도 core라
// 여기서는 주소를 열고 상태(`providers/sign-in-state`)를 `StateChanged`로 다시 읽어 따라간다.
import type { z } from "zod";

import type { OpenExternalApi } from "../../../ipc/open-external.ts";
import { appsOAuthState } from "../../../../protocol/apps/oauth.ts";
import {
  loginCancel,
  type providerSignIn,
  providerSignInState,
} from "../../../../protocol/lophn-agent/providers.ts";
import type { SourceResult } from "../../source-result.ts";
import { call, command } from "./core-call.ts";
import type { CoreSource } from "../connection/connection.ts";
import { followCoreRead } from "../connection/core-read.ts";
import type { EventClient } from "../connection/events/client.ts";

/** 구독 로그인의 진행. 흐름이 browser를 연 뒤 started를 한 번 부르고, signal이 끊기면 로그인을 그만둔다. */
export interface SignInProgress {
  readonly signal: AbortSignal;
  /** device code 로그인이면 사람이 browser에 넣을 code가 온다. 아니면 null이다. */
  started(info: { readonly userCode: string | null }): void;
  /** 로그인 상태를 따라갈 창의 event 연결. Settings가 싣는다(card는 따로 넘긴다). */
  readonly events?: EventClient | null;
}

type OpenLink = OpenExternalApi["openExternal"] | undefined;

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
  const { provider, login } = begun.value;
  const cancel = () =>
    command(core, loginCancel, {
      input: { provider, login },
      compare: {},
      key: `login-cancel-${crypto.randomUUID().slice(0, 8)}`,
    });
  if (!(await openUrl(openLink, begun.value.sign_in.url))) {
    // 열 곳이 없으면 시작한 로그인이 남지 않게 닫는다.
    await cancel();
    return UNAVAILABLE;
  }
  progress?.started({ userCode: begun.value.sign_in.user_code });
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
  if (outcome !== "stop") return outcome;
  await cancel();
  return signal?.aborted === true
    ? { ok: false, code: "cancelled" }
    : UNAVAILABLE;
}

/** 앱 OAuth 로그인을 시작해 authorize 주소를 OS browser로 연다. 열 곳이 없거나 열기가 실패하면 시작한 로그인을 닫는다. */
export async function beginAppSignIn(
  core: CoreSource,
  openLink: OpenLink,
  app: string,
  name: string,
): Promise<SourceResult<true>> {
  const begun = await call<{ url: string }>(
    core,
    "memory",
    "apps",
    "oauth_begin",
    { app, name },
  );
  if (!begun.ok) return begun;
  if (await openUrl(openLink, begun.value.url)) {
    return { ok: true, value: true };
  }
  await call(core, "memory", "apps", "oauth_cancel", { app, name });
  return UNAVAILABLE;
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
): Promise<SourceResult<null>> {
  const core = events.core;
  const begun = await beginAppSignIn(core, openLink, app, name);
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
  if (outcome !== "cancelled") return outcome;
  await call(core, "memory", "apps", "oauth_cancel", { app, name });
  return { ok: false, code: "cancelled" };
}

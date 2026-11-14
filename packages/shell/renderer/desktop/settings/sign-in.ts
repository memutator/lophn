// 로그인 흐름의 한 곳이다. 구독 provider와 앱 OAuth의 시작·기다림은 Settings › Providers, 앱 상세 › Access, 대화의
// sign_in card가 같이 쓴다(MCP OAuth는 workspace/agents/core-extensions.ts의 signInMcpServer가 같은 자리 역할이다).
// token은 이 파일을 지나지 않는다: core가 발급자에게 받아 저장한다.
import type { z } from "zod";

import type { OpenExternalApi } from "../../../ipc/open-external.ts";
import { appsOAuthState } from "../../../../protocol/apps/oauth.ts";
import type { loginBeginInputSchema } from "../../../../protocol/lophn-agent/provider-inputs.ts";
import {
  loginBegin,
  loginCancel,
  loginComplete,
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
}

export interface SignInDeps {
  openLink: OpenExternalApi["openExternal"] | undefined;
  /** command key를 만든다. 테스트가 고정한다. */
  random: () => string;
  /** 다음 확인까지 기다린다. signal이 끊기면 일찍 돌아온다. 테스트가 바로 돌아오게 한다. */
  wait: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
}

export function timerWait(
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** login-complete가 발급자에 닿지 못해 연달아 실패해도 다시 부르는 횟수. */
const COMPLETE_MISSES = 3;
const UNAVAILABLE = { ok: false, code: "unavailable" } as const;

/** 주소를 OS browser로 연다. 열 곳이 없거나 열기가 실패하면 false다. */
async function openUrl(
  openLink: SignInDeps["openLink"],
  url: string,
): Promise<boolean> {
  if (openLink === undefined) return false;
  try {
    return (await openLink(url)).ok;
  } catch {
    return false;
  }
}

/**
 * 구독 계정으로 로그인한다. provider는 아직 없다: core가 로그인을 마치면 token을 저장하고 이 ID로 Connect한다.
 * 주소를 OS browser로 연 뒤 login-complete를 core가 정한 간격마다 부른다. signal이 끊기면 로그인을 그만둔다.
 */
export async function signInProvider(
  core: CoreSource,
  deps: SignInDeps,
  target: z.input<typeof loginBeginInputSchema>,
  progress: SignInProgress | undefined,
): Promise<SourceResult<null>> {
  const id = target.provider;
  const begun = await command(core, loginBegin, {
    input: target,
    compare: {},
    key: `login-begin-${deps.random()}`,
  });
  if (!begun.ok) return begun;
  const login = begun.value.login;
  const cancel = () =>
    command(core, loginCancel, {
      input: { provider: id, login },
      compare: {},
      key: `login-cancel-${deps.random()}`,
    });
  if (!(await openUrl(deps.openLink, begun.value.sign_in.url))) {
    // 열 곳이 없으면 시작한 로그인이 남지 않게 닫는다.
    await cancel();
    return UNAVAILABLE;
  }
  progress?.started({ userCode: begun.value.sign_in.user_code });
  const signal = progress?.signal;
  let interval = begun.value.interval_ms;
  let misses = 0;
  for (;;) {
    await deps.wait(interval, signal);
    if (signal?.aborted) {
      await cancel();
      return { ok: false, code: "cancelled" };
    }
    const step = await command(core, loginComplete, {
      input: { provider: id, login },
      compare: {},
      key: `login-complete-${deps.random()}`,
    });
    if (!step.ok) {
      // 발급자에 잠깐 닿지 못한 것이면 다시 본다. ChatGPT는 교환이 실패하면 세션이 없어져 not_found가 온다.
      if (step.code === "unavailable" && ++misses < COMPLETE_MISSES) continue;
      if (step.code === "not_found" && misses > 0) return UNAVAILABLE;
      if (step.code === "unavailable") await cancel();
      return step;
    }
    misses = 0;
    if (step.value.state === "connected") return { ok: true, value: null };
    interval = step.value.interval_ms;
  }
}

/** 앱 OAuth 로그인을 시작해 authorize 주소를 OS browser로 연다. 열 곳이 없거나 열기가 실패하면 시작한 로그인을 닫는다. */
export async function beginAppSignIn(
  core: CoreSource,
  openLink: SignInDeps["openLink"],
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
  openLink: SignInDeps["openLink"],
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

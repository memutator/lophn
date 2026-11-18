// Setting up a paired computer from the phone (the one on screen, or another by its key, without switching to it): a secret an agent asked for, a provider connected with an API key, a
// provider sign-in that ends in any browser (device code), and the providers read. The order of each (ids, the value, the
// connect) is the core's; the phone only calls its routes. A value typed here goes once, as the upload body, and is not
// kept: callers hold it only until they call.
import { useEffect, useMemo, useState } from "react";
import type { z } from "zod";
import type { MemoryRoute, ReadRoute, UploadRoute } from "../../../protocol/base/route.ts";
import { inputRequestAnswerSecret } from "../../../protocol/lophn-agent/input-request.ts";
import type {
  ProviderSignInState,
  providerSignInInputSchema,
} from "../../../protocol/lophn-agent/provider-inputs.ts";
import {
  loginCancel,
  providerConnectKey,
  providerDefinitions,
  providerList,
  providerSignIn,
  providerSignInState,
} from "../../../protocol/lophn-agent/providers.ts";
import type { ProviderRecord } from "../../../protocol/lophn-agent/provider-values.ts";
import { SECRET_INPUT_MAX_BYTES } from "../../../protocol/secrets/secrets.ts";
import type { SourceResult } from "../../../shell/renderer/conversation/agent-tab-source.ts";
import type { CoreSource } from "../../../shell/renderer/desktop/connection/connection.ts";
import {
  followCoreRead,
  followRead,
  type Loaded,
  type Read,
  readsOf,
} from "../../../shell/renderer/desktop/connection/core-read.ts";
import type { EventClient } from "../../../shell/renderer/desktop/connection/events/client.ts";
import { useEventClient } from "../../../shell/renderer/desktop/connection/events/hooks.tsx";
import { commandBody } from "../../../shell/renderer/command-call.ts";
import { newId } from "../../../shell/renderer/prefixed-id.ts";
import { useComputerData } from "./hooks.tsx";
import { base64Of } from "./images.ts";

export type { ProviderRecord } from "../../../protocol/lophn-agent/provider-values.ts";
export { oauthFlowOf } from "../../../protocol/lophn-agent/provider-values.ts";
export type ProviderDefinitionView = z.output<typeof providerDefinitions.output>["definitions"][number];

async function callRoute<T>(
  core: CoreSource,
  route: ReadRoute | MemoryRoute | UploadRoute | { kind: "command"; resource: string; method: string },
  body: unknown,
): Promise<SourceResult<T>> {
  try {
    const reply = await core.call({ kind: route.kind, resource: route.resource, method: route.method, body });
    return reply.ok ? { ok: true, value: reply.value as T } : { ok: false, code: reply.error?.code ?? "internal" };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

/** The value's UTF-8 as an upload body, or invalid_input when it is empty or over the core's limit. */
async function upload<T>(
  core: CoreSource,
  route: UploadRoute,
  input: Record<string, unknown>,
  value: string,
): Promise<SourceResult<T>> {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength < 1 || bytes.byteLength > SECRET_INPUT_MAX_BYTES) return { ok: false, code: "invalid_input" };
  return callRoute<T>(core, route, { input: { ...input, bytes: bytes.byteLength }, base64: base64Of(bytes) });
}

export type SignInStart = z.input<typeof providerSignInInputSchema>;

/** A started sign-in: what the person opens and types there. The core waits for the provider. */
export interface SignInStarted {
  readonly provider: string;
  readonly login: string;
  readonly url: string;
  readonly code: string | null;
}

export type SignInOutcome = "connected" | "cancelled" | { readonly failed: string };

export interface Setup {
  /** Answers an agent's secret request. The core stores it and ends the request. */
  answerSecret(target: { session: string; toolCall: string }, value: string): Promise<SourceResult<null>>;
  /** Connects a built-in definition with an API key. */
  connectKey(definition: string, value: string): Promise<SourceResult<null>>;
  startSignIn(input: SignInStart): Promise<SourceResult<SignInStarted>>;
  /** Follows a started sign-in until it ends; the returned function stops following. */
  followSignIn(login: string, onEnd: (outcome: SignInOutcome) => void): () => void;
  cancelSignIn(started: SignInStarted): Promise<void>;
}

// A computer that is not paired (any more): every call is unavailable.
const UNPAIRED: CoreSource = {
  subscribe: () => () => {},
  call: () => Promise.resolve({ ok: false, error: { code: "unavailable", message: "not paired" } }),
};

/** The event client of `key`'s computer, or of the computer on screen without a key. Neither switches which is on screen. */
function useClient(key: string | undefined): EventClient | null {
  const onScreen = useEventClient();
  const data = useComputerData(key ?? "");
  return key === undefined ? onScreen : (data?.client ?? null);
}

/** Setting up `computer` (a paired computer's key), or the computer on screen without one. */
export function useSetup(computer?: string): Setup {
  const client = useClient(computer);
  return useMemo(() => {
    const core = client?.core ?? UNPAIRED;
    return {
      async answerSecret(target, value) {
        const sent = await upload(core, inputRequestAnswerSecret, { session: target.session, tool_call: target.toolCall }, value);
        return sent.ok ? { ok: true, value: null } : sent;
      },
      async connectKey(definition, value) {
        const sent = await upload(core, providerConnectKey, { target: { definition } }, value);
        return sent.ok ? { ok: true, value: null } : sent;
      },
      async startSignIn(input) {
        const begun = await callRoute<z.output<typeof providerSignIn.output>>(core, providerSignIn, input);
        if (!begun.ok) return begun;
        const { provider, login, sign_in } = begun.value;
        return { ok: true, value: { provider, login, url: sign_in.url, code: sign_in.user_code } };
      },
      followSignIn(login, onEnd) {
        if (client === null) {
          onEnd({ failed: "unavailable" });
          return () => {};
        }
        let ended = false;
        let follow: { stop(): void } | null = null;
        const end = (outcome: SignInOutcome) => {
          if (ended) return;
          ended = true;
          follow?.stop();
          onEnd(outcome);
        };
        follow = followCoreRead<ProviderSignInState>(
          client,
          providerSignInState,
          { login },
          (loaded) => {
            if (loaded.state === "failed") end({ failed: "unavailable" });
            if (loaded.state !== "ready") return;
            const state = loaded.value;
            if (state.state === "connected") end("connected");
            else if (state.state === "cancelled") end("cancelled");
            else if (state.state === "failed") end({ failed: state.code });
          },
          () => new Date(),
        );
        if (ended) follow.stop();
        return () => {
          ended = true;
          follow?.stop();
        };
      },
      async cancelSignIn(started) {
        await callRoute(
          core,
          loginCancel,
          commandBody(loginCancel, {
            input: { provider: started.provider, login: started.login },
            compare: {},
            key: newId("cancel"),
          }),
        );
      },
    };
  }, [client]);
}

/** The computer's providers and the definitions not connected yet; "forbidden" when the computer does not let this phone. */
export type ProvidersView =
  | {
      readonly connected: readonly ProviderRecord[];
      readonly available: readonly ProviderDefinitionView[];
    }
  | "forbidden";

/** `computer`'s providers, read again when they change. */
export function useProviders(computer: string): Loaded<ProvidersView> {
  const client = useClient(computer);
  const [loaded, setLoaded] = useState<Loaded<ProvidersView>>({ state: "loading" });
  useEffect(() => {
    if (client === null) {
      setLoaded({ state: "failed" });
      return;
    }
    setLoaded({ state: "loading" });
    const follow = followRead(
      client,
      readProviders,
      [...readsOf(providerList, {}), ...readsOf(providerDefinitions, {})],
      setLoaded,
      () => new Date(),
    );
    return () => follow.stop();
  }, [client]);
  return loaded;
}

async function readProviders(core: CoreSource): Read<ProvidersView> {
  const connected: ProviderRecord[] = [];
  let cursor: string | null = null;
  do {
    const page: SourceResult<z.output<typeof providerList.output>> = await callRoute(
      core,
      providerList,
      cursor === null ? {} : { cursor },
    );
    if (!page.ok) return page.code === "forbidden" ? { ok: true, value: "forbidden" } : { ok: false };
    connected.push(...page.value.providers);
    cursor = page.value.next_cursor;
  } while (cursor !== null);
  const read = await callRoute<z.output<typeof providerDefinitions.output>>(core, providerDefinitions, {});
  if (!read.ok) return read.code === "forbidden" ? { ok: true, value: "forbidden" } : { ok: false };
  const used = new Set(connected.map((one) => one.definition.key));
  return {
    ok: true,
    value: { connected, available: read.value.definitions.filter((one) => !used.has(one.key)) },
  };
}

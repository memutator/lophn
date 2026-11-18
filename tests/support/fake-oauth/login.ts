import { TEST_PROVIDER_TARGETS } from "../../../packages/core/lophn-agent/providers/connect-key.ts";
import {
  modelDefaultChange,
  providerSignIn,
  providerSignInState,
} from "../../../packages/protocol/lophn-agent/mod.ts";
import type { Core } from "../core/mod.ts";
import { until } from "../core/human.ts";
import type { FakeIssuer } from "./mod.ts";

const MODEL_NAME = "claude-sonnet-4-5";
const DEVICE_LOGIN_MS = 30_000;

/** fake 발급자로 도는 정의 key. device code(SuperGrok 꼴)와 고정 loopback callback(ChatGPT 꼴)이다. */
export const FAKE_DEVICE = "fake-device";
export const FAKE_PKCE = "fake-pkce";

// core를 띄울 때 줄 env. 두 key의 연결 대상을 fake 발급자의 정의와 fake model server 주소로 바꾼다.
export function fakeProviderEnv(
  issuer: FakeIssuer,
  fake: { url: string },
): Record<string, string> {
  const target = (key: string, product: "supergrok" | "chatgpt") => ({
    definition: { ...issuer.definition(product), key },
    endpoint: fake.url,
    protocol: "anthropic-messages",
  });
  return {
    [TEST_PROVIDER_TARGETS]: JSON.stringify({
      [FAKE_DEVICE]: target(FAKE_DEVICE, "supergrok"),
      [FAKE_PKCE]: target(FAKE_PKCE, "chatgpt"),
    }),
  };
}

// 로그인 하나가 waiting을 벗어날 때까지 상태를 읽는다.
export async function signInSettled(core: Core, login: string, ms: number) {
  return await until(
    "로그인이 끝남",
    async () => {
      const state = await core.call(providerSignInState, { login });
      return state.state === "waiting" ? undefined : state;
    },
    ms,
  );
}

// fakeProviderEnv로 띄운 core에 fake 발급자로 device code 로그인을 끝내 provider를 연결해 두고 기본 model로 정한다.
// 값은 모두 test 고유다. 끝나면 script를 비운다(다음 test가 앞의 줄을 받지 않게).
export async function connectOAuthProvider(
  core: Core,
  issuer: FakeIssuer,
  options: { expires_in?: number } = {},
): Promise<{
  provider: string;
  access: string;
  refresh: string;
  device_code: string;
}> {
  const access = core.ids.newId("key");
  const refresh = core.ids.newId("key");
  const device_code = core.ids.newId("key");
  issuer.script({
    device: { device_code, user_code: "E2E-CODE" },
    device_code: [
      {
        kind: "tokens",
        access,
        refresh,
        expires_in: options.expires_in,
      },
    ],
  });
  const started = await core.call(providerSignIn, { definition: FAKE_DEVICE });
  const settled = await signInSettled(core, started.login, DEVICE_LOGIN_MS);
  if (settled.state !== "connected") {
    throw new Error(`fake 로그인이 끝나지 않았다: ${JSON.stringify(settled)}`);
  }
  const provider = started.provider;
  await core.call(modelDefaultChange, {
    default: { provider, model_name: MODEL_NAME, option_values: {} },
  });
  issuer.script({});
  return { provider, access, refresh, device_code };
}

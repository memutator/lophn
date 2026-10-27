import {
  loginBegin,
  loginComplete,
  modelDefaultChange,
} from "../../../packages/protocol/lophn-agent/mod.ts";
import type { Core } from "../core/mod.ts";
import { until } from "../core/human.ts";
import type { FakeIssuer } from "./mod.ts";

const MODEL_NAME = "claude-sonnet-4-5";
const DEVICE_LOGIN_MS = 30_000;

// 지금 core에 fake 발급자로 device code 로그인을 끝내 provider를 연결해 두고 기본 model로 정한다.
// 값은 모두 test 고유다. 끝나면 script를 비운다(다음 test가 앞의 줄을 받지 않게).
export async function connectOAuthProvider(
  core: Core,
  issuer: FakeIssuer,
  fake: { url: string },
  options: { expires_in?: number } = {},
): Promise<
  { provider: string; access: string; refresh: string; device_code: string }
> {
  const provider = core.ids.newId("pvd");
  const access = core.ids.newId("key");
  const refresh = core.ids.newId("key");
  const device_code = core.ids.newId("key");
  issuer.script({
    device: { device_code, user_code: "E2E-CODE" },
    device_code: [{
      kind: "tokens",
      access,
      refresh,
      expires_in: options.expires_in,
    }],
  });
  const started = await core.call(loginBegin, {
    provider,
    name: "fake subscription",
    definition: issuer.definition("supergrok"),
    endpoint: fake.url,
    protocol: "anthropic-messages",
  });
  // interval(0.1초) 전에 부르면 core가 발급자에 묻지 않고 pending을 돌려준다.
  await until("로그인이 끝남", async () => {
    const step = await core.call(loginComplete, {
      provider,
      login: started.login,
    });
    return step.state === "connected" ? step : undefined;
  }, DEVICE_LOGIN_MS);
  await core.call(modelDefaultChange, {
    default: { provider, model_name: MODEL_NAME, option_values: {} },
  });
  issuer.script({});
  return { provider, access, refresh, device_code };
}

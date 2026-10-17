import { err, ok, type Result } from "../../../base/mod.ts";
import type { RandomSource } from "../../../base/mod.ts";
import type { SecretStorePort } from "../../../protocol/secrets/secret-file.ts";

// provider credential의 `secrets.json` 이름이다. API key와 OAuth access token이 같은 이름 `provider.<id>`를 쓰고
// (credential의 secret_ref가 이것을 가리키고 목적지 규칙이 이 이름만 provider endpoint로 보낸다), OAuth는 그 옆에
// refresh token과 meta를 둔다. `.refresh`·`.meta`는 어떤 provider의 secret_name과도 같지 않아 core 밖으로 안 나간다.
export function providerSecretName(provider: string): string {
  return `provider.${provider.replace(/^pvd_/, "")}`;
}

export function providerTokenNames(provider: string): {
  access: string;
  refresh: string;
  meta: string;
} {
  const access = providerSecretName(provider);
  return { access, refresh: `${access}.refresh`, meta: `${access}.meta` };
}

// meta는 비밀이 아니지만 token과 함께 바뀌어 같은 저장소에 둔다. client_id는 ChatGPT가 첫 로그인에 발급한 것이고
// (갱신이 쓴다), subject는 검증한 id_token의 sub다. SuperGrok은 둘 다 null이다.
export type ProviderTokenMeta = {
  client_id: string | null;
  subject: string | null;
};

type Secrets = Pick<SecretStorePort, "get" | "put" | "delete">;

// refresh → meta → access 순으로 쓴다. access가 있으면 credential이 쓸 수 있는 것이므로 마지막이다.
// 하나라도 못 쓰면 이미 쓴 것을 지운다.
export async function saveProviderTokens(
  secrets: Secrets,
  provider: string,
  tokens: { access: string; refresh: string; meta: ProviderTokenMeta },
): Promise<Result<void>> {
  const names = providerTokenNames(provider);
  const writes: [string, string][] = [
    [names.refresh, tokens.refresh],
    [names.meta, JSON.stringify(tokens.meta)],
    [names.access, tokens.access],
  ];
  const written: string[] = [];
  for (const [name, value] of writes) {
    const put = await secrets.put(name, value);
    if (!put.ok) {
      for (const done of written) await secrets.delete(done);
      return err({ code: "unavailable", message: "token을 저장하지 못했다" });
    }
    written.push(name);
  }
  return ok(undefined);
}

export function loadProviderTokens(
  secrets: Secrets,
  provider: string,
): Result<{ access: string; refresh: string; meta: ProviderTokenMeta }> {
  const names = providerTokenNames(provider);
  const access = secrets.get(names.access);
  const refresh = secrets.get(names.refresh);
  const meta = secrets.get(names.meta);
  if (!access.ok || !refresh.ok || !meta.ok) {
    return err({ code: "unavailable", message: "저장된 token이 없다" });
  }
  const parsed = metaOf(meta.value);
  if (parsed === null) {
    return err({ code: "unavailable", message: "저장된 token meta가 깨졌다" });
  }
  return ok({ access: access.value, refresh: refresh.value, meta: parsed });
}

export async function removeProviderTokens(
  secrets: Secrets,
  provider: string,
): Promise<void> {
  const names = providerTokenNames(provider);
  for (const name of [names.access, names.refresh, names.meta]) {
    await secrets.delete(name);
  }
}

function metaOf(text: string): ProviderTokenMeta | null {
  try {
    const value = JSON.parse(text);
    const field = (key: string) =>
      typeof value?.[key] === "string" ? value[key] as string : null;
    return { client_id: field("client_id"), subject: field("subject") };
  } catch {
    return null;
  }
}

// ChatGPT 로그인의 `ext_agent_host_id`다. 설치마다 하나이고 한 번 만들면 다시 쓴다. 비밀이 아니지만 data root의
// 다른 저장 자리(settings는 사람이 고치는 선언, ledger-id는 restore 때 바뀐다)보다 맞아 `secrets.json`에 둔다.
// 이름 앞머리가 provider·mcp가 아니라 어떤 목적지로도 안 나간다.
const HOST_ID_NAME = "provider-oauth.host-id";

export async function hostIdOf(
  secrets: Secrets,
  random: RandomSource,
): Promise<Result<string>> {
  const saved = secrets.get(HOST_ID_NAME);
  if (saved.ok) return ok(saved.value);
  const bytes = new Uint8Array(16);
  random.fill(bytes);
  // RFC 4122 v4 꼴로 맞춘다.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const id = `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${
    hex.slice(12, 16)
  }-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const put = await secrets.put(HOST_ID_NAME, id);
  return put.ok
    ? ok(id)
    : err({ code: "unavailable", message: "설치 id를 저장하지 못했다" });
}

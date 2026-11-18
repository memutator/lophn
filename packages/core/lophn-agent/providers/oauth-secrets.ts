import { err, ok, type Result } from "../../../base/mod.ts";
import type { SecretStorePort } from "../../../protocol/secrets/secret-file.ts";

// provider credential의 `secrets.json` 이름이다. API key와 OAuth access token이 같은 이름 `provider.<id>`를 쓰고
// (credential의 secret_ref가 이것을 가리키고 목적지 규칙이 이 이름만 provider endpoint로 보낸다), OAuth는 그 옆에
// refresh token과 meta를 둔다. `.refresh`·`.meta`는 어떤 provider의 secret_name과도 같지 않아 core 밖으로 안 나간다.
export function providerSecretName(provider: string): string {
  return `provider.${provider.replace(/^pvd_/, "")}`;
}

// API key를 처음 받는 자리. 연결하는 쪽이 `provider.<id>.new.<무작위>`에 값을 올리고 ConnectProvider에 이 이름을 싣는다.
// core가 연결이 성공한 뒤에만 `provider.<id>`로 옮긴다. 같은 id가 이미 이어져 있으면(다른 창이 먼저 이었다) 그 provider의
// key가 덮이지 않는다. 무작위 꼬리라 두 창이 같은 순간에 이어도 서로의 값을 덮지 않는다.
export function isStagedProviderSecret(
  provider: string,
  name: string,
): boolean {
  const prefix = `${providerSecretName(provider)}.new.`;
  return name.startsWith(prefix) && name.length > prefix.length;
}

// provider id 없이 이름만 보는 임시 이름(`provider.<id>.new.<꼬리>`)이다. 연결이 어느 갈래로 끝나도 지우지만 그 사이에 core가
// 죽으면 남는다. 기동 때 이것으로 치운다.
export function isStagedSecretName(name: string): boolean {
  return /^provider\.[^.]+\.new\..+$/.test(name);
}

export function providerTokenNames(provider: string): {
  access: string;
  refresh: string;
  meta: string;
} {
  const access = providerSecretName(provider);
  return { access, refresh: `${access}.refresh`, meta: `${access}.meta` };
}

// meta는 비밀이 아니지만 token과 함께 바뀌어 같은 저장소에 둔다. subject는 계정 id(ChatGPT·Claude)다. SuperGrok은 null이다.
export type ProviderTokenMeta = {
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
    return {
      subject: typeof value?.subject === "string" ? value.subject : null,
    };
  } catch {
    return null;
  }
}

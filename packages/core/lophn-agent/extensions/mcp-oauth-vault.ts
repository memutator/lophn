import { err, ok, type Result } from "../../../base/mod.ts";
import type { AgentPlace } from "../../../protocol/lophn-agent/mod.ts";
import type { SecretPurpose } from "../../../protocol/server/mod.ts";

// MCP OAuth token 보관(concern lophn-agent/extensions, requirements #R16, #R17, platform/secrets#R1).
// 접근·갱신 token은 OS keychain에만 있고 ledger·설정·log에는 참조와 만료·묶음 정보만 있다. 서버(자리+이름)마다
// 한 벌이고, 같은 이름의 서버도 자리가 다르면 따로다. 벌마다 발급자·서버 URL·client를 함께 적어 두어(binding)
// 그 조합이 바뀌면 옛 token을 쓰지 않을 수 있게 한다(R17). 평문 파일·환경 변수 fallback은 없다.
//
// 값마다 따로 keychain 항목이다: core의 알려진 값 registry가 값 전체를 한 줄로 지우기 때문에 접근 token과 갱신
// token은 각자의 항목이어야 한다. 값이 바뀔 때는 항목의 참조도 바뀌어야 secret store가 새 값을 읽고 옛 값을
// 회수한다(secret-store의 이름별 참조 비교). 현재 벌이 어느 참조인지는 서버마다 고정 참조 하나인 meta 항목이
// 가진다(값 없음).

// 한 서버의 식별이다. 전역(Workspace) 서버는 자리가 null이다.
export type McpAuthKey = { place: AgentPlace | null; name: string };

function scopeOf(place: AgentPlace | null): string {
  return place === null ? "global" : place.id;
}

// 서버 하나를 가리키는 문자열이다(작업 메모리의 열쇠). 자리가 다르면 같은 이름도 다르다.
export function mcpAuthKeyId(key: McpAuthKey): string {
  return `${scopeOf(key.place)}\0${key.name}`;
}

// 설정의 `token_ref`가 가리키는 참조다. 서버 이름과 자리에서 정해진다: 같은 이름의 서버도 자리가 다르면
// 다른 참조라서 다른 자리의 설정을 손으로 맞춰도 그 서버의 token을 가리킬 수 없다.
export function mcpTokenRef(key: McpAuthKey): string {
  return `sec:mcp-oauth:${scopeOf(key.place)}:${key.name}`;
}

// token이 묶인 조합이다(R17). 이 중 하나라도 지금 설정과 다르면 token은 쓰지 않는다.
export type McpGrantBinding = {
  issuer: string;
  server_url: string;
  client_id: string;
};

export type McpGrant = {
  access_token: string;
  refresh_token: string | null;
  // 접근 token의 만료 시각(ms)이다. 발급자가 알리지 않았으면 null이다.
  expires_at_ms: number | null;
  // 갱신이 부를 token endpoint다.
  token_endpoint: string;
  binding: McpGrantBinding;
};

// 필요한 만큼만 쓰는 keychain 눈이다(platform/secrets의 KeychainAdapter와 같은 모양). 제품은 core가 OS adapter를
// 넘기고 시험은 fake를 넘긴다.
export type McpVaultKeychain = {
  status(): Promise<"available" | "unavailable">;
  store(item: {
    name: string;
    purpose: SecretPurpose;
    owner: string;
    value: Uint8Array;
    ref?: string;
  }): Promise<Result<string>>;
  load(ref: string): Promise<Result<Uint8Array>>;
  remove(ref: string): Promise<Result<void>>;
};

export type McpOAuthVault = {
  // 지금 벌을 읽는다. 보관한 것이 없으면 ok(null)이다. keychain을 읽을 수 없으면 unavailable이다: 비어 있는 것으로
  // 꾸미지 않는다.
  load(key: McpAuthKey): Promise<Result<McpGrant | null>>;
  // 새 벌로 바꾼다. 새 항목을 모두 둔 뒤에 meta를 바꾸고 옛 항목을 지운다. 중간에 실패하면 옛 벌이 그대로다.
  save(key: McpAuthKey, grant: McpGrant): Promise<Result<void>>;
  // 벌을 지운다. 없어도 오류가 아니다.
  remove(key: McpAuthKey): Promise<Result<void>>;
  // 알려진 값 registry에 올릴 참조다(이름과 참조뿐, 값 없음). 이 vault가 읽거나 저장한 벌만 나온다.
  refs(): readonly { name: string; sealedRef: string }[];
  // 접근·갱신 token의 현재 보관 참조다. 아직 읽거나 저장하지 않았거나 없으면 undefined다.
  sealedRefOf(key: McpAuthKey, kind: "access" | "refresh"): string | undefined;
};

type Meta = {
  v: 1;
  access_ref: string;
  refresh_ref: string | null;
  expires_at_ms: number | null;
  token_endpoint: string;
  binding: McpGrantBinding;
};

const PURPOSE: SecretPurpose = "external_mcp_credential";
const OWNER = "lophn-agent/extensions";

function unavailable(): Result<never> {
  return err({
    code: "unavailable",
    message: "OS keychain을 사용할 수 없다",
  });
}

function metaOf(value: unknown): Meta | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const binding = record["binding"] as Record<string, unknown> | undefined;
  if (
    record["v"] !== 1 || typeof record["access_ref"] !== "string" ||
    (record["refresh_ref"] !== null &&
      typeof record["refresh_ref"] !== "string") ||
    (record["expires_at_ms"] !== null &&
      typeof record["expires_at_ms"] !== "number") ||
    typeof record["token_endpoint"] !== "string" ||
    binding === undefined || binding === null ||
    typeof binding["issuer"] !== "string" ||
    typeof binding["server_url"] !== "string" ||
    typeof binding["client_id"] !== "string"
  ) return null;
  return record as unknown as Meta;
}

export function createMcpOAuthVault(options: {
  keychain: () => McpVaultKeychain;
  // 항목 참조를 만드는 무작위 값이다. 값에서 파생하지 않는다.
  randomRef: () => string;
}): McpOAuthVault {
  const index = new Map<
    string,
    { key: McpAuthKey; access: string; refresh: string | null }
  >();
  const queues = new Map<string, Promise<unknown>>();

  const idOf = mcpAuthKeyId;
  const base = (key: McpAuthKey) =>
    `mcp-oauth/${scopeOf(key.place)}/${key.name}`;
  const metaRef = (key: McpAuthKey) => `${base(key)}/meta`;

  // 같은 서버의 보관 작업은 차례로 한다: 저장과 지움이 겹쳐 반쯤 지워진 벌을 읽지 않는다.
  function serial<T>(key: McpAuthKey, run: () => Promise<T>): Promise<T> {
    const id = idOf(key);
    const previous = queues.get(id) ?? Promise.resolve();
    const next = previous.then(run, run);
    const tail = next.catch(() => undefined);
    queues.set(id, tail);
    void tail.then(() => {
      if (queues.get(id) === tail) queues.delete(id);
    });
    return next;
  }

  async function text(ref: string): Promise<Result<string | null>> {
    const loaded = await options.keychain().load(ref);
    if (loaded.ok) {
      const value = new TextDecoder().decode(loaded.value);
      loaded.value.fill(0);
      return ok(value);
    }
    return loaded.error.code === "not_found" ? ok(null) : unavailable();
  }

  async function readMeta(key: McpAuthKey): Promise<Result<Meta | null>> {
    if (await options.keychain().status() !== "available") {
      return unavailable();
    }
    const read = await text(metaRef(key));
    if (!read.ok) return read;
    if (read.value === null) return ok(null);
    try {
      return ok(metaOf(JSON.parse(read.value)));
    } catch {
      return ok(null);
    }
  }

  async function dropItems(refs: readonly (string | null)[]) {
    for (const ref of refs) {
      if (ref !== null) await options.keychain().remove(ref);
    }
  }

  return {
    load(key) {
      return serial(key, async () => {
        const meta = await readMeta(key);
        if (!meta.ok) return meta;
        if (meta.value === null) {
          index.delete(idOf(key));
          return ok(null);
        }
        const access = await text(meta.value.access_ref);
        if (!access.ok) return access;
        const refresh = meta.value.refresh_ref === null
          ? ok(null)
          : await text(meta.value.refresh_ref);
        if (!refresh.ok) return refresh;
        // 항목이 사라진 벌은 쓸 수 없다. 없는 것과 같다.
        if (
          access.value === null ||
          (meta.value.refresh_ref !== null && refresh.value === null)
        ) {
          index.delete(idOf(key));
          return ok(null);
        }
        index.set(idOf(key), {
          key,
          access: meta.value.access_ref,
          refresh: meta.value.refresh_ref,
        });
        return ok({
          access_token: access.value,
          refresh_token: refresh.value,
          expires_at_ms: meta.value.expires_at_ms,
          token_endpoint: meta.value.token_endpoint,
          binding: meta.value.binding,
        });
      });
    },

    save(key, grant) {
      return serial(key, async () => {
        const keychain = options.keychain();
        const previous = await readMeta(key);
        if (!previous.ok) return previous;
        const encoder = new TextEncoder();
        const stored: string[] = [];
        const put = async (name: string, value: string, ref: string) => {
          const bytes = encoder.encode(value);
          const saved = await keychain.store({
            name,
            purpose: PURPOSE,
            owner: OWNER,
            value: bytes,
            ref,
          });
          bytes.fill(0);
          if (saved.ok) stored.push(saved.value);
          return saved;
        };
        const rollback = async () => {
          // 새 항목만 지운다. 옛 벌은 그대로 남는다.
          const fixed = metaRef(key);
          await dropItems(stored.filter((ref) => ref !== fixed));
        };
        const access = await put(
          `${base(key)}/access`,
          grant.access_token,
          `${base(key)}/${options.randomRef()}`,
        );
        if (!access.ok) {
          await rollback();
          return unavailable();
        }
        let refreshRef: string | null = null;
        if (grant.refresh_token !== null) {
          const refresh = await put(
            `${base(key)}/refresh`,
            grant.refresh_token,
            `${base(key)}/${options.randomRef()}`,
          );
          if (!refresh.ok) {
            await rollback();
            return unavailable();
          }
          refreshRef = refresh.value;
        }
        const meta: Meta = {
          v: 1,
          access_ref: access.value,
          refresh_ref: refreshRef,
          expires_at_ms: grant.expires_at_ms,
          token_endpoint: grant.token_endpoint,
          binding: grant.binding,
        };
        const written = await put(
          `${base(key)}/meta`,
          JSON.stringify(meta),
          metaRef(key),
        );
        if (!written.ok) {
          await rollback();
          return unavailable();
        }
        index.set(idOf(key), {
          key,
          access: access.value,
          refresh: refreshRef,
        });
        if (previous.value !== null) {
          await dropItems([
            previous.value.access_ref,
            previous.value.refresh_ref,
          ]);
        }
        return ok(undefined);
      });
    },

    remove(key) {
      return serial(key, async () => {
        const meta = await readMeta(key);
        if (!meta.ok) return meta;
        index.delete(idOf(key));
        if (meta.value === null) return ok(undefined);
        const keychain = options.keychain();
        let failed = false;
        for (
          const ref of [
            meta.value.access_ref,
            meta.value.refresh_ref,
            metaRef(key),
          ]
        ) {
          if (ref === null) continue;
          const removed = await keychain.remove(ref);
          if (!removed.ok && removed.error.code !== "not_found") failed = true;
        }
        return failed ? unavailable() : ok(undefined);
      });
    },

    refs() {
      const refs: { name: string; sealedRef: string }[] = [];
      for (const entry of index.values()) {
        const name = `${base(entry.key)}`;
        refs.push({ name: `${name}/access`, sealedRef: entry.access });
        if (entry.refresh !== null) {
          refs.push({ name: `${name}/refresh`, sealedRef: entry.refresh });
        }
      }
      return refs;
    },

    sealedRefOf(key, kind) {
      const entry = index.get(idOf(key));
      if (entry === undefined) return undefined;
      return kind === "access" ? entry.access : entry.refresh ?? undefined;
    },
  };
}

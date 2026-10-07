// secret 보호 입력. 값이 있는 곳은 창의 보호 입력칸과 이 제출 동안의 main 메모리뿐이다.
// 순서(platform#T19 후속): (1) 값을 `/v1/secrets/input`으로 보내 값 없는 준비 증거를 받고,
// (2) 그 증거가 들어간 소유 command 입력의 binding으로 이 창의 handle을 만들고(증거를 받은
// 뒤에만 만들 수 있다), (3) 소유 command를 보내고, (4) 창에는 안전 이름과 저장 결과만 돌려준다.
// 값은 log·오류·IPC 결과 어디에도 넣지 않는다.
import { createHash } from "node:crypto";

import type { Canonical, DeferredPort } from "../coordinator.ts";
import type { ProviderCredentialFields } from "../types.ts";
import {
  bindingOf,
  failed,
  type KindCore,
  type Read,
  readFailure,
  record,
  sendCommand,
} from "./core.ts";

export const SET_SECRET = "SetSecret";
export const REGISTER_PROVIDER_CREDENTIAL = "RegisterProviderCredential";
export const CHANGE_PROVIDER_CREDENTIALS = "ChangeProviderCredentials";

/** contracts SECRET_INPUT_MAX_BYTES. */
export const SECRET_INPUT_MAX_BYTES = 64 * 1024;

const HANDLE_TTL_MS = 120_000;

/** 앱 secret. 처음 넣는 이름만 받는다. 교체 비교 기준은 main↔core 비교 read가 맡는다. */
async function readAppSecret(core: KindCore, name: string): Promise<Read> {
  const got = await core.internal("read", "secrets", "list", { names: [name] });
  if (!got.ok) return readFailure(got);
  const secrets = record(got.value).secrets;
  const status = record(
    (Array.isArray(secrets) ? secrets : []).map(record).find((item) =>
      item.name === name
    ),
  );
  const configured = status.configured === true;
  const revision = typeof status.revision === "number" ? status.revision : null;
  return {
    ok: true,
    value: {
      targetRef: name,
      content: { purpose: "app_secret", owner: name, configured, revision },
      // 이미 값이 있으면 교체 비교 기준(sealed_ref·revision)이 필요하다. 그 비교 read가
      // main↔core 비공개 통로에 아직 없으므로 지금은 고를 결정이 없다.
      allowed: configured ? [] : [SET_SECRET],
      expiresAt: null,
      secondConfirm: false,
      handle: "deferred",
      request: { kind: "secret_input", owner: name, purpose: "app_secret" },
      view: {
        kind: "secret",
        purpose: "app_secret",
        name,
        configured,
        entry: "value",
      },
    },
  };
}

/** provider credential 등록(contracts#T29). 값 아닌 등록 정보는 intent가 싣는다. */
async function readProviderCredential(
  core: KindCore,
  provider: string,
  credential: ProviderCredentialFields | undefined,
): Promise<Read> {
  if (credential === undefined) {
    return failed("invalid_input", "등록 정보가 없다");
  }
  const got = await core.internal("read", "providers", "read", { provider });
  if (!got.ok) return readFailure(got);
  const found = record(record(got.value).provider);
  const revision = found.revision;
  if (typeof revision !== "number") {
    return failed("not_found", "연결을 찾지 못했다");
  }
  return {
    ok: true,
    value: {
      targetRef: provider,
      content: {
        purpose: "provider_credential",
        owner: provider,
        revision,
        credential,
      },
      allowed: [REGISTER_PROVIDER_CREDENTIAL],
      expiresAt: null,
      secondConfirm: false,
      handle: "deferred",
      request: {
        kind: "secret_input",
        owner: provider,
        purpose: "provider_credential",
      },
      view: {
        kind: "secret",
        purpose: "provider_credential",
        name: credential.label,
        provider: typeof found.name === "string" ? found.name : null,
        configured: false,
        // OAuth code·최종 주소 붙여넣기도 같은 보호 입력이다.
        entry: credential.kind === "oauth" ? "code" : "key",
      },
    },
  };
}

/**
 * 등록한 계정 하나의 교체·삭제(contracts ChangeProviderCredentials). 표시 정본은
 * `/v1/provider-credentials/list`의 그 계정이고 비교 기준은 `providers/read`의 판이다. 교체는
 * 새 값을 보호 입력으로 받고, 삭제는 그 계정을 새 일에서 막을 뿐 값을 받지 않는다.
 */
async function readProviderCredentialChange(
  core: KindCore,
  provider: string,
  change: { key: string; action: "replace" | "revoke" },
): Promise<Read> {
  const got = await core.internal("read", "providers", "read", { provider });
  if (!got.ok) return readFailure(got);
  const found = record(record(got.value).provider);
  const revision = found.revision;
  if (typeof revision !== "number") {
    return failed("not_found", "연결을 찾지 못했다");
  }
  const listed = await core.internal("read", "provider-credentials", "list", {
    provider,
  });
  if (!listed.ok) return readFailure(listed);
  const credentials = record(listed.value).credentials;
  const current = record(
    (Array.isArray(credentials) ? credentials : []).map(record).find((item) =>
      item.key === change.key
    ),
  );
  if (
    typeof current.revision !== "number" || typeof current.order !== "number" ||
    typeof current.label !== "string"
  ) {
    return failed("not_found", "계정을 찾지 못했다");
  }
  return {
    ok: true,
    value: {
      targetRef: provider,
      content: {
        purpose: "provider_credential",
        owner: provider,
        revision,
        change: {
          key: change.key,
          action: change.action,
          revision: current.revision,
          order: current.order,
          label: current.label,
        },
      },
      allowed: [CHANGE_PROVIDER_CREDENTIALS],
      expiresAt: null,
      secondConfirm: false,
      handle: "deferred",
      request: {
        kind: "secret_input",
        owner: provider,
        purpose: "provider_credential",
      },
      view: {
        kind: "secret",
        purpose: "provider_credential",
        name: current.label,
        provider: typeof found.name === "string" ? found.name : null,
        configured: false,
        entry: change.action === "replace" ? "replace" : "revoke",
      },
    },
  };
}

export function readSecretInput(
  core: KindCore,
  intent: {
    owner: string;
    purpose: string;
    credential?: ProviderCredentialFields;
    change?: { key: string; action: "replace" | "revoke" };
  },
): Promise<Read> {
  if (intent.purpose === "app_secret") {
    return readAppSecret(core, intent.owner);
  }
  if (intent.purpose === "provider_credential") {
    return intent.change === undefined
      ? readProviderCredential(core, intent.owner, intent.credential)
      : readProviderCredentialChange(core, intent.owner, intent.change);
  }
  return Promise.resolve(failed("not_found", "이 입력을 받을 곳이 없다"));
}

/** 받은 증거에서 contract 네 field만 남긴다. 값은 증거에 없다. */
function evidenceOf(value: unknown): Record<string, string> | null {
  const item = record(value);
  const fields = ["preparation", "sealed_ref", "purpose", "owner"] as const;
  const out: Record<string, string> = {};
  for (const field of fields) {
    const one = item[field];
    if (typeof one !== "string" || one.length === 0) return null;
    out[field] = one;
  }
  return out;
}

/** 오류 문장은 고정 문장만 쓴다. core·transport의 message도 싣지 않는다. */
function safeError(code: string): { code: string; message: string } {
  return {
    code,
    message: code === "unavailable"
      ? "지금은 값을 저장할 수 없다"
      : "값을 저장하지 못했다",
  };
}

export function createSecretSubmitter(
  core: KindCore,
  clock: { now(): number },
): DeferredPort {
  return {
    async submit({ canonical, decision, commandInput, register }) {
      const content = record(canonical.content);
      const purpose = String(content.purpose);
      const owner = String(content.owner);
      if (!canonical.allowed.includes(decision)) {
        return { ok: false, error: safeError("forbidden") };
      }
      // 삭제는 받을 값이 없다. 증거 없이 계정 상태만 바꾼다.
      let evidence: Record<string, string> | null = null;
      let fingerprint: string | null = null;
      if (!isRevoke(content)) {
        const raw = record(commandInput).value;
        if (typeof raw !== "string" || raw.length === 0) {
          return { ok: false, error: safeError("invalid_input") };
        }
        const bytes = new TextEncoder().encode(raw);
        // 같은 key를 두 번 등록하지 않게 하는 지문은 값에서만 만들 수 있다. 값은 남지 않는다.
        fingerprint = createHash("sha256").update(bytes).digest("hex");
        try {
          if (bytes.length > SECRET_INPUT_MAX_BYTES) {
            return { ok: false, error: safeError("invalid_input") };
          }
          let uploaded;
          try {
            uploaded = await core.upload(
              "secrets",
              "input",
              { purpose, owner, bytes: bytes.length },
              bytes,
            );
          } catch {
            return { ok: false, error: safeError("unavailable") };
          }
          if (!uploaded.ok) {
            return { ok: false, error: safeError(uploaded.error.code) };
          }
          evidence = evidenceOf(uploaded.value);
        } finally {
          bytes.fill(0);
        }
        if (
          evidence === null || evidence.purpose !== purpose ||
          evidence.owner !== owner
        ) {
          return { ok: false, error: safeError("internal") };
        }
      }
      const built = commandOf(canonical, evidence, fingerprint);
      const bound = bindingOf(built.binding, built.input);
      const handle = await register({
        target_ref: bound.target,
        content_hash: bound.hash,
        allowed_decisions: [built.decision],
        expires_at: new Date(clock.now() + HANDLE_TTL_MS).toISOString(),
      });
      if (!handle.ok) return { ok: false, error: safeError("conflict") };
      const sent = await sendCommand(core, built.resource, built.method, {
        input: built.input,
        idempotency_key: `confirmation:${handle.confirmation}`,
        compare: built.compare,
        prepared: [],
        confirmation: handle.confirmation,
      });
      if (!sent.ok) {
        return {
          ok: false,
          error: safeError(sent.unknown ? "unavailable" : sent.error.code),
        };
      }
      return {
        ok: true,
        value: { secret_ref: built.safeName, stored: built.stored },
      };
    },
  };
}

/** 계정 삭제인지. 삭제는 값도 증거도 없다. */
function isRevoke(content: Record<string, unknown>): boolean {
  return record(content.change).action === "revoke";
}

function commandOf(
  canonical: Canonical,
  evidence: Record<string, string> | null,
  fingerprint: string | null,
): {
  decision: string;
  resource: string;
  method: string;
  binding: readonly string[];
  input: Record<string, unknown>;
  compare: Record<string, unknown>;
  safeName: string;
  stored: "stored" | "revoked";
} {
  const content = record(canonical.content);
  if (content.purpose === "provider_credential" && content.change) {
    // 교체는 그 계정에 새 값의 증거를 넣고, 삭제는 그 계정을 새 일에서 막는다. 순서·사용 여부는
    // 그대로다. 비교 기준은 연결의 판이고 계정의 판은 입력이 싣는다.
    const change = record(content.change);
    return {
      decision: CHANGE_PROVIDER_CREDENTIALS,
      resource: "provider-credentials",
      method: "change",
      binding: ["provider", "credentials"],
      input: {
        provider: content.owner,
        credentials: [{
          key: change.key,
          revision: change.revision,
          replacement: change.action === "replace" ? evidence : null,
          order: change.order,
          revoke: change.action === "revoke",
        }],
      },
      compare: { revision: content.revision },
      safeName: String(change.label),
      stored: change.action === "revoke" ? "revoked" : "stored",
    };
  }
  if (content.purpose === "provider_credential") {
    const credential = record(content.credential);
    return {
      decision: REGISTER_PROVIDER_CREDENTIAL,
      resource: "provider-credentials",
      method: "register",
      binding: ["provider", "key", "preparation"],
      input: {
        provider: content.owner,
        key: credential.key,
        kind: credential.kind,
        label: credential.label,
        preparation: evidence,
        account: credential.account ?? null,
        organization: credential.organization ?? null,
        plan: credential.plan ?? null,
        dedup_fingerprint: credential.dedup_fingerprint ?? fingerprint,
      },
      compare: { revision: content.revision },
      safeName: String(credential.label),
      stored: "stored",
    };
  }
  return {
    decision: SET_SECRET,
    resource: "secrets",
    method: "set",
    binding: ["name", "preparation"],
    input: { name: content.owner, preparation: evidence },
    compare: { sealed_ref: null, revision: null },
    safeName: String(content.owner),
    stored: "stored",
  };
}

// secret 보호 입력. 값이 있는 곳은 창의 보호 입력칸과 이 제출 동안의 main 메모리뿐이다.
// 순서: (1) 값을 `/v1/secrets/input`으로 보내 값 없는 준비 증거를 받고,
// (2) 그 증거가 들어간 소유 command 입력의 binding으로 이 창의 handle을 만들고(증거를 받은
// 뒤에만 만들 수 있다), (3) 소유 command를 보내고, (4) 창에는 안전 이름과 저장 결과만 돌려준다.
// 값은 log·오류·IPC 결과 어디에도 넣지 않는다.
import type { DeferredPort } from "../coordinator.ts";
import type { ProviderConnectFields } from "../types.ts";
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
// provider 연결(Connect): 보호 입력의 값을 준비 증거로 바꿔 provider와 credential 하나를 함께 등록한다.
// 이 command는 확인 handle을 요구하지 않는다: 사람이 보호 창에 직접 넣은 값이 곧 그 결정이다.
export const REGISTER_PROVIDER = "RegisterProvider";
// provider 끊기(Disconnect): provider와 credential(secret)을 함께 지우므로 확인 창의 handle을 거친다.
export const DISCONNECT_PROVIDER = "DisconnectProvider";
// OAuth 로그인 완료. oauth credential의 값은 secret store에 가지
// 않고 login-complete 교환의 submission으로만 간다(값은 보호 제출이지 보관이
// 아니다).
export const COMPLETE_PROVIDER_LOGIN = "CompleteProviderLogin";

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

/**
 * provider 연결(Connect). provider는 아직 없다: 값 아닌 등록 정보는 intent가 싣고 제출 때 받은 값의
 * 준비 증거와 함께 RegisterProvider로 등록한다. OAuth는 시작한 login handle로 CompleteProviderLogin을
 * 부른다.
 */
function readProviderConnect(
  owner: string,
  connect: ProviderConnectFields,
): Promise<Read> {
  const oauth = connect.kind === "oauth";
  return Promise.resolve({
    ok: true,
    value: {
      targetRef: owner,
      content: { purpose: "provider_credential", owner, connect },
      allowed: [oauth ? COMPLETE_PROVIDER_LOGIN : REGISTER_PROVIDER],
      expiresAt: null,
      secondConfirm: false,
      handle: "deferred",
      request: {
        kind: "secret_input",
        owner,
        purpose: "provider_credential",
      },
      view: {
        kind: "secret",
        purpose: "provider_credential",
        name: connect.name,
        provider: connect.name,
        configured: false,
        // OAuth code·최종 주소 붙여넣기도 같은 보호 입력이다.
        entry: oauth ? "code" : "key",
      },
    },
  });
}

/**
 * provider 끊기(contracts DisconnectProvider). 표시 정본과 비교 기준은 `providers/read`의 그
 * provider다. 값을 받지 않고 그 판의 provider와 credential만 지운다.
 */
async function readProviderDisconnect(
  core: KindCore,
  provider: string,
): Promise<Read> {
  const got = await core.internal("read", "providers", "read", { provider });
  if (!got.ok) return readFailure(got);
  const found = record(record(got.value).provider);
  const revision = found.revision;
  if (typeof revision !== "number" || typeof found.name !== "string") {
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
        disconnect: true,
        name: found.name,
      },
      allowed: [DISCONNECT_PROVIDER],
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
        name: found.name,
        provider: found.name,
        configured: true,
        entry: "disconnect",
      },
    },
  };
}

export function readSecretInput(
  core: KindCore,
  intent: {
    owner: string;
    purpose: string;
    connect?: ProviderConnectFields;
    disconnect?: true;
  },
): Promise<Read> {
  if (intent.purpose === "app_secret") {
    return readAppSecret(core, intent.owner);
  }
  if (intent.purpose === "provider_credential") {
    if (intent.connect !== undefined) {
      return readProviderConnect(intent.owner, intent.connect);
    }
    if (intent.disconnect === true) {
      return readProviderDisconnect(core, intent.owner);
    }
    return Promise.resolve(failed("invalid_input", "연결 정보가 없다"));
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

/** 제출이 부를 소유 command 하나. confirm은 확인 handle을 거치는 command인지다. */
interface Built {
  decision: string;
  resource: string;
  method: string;
  binding: readonly string[];
  input: Record<string, unknown>;
  compare: Record<string, unknown>;
  idempotencyKey: string;
  safeName: string;
  stored: "stored" | "revoked";
  confirm: boolean;
}

export function createSecretSubmitter(
  core: KindCore,
  clock: { now(): number },
): DeferredPort {
  return {
    async submit({ canonical, decision, commandInput, register }) {
      const content = record(canonical.content);
      if (!canonical.allowed.includes(decision)) {
        return { ok: false, error: safeError("forbidden") };
      }
      let built: Built;
      if (content.disconnect === true) {
        // 끊기는 받을 값이 없다. 증거 없이 그 판의 provider와 credential을 지운다.
        built = disconnectCommandOf(content);
      } else if (isOAuthLogin(content)) {
        // OAuth 로그인은 값을 secret store에 보관하지 않는다. 값은 login-complete
        // 교환의 submission으로만 간다.
        const raw = record(commandInput).value;
        if (typeof raw !== "string" || raw.trim().length === 0) {
          return { ok: false, error: safeError("invalid_input") };
        }
        built = loginCommandOf(content, raw);
      } else {
        const stored = await storeValue(
          core,
          String(content.purpose),
          String(content.owner),
          record(commandInput).value,
        );
        if (!stored.ok) return stored;
        built = content.purpose === "provider_credential"
          ? connectCommandOf(content, stored.evidence)
          : setSecretCommandOf(content, stored.evidence);
      }
      let confirmation: string | undefined;
      if (built.confirm) {
        const bound = bindingOf(built.binding, built.input);
        const handle = await register({
          target_ref: bound.target,
          content_hash: bound.hash,
          allowed_decisions: [built.decision],
          expires_at: new Date(clock.now() + HANDLE_TTL_MS).toISOString(),
        });
        if (!handle.ok) return { ok: false, error: safeError("conflict") };
        confirmation = handle.confirmation;
      }
      const sent = await sendCommand(core, built.resource, built.method, {
        input: built.input,
        idempotency_key: built.idempotencyKey === ""
          ? `confirmation:${confirmation}`
          : built.idempotencyKey,
        compare: built.compare,
        prepared: [],
        ...(confirmation === undefined ? {} : { confirmation }),
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

/**
 * 보호 입력의 값을 `/v1/secrets/input`으로 올려 값 없는 준비 증거를 받는다. 값은 이 함수의 byte 배열과
 * upload 본문에만 있고 끝나면 0으로 덮는다.
 */
async function storeValue(
  core: KindCore,
  purpose: string,
  owner: string,
  raw: unknown,
): Promise<
  { ok: true; evidence: Record<string, string> } | {
    ok: false;
    error: { code: string; message: string };
  }
> {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, error: safeError("invalid_input") };
  }
  const bytes = new TextEncoder().encode(raw);
  let evidence: Record<string, string> | null;
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
  return { ok: true, evidence };
}

/** OAuth 로그인 완료인지. 값은 secret store에 가지 않는다. */
function isOAuthLogin(content: Record<string, unknown>): boolean {
  return record(content.connect).kind === "oauth";
}

/** OAuth 로그인 완료 command다. submission은 사람이 붙여넣은 코드·최종 주소다. */
function loginCommandOf(
  content: Record<string, unknown>,
  submission: string,
): Built {
  const connect = record(content.connect);
  return {
    decision: COMPLETE_PROVIDER_LOGIN,
    resource: "providers",
    method: "login-complete",
    binding: ["provider", "login", "submission"],
    input: {
      provider: content.owner,
      login: connect.login,
      submission,
    },
    compare: {},
    idempotencyKey: "",
    safeName: String(connect.name),
    stored: "stored",
    confirm: true,
  };
}

/**
 * provider 연결(Connect) command다. 받은 값의 준비 증거로 provider와 credential 하나를 함께 등록한다.
 * 확인 handle을 거치지 않는다: 사람이 보호 창에 직접 넣은 값이 곧 결정이다. 같은 증거로 다시 보내도
 * 같은 요청이다.
 */
function connectCommandOf(
  content: Record<string, unknown>,
  evidence: Record<string, string>,
): Built {
  const connect = record(content.connect);
  return {
    decision: REGISTER_PROVIDER,
    resource: "providers",
    method: "register",
    binding: [],
    input: {
      id: content.owner,
      name: connect.name,
      definition: connect.definition,
      endpoint: connect.endpoint,
      protocol: connect.protocol,
      credential: { kind: connect.kind, preparation: evidence },
    },
    compare: {},
    idempotencyKey: `connect:${evidence.preparation}`,
    safeName: String(connect.name),
    stored: "stored",
    confirm: false,
  };
}

/** provider 끊기(Disconnect) command다. 비교 기준은 창을 연 때 읽은 provider의 판이다. */
function disconnectCommandOf(content: Record<string, unknown>): Built {
  return {
    decision: DISCONNECT_PROVIDER,
    resource: "providers",
    method: "disconnect",
    binding: ["provider"],
    input: { provider: content.owner },
    compare: { revision: content.revision },
    idempotencyKey: "",
    safeName: String(content.name),
    stored: "revoked",
    confirm: true,
  };
}

function setSecretCommandOf(
  content: Record<string, unknown>,
  evidence: Record<string, string>,
): Built {
  return {
    decision: SET_SECRET,
    resource: "secrets",
    method: "set",
    binding: ["name", "preparation"],
    input: { name: content.owner, preparation: evidence },
    compare: { sealed_ref: null, revision: null },
    idempotencyKey: "",
    safeName: String(content.owner),
    stored: "stored",
    confirm: true,
  };
}

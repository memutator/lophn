// stdin 시작 JSON 한 줄의 순수 검증. contracts app-start와 같은 판정.
import { SOCKET_PATH_MAX_BYTES } from "./limits.ts";

const ULID = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const SHA = /^[0-9a-f]{64}$/;
const CONTROL = /\p{Cc}/u;

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return;
  }
  const keys = Object.keys(value);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || descriptor.get) return;
  }
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  const known = new Set(keys);
  for (const key of Object.keys(value)) if (!known.has(key)) return key;
  return;
}

function id(value: unknown, prefix: string): string | undefined {
  if (typeof value !== "string") return;
  const body = value.slice(prefix.length + 1);
  return value.startsWith(`${prefix}_`) && ULID.test(body) ? value : undefined;
}

function endpoint(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return;
  return new TextEncoder().encode(value).byteLength < SOCKET_PATH_MAX_BYTES
    ? value
    : undefined;
}

const VERIFY_KEY = /^[A-Za-z0-9_-]{43}$/;

export type AppStart = {
  app: string;
  release: string | null;
  bundle_hash: string;
  mode: "live" | "preview" | "test";
  process_nonce: string;
  broker_socket: string;
  direct_socket: string;
  data_path: string;
  broker_credential: string;
  verify_key: string;
};

export function parseAppStart(line: string): AppStart | undefined {
  const trimmed = line.endsWith("\n") ? line.slice(0, -1) : line;
  if (trimmed.includes("\n")) return;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return;
  }
  const source = record(value);
  if (!source) return;
  if (
    exact(source, [
      "app",
      "release",
      "bundle_hash",
      "mode",
      "process_nonce",
      "broker_socket",
      "direct_socket",
      "data_path",
      "broker_credential",
      "verify_key",
    ])
  ) return;
  const app = id(source.app, "app");
  const release = source.release === null ? null : id(source.release, "rel");
  const bundle =
    typeof source.bundle_hash === "string" && SHA.test(source.bundle_hash)
      ? source.bundle_hash
      : undefined;
  const mode = source.mode === "live" || source.mode === "preview" ||
      source.mode === "test"
    ? source.mode
    : undefined;
  const nonce = typeof source.process_nonce === "string" &&
      source.process_nonce.length > 0 && !CONTROL.test(source.process_nonce)
    ? source.process_nonce
    : undefined;
  const broker = endpoint(source.broker_socket);
  const direct = endpoint(source.direct_socket);
  const data =
    typeof source.data_path === "string" && source.data_path.length > 0
      ? source.data_path
      : undefined;
  const credential = typeof source.broker_credential === "string" &&
      source.broker_credential.length > 0
    ? source.broker_credential
    : undefined;
  const verifyKey = typeof source.verify_key === "string" &&
      VERIFY_KEY.test(source.verify_key)
    ? source.verify_key
    : undefined;
  if (
    !app || release === undefined || !bundle || !mode || !nonce || !broker ||
    !direct || !data || !credential || !verifyKey ||
    (mode === "live" && release === null)
  ) return;
  return {
    app,
    release,
    bundle_hash: bundle,
    mode,
    process_nonce: nonce,
    broker_socket: broker,
    direct_socket: direct,
    data_path: data,
    broker_credential: credential,
    verify_key: verifyKey,
  };
}

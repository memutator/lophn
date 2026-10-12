// 머신 이전용 암호 보호 파일(platform/secrets#R9, architecture 5.7).
// 암호화·복호화는 이 모듈의 메모리에서만 한다. 평문 중간 파일은 만들지 않는다.
// secret.export·secret.import pipe 작업은 contracts에 아직 없다.
// 아래 타입은 그 작업이 올 자리의 추천 모양이고, 지금은 platform 안 타입이다.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  SECRET_EXCHANGE_FORMAT,
  type SecretPurpose,
  secretPurposeSchema,
} from "../../protocol/server/mod.ts";
import { argon2id } from "hash-wasm";

export type SecretExchangeItem = {
  name: string;
  purpose: SecretPurpose;
  owner: string;
  value: Uint8Array;
};

export type SecretExchangeFile = {
  bytes: Uint8Array;
};

const TEXT = new TextEncoder();
const FORMAT = SECRET_EXCHANGE_FORMAT.format;
const SALT_BYTES = SECRET_EXCHANGE_FORMAT.salt_bytes;
const NONCE_BYTES = SECRET_EXCHANGE_FORMAT.nonce_bytes;
const KEY_BYTES = 32;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + SALT_BYTES + NONCE_BYTES;

const REJECTED = {
  code: "invalid_input" as const,
  message: "보호 파일을 열 수 없다",
};

function randomBytes(length: number, random: () => Uint8Array): Uint8Array {
  const bytes = random();
  if (bytes.length !== length) {
    throw new Error("무작위 길이가 format과 다르다");
  }
  return bytes;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  // memorySize는 KiB. 64MiB = 65536 KiB. iterations는 Argon2 time cost다.
  const derived = await argon2id({
    password: TEXT.encode(passphrase),
    salt,
    iterations: SECRET_EXCHANGE_FORMAT.iterations,
    parallelism: SECRET_EXCHANGE_FORMAT.parallelism,
    memorySize: SECRET_EXCHANGE_FORMAT.memory_bytes / 1024,
    hashLength: KEY_BYTES,
    outputType: "binary",
  });
  const raw = new Uint8Array(derived);
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function payloadOf(
  items: readonly SecretExchangeItem[],
): Uint8Array<ArrayBuffer> {
  const body = {
    format: FORMAT,
    items: items.map((item) => ({
      name: item.name,
      purpose: item.purpose,
      owner: item.owner,
      value: bytesToBase64(item.value),
    })),
  };
  return new Uint8Array(TEXT.encode(JSON.stringify(body)));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array | undefined {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return undefined;
  }
}

export async function sealExchange(options: {
  items: readonly SecretExchangeItem[];
  passphrase: string;
  random?: () => Uint8Array;
}): Promise<Result<SecretExchangeFile>> {
  if (options.items.length === 0 || options.passphrase.length === 0) {
    return err({
      code: "invalid_input",
      message: "내보낼 항목이나 암호가 없다",
    });
  }
  const draws = options.random === undefined
    ? [
      crypto.getRandomValues(new Uint8Array(SALT_BYTES)),
      crypto.getRandomValues(
        new Uint8Array(NONCE_BYTES),
      ),
    ]
    : [
      randomBytes(SALT_BYTES, options.random),
      randomBytes(
        NONCE_BYTES,
        options.random,
      ),
    ];
  const [salt, nonce] = draws;
  const key = await deriveKey(options.passphrase, salt);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(nonce),
        additionalData: metadata(salt, nonce),
      },
      key,
      payloadOf(options.items),
    ),
  );
  const bytes = new Uint8Array(HEADER_BYTES + sealed.length);
  bytes[0] = FORMAT;
  bytes.set(salt, 1);
  bytes.set(nonce, 1 + SALT_BYTES);
  bytes.set(sealed, HEADER_BYTES);
  return ok({ bytes });
}

// metadata(format·salt·nonce)도 AES-GCM additional data로 인증한다.
function metadata(
  salt: Uint8Array,
  nonce: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(HEADER_BYTES);
  bytes[0] = FORMAT;
  bytes.set(salt, 1);
  bytes.set(nonce, 1 + SALT_BYTES);
  return bytes;
}

export async function openExchange(options: {
  file: SecretExchangeFile;
  passphrase: string;
}): Promise<Result<readonly SecretExchangeItem[]>> {
  const bytes = options.file.bytes;
  if (
    bytes.length < HEADER_BYTES + TAG_BYTES || bytes[0] !== FORMAT ||
    options.passphrase.length === 0
  ) {
    return err(REJECTED);
  }
  const salt = bytes.slice(1, 1 + SALT_BYTES);
  const nonce = bytes.slice(1 + SALT_BYTES, HEADER_BYTES);
  const sealed = bytes.slice(HEADER_BYTES);
  let plain: ArrayBuffer;
  try {
    const key = await deriveKey(options.passphrase, salt);
    plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(nonce),
        additionalData: metadata(salt, nonce),
      },
      key,
      sealed,
    );
  } catch {
    // 틀린 암호와 수정은 같은 거절이다. 어느 쪽인지 말하지 않는다.
    return err(REJECTED);
  }
  return parseItems(new Uint8Array(plain));
}

function parseItems(plain: Uint8Array): Result<readonly SecretExchangeItem[]> {
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return err(REJECTED);
  }
  if (
    typeof body !== "object" || body === null ||
    (body as { format?: unknown }).format !== FORMAT ||
    !Array.isArray((body as { items?: unknown }).items)
  ) {
    return err(REJECTED);
  }
  const items: SecretExchangeItem[] = [];
  for (const entry of (body as { items: unknown[] }).items) {
    if (typeof entry !== "object" || entry === null) return err(REJECTED);
    const record = entry as Record<string, unknown>;
    const purpose = secretPurposeSchema.safeParse(record.purpose);
    if (
      typeof record.name !== "string" || record.name.length === 0 ||
      typeof record.owner !== "string" || record.owner.length === 0 ||
      typeof record.value !== "string" || !purpose.success
    ) {
      return err(REJECTED);
    }
    const value = base64ToBytes(record.value);
    if (value === undefined) return err(REJECTED);
    items.push({
      name: record.name,
      purpose: purpose.data,
      owner: record.owner,
      value,
    });
  }
  if (items.length === 0) return err(REJECTED);
  return ok(items);
}

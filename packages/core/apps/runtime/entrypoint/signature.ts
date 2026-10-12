// AppConnection·ConfirmExecutionProof 서명(apps Q5).
// 서명 대상은 payload의 RFC 8785 canonical JSON UTF-8이고,
// signature는 raw 64byte Ed25519의 base64url이다. 앱은 공개 검증 key만 받는다.
import { canonicalize } from "../../../../base/canonical-json.ts";

const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;

export type VerifyKey = {
  verify(payload: string, signature: string): Promise<boolean>;
};

export type Signed<T> = { payload: T; signature: string };

export function decodeVerifyKey(encoded: string): VerifyKey | undefined {
  const raw = base64Url(encoded);
  if (!raw || raw.byteLength !== 32) return;
  const key = crypto.subtle.importKey("raw", raw, "Ed25519", false, ["verify"]);
  return {
    async verify(payload, signature) {
      if (!SIGNATURE.test(signature)) return false;
      const bytes = base64Url(signature);
      if (!bytes || bytes.byteLength !== 64) return false;
      const imported = await key;
      return await crypto.subtle.verify(
        "Ed25519",
        imported,
        bytes,
        new TextEncoder().encode(payload),
      );
    },
  };
}

export async function verifySigned<T>(
  key: VerifyKey,
  signed: Signed<T>,
  encode: (payload: T) => string,
): Promise<boolean> {
  if (!SIGNATURE.test(signed.signature)) return false;
  return await key.verify(encode(signed.payload), signed.signature);
}

export function canonicalPayload(value: unknown): string {
  return canonicalize(value);
}

function base64Url(value: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - value.length % 4) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return;
  }
}

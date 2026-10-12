// core 안 apps 제어 어댑터의 서명 key(apps Q5). core 시작마다 Ed25519 key 쌍을 하나 만들고, 공개 key는
// 앱 시작 입력의 `verify_key`로 주며, AppConnection과 confirm proof를 이 key로 서명한다. 비밀 key는
// 이 객체 안에만 있고 밖으로 내지 않는다. 서명 대상은 payload의 RFC 8785 canonical JSON UTF-8이고
// signature는 raw 64byte의 base64url이다(runtime/entrypoint/signature.ts가 같은 규칙으로 검증한다).
import {
  type AppConnection,
  type ConfirmExecutionProof,
  confirmProofSigningBytes,
  connectionSigningBytes,
  type SignedConfirmProof,
  type SignedConnection,
} from "../../protocol/apps/mod.ts";

export type CoreSigner = {
  // 앱 시작 입력의 verify_key. raw 32byte의 base64url이다.
  readonly verifyKey: string;
  signConnection(connection: AppConnection): Promise<SignedConnection>;
  // 이 core가 서명한 연결인지 본다. core 안에서 view 출처를 확인하는 곳이 쓴다(problems#T16).
  verifyConnection(signed: SignedConnection): Promise<boolean>;
  // accept_confirm이 낸 proof payload를 서명한다. 접수를 확정한 core만 부른다.
  signConfirmProof(proof: ConfirmExecutionProof): Promise<SignedConfirmProof>;
};

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return;
  const binary = atob(
    value.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - value.length % 4) % 4),
  );
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function createCoreSigner(): Promise<CoreSigner> {
  const pair = await crypto.subtle.generateKey("Ed25519", false, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const raw = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  const sign = async (payload: string): Promise<string> =>
    base64Url(
      new Uint8Array(
        await crypto.subtle.sign(
          "Ed25519",
          pair.privateKey,
          new TextEncoder().encode(payload),
        ),
      ),
    );
  return {
    verifyKey: base64Url(raw),
    async signConnection(connection) {
      return {
        payload: connection,
        signature: await sign(connectionSigningBytes(connection)),
      };
    },
    async verifyConnection(signed) {
      const bytes = fromBase64Url(signed.signature);
      return bytes !== undefined && await crypto.subtle.verify(
        "Ed25519",
        pair.publicKey,
        bytes,
        new TextEncoder().encode(connectionSigningBytes(signed.payload)),
      );
    },
    async signConfirmProof(proof) {
      return {
        payload: proof,
        signature: await sign(confirmProofSigningBytes(proof)),
      };
    },
  };
}

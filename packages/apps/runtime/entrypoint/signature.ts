// AppConnection·ConfirmExecutionProof 서명. platform/identity의 서명 byte 규약이
// 정해지기 전 앱이 로컬에서 검증하는 최소 모양이다. 공개 검증 key만 받는다.

export type VerifyKey = {
  verify(payload: string, signature: string): Promise<boolean>;
};

export type Signed<T> = { payload: T; signature: string };

export async function verifySigned<T>(
  key: VerifyKey,
  signed: Signed<T>,
  encode: (payload: T) => string,
): Promise<boolean> {
  if (signed.signature.length === 0) return false;
  return await key.verify(encode(signed.payload), signed.signature);
}

export function canonicalPayload(value: unknown): string {
  return JSON.stringify(value);
}

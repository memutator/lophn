// helper `lophn-credential`의 처리 본문이다(coding-agent/connection#R17, platform/identity#R15).
// 설치 묶음의 compile binary가 이 파일만 담는다. 그래서 의존성이 없고 상수는 계약
// (contracts/coding-agent connection-auth)과 같은 값이며 테스트가 같은지 본다.
//
// helper는 keychain이나 token 판정을 하지 않는다. stdin의 `CredentialDeliveryRequest`를 같은
// 데이터 폴더의 core가 연 소유자 전용 unix socket(`<H>/run/credential.sock`)에 그대로 건네고,
// core가 active connection·scope·등록된 child 확인을 모두 통과시킨 응답만 stdout에 낸다.
// 응답은 성공 `{"token": ...}` 또는 실패 `{"reason": ...}`뿐이다. 5초 안에 끝나지 않으면
// timeout이다. 평문 파일·user credential fallback은 없다.

export const CREDENTIAL_SOCKET_NAME = "credential.sock";
export const CREDENTIAL_HELPER_TIMEOUT_MS = 5_000;
export const CREDENTIAL_FAILURE_REASONS = [
  "locked",
  "no_secret_service",
  "timeout",
  "not_found",
] as const;
export type CredentialFailureReason =
  (typeof CREDENTIAL_FAILURE_REASONS)[number];

// 요청·응답은 작은 JSON이다. 이 상한을 넘으면 읽지 않는다.
export const CREDENTIAL_MESSAGE_LIMIT = 4096;

export function credentialSocketPath(dataRoot: string): string {
  return `${dataRoot.replace(/\/$/, "")}/run/${CREDENTIAL_SOCKET_NAME}`;
}

// 데이터 root는 core와 같은 근원이다: LOPHN_HOME, 없으면 ~/.lophn.
export function helperDataRoot(
  env: { LOPHN_HOME?: string; HOME?: string },
): string | undefined {
  if (env.LOPHN_HOME !== undefined && env.LOPHN_HOME !== "") {
    return env.LOPHN_HOME;
  }
  return env.HOME === undefined || env.HOME === ""
    ? undefined
    : `${env.HOME.replace(/\/$/, "")}/.lophn`;
}

export type HelperConnection = {
  write(bytes: Uint8Array): Promise<void>;
  closeWrite(): Promise<void>;
  readAll(limit: number): Promise<Uint8Array>;
  close(): void;
};

export type HelperOutcome =
  | { ok: true; stdout: Uint8Array }
  | { ok: false; reason: CredentialFailureReason };

export async function relayCredential(options: {
  request: Uint8Array;
  socketPath: string;
  connect(path: string): Promise<HelperConnection>;
  timeoutMs?: number;
}): Promise<HelperOutcome> {
  let connection: HelperConnection | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<HelperOutcome>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, reason: "timeout" }),
      options.timeoutMs ?? CREDENTIAL_HELPER_TIMEOUT_MS,
    );
  });
  const exchange = (async (): Promise<HelperOutcome> => {
    try {
      connection = await options.connect(options.socketPath);
    } catch {
      // core가 없거나 socket을 열지 않았다: 전달 통로가 없다.
      return { ok: false, reason: "no_secret_service" };
    }
    try {
      await connection.write(options.request);
      await connection.closeWrite();
      const reply = await connection.readAll(CREDENTIAL_MESSAGE_LIMIT);
      return outcomeOf(reply);
    } catch {
      return { ok: false, reason: "not_found" };
    }
  })();
  try {
    return await Promise.race([exchange, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    connection?.close();
  }
}

function outcomeOf(reply: Uint8Array): HelperOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(reply));
  } catch {
    return { ok: false, reason: "not_found" };
  }
  if (typeof parsed === "object" && parsed !== null) {
    const body = parsed as { token?: unknown; reason?: unknown };
    if (typeof body.token === "string" && body.token.length > 0) {
      return {
        ok: true,
        stdout: new TextEncoder().encode(JSON.stringify({ token: body.token })),
      };
    }
    const reason = CREDENTIAL_FAILURE_REASONS.find((item) =>
      item === body.reason
    );
    if (reason !== undefined) return { ok: false, reason };
  }
  return { ok: false, reason: "not_found" };
}

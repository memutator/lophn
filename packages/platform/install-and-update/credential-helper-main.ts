// `lophn-credential` compile binary의 entry다. stdin 요청을 core의 소유자 전용 socket으로
// 건네고 결과를 stdout에 낸다. 성공은 종료 코드 0과 `{"token": ...}`, 실패는 종료 코드 1과
// `{"reason": ...}`다. 일반 log·진단에는 요청 본문이나 token을 쓰지 않는다.
import {
  CREDENTIAL_MESSAGE_LIMIT,
  credentialSocketPath,
  type HelperConnection,
  helperDataRoot,
  relayCredential,
} from "./credential-helper.ts";

async function readAll(
  reader: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of reader) {
    size += chunk.byteLength;
    if (size > limit) throw new Error("message too large");
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function connect(path: string): Promise<HelperConnection> {
  const conn = await Deno.connect({ transport: "unix", path });
  return {
    async write(bytes) {
      let offset = 0;
      while (offset < bytes.byteLength) {
        offset += await conn.write(bytes.subarray(offset));
      }
    },
    closeWrite: () => conn.closeWrite(),
    readAll: (limit) => readAll(conn.readable, limit),
    close: () => {
      try {
        conn.close();
      } catch { /* 이미 닫혔다 */ }
    },
  };
}

async function main(): Promise<number> {
  const root = helperDataRoot({
    LOPHN_HOME: Deno.env.get("LOPHN_HOME"),
    HOME: Deno.env.get("HOME"),
  });
  const fail = async (reason: string) => {
    await Deno.stdout.write(
      new TextEncoder().encode(JSON.stringify({ reason })),
    );
    return 1;
  };
  if (root === undefined) return await fail("not_found");
  let request: Uint8Array;
  try {
    request = await readAll(Deno.stdin.readable, CREDENTIAL_MESSAGE_LIMIT);
  } catch {
    return await fail("not_found");
  }
  const outcome = await relayCredential({
    request,
    socketPath: credentialSocketPath(root),
    connect,
  });
  if (!outcome.ok) return await fail(outcome.reason);
  await Deno.stdout.write(outcome.stdout);
  return 0;
}

Deno.exit(await main());

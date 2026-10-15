// 앱 process의 control socket HTTP 호출. 가상 host lophn.invalid만 쓴다. 앱에 닿기 전에 실패한 것
// (`not_sent`)과 보낸 뒤 끊기거나 시간이 넘거나 응답이 상한을 넘은 것(`lost`)을 구별한다.
import type {
  ControlReply,
  ControlRequest,
  ControlTransport,
} from "../../apps/runtime/supervisor/mod.ts";

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  const length = Number(response.headers.get("content-length") ?? "0");
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  if (length > maxBytes) {
    await reader.cancel();
    return undefined;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

export const unixControlTransport: ControlTransport = async (
  request: ControlRequest,
): Promise<ControlReply> => {
  // 연결부터 확인한다. 연결하지 못하면 앱에는 아무것도 가지 않았다.
  try {
    const connection = await Deno.connect({
      transport: "unix",
      path: request.socket,
    });
    connection.close();
  } catch {
    return { kind: "not_sent" };
  }
  const client = Deno.createHttpClient({
    proxy: { transport: "unix", path: request.socket },
  });
  try {
    const response = await fetch(`http://lophn.invalid${request.path}`, {
      client,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: request.body,
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    const body = await readCapped(response, request.maxBytes);
    return body === undefined
      ? { kind: "lost" }
      : { kind: "reply", status: response.status, body };
  } catch {
    return { kind: "lost" };
  } finally {
    client.close();
  }
};

// 앱 direct socket으로 가는 unix socket HTTP다. `createAppDirect`의 transport다.
// 가상 host `lophn.invalid`만 쓰고 연결을 열지 못해 요청이 나가지 않은 것(NotSent)과
// 보낸 뒤 응답을 잃은 것(결과 불명)을 구별한다. 닿는 socket은 실행 권한이 정한 정확한 경로뿐이다:
// Deno는 unix socket 연결에 그 경로의 net·read·write 허락을 요구하므로 MCP 실행 argv가 앱 direct socket의
// 정확한 경로만 허락하고, 권한이 없거나 허용 목록 밖 endpoint는 연결하지 않고 NotSent다.
import { SOCKET_HOST } from "../../protocol/apps/mod.ts";
import { type AppDirectTransport, NotSent } from "./app-direct.ts";

export function unixAppDirectTransport(
  options: {
    // 있으면 이 목록의 경로만 연다. 실행 권한과 같은 값이다.
    allowed?: readonly string[];
  } = {},
): AppDirectTransport {
  const allowed = options.allowed === undefined
    ? undefined
    : new Set(options.allowed);
  return async (endpoint, request) => {
    if (allowed !== undefined && !allowed.has(endpoint)) throw new NotSent();
    // 먼저 소켓이 열리는지만 본다. 여기서 실패하면 요청은 나가지 않은 것이다(권한 없음 포함).
    try {
      const probe = await Deno.connect({ path: endpoint, transport: "unix" });
      probe.close();
    } catch {
      throw new NotSent();
    }
    let client: Deno.HttpClient;
    try {
      client = Deno.createHttpClient({
        proxy: { transport: "unix", path: endpoint },
      });
    } catch {
      throw new NotSent();
    }
    try {
      const response = await fetch(`http://${SOCKET_HOST}${request.path}`, {
        client,
        method: request.method,
        headers: {
          authorization: request.authorization,
          "content-type": "application/json",
        },
        body: JSON.stringify(request.body),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text.length === 0 ? null : JSON.parse(text),
      };
    } finally {
      client.close();
    }
  };
}

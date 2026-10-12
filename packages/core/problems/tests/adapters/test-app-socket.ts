// runner가 test 앱 대신 여는 Unix socket의 command 호출 자리(apps/runtime direct socket
// `/_lophn/commands/invoke`). 화면 검사 host의 화면이 `lophnApp.call`로 부르면 shell main이
// 이 socket에 빈 Authorization으로 POST한다. test 앱 socket은 연결 증명 없이 받는다: 이 socket은
// 임시 작업 폴더의 0700 Unix socket이고 host child만 경로를 안다.
import type { Result } from "../../../../base/mod.ts";

export const TEST_APP_INVOKE_PATH = "/_lophn/commands/invoke";

export type TestAppInvoke = (
  command: string,
  input: unknown,
) => Promise<Result<unknown>>;

export type TestAppSocket = {
  path: string;
  shutdown(): Promise<void>;
};

export function serveTestAppSocket(options: {
  path: string;
  invoke: TestAppInvoke;
}): TestAppSocket {
  // 같은 자리를 쓰던 이전 자식이 끝나며 남긴 socket 파일은 새로 듣기 전에 지운다.
  try {
    Deno.removeSync(options.path);
  } catch { /* 남은 파일이 없다 */ }
  const server = Deno.serve({ path: options.path, onListen() {} }, async (
    request,
  ) => {
    const url = new URL(request.url);
    if (url.pathname !== TEST_APP_INVOKE_PATH || request.method !== "POST") {
      return Response.json({ error: { code: "not_found" } }, { status: 404 });
    }
    const body = await request.json().catch(() => null) as
      | { command?: unknown; input?: unknown }
      | null;
    if (!body || typeof body.command !== "string") {
      return Response.json({ error: { code: "invalid_input" } }, {
        status: 400,
      });
    }
    const result = await options.invoke(body.command, body.input);
    return result.ok
      ? Response.json({ result: { result: result.value } })
      : Response.json({ error: result.error }, { status: 409 });
  });
  return { path: options.path, shutdown: () => server.shutdown() };
}

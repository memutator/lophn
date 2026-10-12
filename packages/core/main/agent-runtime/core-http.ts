import { err, ok, type Result } from "../../../base/mod.ts";
import { RUNTIME_MACHINE_ROUTES } from "../../lophn-agent/run-loop/mod.ts";
import { API_MAJOR, routePath } from "../../../protocol/server/mod.ts";
import type { CoreCall } from "../../lophn-agent/run-loop/core-call.ts";

export {
  RUNTIME_MACHINE_OPERATIONS,
  RUNTIME_MACHINE_ROUTES,
} from "../../lophn-agent/run-loop/mod.ts";

const MACHINE_PATHS: ReadonlySet<string> = new Set(
  RUNTIME_MACHINE_ROUTES.map((route) => routePath(route)),
);

type Fetch = typeof fetch;

async function post(
  fetchImpl: Fetch,
  port: number,
  token: string,
  path: string,
  body: unknown,
): Promise<Result<unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return err({ code: "unavailable", message: "core is not reachable" });
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return err({ code: "unavailable", message: "unexpected core reply" });
  }
  if (response.status === 200) return ok(parsed);
  const error = (parsed as {
    error?: {
      code?: string;
      message?: string;
      details?: Record<string, unknown>;
    };
  })
    .error;
  return err({
    code: (error?.code ?? "internal") as "internal",
    message: error?.message ?? "core error",
    ...(error?.details === undefined ? {} : { details: error.details }),
  });
}

export function machineCall(options: {
  port: number;
  // 호출 시점의 사용 허가를 가진 credential. 없으면 요청하지 않는다.
  credential(): string | undefined;
  fetch?: Fetch;
}): CoreCall {
  return (path, body) => {
    if (!MACHINE_PATHS.has(path)) {
      return Promise.resolve(
        err({ code: "invalid_input", message: "route is not open" }),
      );
    }
    const token = options.credential();
    if (!token) {
      return Promise.resolve(
        err({ code: "unauthorized", message: "credential is not usable" }),
      );
    }
    return post(options.fetch ?? fetch, options.port, token, path, body);
  };
}

// runtime client는 `apps/connect`처럼 resource/method를 준다. loop는 routePath(/v1/...)를 준다.
function httpPath(path: string): string {
  return path.startsWith("/") ? path : `/v${API_MAJOR}/${path}`;
}

export function agentCall(options: {
  port: number;
  token: string;
  fetch?: Fetch;
}): CoreCall {
  return (path, body) =>
    post(
      options.fetch ?? fetch,
      options.port,
      options.token,
      httpPath(path),
      body,
    );
}

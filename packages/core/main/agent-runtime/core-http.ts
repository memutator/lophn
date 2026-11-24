import { request as httpRequest } from "node:http";
import { err, ok, type Result } from "../../../base/mod.ts";
import { routePath } from "../../../protocol/base/mod.ts";
import type { CoreCall } from "../../lophn-agent/run-loop/core-call.ts";
import { RUNTIME_MACHINE_ROUTES } from "../../lophn-agent/run-loop/mod.ts";

export {
  RUNTIME_MACHINE_OPERATIONS,
  RUNTIME_MACHINE_ROUTES,
} from "../../lophn-agent/run-loop/mod.ts";

const MACHINE_PATHS: ReadonlySet<string> = new Set(
  RUNTIME_MACHINE_ROUTES.map((route) => routePath(route)),
);

type Fetch = typeof fetch;

// Node의 기본 fetch(undici)는 headersTimeout이 5분(300s)이라 사람 응답을 기다리는
// `/ask/wait`·`/tool-gate/check` 호출이 5분 뒤 `unavailable`로 끊긴다.
// loopback core 호출은 `node:http`로 timeout 없이 열어 두어 사람이 답할 때까지 기다린다.
function postNodeHttp(
  port: number,
  token: string,
  path: string,
  payload: string,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const bytes = Buffer.from(payload, "utf8");
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        agent: false,
        timeout: 0,
        headers: {
          "content-type": "application/json",
          "content-length": String(bytes.byteLength),
          authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer | string) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", reject);
      },
    );
    req.setTimeout(0);
    req.on("error", reject);
    req.end(bytes);
  });
}

async function post(
  fetchImpl: Fetch | undefined,
  port: number,
  token: string,
  path: string,
  body: unknown,
): Promise<Result<unknown>> {
  const payload = JSON.stringify(body);
  let status: number;
  let parsed: unknown;
  if (fetchImpl !== undefined) {
    let response: Response;
    try {
      response = await fetchImpl(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: payload,
      });
    } catch {
      return err({ code: "unavailable", message: "core is not reachable" });
    }
    status = response.status;
    try {
      parsed = await response.json();
    } catch {
      return err({ code: "unavailable", message: "unexpected core reply" });
    }
  } else {
    let reply: { status: number; text: string };
    try {
      reply = await postNodeHttp(port, token, path, payload);
    } catch {
      return err({ code: "unavailable", message: "core is not reachable" });
    }
    status = reply.status;
    try {
      parsed = JSON.parse(reply.text);
    } catch {
      return err({ code: "unavailable", message: "unexpected core reply" });
    }
  }
  if (status === 200) return ok(parsed);
  const error = (
    parsed as {
      error?: {
        code?: string;
        message?: string;
        details?: Record<string, unknown>;
      };
    }
  ).error;
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
    return post(options.fetch, options.port, token, path, body);
  };
}

// runtime client는 `apps/connect`처럼 resource/method를 준다. loop는 routePath(/resource/method)를 준다.
function httpPath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export function agentCall(options: {
  port: number;
  token: string;
  fetch?: Fetch;
}): CoreCall {
  return (path, body) =>
    post(options.fetch, options.port, options.token, httpPath(path), body);
}

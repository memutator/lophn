// direct socket의 앱 쪽 구현.
import { DIRECT_SOCKET_PATHS } from "./limits.ts";
import { type HttpHandler, jsonResponse, serveUnix } from "./http.ts";
import { verifyConnection } from "./verify.ts";
import { handleControl } from "./control.ts";
import { handleScreen } from "./screens.ts";
import { handleInvoke } from "./invoke.ts";
import type { RuntimeState } from "./state.ts";

export function startDirectServer(state: RuntimeState) {
  const handler: HttpHandler = async (request) => {
    const authorization = request.headers.get("authorization");
    const verified = await verifyConnection(
      state.key,
      authorization,
      state.identity,
      state.clock,
    );
    if (!verified.ok) {
      return jsonResponse(statusFor(verified.error.code), {
        error: verified.error,
      });
    }
    if (request.path.startsWith(DIRECT_SOCKET_PATHS.screen)) {
      if (request.method !== "GET") {
        return jsonResponse(400, {
          error: { code: "invalid_input", message: "screen is GET" },
        });
      }
      const screen = handleScreen(state, request.url, verified.connection);
      if ("error" in screen) {
        return jsonResponse(screen.status, { error: screen.error });
      }
      return {
        status: 200,
        headers: { "content-type": screen.contentType },
        body: screen.body,
      };
    }
    if (request.path.startsWith("/_lophn/control/")) {
      if (request.method !== "POST") {
        return jsonResponse(400, {
          error: { code: "invalid_input", message: "control is POST" },
        });
      }
      const body = parse(request.body);
      if (!body.ok) {
        return jsonResponse(400, {
          error: { code: "invalid_input", message: "control body is not JSON" },
        });
      }
      const control = handleControl(
        state,
        request.path,
        body.value,
        verified.connection,
      );
      if ("error" in control) {
        return jsonResponse(control.status, { error: control.error });
      }
      return jsonResponse(control.status, control.body);
    }
    if (request.path.startsWith("/_lophn/commands/")) {
      if (request.path.endsWith("/status") && request.method !== "GET") {
        return jsonResponse(400, {
          error: { code: "invalid_input", message: "status is GET" },
        });
      }
      if (!request.path.endsWith("/status") && request.method !== "POST") {
        return jsonResponse(400, {
          error: { code: "invalid_input", message: "command is POST" },
        });
      }
      const outcome = await handleInvoke(
        state,
        request.path,
        request.method === "GET" ? request.url.searchParams : request.body,
        verified.connection,
      );
      if (outcome.error) {
        return jsonResponse(outcome.status, { error: outcome.error });
      }
      return jsonResponse(outcome.status, outcome.body);
    }
    return jsonResponse(404, {
      error: { code: "not_found", message: "unknown path" },
    });
  };
  return serveUnix(state.directSocket, handler);
}

function parse(body: Uint8Array): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(body)) };
  } catch {
    return { ok: false };
  }
}

function statusFor(code: string): number {
  switch (code) {
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "conflict":
      return 409;
    case "unavailable":
      return 503;
    default:
      return 400;
  }
}

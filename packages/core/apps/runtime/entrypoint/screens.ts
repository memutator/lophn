// 화면 byte. view_session은 프로세스 안에서 분리하고 socket 위치는 응답에 없다.
import { parseScreenPath, parseScreenQuery } from "./wire.ts";
import { verifyScreen } from "./verify.ts";
import type { RuntimeState } from "./state.ts";
import type { AppConnection } from "./wire.ts";

export type ScreenResult =
  | { status: number; body: Uint8Array; contentType: string }
  | { status: number; error: { code: string; message: string } };

export function handleScreen(
  state: RuntimeState,
  url: URL,
  connection: AppConnection,
): ScreenResult {
  const parsed = parseScreenPath(url.pathname);
  if (!parsed) {
    return {
      status: 400,
      error: { code: "invalid_input", message: "screen path is invalid" },
    };
  }
  const query = parseScreenQuery(url.searchParams);
  if (!query) {
    return {
      status: 400,
      error: {
        code: "invalid_input",
        message: "screen size or view is missing",
      },
    };
  }
  const rejected = verifyScreen({
    connection,
    screen: parsed.screen,
    size: query.size,
    blueprint: state.blueprint,
  });
  if (rejected) {
    const status = rejected.code === "forbidden" ? 403 : 400;
    return {
      status,
      error: { code: rejected.code, message: rejected.message },
    };
  }
  if (state.closedViews.has(query.view_session)) {
    return {
      status: 409,
      error: { code: "conflict", message: "view session is closed" },
    };
  }
  const bytes = state.screenBytes(parsed.screen, parsed.path);
  if (!bytes) {
    return {
      status: 404,
      error: { code: "not_found", message: "screen asset is missing" },
    };
  }
  const existing = state.views.get(query.view_session);
  if (
    existing &&
    (existing.screen !== parsed.screen || existing.size !== query.size)
  ) {
    return {
      status: 409,
      error: {
        code: "conflict",
        message: "view session is bound to another screen",
      },
    };
  }
  state.views.set(query.view_session, {
    id: query.view_session,
    screen: parsed.screen,
    size: query.size,
  });
  return {
    status: 200,
    body: bytes,
    contentType: state.contentType(parsed.path),
  };
}

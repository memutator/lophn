import { err, type Result } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import type { Route } from "../../protocol/base/mod.ts";
import {
  WORKSPACE_ROUTES,
  type WorkspaceReadOutput,
  workspaceReadOutputSchema,
} from "../../protocol/shell/mod.ts";
import {
  createRedactionEngine,
  type KnownSecretRegistry,
} from "../../base/redaction/mod.ts";
import { createKnownSecretRegistry } from "../../base/redaction/mod.ts";
import type { MemoryHandler } from "./dispatch.ts";

// 현재 보기 relay. 값은 이 모듈의 core 메모리에만 있고
// ledger·blob·log에 가지 않는다.
export const WORKSPACE_MEMORY_ROUTES: readonly Route[] = WORKSPACE_ROUTES;

// 창 수 상한. 크기는 창 수 × (2048 bytes + 탭 page)로 묶인다.
export const WORKSPACE_MAX_WINDOWS = 64;

// relay 값 하나. publish가 보낸 상태와 session 결합만 담는다.
type WindowState = {
  window_ref: string;
  generation: number;
  observed_at: string;
  summary: string;
  tab_pages: unknown[][];
  session: string | null;
};

export type WorkspaceRelay = {
  routes: readonly Route[];
  handlers: Map<string, MemoryHandler>;
  // redaction 알려진 값 registry. 등록된 secret이 relay 반환에 새지 않게 한다.
  registry: KnownSecretRegistry;
  // main 연결이 끊기거나 core epoch가 바뀌면 그 main의 값을 모두 disconnected로 바꾼다.
  disconnect(): void;
};

const VISIBLE_VIEW_FIELDS = [
  "availability",
  "observed_at",
  "generation",
  "summary",
  "next_page",
  "tab_page",
] as const;

export function createWorkspaceRelay(): WorkspaceRelay {
  // publish가 온 창. key는 window_ref다.
  const windows = new Map<string, WindowState>();
  // bind가 잇는 session → window_ref. read가 자기 session의 창을 찾는 데 쓴다.
  const sessions = new Map<string, string>();
  const known = createKnownSecretRegistry();
  const engine = createRedactionEngine({ registry: known });

  let connected = true;

  function disconnect(): void {
    connected = false;
    windows.clear();
    sessions.clear();
  }

  const handlers = new Map<string, MemoryHandler>();

  handlers.set("workspace/publish", (ctx, input) => {
    if (!connected) {
      return err({ code: "unavailable", message: "workspace relay 끊겼다" });
    }
    const record = input as {
      window_ref: string;
      generation: number;
      observed_at: string;
      summary: string;
      tab_pages: unknown[][];
    };
    // 같은 main이 한 창의 publish를 다시 보내면 대체한다. 다른 값은 관여하지 않는다.
    if (
      !windows.has(record.window_ref) && windows.size >= WORKSPACE_MAX_WINDOWS
    ) {
      return err({ code: "conflict", message: "workspace window limit" });
    }
    windows.set(record.window_ref, { ...record, session: null });
    // publish는 결합을 지우지 않는다. bind가 우선이다.
    for (const [session, ref] of sessions) {
      if (ref === record.window_ref) {
        windows.set(record.window_ref, { ...record, session });
      }
    }
    return ok(ctx);
  });

  handlers.set("workspace/bind", (ctx, input) => {
    if (!connected) {
      return err({ code: "unavailable", message: "workspace relay 끊겼다" });
    }
    const record = input as { session: string; window_ref: string };
    const window = windows.get(record.window_ref);
    if (!window) {
      return err({ code: "not_found", message: "window not published" });
    }
    // session 하나에 창 하나. 다른 창에 잇던 결합을 옮긴다.
    sessions.set(record.session, record.window_ref);
    windows.set(record.window_ref, { ...window, session: record.session });
    return ok(ctx);
  });

  handlers.set("workspace/unpublish", (ctx, input) => {
    if (!connected) {
      return err({ code: "unavailable", message: "workspace relay 끊겼다" });
    }
    const record = input as { window_ref: string };
    const window = windows.get(record.window_ref);
    if (!window) {
      return err({ code: "not_found", message: "window not published" });
    }
    windows.delete(record.window_ref);
    for (const [session, ref] of sessions) {
      if (ref === record.window_ref) sessions.delete(session);
    }
    return ok(ctx);
  });

  handlers.set("workspace/read", async (ctx, input) => {
    const record = input as { session: string; page?: number };
    // agent는 자기 credential이 묶인 session만 읽는다.
    const session = ctx.conditions.session;
    if (!session || session !== record.session) {
      return absent("unavailable", "turn session unavailable");
    }
    const ref = sessions.get(record.session);
    if (!ref) return absent("disconnected", "session window not bound");
    const window = windows.get(ref);
    if (!window) return absent("disconnected", "window not published");
    const page = record.page ?? 0;
    if (page < 0 || page >= window.tab_pages.length) {
      return absent("unavailable", "page outside range");
    }
    // 반환 전에 redaction을 거친다. JSON 순환은 구조 검사에서 걸린다.
    const payload = {
      availability: "current",
      observed_at: window.observed_at,
      generation: window.generation,
      summary: window.summary,
      next_page: page + 1 < window.tab_pages.length ? page + 1 : undefined,
      tab_page: window.tab_pages[page],
    };
    const redacted = await engine.redact({
      source: {
        concern: "platform/api",
        revision: "workspace-relay",
        scope: "session_input",
      },
      media_type: "application/json",
      audience: "model",
      safe_fields: [...VISIBLE_VIEW_FIELDS],
      private_fields: [],
    }, JSON.stringify(payload));
    if (redacted.status === "omitted" || redacted.content === null) {
      return absent("unavailable", "redaction omitted");
    }
    if (redacted.content.kind !== "inline") {
      return absent("unavailable", "workspace read unavailable");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(redacted.content.value);
    } catch {
      return absent("unavailable", "workspace read unavailable");
    }
    const output = workspaceReadOutputSchema.safeParse(parsed);
    if (!output.success) {
      return absent("unavailable", "workspace read unavailable");
    }
    return { ok: true, value: output.data as WorkspaceReadOutput };
  });

  return {
    routes: WORKSPACE_MEMORY_ROUTES,
    handlers,
    registry: known,
    disconnect,
  };
}

function absent(
  availability: "disconnected" | "unavailable",
  reason: string,
): Result<WorkspaceReadOutput> {
  // 옛 값을 current로 주지 않는다.
  const shaped = workspaceReadOutputSchema.safeParse({ availability, reason });
  if (!shaped.success) {
    return err({ code: "unavailable", message: "workspace read unavailable" });
  }
  return { ok: true, value: shaped.data as WorkspaceReadOutput };
}

function ok(_ctx: AuthenticatedContext): Result<unknown> {
  return { ok: true, value: {} };
}

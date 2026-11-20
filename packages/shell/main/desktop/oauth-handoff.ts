// 다른 컴퓨터의 loopback OAuth 로그인(`remote_handoff`)을 이 컴퓨터에서 한 번의 클릭으로 끝내기 위한 임시 loopback
// listener다. `start`가 redirect_uri의 loopback port를 열고, `wait`가 browser에서 돌아온 callback 주소 하나를 기다려
// 돌려준다. port가 이미 쓰이고 있으면 `conflict`로 돌려 renderer가 "Paste redirected URL" 입력으로 이어 가게 한다.
// loopback(127.0.0.1·::1·localhost) http 주소만 열고, 기록에는 origin·path만 남겨 code·state를 쓰지 않는다.
import { createServer, type Server } from "node:http";
import { z } from "zod";

import { errorCode } from "../../../base/mod.ts";
import type {
  OAuthHandoffReply,
  OAuthHandoffRequest,
} from "../../ipc/oauth-handoff.ts";
import {
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "./ipc-guard.ts";

const WAIT_TIMEOUT_MS = 5 * 60_000;
const CALLBACK_DONE = "Signed in. You can close this tab and go back to lophn.";
const CALLBACK_REFUSED = "Sign-in was not completed. You can close this tab.";

const handoffRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("start"),
    id: z.string().min(1).max(128),
    redirectUri: z.string().min(1).max(2048),
    state: z.string().min(1).max(512),
  }),
  z.strictObject({
    action: z.literal("wait"),
    id: z.string().min(1).max(128),
  }),
  z.strictObject({
    action: z.literal("cancel"),
    id: z.string().min(1).max(128),
  }),
]);

export interface ParsedLoopback {
  readonly hosts: readonly string[];
  readonly port: number;
  readonly path: string;
  readonly origin: string;
}

/** redirect_uri가 이 기계의 loopback http 주소인지 검사한다. 그 밖의 host·scheme·port는 거절한다. */
export function parseLoopbackRedirect(raw: string): ParsedLoopback | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || url.username !== "" || url.password !== "") {
    return null;
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    return null;
  }
  return {
    hosts: host === "localhost" ? ["127.0.0.1", "::1"] : [host],
    port,
    path: url.pathname,
    origin: url.origin,
  };
}

interface PendingHandoff {
  readonly wait: Promise<OAuthHandoffReply>;
  cancel(): Promise<void>;
}

export interface OAuthHandoffHost {
  handle(request: OAuthHandoffRequest): Promise<OAuthHandoffReply>;
  stopAll(): Promise<void>;
}

function listenOne(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (thrown: unknown) => {
      server.off("listening", onListening);
      reject(thrown);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

/** 임시 loopback callback listener 묶음. IPC handler와 단위 테스트가 같이 쓴다. */
export function createOAuthHandoffHost(deps: {
  log(line: string): void;
  timeoutMs?: number;
}): OAuthHandoffHost {
  const timeoutMs = deps.timeoutMs ?? WAIT_TIMEOUT_MS;
  const active = new Map<string, PendingHandoff>();

  async function start(
    id: string,
    redirectUri: string,
    expectedState: string,
  ): Promise<OAuthHandoffReply> {
    const parsed = parseLoopbackRedirect(redirectUri);
    if (parsed === null) return { ok: false, code: "invalid_input" };
    // 같은 id로 다시 시작하면 앞 listener를 닫는다.
    await active.get(id)?.cancel();

    let settled = false;
    let resolveWait: (reply: OAuthHandoffReply) => void = () => {};
    const wait = new Promise<OAuthHandoffReply>((resolve) => {
      resolveWait = resolve;
    });
    const servers: Server[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = async (reply: OAuthHandoffReply): Promise<void> => {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      active.delete(id);
      await Promise.all(servers.map(closeServer));
      resolveWait(reply);
    };

    const makeServer = () =>
      createServer((req, res) => {
        if (settled) {
          res.writeHead(409, { "content-type": "text/plain; charset=utf-8" });
          res.end("Already received.");
          return;
        }
        const url = new URL(req.url ?? "/", parsed.origin);
        if (url.pathname !== parsed.path) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end("Not found.");
          return;
        }
        const state = url.searchParams.get("state");
        const ours = state === expectedState;
        if (url.searchParams.get("error") !== null && ours) {
          res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
          res.end(CALLBACK_REFUSED);
          void finish({ ok: true, callbackUrl: url.href });
          return;
        }
        const code = url.searchParams.get("code");
        if (code === null || code.length === 0 || !ours) {
          res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          res.end("Invalid callback.");
          return;
        }
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end(CALLBACK_DONE);
        void finish({ ok: true, callbackUrl: url.href });
      });

    for (const host of parsed.hosts) {
      const server = makeServer();
      try {
        await listenOne(server, host, parsed.port);
        servers.push(server);
      } catch (thrown) {
        const code = errorCode(thrown);
        // IPv6가 없는 기계에서는 ::1을 잡지 못해도 127.0.0.1로 받는다.
        if (
          servers.length > 0 &&
          (code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT")
        ) {
          continue;
        }
        await Promise.all(servers.map(closeServer));
        return code === "EADDRINUSE"
          ? { ok: false, code: "conflict" }
          : { ok: false, code: "unavailable" };
      }
    }

    timer = setTimeout(() => {
      void finish({ ok: false, code: "unavailable" });
    }, timeoutMs);

    active.set(id, {
      wait,
      cancel: () => finish({ ok: false, code: "cancelled" }),
    });
    deps.log(
      `oauth handoff listening origin=${parsed.origin} path=${parsed.path}`,
    );
    return { ok: true };
  }

  return {
    async handle(request) {
      if (request.action === "start") {
        return await start(request.id, request.redirectUri, request.state);
      }
      const entry = active.get(request.id);
      if (request.action === "cancel") {
        await entry?.cancel();
        return { ok: true };
      }
      if (entry === undefined) return { ok: false, code: "unavailable" };
      return await entry.wait;
    },
    async stopAll() {
      await Promise.all([...active.values()].map((entry) => entry.cancel()));
    },
  };
}

/** desktop 창 본문의 `shell:oauth-handoff`. caller·입력 검사 뒤 host로 넘긴다. */
export function createOAuthHandoffIpc(deps: {
  registry: ContentsRegistry;
  host: OAuthHandoffHost;
}) {
  return async (
    event: IpcEvent,
    input: unknown,
  ): Promise<OAuthHandoffReply> => {
    const caller = checkCaller(deps.registry, event);
    if (!caller.ok || caller.value.origin.host !== "desktop") {
      return { ok: false, code: "forbidden" };
    }
    const parsed = checkInput(handoffRequestSchema, input);
    if (!parsed.ok) return { ok: false, code: "invalid_input" };
    return await deps.host.handle(parsed.value);
  };
}

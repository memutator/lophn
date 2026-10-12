import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  appEntryUrl,
  createAppProtocolHandler,
  nodeUpstream,
  parseAppUrl,
  type ProtocolView,
  type Upstream,
  type UpstreamRequest,
  type UpstreamResponse,
  VIEW_HEADER,
} from "./app-protocol.ts";
import { navigationAllowed } from "./network-policy.ts";

const LABEL = "app-01j9zzzzzzzzzzzzzzzzzzzzzz";
const VIEW: ProtocolView = {
  view_session: "view-1",
  appLabel: LABEL,
  screen: "main",
  size: "panel",
  endpoint: "/run/lophn/app.sock",
  authorization: '{"payload":{"app":"app_x"},"signature":"secret-sig"}',
  hosts: [{ host: "api.example.com", port: 443 }],
};

function body(text: string): ReadableStream<Uint8Array> {
  return new Response(text).body!;
}

function harness(reply: (request: UpstreamRequest) => UpstreamResponse) {
  const seen: UpstreamRequest[] = [];
  const stale: string[] = [];
  const upstream: Upstream = (request) => {
    seen.push(request);
    return Promise.resolve(reply(request));
  };
  const handler = createAppProtocolHandler({
    viewFor: (token, label) =>
      token === "token-1" && label === LABEL ? VIEW : undefined,
    upstream,
    stale: (view) => stale.push(view),
  }, LABEL);
  const request = (
    url: string,
    init: { method?: string; token?: string | null } = {},
  ) =>
    handler(
      new Request(url, {
        method: init.method ?? "GET",
        headers: init.token === null ? {} : {
          [VIEW_HEADER]: init.token ?? "token-1",
        },
      }),
    );
  return { seen, stale, request };
}

const html = (): UpstreamResponse => ({
  status: 200,
  headers: { "content-type": "text/html; charset=utf-8" },
  body: body("<p>hi</p>"),
});

test("shell/app-frame#R9, shell/app-frame#R12: 앱 요청은 main이 정한 연결·size·view_session으로 socket에 가고 view에는 socket·인증이 없다", async () => {
  const { seen, request } = harness(html);
  const response = await request(
    `lophn-app://${LABEL}/main/index.html?view_session=other&size=full#x`,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "<p>hi</p>");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.endpoint, VIEW.endpoint);
  assert.equal(seen[0]!.authorization, VIEW.authorization);
  // 페이지 query는 넘기지 않는다. main의 size·view_session만 붙는다.
  assert.equal(
    seen[0]!.path,
    "/screens/main/index.html?size=panel&view_session=view-1",
  );
  const headers = [...response.headers.entries()].flat().join(" ");
  assert.equal(headers.includes("secret-sig"), false);
  assert.equal(headers.includes(".sock"), false);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("shell/app-frame#R11: 대소문자를 바꾼 host도 같은 앱으로만 풀리고 다른 label·port·userinfo는 없는 것과 같다", async () => {
  assert.deepEqual(
    parseAppUrl(`lophn-app://${LABEL.toUpperCase()}/main/a/b.js`, LABEL),
    { screen: "main", asset: ["a", "b.js"] },
  );
  assert.equal(
    appEntryUrl(LABEL, "main"),
    `lophn-app://${LABEL}/main/index.html`,
  );
  const { seen, request } = harness(html);
  for (
    const url of [
      "lophn-app://app-01j9yyyyyyyyyyyyyyyyyyyyyy/main/index.html",
      `lophn-app://${LABEL}:8080/main/index.html`,
    ]
  ) {
    assert.equal((await request(url)).status, 404, url);
  }
  assert.equal(seen.length, 0);
  assert.equal(
    parseAppUrl(`lophn-app://u:p@${LABEL}/main/index.html`, LABEL),
    undefined,
  );
});

test("shell/app-frame#R9: 경로 이탈·인코딩한 구분자·다른 screen·모르는 view는 socket에 가지 않고 같은 404다", async () => {
  const { seen, request } = harness(html);
  for (
    const url of [
      `lophn-app://${LABEL}/main/%2e%2e/secret`,
      `lophn-app://${LABEL}/main/a%2fb.js`,
      `lophn-app://${LABEL}/main/a%5cb.js`,
      `lophn-app://${LABEL}/main/c:x`,
      `lophn-app://${LABEL}/main/%00`,
      `lophn-app://${LABEL}/main`,
      `lophn-app://${LABEL}/other/index.html`,
    ]
  ) {
    assert.equal((await request(url)).status, 404, url);
  }
  assert.equal(
    (await request(`lophn-app://${LABEL}/main/index.html`, { token: "nope" }))
      .status,
    404,
  );
  assert.equal(
    (await request(`lophn-app://${LABEL}/main/index.html`, { token: null }))
      .status,
    404,
  );
  assert.equal(
    (await request(`lophn-app://${LABEL}/main/index.html`, { method: "POST" }))
      .status,
    405,
  );
  assert.equal(seen.length, 0);
});

test("shell/app-frame#R9: 같은 screen 안 redirect만 이 view 주소로 바꾸고 다른 연결로의 redirect는 거절한다", async () => {
  let location = "next.html";
  const { request } = harness(() => ({
    status: 302,
    headers: { location },
    body: body(""),
  }));
  const same = await request(`lophn-app://${LABEL}/main/index.html`);
  assert.equal(same.status, 307);
  assert.equal(
    same.headers.get("location"),
    `lophn-app://${LABEL}/main/next.html`,
  );
  for (
    const target of [
      "/screens/other/index.html",
      "http://evil.example.com/",
      "http://127.0.0.1:7431/v1/apps/connect",
      "/_lophn/commands/invoke",
      "lophn-app://app-01j9yyyyyyyyyyyyyyyyyyyyyy/main/index.html",
    ]
  ) {
    location = target;
    const refused = await request(`lophn-app://${LABEL}/main/index.html`);
    assert.equal(refused.status, 502, target);
    assert.equal(refused.headers.get("location"), null);
  }
});

test("shell/app-frame#R16: 허용하지 않은 MIME은 거절하고 응답 CSP는 앱 CSP와 함께 겹친다", async () => {
  let reply: UpstreamResponse = {
    status: 200,
    headers: { "content-type": "application/octet-stream" },
    body: body("x"),
  };
  const { request } = harness(() => reply);
  assert.equal(
    (await request(`lophn-app://${LABEL}/main/a.bin`)).status,
    502,
  );
  reply = { status: 200, headers: {}, body: body("x") };
  assert.equal((await request(`lophn-app://${LABEL}/main/a`)).status, 502);
  reply = {
    status: 200,
    headers: {
      "content-type": "text/javascript",
      "content-security-policy": "script-src 'none'",
      "set-cookie": "a=b",
      "access-control-allow-origin": "*",
    },
    body: body("1"),
  };
  const ok = await request(`lophn-app://${LABEL}/main/app.js`);
  assert.equal(ok.status, 200);
  const csp = ok.headers.get("content-security-policy") ?? "";
  assert.match(csp, /connect-src 'self' https:\/\/api\.example\.com:443/);
  assert.match(csp, /script-src 'none'/);
  assert.equal(ok.headers.get("access-control-allow-origin"), null);
});

test("shell/app-frame#R12: 연결이 거절되면(만료·회수) registry에 알리고 view는 옛 인증으로 다시 부르지 않는다", async () => {
  const { stale, request } = harness(() => ({
    status: 401,
    headers: { "content-type": "application/json" },
    body: body('{"error":{"code":"unauthorized"}}'),
  }));
  const response = await request(`lophn-app://${LABEL}/main/index.html`);
  assert.equal(response.status, 503);
  assert.equal(await response.text(), "");
  assert.deepEqual(stale, ["view-1"]);
});

test("shell/app-frame#R9: Node client는 socketPath로 붙어 응답을 stream으로 넘기고 취소하면 upstream도 끊는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lophn-sock-"));
  const socket = join(dir, "a.sock");
  let closed!: () => void;
  const upstreamClosed = new Promise<void>((resolve) => closed = resolve);
  const seen: { host?: string; authorization?: string; url?: string }[] = [];
  const server = createServer((incoming, outgoing: ServerResponse) => {
    seen.push({
      host: incoming.headers.host,
      authorization: incoming.headers.authorization,
      url: incoming.url,
    });
    outgoing.writeHead(200, { "content-type": "text/plain" });
    // 끝나지 않는 응답. main은 이것을 모으지 않고 흘려야 한다.
    const timer = setInterval(() => outgoing.write("x".repeat(1024)), 5);
    outgoing.on("close", () => {
      clearInterval(timer);
      closed();
    });
  });
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  try {
    const handler = createAppProtocolHandler({
      viewFor: () => ({ ...VIEW, endpoint: socket }),
      upstream: nodeUpstream,
      stale: () => {},
    }, LABEL);
    const controller = new AbortController();
    const response = await handler(
      new Request(`lophn-app://${LABEL}/main/stream.txt`, {
        headers: { [VIEW_HEADER]: "token-1" },
        signal: controller.signal,
      }),
    );
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const first = await reader.read();
    assert.equal(first.done, false);
    assert.deepEqual(seen, [{
      host: "lophn.invalid",
      authorization: VIEW.authorization,
      url: "/screens/main/stream.txt?size=panel&view_session=view-1",
    }]);
    controller.abort();
    await upstreamClosed;
    await reader.cancel().catch(() => {});
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("shell/app-frame#R9: socket이 없으면 view에 경로를 보이지 않고 503이다", async () => {
  const handler = createAppProtocolHandler({
    viewFor: () => ({
      ...VIEW,
      endpoint: join(tmpdir(), "lophn-missing.sock"),
    }),
    upstream: nodeUpstream,
    stale: () => {},
  }, LABEL);
  const response = await handler(
    new Request(`lophn-app://${LABEL}/main/index.html`, {
      headers: { [VIEW_HEADER]: "token-1" },
    }),
  );
  assert.equal(response.status, 503);
  assert.equal(await response.text(), "");
});

test("apps/agent-context#R2: 첫 주소는 이 view의 session만 page query로 싣고 앱 socket 요청에는 그 query가 아니라 main이 정한 session만 간다", async () => {
  const entry = appEntryUrl(LABEL, "main", "view-1");
  assert.equal(
    entry,
    `lophn-app://${LABEL}/main/index.html?view_session=view-1`,
  );
  // 같은 화면의 주소라 탐색이 허용되고 경로 해석은 query와 무관하다.
  assert.equal(navigationAllowed(entry, LABEL, "main"), true);
  assert.deepEqual(parseAppUrl(entry, LABEL), {
    screen: "main",
    asset: ["index.html"],
  });
  // 페이지가 다른 session을 query로 주장해도 socket에는 main이 정한 view의 session이 간다.
  const { seen, request } = harness(html);
  const forged =
    `lophn-app://${LABEL}/main/index.html?view_session=view-other&size=full`;
  assert.equal((await request(forged)).status, 200);
  assert.equal(seen[0]!.path.includes("view_session=view-1"), true);
  assert.equal(seen[0]!.path.includes("view-other"), false);
  // 세션이 없는 호출은 query를 붙이지 않는다.
  assert.equal(
    appEntryUrl(LABEL, "main"),
    `lophn-app://${LABEL}/main/index.html`,
  );
});

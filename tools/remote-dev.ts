// 폰 앱 없이 remote 화면을 browser(컴퓨터나 같은 network의 폰)로 열어 보는 개발용 명령.
// 실행: npm run dev:remote  (먼저 `npm run dev`나 `npm run dev:core`가 떠 있어야 한다)
// 개발 core(.dev-data)를 사람 자격으로 붙어 remote listener를 켜고 pairing code를 하나 받은 뒤, renderer의 dist/remote를
// 정적으로 내주고 code를 실은 주소를 찍는다. 주소를 열면 화면이 그 code로 pairing하고 core에 붙는다. code는 5분, 한 번이다.
// 개발 core의 remote port는 사람의 lophn(기본 7432)과 겹치지 않게 47432로 둔다.
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { cliDial } from "../packages/cli/connection/client/node.ts";
import {
  CONTROL_REQUEST_TIMEOUT_MS,
  controlConnect,
  createRpcClient,
} from "../packages/protocol/client/mod.ts";
import { settingsUpdate } from "../packages/protocol/config/file.ts";
import { pairingStart } from "../packages/protocol/remote/routes.ts";

const REMOTE_PORT = 47432;
const PAGE_PORT = 5174;
const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "packages/shell/renderer/dist/remote");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function fail(message: string): never {
  console.error(`dev:remote: ${message}`);
  process.exit(1);
}

// 개발용 bridge(remote/dev)가 든 build인지 본다. prod build에는 그 chunk가 없어 "폰 앱에서 연다"만 보인다.
const chunks = await readdir(join(dist, "chunks")).catch(() => []);
if (!chunks.some((name) => name.startsWith("dev-remote-"))) {
  fail(
    "renderer의 개발 build(dist/remote)가 없다. `npm run dev`나 `npm run dev:core`를 띄우면 만든다.",
  );
}

const server = createServer(async (request, response) => {
  const path = normalize(
    decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname),
  ).replace(/^\/+/, "");
  if (path.split("/").includes("..")) {
    response.writeHead(400).end();
    return;
  }
  const file = path === "" ? "index.html" : path;
  try {
    const bytes = await readFile(join(dist, file));
    response
      .writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      })
      .end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
// page port를 먼저 잡는다. 이미 다른 dev:remote가 쥐고 있으면 새 pairing code로 그 쪽 code를 무효로 만들기 전에 끝낸다.
await new Promise<void>((resolve) => {
  server.once("error", (error: NodeJS.ErrnoException) =>
    fail(
      error.code === "EADDRINUSE"
        ? `port ${PAGE_PORT}를 이미 쓴다. 떠 있는 dev:remote를 Ctrl+C로 끝내고 다시 띄운다.`
        : error.message,
    ),
  );
  server.listen(PAGE_PORT, "0.0.0.0", resolve);
});

const dial = cliDial({
  dataRoot: join(root, ".dev-data"),
  platform: process.platform,
  xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
});
if (!dial.ok) fail(dial.error.message);
const connected = await controlConnect(
  { dial: dial.value, timeoutMs: CONTROL_REQUEST_TIMEOUT_MS },
  "cli",
);
if (!connected.ok) {
  fail(
    `개발 core에 붙지 못했다(${connected.error.code}). 먼저 \`npm run dev\`나 \`npm run dev:core\`를 띄운다.`,
  );
}
const core = createRpcClient({
  baseUrl: connected.value.api_url,
  token: connected.value.user_token,
  fetch: async (input, init) => {
    const response = await fetch(input, init);
    return {
      status: response.status,
      headers: response.headers,
      bytes: new Uint8Array(await response.arrayBuffer()),
    };
  },
});

const updated = await core.call(settingsUpdate, {
  changes: [
    { key: "remote.enabled", action: "set", value: true },
    { key: "remote.port", action: "set", value: REMOTE_PORT },
    // 개발 core는 lophn이 띄운 실제 relay에 붙지 않는다. browser는 direct로 붙는다.
    { key: "remote.relay", action: "set", value: "" },
  ],
});
if (!updated.ok) fail(`remote를 켜지 못했다: ${updated.error.message}`);
if (updated.value.rejected.length > 0) {
  fail(`remote 설정이 거절됐다: ${JSON.stringify(updated.value.rejected)}`);
}

// listener는 설정 변경을 받고 열린다. 열리기 전에는 pairing/start가 unavailable이다.
let qr: string | undefined;
for (let tries = 0; tries < 50 && qr === undefined; tries += 1) {
  const started = await core.call(pairingStart, {});
  if (started.ok) {
    const { expires_at: _, ...pairing } = started.value;
    qr = JSON.stringify(pairing);
  } else if (started.error.code === "unavailable") {
    await sleep(100);
  } else {
    fail(`pairing code를 받지 못했다: ${started.error.message}`);
  }
}
if (qr === undefined) fail("remote listener가 열리지 않는다");

const hash = `#pair=${encodeURIComponent(qr)}`;
const lan = Object.values(networkInterfaces())
  .flat()
  .filter((net) => net?.family === "IPv4" && !net.internal)
  .map((net) => net?.address);
console.log("remote 화면(이 컴퓨터):");
console.log(`  http://localhost:${PAGE_PORT}/${hash}`);
for (const address of lan) {
  console.log(`같은 network의 폰:\n  http://${address}:${PAGE_PORT}/${hash}`);
}
console.log(
  "pairing code는 5분 안에 한 번 쓴다. 다시 받으려면 이 명령을 다시 띄운다. 끝내려면 Ctrl+C.",
);

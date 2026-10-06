// 실제 앱 진입점의 화면 자원(shell#T37, apps/sdk#R33). 진입점이 bundle 사본의 screens/를 내주지 않으면
// 실제 앱 프로세스의 `GET /screens/<screen>/<path>`가 모두 404다.
import { assert, assertEquals } from "@std/assert";
import { createCoreSigner } from "../signing.ts";
import { bundleScreenFiles, screenContentType } from "./screen-files.ts";
import { main } from "./main.ts";
import { APP, blueprint, connection, HASH, NONCE, REL } from "./testing.ts";
import { SOCKET_HOST } from "./limits.ts";

async function bundleWithScreens(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "lophn-screens-" });
  await Deno.mkdir(`${dir}/screens/usage/assets`, { recursive: true });
  await Deno.mkdir(`${dir}/screens/other`, { recursive: true });
  await Deno.writeTextFile(
    `${dir}/screens/usage/index.html`,
    '<!doctype html><script type="module" src="./index.js"></script>',
  );
  await Deno.writeTextFile(
    `${dir}/screens/usage/index.js`,
    "export const usage = 1;",
  );
  await Deno.writeTextFile(`${dir}/screens/usage/assets/a.css`, "body{}");
  await Deno.writeTextFile(`${dir}/screens/other/index.html`, "<p>other</p>");
  await Deno.writeTextFile(`${dir}/secret.txt`, "outside screens");
  return dir;
}

Deno.test("shell#T37 apps/runtime: bundle screen files are served only under their own screen with a type the shell accepts", async () => {
  const dir = await bundleWithScreens();
  try {
    const files = bundleScreenFiles(dir);
    const html = files.screenBytes("usage", "index.html");
    assert(html);
    assertEquals(
      new TextDecoder().decode(html).includes("index.js"),
      true,
    );
    assert(files.screenBytes("usage", "assets/a.css"));
    // 다른 screen의 파일과 screen 밖 경로·없는 파일은 내주지 않는다.
    assertEquals(files.screenBytes("usage", "../other/index.html"), undefined);
    assertEquals(files.screenBytes("usage", "../../secret.txt"), undefined);
    assertEquals(files.screenBytes("..", "secret.txt"), undefined);
    assertEquals(files.screenBytes("usage", "missing.js"), undefined);
    assertEquals(files.screenBytes("usage", "assets"), undefined);
    assertEquals(
      files.contentType("index.html"),
      "text/html; charset=utf-8",
    );
    assertEquals(screenContentType("a/b.css"), "text/css; charset=utf-8");
    assertEquals(screenContentType("i.js"), "text/javascript; charset=utf-8");
    assertEquals(screenContentType("f.woff2"), "font/woff2");
    assertEquals(screenContentType("run.exe"), "application/octet-stream");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("shell#T37 apps/runtime#R8: the real entrypoint serves /screens/<screen>/index.html and its assets from the bundle", async () => {
  const dir = await bundleWithScreens();
  const signer = await createCoreSigner();
  const socket = `${dir}/a.sock`;
  try {
    await main({
      readLine: () =>
        Promise.resolve(
          JSON.stringify({
            app: APP,
            release: REL,
            bundle_hash: HASH,
            mode: "live",
            process_nonce: NONCE,
            broker_socket: `${dir}/b.sock`,
            direct_socket: socket,
            data_path: dir,
            broker_credential: "child-cred",
            verify_key: signer.verifyKey,
          }),
        ),
      importModule: () =>
        Promise.resolve({ createExceptionObserver: () => () => undefined }),
      blueprint: blueprint(),
      broker: () => Promise.resolve({ status: 503, body: null }),
      dataSchema: 0,
      reportTransport: () => Promise.resolve(undefined),
      exit: () => undefined,
      writeStderr: () => undefined,
      ...bundleScreenFiles(dir),
    });
    const authorization = JSON.stringify(
      await signer.signConnection(
        // 진입점은 실제 시계를 쓴다. 만료는 지금 뒤로 둔다.
        connection({
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }) as Parameters<typeof signer.signConnection>[0],
      ),
    );
    const index = await get(
      socket,
      "/screens/usage/index.html?size=full&view_session=v1",
      authorization,
    );
    assertEquals(index.status, 200);
    assertEquals(index.type, "text/html; charset=utf-8");
    assertEquals(index.body.includes("index.js"), true);
    const script = await get(
      socket,
      "/screens/usage/index.js?size=full&view_session=v1",
      authorization,
    );
    assertEquals(script.status, 200);
    assertEquals(script.type, "text/javascript; charset=utf-8");
    const style = await get(
      socket,
      "/screens/usage/assets/a.css?size=full&view_session=v1",
      authorization,
    );
    assertEquals(style.status, 200);
    assertEquals(style.type, "text/css; charset=utf-8");
    const missing = await get(
      socket,
      "/screens/usage/missing.js?size=full&view_session=v1",
      authorization,
    );
    assertEquals(missing.status, 404);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

async function get(socket: string, path: string, authorization: string) {
  const conn = await Deno.connect({ path: socket, transport: "unix" });
  await conn.write(
    new TextEncoder().encode([
      `GET ${path} HTTP/1.1`,
      `host: ${SOCKET_HOST}`,
      `authorization: ${authorization}`,
      "connection: close",
      "",
      "",
    ].join("\r\n")),
  );
  const chunks: Uint8Array[] = [];
  const buffer = new Uint8Array(8192);
  while (true) {
    const read = await conn.read(buffer);
    if (read === null) break;
    chunks.push(buffer.slice(0, read));
  }
  conn.close();
  const text = new TextDecoder().decode(
    new Uint8Array(chunks.flatMap((chunk) => [...chunk])),
  );
  const split = text.indexOf("\r\n\r\n");
  const head = text.slice(0, split);
  return {
    status: Number(text.split(" ")[1]),
    type: /content-type: ([^\r\n]+)/i.exec(head)?.[1],
    body: text.slice(split + 4),
  };
}

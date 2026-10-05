// 실제 core(apps/core/main.ts)를 temp LOPHN_HOME으로 띄우고 renderer의 CoreSource 모양으로
// 묶는다. main의 contract client 대신 같은 HTTP route(`POST /v1/<resource>/<method>`)를
// 사람 token으로 부른다. 사람 데이터 root(~/.lophn)는 열지 않고, 띄운 core만 정확히 멈춘다.
// component test는 temp bundle에서 돌아 import.meta.url이 repo를 가리키지 않으므로 repo
// root는 실행 위치에서 위로 찾는다.
import type { CoreSource } from "../desktop/connection/connection.ts";

export interface RealCore {
  readonly source: CoreSource;
  /** core stderr. 실패 때 원인을 보인다. */
  log(): string;
  stop(): Promise<void>;
}

const HELLO_TIMEOUT_MS = 60_000;

async function repoRoot(): Promise<string> {
  let directory = Deno.cwd();
  for (;;) {
    try {
      await Deno.stat(`${directory}/apps/core/main.ts`);
      return directory;
    } catch {
      const parent = directory.replace(/\/[^/]+$/, "");
      if (parent === directory || parent === "") {
        throw new Error("repo root(apps/core/main.ts)를 찾지 못했다");
      }
      directory = parent;
    }
  }
}

interface Hello {
  user_token: string;
  api_port: number;
}

// 길이 prefix frame(길이 4 + kind 1 + channel 4 + payload)에서 hello JSON을 찾는다.
// hello 뒤에도 stdout을 끝까지 비워 core가 pipe에서 막히지 않게 한다.
function readHello(stdout: ReadableStream<Uint8Array>): Promise<Hello> {
  return new Promise((resolve, reject) => {
    let buffer = new Uint8Array();
    let found = false;
    const decoder = new TextDecoder();
    (async () => {
      for await (const chunk of stdout) {
        if (found) continue;
        const next = new Uint8Array(buffer.length + chunk.length);
        next.set(buffer);
        next.set(chunk, buffer.length);
        buffer = next;
        while (buffer.length >= 9) {
          const view = new DataView(buffer.buffer, buffer.byteOffset);
          const length = view.getUint32(0, false);
          if (buffer.length < 4 + length) break;
          const kind = view.getUint8(4);
          const payload = buffer.slice(9, 4 + length);
          buffer = buffer.slice(4 + length);
          if (kind !== 1) continue;
          const value = JSON.parse(decoder.decode(payload)) as Partial<Hello>;
          if (
            typeof value.user_token === "string" &&
            typeof value.api_port === "number"
          ) {
            found = true;
            resolve(value as Hello);
            break;
          }
        }
      }
      if (!found) reject(new Error("core가 hello 전에 끝났다"));
    })().catch(reject);
  });
}

export async function startRealCore(): Promise<RealCore> {
  const home = await Deno.makeTempDir({ prefix: "lophn-dock-core-" });
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", "apps/core/main.ts", "--port=0"],
    cwd: await repoRoot(),
    env: { LOPHN_HOME: home },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  let stderr = "";
  const drained = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of child.stderr) stderr += decoder.decode(chunk);
  })();
  const stop = async () => {
    try {
      child.kill("SIGTERM");
    } catch { /* 이미 끝남 */ }
    try {
      await child.stdin.close();
    } catch { /* 이미 닫힘 */ }
    await child.status;
    await drained;
    await Deno.remove(home, { recursive: true });
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hello: Hello;
  try {
    hello = await Promise.race([
      readHello(child.stdout),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("core hello가 오지 않았다")),
          HELLO_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    await stop();
    throw new Error(`${(error as Error).message}\n${stderr}`);
  } finally {
    clearTimeout(timer);
  }
  const base = `http://127.0.0.1:${hello.api_port}/v1`;
  const source: CoreSource = {
    subscribe(listener) {
      listener({ state: "ready", confirmedAt: Date.now() });
      return () => {};
    },
    async call({ resource, method, body }) {
      const response = await fetch(`${base}/${resource}/${method}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${hello.user_token}`,
        },
        body: JSON.stringify(body),
      });
      const value = await response.json();
      return response.status === 200
        ? { ok: true, value }
        : { ok: false, error: value.error };
    },
  };
  return { source, log: () => stderr, stop };
}

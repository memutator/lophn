// 사람이 coding agent의 화면을 직접 본다. `deno task eval:attach [session] [--write]`.
// 읽기 전용이 기본이다. Ctrl-]로 나간다.
import { DEFAULT_SOCKET_DIR } from "./screen.ts";

const DETACH = 0x1d;

async function pickSocket(arg: string | undefined): Promise<string> {
  const found: { path: string; stem: string; at: number }[] = [];
  try {
    for await (const entry of Deno.readDir(DEFAULT_SOCKET_DIR)) {
      if (!entry.name.endsWith(".sock")) continue;
      const path = `${DEFAULT_SOCKET_DIR}/${entry.name}`;
      const info = await Deno.stat(path);
      found.push({
        path,
        stem: entry.name.slice(0, -".sock".length),
        at: info.mtime?.getTime() ?? 0,
      });
    }
  } catch {
    // 폴더가 없으면 socket이 없는 것이다.
  }
  const match = arg === undefined
    ? found.sort((a, b) => b.at - a.at)[0]
    : found.find((item) => arg.endsWith(item.stem) || item.stem.endsWith(arg));
  if (!match) {
    throw new Error(
      `붙을 session이 없다(${DEFAULT_SOCKET_DIR}${arg ? `, ${arg}` : ""})`,
    );
  }
  return match.path;
}

async function main(): Promise<number> {
  const write = Deno.args.includes("--write");
  const arg = Deno.args.find((item) => !item.startsWith("--"));
  if (!Deno.stdin.isTerminal()) throw new Error("터미널에서 실행한다");
  let conn: Deno.Conn;
  try {
    conn = await Deno.connect({
      transport: "unix",
      path: await pickSocket(arg),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const encoder = new TextEncoder();
  const send = (message: unknown) =>
    conn.write(encoder.encode(JSON.stringify(message) + "\n")).catch(() => {});
  const size = () => {
    const { columns, rows } = Deno.consoleSize();
    return { cols: columns, rows };
  };

  console.error(
    write
      ? "키를 coding agent에 넣는다(--write). Ctrl-]로 나간다"
      : "읽기 전용. Ctrl-]로 나간다",
  );
  Deno.stdin.setRaw(true);
  try {
    await send({ t: "hello", write, ...size() });
    const onResize = () => void send({ t: "resize", ...size() });
    Deno.addSignalListener("SIGWINCH", onResize);

    const detached = (async () => {
      for await (const bytes of Deno.stdin.readable) {
        if (bytes.includes(DETACH)) return;
        if (write) {
          await send({ t: "key", data: new TextDecoder().decode(bytes) });
        }
      }
    })();
    const ended = (async () => {
      let pending = "";
      const decoder = new TextDecoder();
      for await (const bytes of conn.readable) {
        pending += decoder.decode(bytes, { stream: true });
        let newline: number;
        while ((newline = pending.indexOf("\n")) >= 0) {
          const message = JSON.parse(pending.slice(0, newline)) as {
            t: string;
            data?: string;
            reason?: string;
          };
          pending = pending.slice(newline + 1);
          if (message.t === "out") {
            await Deno.stdout.write(encoder.encode(message.data ?? ""));
          } else if (message.t === "end") return message.reason;
        }
      }
    })();
    const reason = await Promise.race([detached.then(() => undefined), ended]);
    Deno.removeSignalListener("SIGWINCH", onResize);
    Deno.stdin.setRaw(false);
    if (reason !== undefined) console.error(`\n끝났다: ${reason}`);
  } finally {
    Deno.stdin.setRaw(false);
    try {
      conn.close();
    } catch {
      // 이미 닫혔다.
    }
  }
  return 0;
}

if (import.meta.main) Deno.exit(await main());

// 사람이 coding agent의 TUI를 직접 보는 길의 서버(session마다 unix socket 하나). `attach.ts`가 client다.
// 연결 규칙: 줄 단위 JSON.
//   client → 서버: {"t":"hello","write":bool,"cols":n,"rows":n} (첫 줄), {"t":"resize","cols","rows"}, {"t":"key","data"}
//   서버 → client: {"t":"out","data"}, {"t":"end","reason"}
// 화면 글은 사람에게만 가고 상태 판단에 쓰지 않는다.
import type { EvalTerminal } from "./host.ts";
import type { FocusGate } from "./focus.ts";

export const DEFAULT_SOCKET_DIR = "/tmp/lophn-eval/sock";
const PUSH_MS = 150;
const SOCKET_PATH_MAX = 100;

export function socketPathOf(socketDir: string, session: string): string {
  const path = `${socketDir}/${session.slice(-12)}.sock`;
  if (path.length > SOCKET_PATH_MAX) {
    throw new Error(`socket 경로가 ${SOCKET_PATH_MAX}자를 넘는다: ${path}`);
  }
  return path;
}

export type Screen = {
  path: string;
  /** 남은 출력을 보내고 end를 알리고 접속과 socket file을 닫는다. */
  end(reason: string): Promise<void>;
};

export function serveScreen(input: {
  path: string;
  terminal: EvalTerminal;
  ref: string;
  generation: number;
  gate: FocusGate;
  onKey(): void;
}): Screen {
  const { host } = input.terminal;
  const { ref, generation } = input;
  Deno.mkdirSync(input.path.slice(0, input.path.lastIndexOf("/")), {
    recursive: true,
    mode: 0o700,
  });
  try {
    Deno.removeSync(input.path);
  } catch {
    // 옛 file이 없다.
  }
  const listener = Deno.listen({ transport: "unix", path: input.path });
  const encoder = new TextEncoder();
  const clients = new Set<
    { flush(): Promise<void>; close(reason: string): Promise<void> }
  >();

  async function snapshot(after: number) {
    const reply = await host.handle({
      id: "screen",
      type: "snapshot",
      terminal_ref: ref,
      after_seq: after,
    });
    return reply.ok && "output" in reply ? reply : null;
  }

  async function serve(conn: Deno.Conn): Promise<void> {
    let last = 0;
    let release: (() => void) | null = null;
    let closed = false;
    const send = async (message: unknown) => {
      try {
        await conn.write(encoder.encode(JSON.stringify(message) + "\n"));
      } catch {
        closed = true;
      }
    };
    // 주기 전송과 마지막 전송이 겹치면 같은 chunk를 두 번 보내므로 줄 세운다.
    let queue = Promise.resolve();
    const flush = () =>
      queue = queue.then(async () => {
        const reply = await snapshot(last);
        if (reply === null) return;
        for (const item of reply.output) {
          last = item.seq;
          await send({ t: "out", data: item.chunk });
        }
      });
    const client = {
      flush,
      async close(reason: string) {
        if (closed) return;
        await flush();
        await send({ t: "end", reason });
        closed = true;
        try {
          conn.close();
        } catch {
          // 이미 닫혔다.
        }
      },
    };
    clients.add(client);
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      let write = false;
      let hello = false;
      let pending = "";
      for await (const bytes of conn.readable) {
        pending += new TextDecoder().decode(bytes, { stream: true });
        let newline: number;
        while ((newline = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          const message = JSON.parse(line) as {
            t: string;
            write?: boolean;
            cols?: number;
            rows?: number;
            data?: string;
          };
          if (message.t === "hello" && !hello) {
            hello = true;
            write = message.write === true;
            if (write) release = input.gate.hold(ref);
            await resize(message);
            const reply = await snapshot(0);
            if (reply?.runtime.dropped_output) {
              await send({ t: "out", data: "\r\n[eval: 앞부분이 잘렸다]\r\n" });
            }
            await flush();
            timer = setInterval(() => void flush(), PUSH_MS);
          } else if (message.t === "resize") await resize(message);
          else if (message.t === "key" && write && message.data) {
            input.onKey();
            await host.handle({
              id: "screen",
              type: "input",
              terminal_ref: ref,
              generation,
              text: message.data,
            });
          }
        }
      }
    } catch {
      // 접속이 끊겼거나 줄이 깨졌다. 이 접속만 닫는다.
    } finally {
      clearInterval(timer);
      release?.();
      clients.delete(client);
      closed = true;
      try {
        conn.close();
      } catch {
        // 이미 닫혔다.
      }
    }
  }

  async function resize(message: { cols?: number; rows?: number }) {
    if (!message.cols || !message.rows) return;
    await host.handle({
      id: "screen",
      type: "resize",
      terminal_ref: ref,
      generation,
      columns: message.cols,
      rows: message.rows,
    });
  }

  void (async () => {
    try {
      for await (const conn of listener) void serve(conn);
    } catch {
      // listener를 닫았다.
    }
  })();

  return {
    path: input.path,
    async end(reason) {
      try {
        listener.close();
      } catch {
        // 이미 닫혔다.
      }
      await Promise.all([...clients].map((client) => client.close(reason)));
      await Deno.remove(input.path).catch(() => {});
    },
  };
}

import {
  type ChildMessage,
  childMessageSchema,
  type Frame,
  type ParentMessage,
  parentMessageSchema,
} from "../../contracts/platform/mod.ts";
import {
  readFrames,
  writeJson,
  type ByteReader,
  type ByteWriter,
} from "./frames.ts";

const STDERR_LINE_MAX = 8 * 1024;

export type ChildStreams = {
  stdin: ByteReader;
  stdout: ByteWriter;
  stderr: ByteWriter;
};

export type ChildHandlers = {
  // hello의 credential은 여기로만 간다. log·stderr에 남기지 않는다.
  onHello(
    message: Extract<ParentMessage, { type: "hello" }>,
  ): Promise<void> | void;
  onStop(): Promise<void> | void;
  // byte chunk는 제어 메시지가 아니다. entry가 채널로 받는다.
  onFrame?(frame: Frame): Promise<void> | void;
  // 후속 contract가 parent message를 늘려도 여기서 protocol 위반으로 죽이지 않는다.
  onParent?(message: ParentMessage): Promise<void> | void;
};

export type ChildSession = {
  send(message: ChildMessage): Promise<void>;
  // 부모 pipe가 닫히면 새 작업과 credential 사용을 막고 끝난다.
  readonly stopped: boolean;
  readonly credentialUsable: boolean;
  run(): Promise<void>;
};

function redirectConsole(stderr: ByteWriter) {
  const write = (args: unknown[]) => {
    const line = args.map((arg) => String(arg)).join(" ").slice(
      0,
      STDERR_LINE_MAX,
    );
    // Deno는 console.* 교체를 무시하고 stdout에 쓴다. 직접 stderr로 보낸다.
    try {
      Deno.stderr.writeSync(new TextEncoder().encode(`${line}\n`));
    } catch { /* 호출자가 넘긴 stderr가 아니면 아래 writer로 보낸다 */ }
    void stderr.write(new TextEncoder().encode(`${line}\n`)).catch(() => {});
  };
  console.log = (...args) => write(args);
  console.info = (...args) => write(args);
  console.debug = (...args) => write(args);
  console.warn = (...args) => write(args);
  console.error = (...args) => write(args);
}

export function startChild(
  streams: ChildStreams,
  handlers: ChildHandlers,
): ChildSession {
  redirectConsole(streams.stderr);
  let stopped = false;
  let credentialUsable = false;

  const session: ChildSession = {
    get stopped() {
      return stopped;
    },
    get credentialUsable() {
      return credentialUsable;
    },
    send(message) {
      if (stopped) return Promise.reject(new Error("child pipe is closed"));
      const parsed = childMessageSchema.parse(message);
      return writeJson(streams.stdout, parsed);
    },
    async run() {
      const frames = readFrames(streams.stdin);
      try {
        while (true) {
          // for-await로 빠져나오면 generator가 닫힌다. 한 frame씩 꺼낸다.
          const next = await frames.next();
          if (next.done) return;
          const frame = next.value;
          if (frame.kind !== "json") {
            await handlers.onFrame?.(frame);
            continue;
          }
          const parsed = parentMessageSchema.safeParse(frame.payload);
          if (!parsed.success) {
            throw new Error("parent message is not valid");
          }
          const message = parsed.data;
          if (message.type === "hello") {
            credentialUsable = true;
            await handlers.onHello(message);
            continue;
          }
          if (message.type === "stop") {
            stopped = true;
            credentialUsable = false;
            await handlers.onStop();
            return;
          }
          await handlers.onParent?.(message);
        }
      } finally {
        // EOF와 stop 모두 같은 끝이다. 이후 credential은 쓸 수 없다.
        stopped = true;
        credentialUsable = false;
        await frames.return("closed").catch(() => {});
      }
    },
  };
  return session;
}

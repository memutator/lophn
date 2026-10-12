import { assertEquals, assertRejects } from "@std/assert";
import {
  encodeFrame,
  FrameDecoder,
  type ParentMessage,
} from "../../../protocol/server/mod.ts";
import type { ByteReader } from "./frames.ts";
import { type ChildHandlers, type ChildSession, startChild } from "./child.ts";

const HELLO = {
  type: "hello" as const,
  core_epoch: "epoch-1",
  process_identity: "proc-1",
  kind: "platform/io" as const,
  task: "task-1",
  scope: { operations: ["blob.put"], targets: {} },
  credential: "credential-value-not-for-argv",
  api_port: 7431,
};
const RESPONSE = {
  type: "worker_response" as const,
  request_id: "req-1",
  ok: true as const,
  payload: {},
};

function stdinOf(frames: Uint8Array[]) {
  const chunks = [...frames];
  let eof = false;
  let wake: (() => void) | undefined;
  const reader: ByteReader = {
    async read(buffer) {
      while (true) {
        const next = chunks.shift();
        if (next) {
          buffer.set(next);
          return next.length;
        }
        if (eof) return null;
        await new Promise<void>((resolve) => wake = resolve);
      }
    },
  };
  return {
    reader,
    eof: () => {
      eof = true;
      wake?.();
    },
  };
}

// stdout sink. blocked면 write가 release 전까지 끝나지 않는다.
function stdoutSink(blocked: boolean) {
  const written: Uint8Array[] = [];
  const pending: Array<() => void> = [];
  return {
    writer: {
      write: (bytes: Uint8Array) => {
        if (!blocked) {
          written.push(bytes.slice());
          return Promise.resolve(bytes.length);
        }
        return new Promise<number>((resolve) => {
          pending.push(() => {
            written.push(bytes.slice());
            resolve(bytes.length);
          });
        });
      },
    },
    release: () => pending.shift()?.(),
    types: () =>
      new FrameDecoder().push(
        new Uint8Array(written.flatMap((chunk) => [...chunk])),
      ).map((frame) =>
        frame.kind === "json"
          ? (frame.payload as { type: string }).type
          : frame.kind
      ),
  };
}

function open(
  blocked: boolean,
  handlers: (session: () => ChildSession) => ChildHandlers,
) {
  const stdin = stdinOf([
    encodeFrame({ kind: "json", channel: 0, payload: HELLO }),
  ]);
  const stdout = stdoutSink(blocked);
  const session: ChildSession = startChild({
    stdin: stdin.reader,
    stdout: stdout.writer,
    stderr: { write: (bytes) => Promise.resolve(bytes.length) },
  }, handlers(() => session));
  return { stdin, stdout, session };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

Deno.test("platform/security#R3: EOF 뒤 onStop이 끝나지 않아도 일반 send·sendBytes는 한 frame도 쓰지 않는다", async () => {
  const { stdin, stdout, session } = open(false, () => ({
    onHello: () => {},
    onStop: () => new Promise(() => {}),
  }));
  void session.run();
  await tick();
  stdin.eof();
  await tick();
  assertEquals(session.stopped, false);
  assertEquals(session.credentialUsable, false);
  await assertRejects(() => session.send({ type: "ready" }), Error, "stopping");
  await assertRejects(() => session.send(RESPONSE), Error, "stopping");
  await assertRejects(
    () => session.sendBytes(1, new Uint8Array([1])),
    Error,
    "stopping",
  );
  assertEquals(stdout.types(), []);
  // stopped ack는 한 번만 나간다.
  await session.send({ type: "stopped" });
  await assertRejects(() => session.send({ type: "stopped" }));
  assertEquals(stdout.types(), ["stopped"]);
});

Deno.test("platform/security#R3: cleanup 중 진 handler의 늦은 ready·응답·bytes 전송을 막는다", async () => {
  let resume: () => void = () => {};
  const late: Array<Promise<void>> = [];
  const { stdin, stdout, session } = open(false, (current) => ({
    onHello: async () => {
      await new Promise<void>((resolve) => resume = resolve);
      for (
        const sent of [
          current().send({ type: "ready" }),
          current().send(RESPONSE),
          current().sendBytes(2, new Uint8Array([7])),
        ]
      ) {
        sent.catch(() => {});
        late.push(sent);
      }
    },
    onStop: async () => {
      // cleanup이 진행 중일 때 진 handler가 깨어난다.
      resume();
      await tick();
      await current().send({ type: "stopped" });
    },
  }));
  const running = session.run();
  await tick();
  stdin.eof();
  await running;
  for (const sent of late) await assertRejects(() => sent);
  assertEquals(stdout.types(), ["stopped"]);
});

Deno.test("platform/security#R3: terminal 전 줄 선 일반 frame은 쓰기 시작 전이면 버린다", async () => {
  const sends: Array<Promise<void>> = [];
  const { stdin, stdout, session } = open(true, (current) => ({
    onHello: () => {
      for (
        const sent of [
          current().send(RESPONSE),
          current().send({ type: "ready" }),
          current().sendBytes(3, new Uint8Array([1])),
        ]
      ) {
        sent.catch(() => {});
        sends.push(sent);
      }
    },
    onParent: (_message: ParentMessage) => {},
    onStop: () => current().send({ type: "stopped" }),
  }));
  const running = session.run();
  await tick();
  stdin.eof();
  await tick();
  // 첫 frame은 이미 쓰기를 시작했다(되돌린다고 주장하지 않는다). 나머지는 거절됐다.
  await assertRejects(() => sends[1], Error, "closed");
  await assertRejects(() => sends[2], Error, "closed");
  stdout.release();
  await sends[0];
  await tick();
  stdout.release();
  await running;
  assertEquals(stdout.types(), ["worker_response", "stopped"]);
});

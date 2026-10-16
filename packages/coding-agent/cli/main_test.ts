import {
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";
import { cliMain } from "./main.ts";

function sink(): { stream: WritableStream<Uint8Array>; text(): string } {
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  return {
    stream: new WritableStream({
      write(chunk) {
        chunks.push(decoder.decode(chunk));
      },
    }),
    text: () => chunks.join(""),
  };
}

Deno.test("hook CLI는 token 없이 거절되고 core로 아무것도 보내지 않는다", async () => {
  const stdout = sink();
  const stderr = sink();
  let sent = false;
  let read = false;
  const code = await cliMain(["hook", "claude", "Stop"], {
    env: { get: (name) => name === "LOPHN_HOME" ? "/nonexistent" : undefined },
    fetch: () => {
      sent = true;
      return Promise.reject(new Error("must not send"));
    },
    stdin: () => {
      read = true;
      return Promise.resolve("{}");
    },
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  assertNotEquals(code, 0);
  assertEquals(stdout.text(), "");
  assertStringIncludes(stderr.text(), "LOPHN_CODING_TOKEN");
  assertEquals([sent, read], [false, false]);
});

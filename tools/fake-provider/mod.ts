// 테스트가 쓰는 진입점. 포트는 127.0.0.1의 빈 포트다.
import { FakeServer, type ServerOptions } from "./server.ts";
import type { LoggedRequest, Script } from "./types.ts";

export type { LoggedRequest, Script, Step } from "./types.ts";

export type FakeProvider = {
  url: string;
  requests(): LoggedRequest[];
  assertDone(expected: number): void;
  release(gate: string): void;
  close(): Promise<void>;
};

export function startFakeProvider(
  options: ServerOptions & { script: Script },
): FakeProvider {
  const fake = new FakeServer(options);
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    onListen: () => {},
  }, (request) => fake.handle(request));
  const url = `http://127.0.0.1:${server.addr.port}`;
  return {
    url,
    requests: () => fake.requests(),
    assertDone: (expected) => fake.assertDone(expected),
    release: (gate) => fake.release(gate),
    close: () => {
      fake.close();
      return server.shutdown();
    },
  };
}

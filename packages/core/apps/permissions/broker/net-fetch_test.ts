import { assertEquals } from "@std/assert";
import { ok } from "../../../../base/mod.ts";
import { createNetFetchService } from "./net-fetch.ts";

const CHILD = {
  app: "demo",
  release: "r1",
  mode: "live" as const,
  processNonce: "n1",
};

function setup(
  granted: { host: string; port: number }[],
  respond: (url: URL) => Response,
) {
  const urls: string[] = [];
  const service = createNetFetchService({
    access: {
      current: () =>
        Promise.resolve(ok({
          release: "r1",
          scope: {
            access: granted.map((scope) => ({ kind: "net.fetch", scope })),
            app_calls: [],
          },
          app_api: ["demo.run"],
        })),
    },
    transport: (input) => {
      const url = new URL(String(input));
      urls.push(url.href);
      return Promise.resolve(respond(url));
    },
    platformPorts: [4000],
  });
  const fetch = (host: string, port: number, path = "/x") =>
    service.request(CHILD, {
      process_nonce: "n1",
      mode: "live",
      invocation: null,
      command: "demo.run",
      host,
      port,
      method: "GET",
      path,
    });
  return { urls, fetch };
}

Deno.test("loopback host goes out as http, others as https, platform ports stay blocked", async () => {
  const { urls, fetch } = setup(
    [
      { host: "127.0.0.1", port: 8080 },
      { host: "127.0.0.1", port: 4000 },
      { host: "api.example.com", port: 443 },
    ],
    () => new Response("ok"),
  );
  assertEquals((await fetch("127.0.0.1", 8080)).ok, true);
  assertEquals((await fetch("api.example.com", 443)).ok, true);
  const platform = await fetch("127.0.0.1", 4000);
  assertEquals(!platform.ok && platform.error.code, "forbidden");
  assertEquals(urls, [
    "http://127.0.0.1:8080/x",
    "https://api.example.com/x",
  ]);
});

Deno.test("redirect from https down to loopback http is refused", async () => {
  const { urls, fetch } = setup(
    [
      { host: "127.0.0.1", port: 8080 },
      { host: "api.example.com", port: 443 },
    ],
    (url) =>
      url.protocol === "https:"
        ? new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1:8080/y" },
        })
        : new Response("ok"),
  );
  const result = await fetch("api.example.com", 443);
  assertEquals(!result.ok && result.error.code, "forbidden");
  assertEquals(urls, ["https://api.example.com/x"]);
});

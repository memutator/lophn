import assert from "node:assert/strict";
import { test } from "node:test";

import type { CoreSource } from "../../connection/connection.ts";
import { validAddress } from "./addresses.ts";
import { coreRemoteSource } from "./core-source.ts";

test("validAddress는 host·IPv4·IPv6를 받아들이고 scheme·port·중복·공백을 거절한다", () => {
  assert.equal(validAddress("studio.tail1234.ts.net", []), true);
  assert.equal(validAddress("100.64.0.12", ["studio.tail1234.ts.net"]), true);
  assert.equal(validAddress("fd7a:115c:a1e0::1", []), true);

  assert.equal(validAddress("", []), false);
  assert.equal(validAddress("studio.tail1234.ts.net:7432", []), false);
  assert.equal(validAddress("https://studio.tail1234.ts.net", []), false);
  assert.equal(validAddress("[::1]:7432", []), false);
  assert.equal(validAddress("studio tail", []), false);
  assert.equal(validAddress("a.example.com", ["a.example.com"]), false);
  assert.equal(validAddress("a".repeat(254), []), false);
});

test("coreRemoteSource.addresses와 setAddresses는 remote.addresses 설정을 읽고 쓴다", async () => {
  let stored: string[] = ["studio.tail1234.ts.net"];
  const calls: unknown[] = [];
  const core: CoreSource = {
    subscribe: () => () => {},
    call: (req) => {
      calls.push(req);
      if (req.resource === "settings" && req.method === "list") {
        return Promise.resolve({
          ok: true,
          value: {
            settings: [
              {
                key: "remote.addresses",
                type: {},
                default: [],
                chosen: stored,
              },
            ],
            folders: [],
          },
        });
      }
      if (req.resource === "settings" && req.method === "update") {
        const change = (req.body as { changes: { value: string[] }[] })
          .changes[0]!;
        stored = change.value;
        return Promise.resolve({
          ok: true,
          value: { changed: ["remote.addresses"], rejected: [], notes: [] },
        });
      }
      throw new Error(`unexpected call ${req.resource}/${req.method}`);
    },
  };

  const source = coreRemoteSource(core);
  assert.deepStrictEqual(await source.addresses(), {
    ok: true,
    value: ["studio.tail1234.ts.net"],
  });
  assert.deepStrictEqual(
    await source.setAddresses(["studio.tail1234.ts.net", "100.64.0.12"]),
    { ok: true, value: null },
  );
  assert.deepStrictEqual(await source.addresses(), {
    ok: true,
    value: ["studio.tail1234.ts.net", "100.64.0.12"],
  });
  assert.equal(calls.length, 3);
});

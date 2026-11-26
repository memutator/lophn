import assert from "node:assert/strict";
import { test } from "node:test";

import type { CoreSource } from "../../connection/connection.ts";
import { coreSyncSource } from "../sync/core-source.ts";
import { batchRequiresPermissionConfirmation } from "../sync/source.ts";
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

test("coreRemoteSource.connectionSettings와 setHub·setPort·setRelay·setOsc52Clipboard·relayStatus가 설정과 hub_listening을 읽고 쓴다", async () => {
  const values = new Map<string, unknown>([
    ["remote.hub", false],
    ["remote.port", 7432],
    ["remote.relay", "wss://lophn-relay.fly.dev"],
    ["shell.terminal.osc52_clipboard", true],
  ]);
  const core: CoreSource = {
    subscribe: () => () => {},
    call: (req) => {
      if (req.resource === "settings" && req.method === "list") {
        return Promise.resolve({
          ok: true,
          value: {
            settings: [...values.entries()].map(([key, chosen]) => ({
              key,
              type: {},
              default: chosen,
              chosen,
            })),
            folders: [],
          },
        });
      }
      if (req.resource === "settings" && req.method === "update") {
        const change = (
          req.body as { changes: { key: string; value: unknown }[] }
        ).changes[0]!;
        values.set(change.key, change.value);
        return Promise.resolve({
          ok: true,
          value: { changed: [change.key], rejected: [], notes: [] },
        });
      }
      if (req.resource === "remote_relay" && req.method === "status") {
        return Promise.resolve({
          ok: true,
          value: {
            url: values.get("remote.relay") || null,
            state: "connected",
            hub_listening: values.get("remote.hub") === true,
          },
        });
      }
      throw new Error(`unexpected call ${req.resource}/${req.method}`);
    },
  };

  const source = coreRemoteSource(core);
  assert.deepStrictEqual(await source.connectionSettings(), {
    ok: true,
    value: {
      hub: false,
      port: 7432,
      relay: "wss://lophn-relay.fly.dev",
      osc52Clipboard: true,
    },
  });
  await source.setHub(true);
  await source.setPort(8443);
  await source.setRelay("");
  await source.setOsc52Clipboard(false);
  assert.deepStrictEqual(await source.connectionSettings(), {
    ok: true,
    value: { hub: true, port: 8443, relay: "", osc52Clipboard: false },
  });
  assert.deepStrictEqual(await source.relayStatus(), {
    ok: true,
    value: { url: null, state: "connected", hubListening: true },
  });
});

test("coreSyncSource.applyStagedSettings는 confirmPermissions가 true일 때만 confirm_permissions를 보낸다", async () => {
  const bodies: Record<string, unknown>[] = [];
  const core: CoreSource = {
    subscribe: () => () => {},
    call: (req) => {
      if (req.resource === "settings_export" && req.method === "apply") {
        const body = req.body as Record<string, unknown>;
        bodies.push(body);
        const confirmed = body["confirm_permissions"] === true;
        return Promise.resolve({
          ok: true,
          value: {
            applied: [
              {
                kind: "permission_rules",
                id: "permission_rules",
                status: confirmed ? "applied" : "requires_person_confirmation",
              },
            ],
            requires_permission_confirmation: !confirmed,
          },
        });
      }
      throw new Error(`unexpected call ${req.resource}/${req.method}`);
    },
  };

  const sync = coreSyncSource(core, { picker: undefined });
  const first = await sync.applyStagedSettings({
    batch: "stg_01jd0000000000000000000001",
  });
  assert.equal(first.ok, true);
  assert.equal("confirm_permissions" in bodies[0]!, false);
  if (first.ok) assert.equal(first.value.requiresPermissionConfirmation, true);

  const second = await sync.applyStagedSettings({
    batch: "stg_01jd0000000000000000000001",
    confirmPermissions: true,
  });
  assert.equal(second.ok, true);
  assert.equal(bodies[1]!["confirm_permissions"], true);
  if (second.ok) {
    assert.equal(second.value.requiresPermissionConfirmation, false);
  }

  assert.equal(
    batchRequiresPermissionConfirmation({
      id: "stg_01jd0000000000000000000001",
      from_machine: "mch_01jd0000000000000000000002",
      from_name: "Home",
      to_machine: "mch_01jd0000000000000000000001",
      project_identity: null,
      items: [
        {
          kind: "agent",
          id: "ops",
          title: "ops",
          files: [{ rel_path: "ops.md", content: "", sha256: "a".repeat(64) }],
          locked_fields: ["permissions"],
        },
      ],
      state: "pending",
      delivery_state: "delivered",
      note: null,
      created_at: "2026-11-26T00:00:00.000Z",
      updated_at: "2026-11-26T00:00:00.000Z",
    }),
    true,
  );
});

test("coreSyncSource.setAppSyncPolicy는 sync.app_policies를 덮어쓰고 default로 되돌린다", async () => {
  let policies: Record<string, string> = {};
  const core: CoreSource = {
    subscribe: () => () => {},
    call: (req) => {
      if (req.resource === "settings" && req.method === "list") {
        return Promise.resolve({
          ok: true,
          value: {
            settings: [
              {
                key: "sync.app_policies",
                type: {},
                default: {},
                chosen: policies,
              },
            ],
            folders: [],
          },
        });
      }
      if (req.resource === "settings" && req.method === "update") {
        const change = (
          req.body as { changes: { value: Record<string, string> }[] }
        ).changes[0]!;
        policies = change.value;
        return Promise.resolve({
          ok: true,
          value: { changed: ["sync.app_policies"], rejected: [], notes: [] },
        });
      }
      throw new Error(`unexpected call ${req.resource}/${req.method}`);
    },
  };

  const sync = coreSyncSource(core, { picker: undefined });
  assert.deepStrictEqual(await sync.setAppSyncPolicy("app_memo", "local"), {
    ok: true,
  });
  assert.deepStrictEqual(policies, { app_memo: "local" });
  assert.deepStrictEqual(await sync.setAppSyncPolicy("app_memo", "default"), {
    ok: true,
  });
  assert.deepStrictEqual(policies, {});
});

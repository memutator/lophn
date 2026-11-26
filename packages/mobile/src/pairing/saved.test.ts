import assert from "node:assert/strict";
import { test } from "node:test";
import { readComputers } from "./saved.ts";

test("a computers save from before the roster still reads every computer that was paired; a broken element is dropped alone", () => {
  const old = [
    {
      addresses: ["192.168.0.2"],
      port: 47432,
      key: "k".repeat(43),
      relay: "wss://relay.lophn.test",
      machine: "mch_01m7dp1jqw47d55vdyzxv5wd0x",
      device: "dev_01m7dp1jqw47d55vdyzxv5wd0a",
      revoked: false,
      name: "My Galaxy",
      announced: "mina-desktop",
    },
    // Paired before computers announced themselves, and later cut off.
    {
      addresses: ["10.0.0.3"],
      port: 47432,
      key: "j".repeat(43),
      device: "dev_01m7dp1jqw47d55vdyzxv5wd0b",
      revoked: true,
    },
    { addresses: "not a list", port: 47432, key: "x" },
  ];
  assert.deepEqual(readComputers(JSON.stringify(old)), [
    {
      addresses: ["192.168.0.2"],
      port: 47432,
      key: "k".repeat(43),
      relay: "wss://relay.lophn.test",
      machine: "mch_01m7dp1jqw47d55vdyzxv5wd0x",
      name: "My Galaxy",
      announced: "mina-desktop",
    },
    { addresses: ["10.0.0.3"], port: 47432, key: "j".repeat(43) },
  ]);
  assert.deepEqual(readComputers(null), []);
  assert.deepEqual(readComputers("{"), []);
});

test("readComputers keeps hub role and ordered relays", () => {
  const saved = [
    {
      addresses: ["198.51.100.10"],
      port: 7432,
      key: "h".repeat(43),
      relay: "ws://198.51.100.10:7432",
      relays: ["ws://198.51.100.10:7432", "wss://fly.test"],
      hub: true,
      machine: "mch_01m7dp1jqw47d55vdyzxv5wd0x",
    },
  ];
  assert.deepEqual(readComputers(JSON.stringify(saved)), saved);
});

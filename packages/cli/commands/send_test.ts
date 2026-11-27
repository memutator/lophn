import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { err, ok } from "../../base/mod.ts";
import { parseCommandLine } from "../parser.ts";
import { HANDOFF_COMMANDS } from "./handoff.ts";
import { COMMANDS } from "./mod.ts";
import { REMOTE_COMMANDS } from "./remote.ts";
import { SEND_COMMANDS } from "./send.ts";
import { SETTINGS_COMMANDS } from "./settings.ts";
import type { CommandContext } from "./types.ts";

const TRF = "trf_01hzzzzzzzzzzzzzzzzzzzzzza";
const MCH_A = "mch_01hzzzzzzzzzzzzzzzzzzzzzza";
const MCH_B = "mch_01hzzzzzzzzzzzzzzzzzzzzzzb";
const STG = "stg_01hzzzzzzzzzzzzzzzzzzzzzza";
const DEV = "dev_01hzzzzzzzzzzzzzzzzzzzzzza";
const SHA = "a".repeat(64);

const findCmd = (list: readonly (typeof COMMANDS)[number][], name: string) =>
  list.find((c) => c.name === name)!;

test("variadic positional parsing supports `lophn send <paths...>` and `lophn settings export <kind> <ids...>`", () => {
  const sendParsed = parseCommandLine(
    ["send", "a.txt", "dir/b.txt", "--on", "VM", "--note", "build"],
    COMMANDS,
  );
  assert.ok(sendParsed.ok);
  assert.equal(sendParsed.value.kind, "run");
  assert.equal(sendParsed.value.command.name, "send");
  assert.deepStrictEqual(sendParsed.value.input, {
    paths: ["a.txt", "dir/b.txt"],
    on: "VM",
    note: "build",
  });

  const exportParsed = parseCommandLine(
    ["settings", "export", "agent", "reviewer", "builder", "--on", "VM"],
    COMMANDS,
  );
  assert.ok(exportParsed.ok);
  assert.equal(exportParsed.value.kind, "run");
  assert.equal(exportParsed.value.command.name, "settings.export");
  assert.deepStrictEqual(exportParsed.value.input, {
    kind: "agent",
    ids: ["reviewer", "builder"],
    on: "VM",
  });

  // Mixing --paths and positional args is still rejected.
  const dup = parseCommandLine(
    ["send", "a.txt", "--paths", "b.txt", "--on", "VM"],
    COMMANDS,
  );
  assert.equal(dup.ok, false);
});

test("lophn send resolves relative paths and formats held_at_hub delivery and expiry", async () => {
  const seen: { route: string; input: unknown }[] = [];
  const ctx = {
    cwd: "/work/repo",
    key: "k1",
    core: {
      read: (route: { name: string }, input: unknown) => {
        seen.push({ route: route.name, input });
        return Promise.resolve(
          ok({
            transfer: TRF,
            to_machine: MCH_B,
            to_name: "VM",
            state: "held_at_hub",
            held_by: [MCH_A],
            files: [
              { name: "a.txt", rel_path: "a.txt", size: 12, sha256: SHA },
            ],
            created_at: "2026-11-26T00:00:00.000Z",
            expires_at: "2026-12-03T00:00:00.000Z",
          }),
        );
      },
    },
  } as unknown as CommandContext;

  const send = findCmd(SEND_COMMANDS, "send");
  const ran = await send.run(
    { paths: ["./a.txt", "/abs/b.txt"], on: "VM", note: "logs" },
    ctx,
  );
  assert.ok(ran.ok);
  assert.deepStrictEqual(seen, [
    {
      route: "transfers.send",
      input: {
        to: "VM",
        paths: [resolve("/work/repo", "./a.txt"), resolve("/abs/b.txt")],
        note: "logs",
      },
    },
  ]);
  assert.match(ran.value.text ?? "", new RegExp(TRF));
  assert.match(
    ran.value.text ?? "",
    /held_at_hub \(target offline; Hub .* picks it up\)/,
  );
  assert.match(ran.value.text ?? "", /2026-12-03T00:00:00\.000Z/);
  assert.match(ran.value.text ?? "", /a\.txt \(12 bytes\)/);
});

test("lophn send enforces ctx.resolveRead when invoked from lophn tool", async () => {
  const send = findCmd(SEND_COMMANDS, "send");
  const denied = await send.run({ paths: ["/etc/passwd"], on: "VM" }, {
    resolveRead: () =>
      Promise.resolve(err({ code: "forbidden", message: "outside workspace" })),
    core: {
      read: () => Promise.reject(new Error("must not call core")),
    },
  } as unknown as CommandContext);
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "forbidden");
});

test("handoff.write --attach uploads via transfers/send and attaches TransferAttachment[]", async () => {
  const calls: { route: string; input: unknown }[] = [];
  const ctx = {
    cwd: "/work/repo",
    key: "k2",
    core: {
      read: (route: { name: string }, input: unknown) => {
        calls.push({ route: route.name, input });
        if (route.name === "machine.computers") {
          return Promise.resolve(
            ok({
              computers: [
                {
                  id: MCH_A,
                  name: "MainHome",
                  status: "online",
                  current: true,
                  always_on: false,
                },
                {
                  id: MCH_B,
                  name: "Window",
                  status: "offline",
                  current: false,
                  always_on: false,
                },
              ],
            }),
          );
        }
        if (route.name === "transfers.send") {
          return Promise.resolve(
            ok({
              transfer: TRF,
              to_machine: MCH_B,
              to_name: "Window",
              state: "held_at_hub",
              files: [
                {
                  name: "report.md",
                  rel_path: "report.md",
                  size: 42,
                  sha256: SHA,
                },
              ],
              created_at: "2026-11-26T00:00:00.000Z",
              expires_at: "2026-12-03T00:00:00.000Z",
            }),
          );
        }
        return Promise.resolve(
          ok({
            identity: "pri_01hzzzzzzzzzzzzzzzzzzzzzza",
            branch: "main",
            commit: "a".repeat(40),
            written_at: "2026-11-26T00:00:01.000Z",
          }),
        );
      },
    },
  } as unknown as CommandContext;

  const write = findCmd(HANDOFF_COMMANDS, "handoff.write");
  const ran = await write.run(
    { body: "continue on Window", attach: ["report.md"] },
    ctx,
  );
  assert.ok(ran.ok);
  assert.deepStrictEqual(
    calls.map((c) => c.route),
    ["machine.computers", "transfers.send", "handoff.write"],
  );
  assert.deepStrictEqual(calls[2]?.input, {
    text: "continue on Window",
    attachments: [
      {
        transfer: TRF,
        name: "report.md",
        size: 42,
        sha256: SHA,
        rel_path: "report.md",
      },
    ],
  });
});

test("settings export|staged|apply|dismiss handle routes and requires_person_confirmation warning", async () => {
  const seen: { route: string; input: unknown }[] = [];
  const ctx = {
    key: "k3",
    core: {
      read: (route: { name: string }, input: unknown) => {
        seen.push({ route: route.name, input });
        if (route.name === "settings_export.send") {
          return Promise.resolve(
            ok({
              batch: STG,
              to_machine: MCH_B,
              delivery_state: "held_at_hub",
              item_count: 2,
            }),
          );
        }
        if (route.name === "settings_export.staged") {
          return Promise.resolve(
            ok({
              batches: [
                {
                  id: STG,
                  from_machine: MCH_A,
                  from_name: "MainHome",
                  to_machine: MCH_B,
                  project_identity: null,
                  items: [
                    {
                      kind: "permission_rules",
                      id: "default",
                      title: "Shell rules",
                      files: [
                        { rel_path: "rules.json", content: "{}", sha256: SHA },
                      ],
                      locked_fields: ["remote.hub"],
                    },
                  ],
                  state: "pending",
                  delivery_state: "delivered",
                  note: "sync perms",
                  created_at: "2026-11-26T00:00:00.000Z",
                  updated_at: "2026-11-26T00:00:00.000Z",
                },
              ],
            }),
          );
        }
        if (route.name === "settings_export.apply") {
          return Promise.resolve(
            ok({
              applied: [
                { kind: "agent", id: "reviewer", status: "applied" },
                {
                  kind: "permission_rules",
                  id: "default",
                  status: "requires_person_confirmation",
                },
              ],
              requires_permission_confirmation: true,
            }),
          );
        }
        return Promise.resolve(ok({ dismissed: true }));
      },
    },
  } as unknown as CommandContext;

  const exported = await findCmd(SETTINGS_COMMANDS, "settings.export").run(
    { kind: "agent", ids: ["a", "b"], on: "VM", note: "copy" },
    ctx,
  );
  assert.ok(exported.ok);
  assert.deepStrictEqual(seen[0]?.input, {
    to: "VM",
    items: [
      { kind: "agent", id: "a" },
      { kind: "agent", id: "b" },
    ],
    note: "copy",
  });

  const listed = await findCmd(SETTINGS_COMMANDS, "settings.staged").run(
    {},
    ctx,
  );
  assert.ok(listed.ok);
  assert.match(listed.value.text ?? "", /permission_rules/);
  assert.match(listed.value.text ?? "", /locked: remote\.hub/);

  const applied = await findCmd(SETTINGS_COMMANDS, "settings.apply").run(
    { batch: STG, overwrite: true },
    ctx,
  );
  assert.ok(applied.ok);
  assert.match(applied.value.text ?? "", /requires_person_confirmation/);
  assert.match(applied.value.note ?? "", /--confirm-permissions/);
  assert.match(applied.value.note ?? "", /Settings › My computers/);

  const dismissed = await findCmd(SETTINGS_COMMANDS, "settings.dismiss").run(
    { batch: STG },
    ctx,
  );
  assert.ok(dismissed.ok);
  assert.match(dismissed.value.summary, /dismissed/);
});

test("remote.status prints hub_listening and ordered relays, and remote.terminal_input uses control wording", async () => {
  const ctx = {
    core: {
      read: (route: { name: string }) => {
        if (route.name === "remote_relay.status") {
          return Promise.resolve(
            ok({
              url: "wss://hub.example/v1/host",
              state: "connected",
              hub_listening: true,
            }),
          );
        }
        if (route.name === "machine.environment") {
          return Promise.resolve(
            ok({
              this_machine: { id: MCH_A, name: "VM" },
              machines: [
                {
                  id: MCH_A,
                  name: "VM",
                  display_name: "VM",
                  always_on: {
                    keep_running: true,
                    starts_at_login: true,
                    keep_awake: true,
                  },
                  hub: true,
                  addresses: {
                    lan: [],
                    port: 7432,
                    relay: "wss://relay.lophn.dev",
                    relays: [
                      "wss://hub.example/v1/host",
                      "wss://relay.lophn.dev",
                    ],
                  },
                  lophn_version: "0.23.180",
                  record_at: "2026-11-26T00:00:00.000Z",
                  exchange: "ok",
                  destinations: [],
                  sections: {},
                },
              ],
              destinations: [],
              apps: [],
              available: [],
              sections: {},
            }),
          );
        }
        if (route.name === "machines.list") {
          return Promise.resolve(
            ok({
              machines: [
                {
                  machine: MCH_B,
                  device: DEV,
                  name: "MainHome",
                  status: "connected",
                  update: null,
                  path: "direct",
                  last_seen_at: "2026-11-26T00:00:00.000Z",
                  hub: false,
                },
              ],
            }),
          );
        }
        return Promise.resolve(ok({ id: DEV }));
      },
    },
  } as unknown as CommandContext;

  const status = await findCmd(REMOTE_COMMANDS, "remote.status").run({}, ctx);
  assert.ok(status.ok);
  assert.match(status.value.text ?? "", /hub listening: yes/);
  assert.match(
    status.value.text ?? "",
    /wss:\/\/hub\.example\/v1\/host, wss:\/\/relay\.lophn\.dev/,
  );

  const toggle = await findCmd(REMOTE_COMMANDS, "remote.terminal_input").run(
    { device: DEV },
    ctx,
  );
  assert.ok(toggle.ok);
  assert.match(toggle.value.summary, /controlling this computer/);
});

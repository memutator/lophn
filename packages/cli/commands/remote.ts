// `lophn remote on|status|invite|join|devices|terminal-input|remove`: 화면 없는 기계를 사람의 터미널에서 내 기기 명단에 넣고 다룬다.
// 모두 `workspaces: []`라 lophn agent의 `lophn` tool에 없고, agent의 shell에서 부르면 route의 actor user에서 막힌다.
// lophn의 터미널 탭은 사람 token을 받아 거기서 도는 coding agent와 사람을 가릴 수 없으므로, 명단을 바꾸는 명령
// (`ROSTER_CHANGING_COMMANDS`)은 그 안에서 core에 붙기 전에 거절한다(cli/main.ts).
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import { settingsUpdate } from "../../protocol/config/mod.ts";
import { machineEnvironment } from "../../protocol/folder/mod.ts";
import {
  keyTextSchema,
  machinesList,
  remoteRelayStatus,
  rosterInvite,
  rosterJoin,
  rosterKindSchema,
  rosterList,
  rosterRemove,
  rosterSetTerminalInput,
} from "../../protocol/remote/mod.ts";
import { defineCommand } from "./types.ts";

const DEVICE_ID = idSchema("dev");

const IN_TAB =
  "It is refused (forbidden) inside a lophn terminal tab, where a coding agent may be the one typing: use Settings › My computers (or Remote), or a terminal outside lophn (SSH on a computer without a screen).";

const on = defineCommand({
  name: "remote.on",
  summary: "Turn on remote so phones and other computers can reach this one",
  description:
    "Turn on `remote.enabled`: lophn listens on `remote.port` on every network interface (and through `remote.relay` when one is set) and stays running while it is on. " +
    "It is needed before `lophn remote invite` and `lophn remote join`. It does not change the relay setting. " +
    "Turn it off with `lophn settings set remote.enabled false`.",
  input: z.strictObject({}),
  effect: "write",
  routes: [settingsUpdate],
  workspaces: [],
  run: async (_input, ctx) => {
    const updated = await ctx.core.read(settingsUpdate, {
      changes: [{ key: "remote.enabled", action: "set", value: true }],
    });
    if (!updated.ok) return updated;
    const rejection = updated.value.rejected[0];
    if (rejection !== undefined) {
      return err({
        code: rejection.reason === "locked" ? "forbidden" : "invalid_input",
        message: `remote.enabled: ${rejection.message ?? rejection.reason}`,
      });
    }
    const changed = updated.value.changed.length > 0;
    return ok({
      summary: changed ? "remote is on" : "remote was already on",
      content: { enabled: true, changed },
    });
  },
});

const status = defineCommand({
  name: "remote.status",
  summary: "Show remote relay, hub listening, and peer computer status",
  description:
    "Show this computer's remote connection status: active relay state (`off`, `connecting`, `connected`), whether this computer is listening as a Hub (`hub_listening`), ordered relay URLs (Hub relays first, fallback `remote.relay` last), and peer computers in the device list.",
  input: z.strictObject({}),
  effect: "read",
  routes: [remoteRelayStatus, machineEnvironment, machinesList],
  workspaces: [],
  run: async (_input, ctx) => {
    const relay = await ctx.core.read(remoteRelayStatus, {});
    if (!relay.ok) return relay;
    const env = await ctx.core.read(machineEnvironment, {});
    if (!env.ok) return env;
    const peers = await ctx.core.read(machinesList, {});
    if (!peers.ok) return peers;

    const self = env.value.machines.find(
      (m) => m.id === env.value.this_machine.id,
    );
    const orderedRelays =
      self?.addresses.relays !== undefined && self.addresses.relays.length > 0
        ? self.addresses.relays
        : self?.addresses.relay !== null && self?.addresses.relay !== undefined
          ? [self.addresses.relay]
          : relay.value.url !== null
            ? [relay.value.url]
            : [];
    const hubEnabled = self?.hub ?? false;
    const hubListening = relay.value.hub_listening ?? false;
    const computers = peers.value.machines.map((m) => ({
      machine: m.machine,
      device: m.device,
      name: m.name,
      status: m.status,
      path: m.path,
      ...(m.hub === true ? { hub: true } : {}),
    }));

    const lines = [
      `relay: ${relay.value.state}${relay.value.url === null ? "" : ` (${relay.value.url})`}`,
      `hub listening: ${hubListening ? "yes" : "no"}${hubEnabled ? " (hub enabled)" : ""}`,
      `relays: ${orderedRelays.length === 0 ? "none" : orderedRelays.join(", ")}`,
    ];
    if (computers.length > 0) {
      lines.push(`computers (${computers.length}):`);
      for (const c of computers) {
        lines.push(
          `  ${c.name} (${c.machine})  ${c.status}${c.path === null ? "" : ` via ${c.path}`}${c.hub === true ? " [hub]" : ""}`,
        );
      }
    }
    return ok({
      summary: `relay ${relay.value.state}${hubListening ? ", hub listening" : ""}, ${orderedRelays.length} ${orderedRelays.length === 1 ? "relay" : "relays"}, ${computers.length} ${computers.length === 1 ? "computer" : "computers"}`,
      content: {
        relay: {
          state: relay.value.state,
          url: relay.value.url,
          relays: orderedRelays,
        },
        hub: {
          enabled: hubEnabled,
          listening: hubListening,
        },
        computers,
      },
      text: lines.join("\n"),
    });
  },
});

const invite = defineCommand({
  name: "remote.invite",
  summary: "Make an invite for a new phone or computer",
  description:
    "Make a one-time invite that lets a new device into this person's device list. <kind> is the device it is for: phone or computer; the invite does not work for the other kind. " +
    "It prints the invite, one line of text: paste it whole into `lophn remote join '<invite>'` on the other computer, or into Paste the invite instead on the phone. " +
    "Once the device is in, every computer in the list knows it. " +
    "--no-terminal-input keeps this computer from allowing the new device to control this computer (`Allow controlling this computer` — terminals, apps, settings and providers; allowed by default); only this computer is affected, every other computer decides for itself (`lophn remote terminal-input` there). " +
    "The invite lasts 30 minutes; --long makes it last 7 days, for a computer that cannot be on at the same time as this one (dual boot, a home and a work computer). " +
    "Remote must be on: run `lophn remote on` first, or this is unavailable. " +
    IN_TAB,
  input: z.strictObject({
    kind: rosterKindSchema,
    terminal_input: z.boolean().optional(),
    long: z.boolean().optional(),
  }),
  positional: ["kind"],
  effect: "write",
  routes: [rosterInvite],
  workspaces: [],
  run: async (input, ctx) => {
    const made = await ctx.core.read(rosterInvite, {
      kind: input.kind,
      terminal_input: input.terminal_input ?? true,
      lifetime: input.long === true ? "long" : "short",
    });
    if (!made.ok) return made;
    const text = JSON.stringify(made.value.invite);
    const { expires_at } = made.value;
    const where =
      input.kind === "phone"
        ? "into Paste the invite instead on the phone"
        : "into `lophn remote join '<invite>'` on the other computer";
    return ok({
      summary: `invite for a ${input.kind}, expires ${expires_at}`,
      content: { invite: text, expires_at },
      // 초대장 글만 stdout에 두어 그대로 복사하거나 file로 옮긴다.
      text,
      note: `Paste this line ${where}. It works once and expires at ${expires_at}.`,
    });
  },
});

const REFUSED: Readonly<Record<string, string>> = {
  expired:
    "the invite expired; make a new one with `lophn remote invite computer` on the inviting computer",
  used: "another device already used this invite; make a new one",
  untrusted:
    "the invite does not check out (it was cut, changed, or its computer is not trusted); copy the whole line again or make a new one",
  removed:
    "this computer was removed from the device list; its key cannot join again",
  this_computer:
    "this invite was made on this computer; run `lophn remote join` on the other computer",
  id_taken: "another device in the list already has this computer's id",
  key_taken: "this computer's key is already in the list as another device",
};

const join = defineCommand({
  name: "remote.join",
  summary: "Join this computer to another computer's device list",
  description:
    "Join with an invite made by `lophn remote invite computer` on another computer. Quote the whole line: `lophn remote join '<invite>'`. " +
    "After it, this computer and every device in that list know each other. Remote must be on here (`lophn remote on`). " +
    "--no-terminal-input keeps this computer from allowing the inviting computer to control this computer (`Allow controlling this computer`; allowed by default); the inviting computer decides separately, from the invite it made. " +
    "pending: true means the inviting computer was not reached yet; it completes when this computer reaches a computer that trusts it, or a phone carries the news. " +
    "A refusal names why in details.reason: expired, used, untrusted, removed, this_computer, id_taken or key_taken. " +
    IN_TAB,
  input: z.strictObject({
    text: z.string().min(1),
    terminal_input: z.boolean().optional(),
  }),
  positional: ["text"],
  effect: "write",
  routes: [rosterJoin],
  workspaces: [],
  run: async (input, ctx) => {
    const joined = await ctx.core.read(rosterJoin, input);
    if (!joined.ok) {
      const reason = joined.error.details?.reason;
      const told = typeof reason === "string" ? REFUSED[reason] : undefined;
      if (told === undefined) return joined;
      return err({ ...joined.error, message: `join refused: ${told}` });
    }
    const { device, machine, pending } = joined.value;
    const summary = pending
      ? `joined as ${device}, waiting: the inviting computer ${machine} was not reached yet. It completes when this computer reaches a computer that trusts it, or a phone carries the news`
      : `joined as ${device} with ${machine}`;
    return ok({
      summary,
      content: joined.value,
      ...(pending ? { note: summary } : {}),
    });
  },
});

const devices = defineCommand({
  name: "remote.devices",
  summary: "List the devices in this person's device list",
  description:
    "List every phone and computer this computer trusts: id, kind, name, os, terminal_input (`Allow controlling this computer`: whether this computer lets it control terminals, apps, settings and providers here; each computer decides for itself), this (this computer), " +
    "pending (it joined with an invite and no other computer has taken it in yet, e.g. this computer after a join that did not reach the inviting computer). " +
    "For another computer it adds status (connecting, connected, offline, update), path (direct or relay) and hub (whether it acts as a Hub); update means one side runs an older lophn (update: client is this computer, host is that one). " +
    "disputed: true marks a computer that is out because two computers removed each other and this computer cannot tell which to trust (one may be a stolen computer). " +
    "Resolve it here: remove the one you do not trust with `lophn remote remove <key>`, using the row's key, and the other comes back. " +
    "Add one with `lophn remote invite`, take one out with `lophn remote remove`, change whether it may control this computer with `lophn remote terminal-input`.",
  input: z.strictObject({}),
  effect: "read",
  routes: [rosterList, machinesList],
  workspaces: [],
  run: async (_input, ctx) => {
    const listed = await ctx.core.read(rosterList, {});
    if (!listed.ok) return listed;
    const links = await ctx.core.read(machinesList, {});
    if (!links.ok) return links;
    const byDevice = new Map(links.value.machines.map((m) => [m.device, m]));
    const rows = listed.value.devices.map((d) => {
      const link = byDevice.get(d.id);
      return {
        id: d.id,
        key: d.key,
        kind: d.kind,
        name: d.name,
        os: d.os,
        terminal_input: d.terminal_input,
        this: d.this,
        pending: d.pending,
        disputed: d.disputed,
        ...(d.kind === "computer" && !d.this && !d.disputed
          ? {
              status: link?.status ?? "offline",
              update: link?.update ?? null,
              path: link?.path ?? null,
              ...(link?.hub === true ? { hub: true } : {}),
            }
          : {}),
      };
    });
    const disputed = rows.filter((row) => row.disputed).length;
    return ok({
      summary: `${rows.length} ${rows.length === 1 ? "device" : "devices"}`,
      content: { devices: rows },
      arrayKeys: ["devices"],
      ...(disputed === 0
        ? {}
        : {
            note: `${disputed} disputed: two computers removed each other. Remove the one you do not trust with \`lophn remote remove <key>\` and the other comes back.`,
          }),
    });
  },
});

const terminalInput = defineCommand({
  name: "remote.terminal_input",
  summary: "Allow a device to control this computer, or stop it",
  description:
    "Allow a device in the device list to control this computer (`Allow controlling this computer`: terminals, apps, settings, files and providers), or revoke control with --off. <device> is its dev_ id from `lophn remote devices`. " +
    "It changes this computer only: each computer decides for itself what the devices in the list may do on it, so run it on the computer that should allow control. " +
    "For another computer to run commands or call apps on this computer, allow it here for that computer. " +
    "A device that is not in the list is not_found; this computer's own row is invalid_input. Remote must be on (`lophn remote on`). " +
    IN_TAB,
  input: z.strictObject({
    device: DEVICE_ID,
    off: z.boolean().optional(),
  }),
  positional: ["device"],
  effect: "write",
  routes: [rosterSetTerminalInput],
  workspaces: [],
  run: async (input, ctx) => {
    const on = input.off !== true;
    const done = await ctx.core.read(rosterSetTerminalInput, {
      id: input.device,
      on,
    });
    if (!done.ok) return done;
    return ok({
      summary: `${on ? "allowed" : "stopped"} ${done.value.id} controlling this computer`,
      content: { id: done.value.id, terminal_input: on },
    });
  },
});

const remove = defineCommand({
  name: "remote.remove",
  summary: "Take a device out of the device list",
  description:
    "Remove a device from the device list, by its dev_ id or its key from `lophn remote devices`. It spreads to every computer in the list: the device is cut off everywhere and its key cannot join again (a new invite makes it a new device). " +
    "A disputed row (two computers removed each other) is removed by its key: the one removed here stays out and the other comes back. " +
    "An id that more than one row carries is refused (conflict); use the key. This computer cannot remove itself (invalid_input). " +
    IN_TAB,
  input: z.strictObject({ device: z.string().min(1) }),
  positional: ["device"],
  effect: "write",
  routes: [rosterRemove],
  workspaces: [],
  run: async (input, ctx) => {
    const target = DEVICE_ID.safeParse(input.device).success
      ? { id: input.device as z.infer<typeof DEVICE_ID> }
      : keyTextSchema.safeParse(input.device).success
        ? { key: input.device }
        : undefined;
    if (target === undefined) {
      return err({
        code: "invalid_input",
        message: `${input.device} is neither a dev_ id nor a device key from \`lophn remote devices\``,
      });
    }
    const done = await ctx.core.read(rosterRemove, target);
    if (!done.ok) return done;
    return ok({ summary: `removed ${done.value.id}`, content: done.value });
  },
});

export const REMOTE_COMMANDS = [
  on,
  status,
  invite,
  join,
  devices,
  terminalInput,
  remove,
];

export const ROSTER_CHANGING_COMMANDS: readonly string[] = [
  invite.name,
  join.name,
  terminalInput.name,
  remove.name,
];

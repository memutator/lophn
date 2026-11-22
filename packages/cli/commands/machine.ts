// `lophn machine environment|forget|computers`: 사람의 여러 기계가 폴더로 앱을 주고받는 환경을 읽고, 사람이 기계 하나를 목록에서 지우고,
// agent가 `--on`으로 부를 수 있는 사람의 컴퓨터를 읽는다.
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import {
  machineEnvironment,
  machineForget,
} from "../../protocol/folder/mod.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { machineComputers } from "../../protocol/machine/mod.ts";
import { defineCommand } from "./types.ts";

const environment = defineCommand({
  name: "machine.environment",
  summary: "Read this person's machines, sync folders and synced apps",
  description: [
    "Read how this computer exchanges apps with the person's other machines through sync folders. It is not live: it shows what lophn last read and wrote (export runs a few seconds after a change and every 5 minutes; reading runs when the folder changes and every 2 minutes).",
    "this_machine is this computer. machines lists it and every machine whose record lophn read from a sync folder: name, display_name (the name with the last 6 characters of the id when two machines share a name; use it when you talk to the person), always_on, addresses, lophn_version, record_at (when that machine last wrote its record), exchange (ok; update_this: update lophn on this computer to exchange with that machine; update_peer: that machine runs an older lophn and must be updated there).",
    'destinations are the sync folders on this computer: a name mapped to a local path, with state ok, missing or not_writable, and how many other machines wrote there. lophn only writes and reads files in these folders; an outside tool the person runs moves them between machines. A destination is set only with the person\'s approval: change it with `lophn settings set folder.destinations \'{"<name>":{"path":"<absolute path>"}}\'` (the value is the whole map, so keep the names already there) and the person is asked to allow that exact change. The same name may point at a different path on each machine.',
    "apps lists the apps on this computer. destinations lists each destination the app's declaration sync sends tables to (empty when no table leaves this computer): name, tables (the tables that go there; null for an old release that sends every table), state set or not_set_here (this computer has no destination of that name, so those tables do not sync here), export (exported_at, head: last file number written, pending: log lines not passed yet, error) and imports (per other machine: cursor, the last file applied; waiting_for, the next file number this computer waits for and the outside tool has not brought yet; held, files from a different release of the app, kept on this computer and not applied until this computer runs that release; error). Each destination is its own stream: one that is missing or stopped does not stop the others. follow is how this computer follows a newer release another machine runs (state current, installing, activating, waiting_consent (the person has not answered the consent card yet), declined, lophn_update, install_failed or activation_failed with reason, diverged (two machines released versions that do not descend from each other: combine them into one new release); release is the release it follows). held lists changes from another machine kept here because that machine runs a different release, per destination, machine and release, with why: newer_release (they apply when this computer runs that release), older_release (they arrive when that machine updates), diverged (they arrive after the two releases are combined). machines lists the release each machine runs for this app. away is set when this computer has held changes to resolve, with since when this computer was away from the other machines longer than 90 days for that app (null once it caught up): changes that could undo deletions made elsewhere are held, not sent; read and resolve them with `lophn app sync-held`.",
    "available lists apps another machine shared that this computer does not have yet; take one in with `lophn app take-in`.",
    "A phone does not use sync folders: it syncs through the computer it is paired with.",
    "Error codes: destination_missing, not_writable, foreign_writer, invalid_file, newer_format (that machine's lophn is newer; update lophn here), too_large, clock_ahead (details name the machine whose clock is ahead and by how much; its changes wait until the clocks agree), apply_failed, app_not_running, away_too_long, source_failed.",
  ].join(" "),
  input: z.strictObject({}),
  effect: "read",
  routes: [machineEnvironment],
  workspaces: ["home", "app"],
  run: async (input, ctx) => {
    const read = await ctx.core.read(machineEnvironment, input);
    if (!read.ok) return read;
    const env = read.value;
    const ready = env.destinations.filter((each) => each.state === "ok").length;
    const failing = env.apps.filter(
      (app) =>
        app.destinations.some(
          (destination) =>
            destination.export?.error != null ||
            destination.imports.some((each) => each.error !== null),
        ) || app.away !== null,
    ).length;
    return ok({
      summary: `${env.machines.length} ${env.machines.length === 1 ? "machine" : "machines"}, ${ready}/${env.destinations.length} sync folders ok, ${failing} ${failing === 1 ? "app" : "apps"} with errors`,
      content: env,
    });
  },
});

const forget = defineCommand({
  name: "machine.forget",
  summary: "Remove a machine from this computer's list",
  description:
    "Forget another machine on this computer: lophn stops reading its files and no longer waits for it before cleaning up old deletions. Use it for a machine the person no longer has. If that machine writes to the sync folder again it comes back to the list.",
  input: z.strictObject({ machine: idSchema("mch") }),
  positional: ["machine"],
  effect: "write",
  routes: [machineForget],
  workspaces: [],
  run: async (input, ctx) => {
    const done = await ctx.core.read(machineForget, input);
    if (!done.ok) return done;
    return ok({ summary: `forgot ${input.machine}`, content: done.value });
  },
});

const computers = defineCommand({
  name: "machine.computers",
  summary: "List the person's computers you can reach with --on",
  description:
    "List the person's computers: id, name, status (online, offline, connecting, update), current (this computer) and always_on. Use a name or id with --on on call send, session list, agent list and agent card. A call sent to an offline computer goes when that computer comes back.",
  input: z.strictObject({}),
  effect: "read",
  routes: [machineComputers],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const read = await ctx.core.read(machineComputers, input);
    if (!read.ok) return read;
    const { computers } = read.value;
    return ok({
      summary: `${computers.length} ${computers.length === 1 ? "computer" : "computers"}`,
      content: { computers },
      arrayKeys: ["computers"],
    });
  },
});

export const MACHINE_COMMANDS = [environment, forget, computers];

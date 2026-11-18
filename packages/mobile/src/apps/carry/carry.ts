// The phone carries the files of the "my computers" folder (architecture folder-sync.md, "옮기는 길 셋"): it takes a
// computer's manifests and files and hands them to the next computer it meets. It neither verifies nor applies them:
// the computer that takes one checks the signature and the list chain. The phone only checks size and sha256 against
// the lists it holds, to keep wrong bytes off the phone.
//
// What it holds: per machine the manifest with the biggest revision, files under `files/<path>`, and per computer what
// that computer holds (the manifest revision of each machine) and its last `carry/wants`. One SQLite database, so what
// the phone holds and what it knows of the computers change together.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { err, ok, type Result } from "../../../../base/result.ts";
import type { SyncDb } from "../../../../protocol/apps/sync/db.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import {
  CARRY_CHUNK_MAX_BYTES,
  CARRY_WANTS_MAX,
  type CarryPutStatus,
  CROSS_EVENT_MAX_AGE_MS,
  carryFile,
  carryManifests,
  carryPut,
  carryWants,
  expectedFiles,
  isCover,
  type ManifestBody,
  manifestBodySchema,
  manifestPath,
  parseCarryPath,
} from "../../../../protocol/remote/carry.ts";
import type { Remote } from "../local/ports.ts";
import { ask, failed, fromBase64, toBase64 } from "../local/transfer.ts";
import type { CarryDeps } from "./ports.ts";

const KIB = 1024;
const MIB = 1024 * KIB;
const DAY = 24 * 60 * 60 * 1000;

// What the phone holds at most. Past it the files it got first go first; a bigger file is not carried.
export const CARRY_MAX_BYTES = 256 * MIB;
export const CARRY_MAX_AGE_MS = 30 * DAY;
// The person's choices for the biggest file carried over mobile data.
export const CARRY_LIMITS = [256 * KIB, MIB, 8 * MIB, Infinity] as const;
export const CARRY_LIMIT_DEFAULT = MIB;

type Expected = { size: number; sha256: string };
type Want = Expected & { machine: string; path: string };
type Held = Want & { revision: number; received_at: number };
type Computer = { revisions: Record<string, number>; wants: Want[] };

const INCOMING = "incoming";
const fileAt = (path: string) => `files/${path}`;
const keyOf = (file: { machine: string; path: string }) => `${file.machine}\n${file.path}`;
const hex = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
const same = (a: Expected, b: Expected) => a.size === b.size && a.sha256 === b.sha256;
const isEvent = (path: string) => path.split("/")[4] === "events";

export function ensureTables(db: SyncDb): void {
  db.exec(`
    create table if not exists carry_manifests (
      machine text primary key,
      revision integer not null,
      text text not null,
      received_at integer not null
    );
    create table if not exists carry_files (
      machine text not null,
      path text not null,
      size integer not null,
      sha256 text not null,
      revision integer not null,
      received_at integer not null,
      source text not null,
      primary key (machine, path)
    );
    create table if not exists carry_computers (
      machine text primary key,
      revisions text not null,
      wants text not null,
      wants_at integer
    );
  `);
}

function heldManifest(
  db: SyncDb,
  machine: string,
): { revision: number; text: string; body: ManifestBody | null } | null {
  const row = db.all("select revision, text from carry_manifests where machine = ?", [machine])[0];
  if (row === undefined) return null;
  const text = String(row.text);
  return { revision: Number(row.revision), text, body: bodyOf(text) };
}

function bodyOf(text: string): ManifestBody | null {
  try {
    const parsed = manifestBodySchema.safeParse((JSON.parse(text) as { body: unknown }).body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function heldFile(db: SyncDb, machine: string, path: string): Held | null {
  const row = db.all(
    "select size, sha256, revision, received_at from carry_files where machine = ? and path = ?",
    [machine, path],
  )[0];
  return row === undefined
    ? null
    : {
        machine,
        path,
        size: Number(row.size),
        sha256: String(row.sha256),
        revision: Number(row.revision),
        received_at: Number(row.received_at),
      };
}

function readComputer(db: SyncDb, machine: string): Computer {
  const row = db.all("select revisions, wants from carry_computers where machine = ?", [machine])[0];
  return row === undefined
    ? { revisions: {}, wants: [] }
    : { revisions: JSON.parse(String(row.revisions)), wants: JSON.parse(String(row.wants)) };
}

function writeComputer(db: SyncDb, machine: string, computer: Computer, wantsAt: number | null) {
  db.run(
    `insert into carry_computers (machine, revisions, wants, wants_at) values (?, ?, ?, ?)
     on conflict (machine) do update set revisions = excluded.revisions, wants = excluded.wants,
       wants_at = coalesce(excluded.wants_at, wants_at)`,
    [machine, JSON.stringify(computer.revisions), JSON.stringify(computer.wants), wantsAt],
  );
}

function drop(deps: CarryDeps, file: { machine: string; path: string }) {
  deps.db.run("delete from carry_files where machine = ? and path = ?", [file.machine, file.path]);
  deps.files.remove(fileAt(file.path));
}

/** What the phone holds now, for Settings. */
export function holding(db: SyncDb): { files: number; bytes: number } {
  const row = db.all("select count(*) as files, coalesce(sum(size), 0) as bytes from carry_files")[0]!;
  return { files: Number(row.files), bytes: Number(row.bytes) };
}

// Reads a file of the computer in chunks into `sink`. False when the computer does not hold it or the bytes are not
// the size and sha256 asked for.
async function pull(
  remote: Remote,
  file: Want,
  sink: (bytes: Uint8Array) => void,
): Promise<Result<boolean>> {
  const hash = sha256.create();
  let offset = 0;
  while (offset < file.size) {
    const reply = await ask(remote, carryFile, {
      machine: file.machine,
      path: file.path,
      offset,
      length: Math.min(CARRY_CHUNK_MAX_BYTES, file.size - offset),
    });
    if (!reply.ok) return reply.error.code === "not_found" ? ok(false) : failed(reply);
    const bytes = fromBase64((reply.value as { base64: string }).base64);
    if (bytes.byteLength === 0) return ok(false);
    hash.update(bytes);
    sink(bytes);
    offset += bytes.byteLength;
  }
  return ok(offset === file.size && bytesToHex(hash.digest()) === file.sha256);
}

// Hands a file to the computer in chunks; its answer to the last one.
async function put(
  remote: Remote,
  file: Want,
  chunk: (offset: number, length: number) => Uint8Array,
): Promise<Result<CarryPutStatus>> {
  for (let offset = 0; ; ) {
    const bytes = chunk(offset, Math.min(CARRY_CHUNK_MAX_BYTES, file.size - offset));
    const reply = await ask(remote, carryPut, {
      machine: file.machine,
      path: file.path,
      size: file.size,
      sha256: file.sha256,
      offset,
      bytes: toBase64(bytes),
    });
    if (!reply.ok) return failed(reply);
    const { status } = reply.value as { status: CarryPutStatus };
    offset += bytes.byteLength;
    if (status !== "partial") return ok(status);
    if (bytes.byteLength === 0 || offset >= file.size) {
      return err({ code: "internal", message: "the computer still waits after the whole file" });
    }
  }
}

async function readWants(remote: Remote): Promise<Result<Want[]> | null> {
  const all: Want[] = [];
  let after: { machine: string; path: string } | undefined;
  for (;;) {
    const reply = await ask(remote, carryWants, {
      limit: CARRY_WANTS_MAX,
      ...(after === undefined ? {} : { after }),
    });
    if (!reply.ok) return reply.error.code === "not_found" ? null : failed(reply);
    const { files } = reply.value as { files: Want[] };
    const last = files.at(-1);
    if (last === undefined) return ok(all);
    all.push(...files);
    after = { machine: last.machine, path: last.path };
  }
}

/**
 * One meeting with a connected computer (its machine id `computer`). `roster` is the machines of every computer in the
 * phone's list. Takes the computer's newer manifests, hands it the phone's newer manifests and the files it wants, and
 * takes from it what another computer last wanted and what its new manifests brought. A computer without the carry
 * routes (an old lophn) is left alone.
 */
export async function carryWith(
  deps: CarryDeps,
  remote: Remote,
  computer: string,
  roster: readonly string[],
): Promise<Result<void>> {
  const { db, files } = deps;
  const heldBytes = (path: string) => files.read(fileAt(path));
  const listed = await ask(remote, carryManifests, {});
  if (!listed.ok) return listed.error.code === "not_found" ? ok(undefined) : failed(listed);
  const state = readComputer(db, computer);

  // Its manifests. For a machine whose manifest the phone takes now: what the one it held listed (null: none).
  const before = new Map<string, Map<string, Expected> | null>();
  const { manifests } = listed.value as { manifests: (Expected & { machine: string; revision: number })[] };
  for (const each of manifests) {
    state.revisions[each.machine] = each.revision;
    const held = heldManifest(db, each.machine);
    if (held !== null && held.revision >= each.revision) continue;
    const parts: Uint8Array[] = [];
    const got = await pull(remote, { ...each, path: manifestPath(each.machine as Id<"mch">) }, (bytes) =>
      parts.push(bytes),
    );
    if (!got.ok) return got;
    if (!got.value) continue;
    const text = new TextDecoder().decode(concat(parts));
    const body = bodyOf(text);
    if (body === null || body.machine !== each.machine || body.revision !== each.revision) continue;
    before.set(
      each.machine,
      held?.body ? expectedFiles(held.body, heldBytes) : null,
    );
    db.run(
      `insert into carry_manifests (machine, revision, text, received_at) values (?, ?, ?, ?)
       on conflict (machine) do update set revision = excluded.revision, text = excluded.text,
         received_at = excluded.received_at`,
      [each.machine, each.revision, text, deps.now()],
    );
  }
  writeComputer(db, computer, state, null);

  // The phone's newer manifests go whatever the network.
  for (const row of db.all("select machine from carry_manifests")) {
    const machine = String(row.machine);
    const held = heldManifest(db, machine)!;
    if ((state.revisions[machine] ?? 0) >= held.revision) continue;
    const bytes = new TextEncoder().encode(held.text);
    const status = await put(
      remote,
      { machine, path: manifestPath(machine as Id<"mch">), size: bytes.byteLength, sha256: hex(bytes) },
      (offset, length) => bytes.subarray(offset, offset + length),
    );
    if (!status.ok) return status;
    if (status.value === "accepted" || status.value === "have") {
      state.revisions[machine] = held.revision;
      writeComputer(db, computer, state, null);
    }
  }

  // The files it wants. A list file it takes can make it want more, so it is asked again until nothing new went.
  for (;;) {
    const wants = await readWants(remote);
    if (wants === null) return ok(undefined);
    if (!wants.ok) return wants;
    state.wants = wants.value;
    writeComputer(db, computer, state, deps.now());
    let more = false;
    for (const want of wants.value) {
      const held = heldFile(db, want.machine, want.path);
      if (held === null || !same(held, want) || held.size > deps.cap()) continue;
      const status = await put(remote, want, (offset, length) =>
        files.readRange(fileAt(want.path), offset, length),
      );
      if (!status.ok) return status;
      if (status.value === "rejected") drop(deps, held);
      if (status.value === "accepted" || status.value === "have") {
        state.wants = state.wants.filter((each) => keyOf(each) !== keyOf(want));
        writeComputer(db, computer, state, null);
      }
      if (status.value === "accepted") more = true;
    }
    if (!more) break;
  }

  // What to take from it: what another computer last wanted, and what a manifest taken now brought, when a computer
  // other than this one and the maker can use it. A file the phone cannot check yet goes after its list file.
  const wanted: Want[] = db
    .all("select wants from carry_computers where machine != ?", [computer])
    .flatMap((row) => JSON.parse(String(row.wants)) as Want[]);
  const tried = new Set<string>();
  for (;;) {
    const expected = new Map<string, Map<string, Expected>>();
    const expectOf = (machine: string) => {
      let found = expected.get(machine);
      if (found === undefined) {
        const body = heldManifest(db, machine)?.body;
        found = body ? expectedFiles(body, heldBytes) : new Map<string, Expected>();
        expected.set(machine, found);
      }
      return found;
    };
    const targets = [...wanted];
    for (const [machine, old] of before) {
      if (!roster.some((each) => each !== computer && each !== machine)) continue;
      for (const [path, now] of expectOf(machine)) {
        const was = old?.get(path);
        // Meeting a machine's manifest for the first time, the phone does not know what is new: it takes only the lists.
        const fresh =
          old === null
            ? isCover(path) || parseCarryPath(path)?.coveredBy === null
            : was === undefined || !same(was, now);
        if (fresh) targets.push({ machine, path, ...now });
      }
    }
    let gotList = false;
    for (const target of targets) {
      const map = expectOf(target.machine);
      let path: string | null = target.path;
      let now = map.get(path);
      while (now === undefined && path !== null) {
        path = parseCarryPath(path)?.coveredBy ?? null;
        now = path === null ? undefined : map.get(path);
      }
      if (now === undefined || path === null) continue;
      if (path === target.path && !same(now, target)) continue;
      const file = { machine: target.machine, path, ...now };
      const held = heldFile(db, file.machine, file.path);
      if ((held !== null && same(held, file)) || tried.has(keyOf(file))) continue;
      if (file.size > Math.min(deps.cap(), CARRY_MAX_BYTES)) continue;
      tried.add(keyOf(file));
      files.remove(INCOMING);
      files.write(INCOMING, new Uint8Array());
      const got = await pull(remote, file, (bytes) => files.append(INCOMING, bytes));
      if (!got.ok) return got;
      if (!got.value) {
        files.remove(INCOMING);
        continue;
      }
      files.move(INCOMING, fileAt(file.path));
      db.run(
        `insert into carry_files (machine, path, size, sha256, revision, received_at, source)
         values (?, ?, ?, ?, ?, ?, ?)
         on conflict (machine, path) do update set size = excluded.size, sha256 = excluded.sha256,
           revision = excluded.revision, received_at = excluded.received_at, source = excluded.source`,
        [
          file.machine,
          file.path,
          file.size,
          file.sha256,
          heldManifest(db, file.machine)!.revision,
          deps.now(),
          computer,
        ],
      );
      if (isCover(file.path)) {
        gotList = true;
        expected.delete(file.machine);
      }
    }
    if (!gotList) return ok(undefined);
  }
}

/**
 * What goes. A file goes once every computer in the list holds a manifest of its machine at least as new as the one
 * that brought it and did not want it at its last `carry/wants`; a list file stays for checking until it is old. Past
 * that: a machine no longer in the list, a file older than CARRY_MAX_AGE_MS (an event file than
 * CROSS_EVENT_MAX_AGE_MS), and past CARRY_MAX_BYTES the oldest first.
 */
export function prune(deps: CarryDeps, roster: readonly string[]): void {
  const { db } = deps;
  const listed = new Set(roster);
  const now = deps.now();
  const gone: Held[] = [];
  db.exec("begin immediate");
  try {
    for (const table of ["carry_computers", "carry_manifests"]) {
      for (const row of db.all(`select machine from ${table}`)) {
        if (!listed.has(String(row.machine))) {
          db.run(`delete from ${table} where machine = ?`, [String(row.machine)]);
        }
      }
    }
    const computers = roster.map((machine) => {
      const state = readComputer(db, machine);
      return { revisions: state.revisions, wants: new Set(state.wants.map(keyOf)) };
    });
    const kept: Held[] = [];
    const rows = db.all("select machine, path from carry_files order by received_at, machine, path");
    for (const row of rows) {
      const file = heldFile(db, String(row.machine), String(row.path))!;
      const age = now - file.received_at;
      const delivered =
        !isCover(file.path) &&
        computers.every(
          (each) =>
            (each.revisions[file.machine] ?? 0) >= file.revision && !each.wants.has(keyOf(file)),
        );
      if (
        !listed.has(file.machine) ||
        delivered ||
        age > CARRY_MAX_AGE_MS ||
        (isEvent(file.path) && age > CROSS_EVENT_MAX_AGE_MS)
      ) {
        gone.push(file);
      } else {
        kept.push(file);
      }
    }
    let total = kept.reduce((sum, file) => sum + file.size, 0);
    for (const file of kept) {
      if (total <= CARRY_MAX_BYTES) break;
      gone.push(file);
      total -= file.size;
    }
    for (const file of gone) {
      db.run("delete from carry_files where machine = ? and path = ?", [file.machine, file.path]);
    }
    db.exec("commit");
  } catch (thrown) {
    db.exec("rollback");
    throw thrown;
  }
  // After the commit: a row never names a file that is not there.
  for (const file of gone) deps.files.remove(fileAt(file.path));
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

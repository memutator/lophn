import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { nodeSyncDb } from "../../../../protocol/apps/sync/node-db.ts";
import {
  expectedFiles,
  manifestBodySchema,
  manifestPathMachine,
} from "../../../../protocol/remote/carry.ts";
import { generateKeyPair, remoteKeyText } from "../../../../protocol/remote/noise.ts";
import {
  generateSigningKey,
  type RosterEntryBody,
  type RosterStatement,
  signRoster,
} from "../../../../protocol/remote/roster.ts";
import type { Remote } from "../local/ports.ts";
import { CARRY_MAX_BYTES, carryRosterMachines, carryWith, ensureTables, prune } from "./carry.ts";
import type { CarryDeps } from "./ports.ts";

// The phone on node (the carry folder on disk, its database on node:sqlite) and fake computers that answer the four
// carry routes the way the computer's receiving side does: it wants what the manifests it holds list and it lacks,
// and takes a file only when its list chain expects those bytes.

const A = "mch_01jx00000000000000000000aa";
const B = "mch_01jx00000000000000000000bb";
const C = "mch_01jx00000000000000000000cc";
const APP = "app_01jx0000000000000000000001";
const AT = "2026-11-19T00:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const text = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const entry = (path: string, bytes: Uint8Array) => ({ path, size: bytes.byteLength, sha256: sha(bytes) });

const root = mkdtempSync(join(tmpdir(), "lophn-carry-"));
after(() => rmSync(root, { recursive: true, force: true }));
let phones = 0;

function phone(
  clock: { now: number },
  cap: () => number = () => Infinity,
): CarryDeps & { holds(path: string): boolean } {
  const dir = join(root, `phone-${++phones}`);
  mkdirSync(dir);
  const at = (path: string) => join(dir, path);
  const made = (path: string) => {
    mkdirSync(dirname(at(path)), { recursive: true });
    return at(path);
  };
  const raw = new DatabaseSync(join(dir, "carry.db"));
  const db = nodeSyncDb(raw);
  ensureTables(db);
  return {
    db,
    now: () => clock.now,
    cap,
    files: {
      read: (path) => (existsSync(at(path)) ? new Uint8Array(readFileSync(at(path))) : null),
      readRange: (path, offset, length) => new Uint8Array(readFileSync(at(path)).subarray(offset, offset + length)),
      write: (path, bytes) => writeFileSync(made(path), bytes),
      append: (path, bytes) => writeFileSync(made(path), bytes, { flag: "a" }),
      move: (from, to) => renameSync(at(from), made(to)),
      remove: (path) => rmSync(at(path), { recursive: true, force: true }),
    },
    holds: (path) =>
      db.all("select 1 from carry_files where path = ?", [path]).length === 1 && existsSync(at(`files/${path}`)),
  };
}

// A machine's own folder: a manifest over one app's files.json, which lists the data files.
function made(machine: string, revision: number, data: Record<string, string>) {
  const files = new Map<string, Uint8Array>();
  const listed = Object.entries(data).map(([name, content]) => {
    const path = `machines/${machine}/apps/${APP}/data/${name}`;
    const bytes = new TextEncoder().encode(content);
    files.set(path, bytes);
    return entry(path, bytes);
  });
  const listPath = `machines/${machine}/apps/${APP}/files.json`;
  const list = text({ format: 1, machine, app: APP, written_at: AT, files: listed });
  files.set(listPath, list);
  const manifest = `${JSON.stringify({
    body: { format: 1, machine, revision, written_at: AT, files: [entry(listPath, list)] },
    signature: "not-checked-by-the-phone",
  })}\n`;
  return { manifest, files };
}

function computer(me: string) {
  const manifests = new Map<string, string>();
  const files = new Map<string, Uint8Array>();
  const staging = new Map<string, Buffer>();
  const expected = (machine: string) => {
    const held = manifests.get(machine);
    return held === undefined
      ? new Map<string, { size: number; sha256: string }>()
      : expectedFiles(manifestBodySchema.parse(JSON.parse(held).body), (path) => files.get(path) ?? null);
  };
  const wants = () =>
    [...manifests.keys()]
      .sort()
      .flatMap((machine) =>
        [...expected(machine)]
          .filter(([path, want]) => files.get(path) === undefined || sha(files.get(path)!) !== want.sha256)
          .map(([path, want]) => ({ machine, path, ...want })),
      )
      .sort((a, b) => (a.machine === b.machine ? (a.path < b.path ? -1 : 1) : a.machine < b.machine ? -1 : 1));
  const answer = (value: unknown) => ({ ok: true, value });
  const notFound = { ok: false, error: { code: "not_found", message: "not here" } };
  const remote: Remote = {
    async call({ method, body }) {
      const input = body as Record<string, any>;
      switch (method) {
        case "manifests":
          return answer({
            manifests: [...manifests].map(([machine, held]) => ({
              machine,
              revision: JSON.parse(held).body.revision,
              size: Buffer.byteLength(held),
              sha256: sha(held),
            })),
          });
        case "wants": {
          const after = input.after as { machine: string; path: string } | undefined;
          const rest = wants().filter(
            (want) =>
              after === undefined ||
              want.machine > after.machine ||
              (want.machine === after.machine && want.path > after.path),
          );
          return answer({ files: rest.slice(0, input.limit) });
        }
        case "file": {
          const machine = manifestPathMachine(input.path);
          const bytes =
            machine === null ? files.get(input.path) : Buffer.from(manifests.get(machine) ?? "");
          if (bytes === undefined || bytes.byteLength === 0) return notFound;
          return answer({
            base64: Buffer.from(bytes.subarray(input.offset, input.offset + input.length)).toString("base64"),
          });
        }
        case "put": {
          const machine = manifestPathMachine(input.path);
          const bytes = Buffer.from(input.bytes, "base64");
          if (machine !== null) {
            const held = manifests.get(machine);
            const revision = JSON.parse(bytes.toString()).body.revision;
            if (held !== undefined && JSON.parse(held).body.revision >= revision) return answer({ status: "have" });
            manifests.set(machine, bytes.toString());
            return answer({ status: "accepted" });
          }
          const want = expected(input.machine).get(input.path);
          if (want === undefined || want.sha256 !== input.sha256) return answer({ status: "rejected" });
          if (files.get(input.path) !== undefined && sha(files.get(input.path)!) === want.sha256) {
            return answer({ status: "have" });
          }
          const so = Buffer.concat([input.offset === 0 ? Buffer.alloc(0) : staging.get(input.path)!, bytes]);
          if (so.byteLength < input.size) {
            staging.set(input.path, so);
            return answer({ status: "partial" });
          }
          if (sha(so) !== input.sha256) return answer({ status: "rejected" });
          files.set(input.path, new Uint8Array(so));
          return answer({ status: "accepted" });
        }
        default:
          return notFound;
      }
    },
  };
  return {
    remote,
    files,
    /** The machine writes its own folder. */
    publish(own: ReturnType<typeof made>) {
      manifests.set(me, own.manifest);
      for (const [path, bytes] of own.files) files.set(path, bytes);
    },
  };
}

test("the phone keeps a file until every other computer holds the manifest that brought it and does not want it", async () => {
  const clock = { now: 1_000 };
  const deps = phone(clock);
  const roster = [A, B, C];
  const [a, b, c] = [computer(A), computer(B), computer(C)];
  const first = made(A, 1, { "000000000001.changes": "one" });
  a.publish(first);
  const list = `machines/${A}/apps/${APP}/files.json`;
  const one = `machines/${A}/apps/${APP}/data/000000000001.changes`;
  const meet = async (who: ReturnType<typeof computer>, machine: string) => {
    clock.now += 1_000;
    assert.deepEqual(await carryWith(deps, who.remote, machine, roster), { ok: true, value: undefined });
    prune(deps, roster);
  };

  // A's manifest is new to the phone: it takes the list, not the data nobody asked for yet.
  await meet(b, B);
  await meet(a, A);
  assert.ok(deps.holds(list));
  assert.ok(!deps.holds(one));
  // B and C take the manifest and the list, and say they want the data file; the phone takes it from A for them.
  await meet(b, B);
  assert.ok(b.files.has(list));
  await meet(c, C);
  assert.ok(c.files.has(list));
  await meet(a, A);
  assert.ok(deps.holds(one));
  await meet(b, B);
  assert.equal(sha(b.files.get(one)!), sha("one"));
  // A and B have it; C holds the manifest that lists it but still wants it: it stays.
  assert.ok(deps.holds(one));
  await meet(c, C);
  assert.equal(sha(c.files.get(one)!), sha("one"));
  assert.ok(!deps.holds(one));
  // The list stays to check what the next one lists.
  assert.ok(deps.holds(list));

  // A writes more: the phone takes what its new list brought, without anyone asking.
  a.publish(made(A, 2, { "000000000001.changes": "one", "000000000002.changes": "two" }));
  const two = `machines/${A}/apps/${APP}/data/000000000002.changes`;
  await meet(a, A);
  assert.ok(deps.holds(two));
  assert.ok(!deps.holds(one));
  // B takes it; C still holds the manifest before it: it stays until C met the phone.
  await meet(b, B);
  assert.ok(b.files.has(two));
  assert.ok(deps.holds(two));
  await meet(c, C);
  assert.ok(c.files.has(two));
  assert.ok(!deps.holds(two));
});

test("past the bounds the oldest files go first; an event file goes after a week, any file after 30 days", () => {
  const clock = { now: 100 * DAY };
  const deps = phone(clock);
  const add = (name: string, size: number, receivedDaysAgo: number) => {
    const path = `machines/${A}/apps/${APP}/${name}`;
    deps.files.write(`files/${path}`, new Uint8Array([1]));
    deps.db.run(
      "insert into carry_files (machine, path, size, sha256, revision, received_at, source) values (?, ?, ?, ?, 1, ?, ?)",
      [A, path, size, sha("x"), clock.now - receivedDaysAgo * DAY, B],
    );
    return path;
  };
  const oldest = add("data/000000000001.changes", CARRY_MAX_BYTES / 2, 5);
  const older = add("data/000000000002.changes", CARRY_MAX_BYTES / 2, 4);
  const newest = add("data/000000000003.changes", 1024, 3);
  const event = add("events/01jx0000000000000000000001.json", 100, 8);
  const young = add("events/01jx0000000000000000000002.json", 100, 2);
  const stale = add("data/000000000004.changes", 100, 31);
  // A computer that never met the phone keeps everything from going as delivered.
  prune(deps, [A, B]);
  assert.ok(!deps.holds(oldest));
  assert.ok(deps.holds(older));
  assert.ok(deps.holds(newest));
  assert.ok(!deps.holds(event));
  assert.ok(deps.holds(young));
  assert.ok(!deps.holds(stale));
  // A machine that left the list takes its files with it.
  prune(deps, [B]);
  assert.ok(!deps.holds(older));
  assert.ok(!deps.holds(young));
});

test("a file skipped for the mobile data cap is taken once Wi-Fi or a bigger cap returns, and its mark expires after 30 days", async () => {
  const clock = { now: 1_000 };
  let max = 100;
  const deps = phone(clock, () => max);
  const roster = [A, B];
  const [a, b] = [computer(A), computer(B)];
  const meet = async (who: ReturnType<typeof computer>, machine: string) => {
    clock.now += 1_000;
    assert.deepEqual(await carryWith(deps, who.remote, machine, roster), { ok: true, value: undefined });
    prune(deps, roster);
  };

  // Initial manifest on Wi-Fi so the phone holds A's list and rev 1.
  max = Infinity;
  a.publish(made(A, 1, { "000000000001.changes": "one" }));
  await meet(a, A);
  await meet(b, B);

  // Over mobile data (1024 B cap), A publishes a small file and a large file (2048 B).
  max = 1024;
  const bigContent = "x".repeat(2048);
  a.publish(
    made(A, 2, {
      "000000000001.changes": "one",
      "000000000002.changes": "small",
      "000000000003.changes": bigContent,
    }),
  );
  const small = `machines/${A}/apps/${APP}/data/000000000002.changes`;
  const big = `machines/${A}/apps/${APP}/data/000000000003.changes`;
  await meet(a, A);
  assert.ok(deps.holds(small));
  assert.ok(!deps.holds(big));
  const skippedAt = Number(
    deps.db.all("select at from carry_skipped where machine = ? and path = ?", [A, big])[0]?.at,
  );
  assert.ok(skippedAt > 0);

  // Meeting A again under the same cap does not refresh the mark's timestamp.
  clock.now += 10 * DAY;
  await meet(a, A);
  assert.ok(!deps.holds(big));
  assert.equal(
    Number(deps.db.all("select at from carry_skipped where machine = ? and path = ?", [A, big])[0]?.at),
    skippedAt,
  );

  // Back on Wi-Fi (or a bigger cap): A's manifest revision did not change, yet the phone pulls the skipped file and drops its mark.
  max = Infinity;
  await meet(a, A);
  assert.ok(deps.holds(big));
  assert.equal(deps.db.all("select 1 from carry_skipped where machine = ? and path = ?", [A, big]).length, 0);
  await meet(b, B);
  assert.equal(sha(b.files.get(big)!), sha(bigContent));
  assert.ok(!deps.holds(big));

  // A skipped mark older than 30 days is pruned and no longer pulled even on Wi-Fi.
  max = 1024;
  a.publish(
    made(A, 3, {
      "000000000001.changes": "one",
      "000000000002.changes": "small",
      "000000000003.changes": bigContent,
      "000000000004.changes": "y".repeat(2048),
    }),
  );
  const stale = `machines/${A}/apps/${APP}/data/000000000004.changes`;
  await meet(a, A);
  assert.equal(deps.db.all("select 1 from carry_skipped where machine = ? and path = ?", [A, stale]).length, 1);
  clock.now += 31 * DAY;
  prune(deps, roster);
  assert.equal(deps.db.all("select 1 from carry_skipped where machine = ? and path = ?", [A, stale]).length, 0);
  max = Infinity;
  await meet(a, A);
  assert.ok(!deps.holds(stale));
});

test("carry retention counts trusted unsaved computers from roster.json and still drops after 30 days", async () => {
  const random = { fill: (bytes: Uint8Array) => bytes.set(randomBytes(bytes.byteLength)) };
  const makeKeys = () => ({
    host: remoteKeyText(generateKeyPair(random).publicKey),
    signing: generateSigningKey(random),
  });
  const [keysA, keysB, keysC, keysD] = [makeKeys(), makeKeys(), makeKeys(), makeKeys()];
  const D = "mch_01jx00000000000000000000dd";
  const DEV_A = "dev_01jx00000000000000000000aa";
  const DEV_B = "dev_01jx00000000000000000000bb";
  const DEV_C = "dev_01jx00000000000000000000cc";
  const DEV_D = "dev_01jx00000000000000000000dd";
  const entryOf = (
    id: string,
    machine: string,
    name: string,
    keys: ReturnType<typeof makeKeys>,
  ): RosterEntryBody => ({
    type: "entry",
    id,
    kind: "computer",
    key: keys.host,
    signing_key: remoteKeyText(keys.signing.publicKey),
    machine,
    name,
    os: "linux",
    rev: 1,
    invite: null,
  });
  const sign = (body: RosterEntryBody): RosterStatement => ({
    body,
    by: DEV_A,
    signature: signRoster(body, keysA.signing.secretKey),
  });
  const removalD: RosterStatement = {
    body: {
      type: "removal",
      id: DEV_D,
      key: keysD.host,
      signing_key: remoteKeyText(keysD.signing.publicKey),
      at: AT,
    },
    by: DEV_A,
    signature: signRoster(
      {
        type: "removal",
        id: DEV_D,
        key: keysD.host,
        signing_key: remoteKeyText(keysD.signing.publicKey),
        at: AT,
      },
      keysA.signing.secretKey,
    ),
  };
  const snapshot = {
    statements: [
      sign(entryOf(DEV_A, A, "alpha", keysA)),
      sign(entryOf(DEV_B, B, "beta", keysB)),
      sign(entryOf(DEV_C, C, "gamma", keysC)),
      sign(entryOf(DEV_D, D, "delta", keysD)),
      removalD,
    ],
    reach: [],
  };
  // Only A and B are saved on the phone; C is in roster.json without reach yet, and D was removed.
  const saved = [
    { machine: A as `mch_${string}`, signing_key: remoteKeyText(keysA.signing.publicKey) },
    { machine: B as `mch_${string}`, signing_key: remoteKeyText(keysB.signing.publicKey) },
  ];
  const roster = carryRosterMachines(saved, snapshot);
  assert.deepEqual(new Set(roster), new Set([A, B, C]));

  const clock = { now: 1_000 };
  const deps = phone(clock);
  const [a, b] = [computer(A), computer(B)];
  const meet = async (who: ReturnType<typeof computer>, machine: string) => {
    clock.now += 1_000;
    assert.deepEqual(await carryWith(deps, who.remote, machine, roster), { ok: true, value: undefined });
    prune(deps, roster);
  };

  a.publish(made(A, 1, { "000000000001.changes": "one" }));
  await meet(a, A);
  await meet(b, B);
  a.publish(made(A, 2, { "000000000001.changes": "one", "000000000002.changes": "two" }));
  const two = `machines/${A}/apps/${APP}/data/000000000002.changes`;
  await meet(a, A);
  await meet(b, B);
  assert.ok(b.files.has(two));
  // Both saved computers (A and B) have it, yet it stays for unsaved roster computer C.
  assert.ok(deps.holds(two));

  // Past the 30-day age cap, an unreachable unsaved computer does not hold the file forever.
  clock.now += 31 * DAY;
  prune(deps, roster);
  assert.ok(!deps.holds(two));
});

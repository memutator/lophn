import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { seededRandom } from "../../base/mod.ts";
import type { Id } from "../base/ids.ts";
import { generateKeyPair, remoteKeyText } from "./noise.ts";
import {
  generateSigningKey,
  type RosterEntryBody,
  type RosterStatement,
  rosterView,
  signRoster,
} from "./roster.ts";
import {
  appFilesPath,
  appFilesSchema,
  carryFile,
  eventFilePath,
  expectedFile,
  expectedFiles,
  machineRemoved,
  machineSigningKey,
  type ManifestBody,
  manifestPath,
  newerManifest,
  readEventFile,
  rosterFileSchema,
  signManifest,
  verifyManifest,
} from "./carry.ts";
import {
  dataEntryPath,
  packageFilePath,
  recordPath,
  sourcePath,
} from "../folder/layout.ts";
import { encodeRecord, sourceMetaSchema } from "../folder/records.ts";

const random = seededRandom(11);
const AT = "2026-11-18T00:00:00.000Z";
const NOW = Date.parse(AT);
const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"app">;
const COMMIT = "b".repeat(40);
const hex = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
const text = (value: string) => new TextEncoder().encode(value);

let serial = 0;
function computer() {
  serial += 1;
  const digits = String(serial).padStart(25, "0");
  return {
    id: `dev_1${digits}`,
    machine: `mch_0${digits}` as Id<"mch">,
    key: remoteKeyText(generateKeyPair(random).publicKey),
    signing: generateSigningKey(random),
  };
}
type Computer = ReturnType<typeof computer>;

function entry(c: Computer, machine = c.machine): RosterEntryBody {
  return {
    type: "entry",
    id: c.id,
    kind: "computer",
    key: c.key,
    signing_key: remoteKeyText(c.signing.publicKey),
    machine,
    name: "computer",
    os: "linux",
    rev: 1,
    invite: null,
  };
}

function signed(body: RosterStatement["body"], by: Computer): RosterStatement {
  return { body, by: by.id, signature: signRoster(body, by.signing.secretKey) };
}

// 받는 컴퓨터 A의 명단: B는 A가 들였고, C는 A가 들였다 뺐고(정해진 빼기), D는 명단에 없다(자기 서명뿐).
const a = computer();
const b = computer();
const c = computer();
const d = computer();
const statements = [
  signed(entry(a), a),
  signed(entry(b), a),
  signed(entry(c), a),
  signed(entry(d), d),
  signed(
    {
      type: "removal",
      id: c.id,
      key: c.key,
      signing_key: remoteKeyText(c.signing.publicKey),
      at: AT,
    },
    a,
  ),
];
const self = remoteKeyText(a.signing.publicKey);
const view = rosterView(statements, [self], self);
const signingKeyOf = (machine: Id<"mch">) => machineSigningKey(view, machine);

const bundle = text("git bundle bytes");
const changes = text("lophn-folder 2 changes ...");
const record = text("{}\n");
const listed = (path: string, bytes: Uint8Array) => ({
  path,
  size: bytes.byteLength,
  sha256: hex(bytes),
});
function sourceMetaJson(machine: Id<"mch">, bundleSha: string) {
  return encodeRecord(sourceMetaSchema, {
    format: 2,
    machine,
    app: APP,
    n: 1,
    heads: { main: "e".repeat(40) },
    prerequisites: [],
    size: bundle.byteLength,
    sha256: bundleSha,
    created_at: AT,
  });
}
const source = sourceMetaJson(b.machine, hex(bundle));
function appFilesJson(sourceBytes: Uint8Array) {
  return encodeRecord(appFilesSchema, {
    format: 1,
    machine: b.machine,
    app: APP,
    written_at: AT,
    files: [
      listed(sourcePath(b.machine, APP, 1, "json"), sourceBytes),
      listed(dataEntryPath(b.machine, APP, 1, "changes"), changes),
    ],
  });
}
const appFiles = appFilesJson(source);

function bodyOf(machine: Id<"mch">, revision = 10): ManifestBody {
  return {
    format: 1,
    machine,
    revision,
    written_at: AT,
    files: [
      listed(recordPath(machine), record),
      listed(appFilesPath(machine, APP), appFiles),
    ],
  };
}

test("명단에 하나뿐인 컴퓨터가 자기 이름으로 서명한 manifest만 믿는다", () => {
  assert.ok(signingKeyOf(b.machine) !== null);
  assert.equal(signingKeyOf(c.machine), null, "C는 빠졌다");
  assert.equal(signingKeyOf(d.machine), null, "D는 명단에 없다");

  const good = signManifest(bodyOf(b.machine), b.signing.secretKey);
  assert.deepEqual(verifyManifest(good, signingKeyOf)?.body, bodyOf(b.machine));

  const tampered = JSON.parse(good) as { body: ManifestBody };
  tampered.body.files[1]!.sha256 = "0".repeat(64);
  const cases: [string, string][] = [
    [
      "명단에 없는 컴퓨터",
      signManifest(bodyOf(d.machine), d.signing.secretKey),
    ],
    ["빠진 컴퓨터", signManifest(bodyOf(c.machine), c.signing.secretKey)],
    ["서명 뒤 고친 목록", JSON.stringify(tampered)],
    [
      "다른 기계 이름(믿는 기계)",
      signManifest(bodyOf(a.machine), b.signing.secretKey),
    ],
    [
      "다른 기계 이름(모르는 서명자)",
      signManifest(bodyOf(b.machine), d.signing.secretKey),
    ],
    ["깨진 글", good.slice(0, -10)],
  ];
  for (const [name, manifest] of cases) {
    assert.equal(verifyManifest(manifest, signingKeyOf), null, name);
  }

  // 믿는 B가 새 key E의 항목에 A의 기계 이름을 달아 서명했다. A의 이름으로는 아무 manifest도 믿지 않는다(어느 key가 A인지
  // 모른다). E가 A의 이름으로 낸 큰 revision이 A를 막지 못한다.
  const e = computer();
  const forged = rosterView(
    [...statements, signed(entry(e, a.machine), b)],
    [self],
    self,
  );
  const forgedKeyOf = (machine: Id<"mch">) =>
    machineSigningKey(forged, machine);
  assert.equal(
    forged.devices.filter((each) => each.body.machine === a.machine).length,
    2,
    "명단 규칙은 이 둘을 충돌로 보지 않는다",
  );
  assert.equal(forgedKeyOf(a.machine), null);
  const impostor = signManifest(
    { ...bodyOf(a.machine), revision: Number.MAX_SAFE_INTEGER },
    e.signing.secretKey,
  );
  assert.equal(verifyManifest(impostor, forgedKeyOf), null);
  assert.equal(machineRemoved(forged, a.machine), false, "지우지 않는다");
});

test("하위 폴더는 정해진 빼기로 빠진 컴퓨터의 것만 지운다", () => {
  assert.equal(machineRemoved(view, c.machine), true);
  assert.equal(machineRemoved(view, b.machine), false);
  assert.equal(machineRemoved(view, d.machine), false, "빼기가 없다");

  // C가 옛 key를 정해진 빼기로 잃은 뒤 같은 기계 이름의 새 key로 돌아왔고, 도둑 T와 새 key가 서로 뺐다(정해지지 않음).
  const fresh = computer();
  const thief = computer();
  const removal = (target: Computer): RosterStatement["body"] => ({
    type: "removal",
    id: target.id,
    key: target.key,
    signing_key: remoteKeyText(target.signing.publicKey),
    at: AT,
  });
  const disputed = rosterView(
    [
      ...statements,
      signed(entry(fresh, c.machine), a),
      signed(entry(thief), a),
      signed(removal(fresh), thief),
      signed(removal(thief), fresh),
    ],
    [self],
    self,
  );
  assert.equal(
    disputed.devices.some((each) => each.body.machine === c.machine),
    false,
    "새 key는 다툼으로 빠져 있다",
  );
  assert.ok(
    disputed.removed.some(
      (each) => !each.settled && each.entry?.machine === c.machine,
    ),
  );
  assert.equal(machineRemoved(disputed, c.machine), false);
});

test("표시보다 revision이 크지 않은 manifest는 받지 않는다", () => {
  assert.equal(newerManifest(10, bodyOf(b.machine, 10)), false);
  assert.equal(newerManifest(10, bodyOf(b.machine, 9)), false);
  assert.equal(newerManifest(10, bodyOf(b.machine, 11)), true);
  assert.equal(newerManifest(null, bodyOf(b.machine, 1)), true);
});

test("manifest에서 시작한 목록 file 사슬이 맞을 때만 path에 기대값이 있다", () => {
  const body = bodyOf(b.machine);
  const held = new Map<string, Uint8Array>([
    [appFilesPath(b.machine, APP), appFiles],
    [sourcePath(b.machine, APP, 1, "json"), source],
  ]);
  const heldBytes = (path: string) => held.get(path) ?? null;
  const bundlePath = sourcePath(b.machine, APP, 1, "bundle");
  const dataPath = dataEntryPath(b.machine, APP, 1, "changes");

  const expected = (path: string) => expectedFile(body, path, heldBytes);
  assert.deepEqual(expected(dataPath), {
    size: changes.byteLength,
    sha256: hex(changes),
  });
  assert.deepEqual(expected(bundlePath), {
    size: bundle.byteLength,
    sha256: hex(bundle),
  });
  assert.deepEqual(
    [...expectedFiles(body, heldBytes).keys()].sort(),
    [
      recordPath(b.machine),
      appFilesPath(b.machine, APP),
      sourcePath(b.machine, APP, 1, "json"),
      dataPath,
      bundlePath,
    ].sort(),
  );

  const none = [
    dataEntryPath(b.machine, APP, 2, "changes"),
    dataEntryPath(a.machine, APP, 1, "changes"),
    `machines/${b.machine}/apps/${APP}/releases/${"b".repeat(64)}/release.json`,
    `machines/${b.machine}/apps/${APP}/releases/${"b".repeat(64)}/files/app/main.js`,
    manifestPath(b.machine),
  ];
  for (const path of none) assert.equal(expected(path), null, path);

  // 받는 쪽이 든 목록 file이 사슬과 다르면(바꿔친 source json, 바꿔친 앱 목록) 그 아래 file을 기대하지 않는다.
  held.set(
    sourcePath(b.machine, APP, 1, "json"),
    sourceMetaJson(b.machine, hex(text("swapped"))),
  );
  assert.equal(expected(bundlePath), null);
  assert.equal(expectedFiles(body, heldBytes).has(bundlePath), false);
  held.set(sourcePath(b.machine, APP, 1, "json"), source);
  held.set(appFilesPath(b.machine, APP), appFilesJson(text("other")));
  for (const path of [dataPath, bundlePath]) {
    assert.equal(expected(path), null, path);
  }
  held.delete(appFilesPath(b.machine, APP));
  assert.equal(expected(dataPath), null);
});

test("manifest 글은 carry/file로 그 기계의 path에서만 읽는다", () => {
  const read = (machine: Id<"mch">, path: string) =>
    carryFile.input.safeParse({ machine, path, offset: 0, length: 1 }).success;
  assert.equal(read(b.machine, manifestPath(b.machine)), true);
  assert.equal(read(b.machine, manifestPath(a.machine)), false);
  assert.equal(read(b.machine, "manifest.json"), false);
});

test("폴더의 명단 file은 주소를 싣지 않는다", () => {
  const parsed = rosterFileSchema.parse({
    format: 1,
    machine: b.machine,
    written_at: AT,
    statements: statements.slice(0, 2),
    reach: [{ device: b.id, addresses: ["203.0.113.9"], port: 1, relay: null }],
  });
  assert.equal("reach" in parsed, false);
});

test("event file은 path의 기계·앱·id와 같고 때가 범위 안일 때만 낸다", () => {
  const id = "01hzzzzzzzzzzzzzzzzzzzzzzz";
  const path = eventFilePath(b.machine, APP, id);
  const file = (over: Record<string, unknown>) =>
    text(
      JSON.stringify({
        format: 2,
        machine: b.machine,
        app: APP,
        id,
        code_commit: COMMIT,
        name: "note.added",
        payload: {},
        at: AT,
        ...over,
      }),
    );
  assert.ok(readEventFile(path, file({}), NOW) !== null);
  const refused: [string, Uint8Array, number][] = [
    ["다른 기계라 함", file({ machine: a.machine }), NOW],
    ["다른 앱이라 함", file({ app: "app_01hyyyyyyyyyyyyyyyyyyyyyyy" }), NOW],
    ["다른 id라 함", file({ id: "01hyyyyyyyyyyyyyyyyyyyyyyy" }), NOW],
    ["5분 넘게 앞선 때", file({ at: "2026-11-18T00:05:00.001Z" }), NOW],
    ["7일보다 옛 것", file({}), NOW + 7 * 86_400_000 + 1],
  ];
  for (const [name, bytes, now] of refused) {
    assert.equal(readEventFile(path, bytes, now), null, name);
  }
});

test("manifest의 선택 칸 packages가 @me/* package file을 서명 사슬에 싣고 다른 기계·files 오용을 막는다", () => {
  const pkgPath = packageFilePath(b.machine, "@me/shared", "1.0.0");
  const pkgBytes = text('{"name":"@me/shared"}\n');
  const body: ManifestBody = {
    ...bodyOf(b.machine),
    packages: [listed(pkgPath, pkgBytes)],
  };
  const signedText = signManifest(body, b.signing.secretKey);
  const verified = verifyManifest(signedText, signingKeyOf);
  assert.deepEqual(verified?.body, body);
  assert.deepEqual(
    expectedFile(body, pkgPath, () => null),
    { size: pkgBytes.byteLength, sha256: hex(pkgBytes) },
  );
  assert.equal(expectedFiles(body, () => null).has(pkgPath), true);
  assert.equal(
    carryFile.input.safeParse({
      machine: b.machine,
      path: pkgPath,
      offset: 0,
      length: 1,
    }).success,
    true,
  );
  // packages 항목을 변조하면 서명이 깨진다.
  const tampered = JSON.parse(signedText) as { body: ManifestBody };
  tampered.body.packages![0]!.sha256 = "0".repeat(64);
  assert.equal(verifyManifest(JSON.stringify(tampered), signingKeyOf), null);
  // package path는 옛 판 호환을 위해 files에 넣지 못한다.
  assert.throws(() =>
    signManifest(
      {
        ...bodyOf(b.machine),
        files: [...bodyOf(b.machine).files, listed(pkgPath, pkgBytes)],
      },
      b.signing.secretKey,
    ),
  );
  // 다른 기계의 package path는 실을 수 없다.
  assert.throws(() =>
    signManifest(
      {
        ...bodyOf(b.machine),
        packages: [
          listed(packageFilePath(a.machine, "@me/shared", "1.0.0"), pkgBytes),
        ],
      },
      b.signing.secretKey,
    ),
  );
});

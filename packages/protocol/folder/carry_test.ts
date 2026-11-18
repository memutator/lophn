import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { seededRandom } from "../../base/mod.ts";
import type { Id } from "../base/ids.ts";
import { generateKeyPair, remoteKeyText } from "../remote/noise.ts";
import {
  generateSigningKey,
  type RosterEntryBody,
  type RosterStatement,
  rosterView,
  signRoster,
} from "../remote/roster.ts";
import {
  expectedFile,
  expectedFiles,
  type ManifestBody,
  newerManifest,
  signManifest,
  verifyManifest,
} from "./carry.ts";
import {
  dataEntryPath,
  recordPath,
  releaseFilePath,
  releaseRecordPath,
  sourcePath,
} from "./layout.ts";
import {
  encodeRecord,
  releaseRecordSchema,
  sourceMetaSchema,
} from "./records.ts";

const random = seededRandom(11);
const AT = "2026-11-18T00:00:00.000Z";
const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"app">;
const HASH = "b".repeat(64);
const hex = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
const text = (value: string) => new TextEncoder().encode(value);

let serial = 0;
function computer() {
  serial += 1;
  const digits = String(serial).padStart(25, "0");
  return {
    id: `dev_0${digits}`,
    machine: `mch_0${digits}` as Id<"mch">,
    key: remoteKeyText(generateKeyPair(random).publicKey),
    signing: generateSigningKey(random),
  };
}
type Computer = ReturnType<typeof computer>;

function entry(c: Computer): RosterEntryBody {
  return {
    type: "entry",
    id: c.id,
    kind: "computer",
    key: c.key,
    signing_key: remoteKeyText(c.signing.publicKey),
    machine: c.machine,
    name: "computer",
    os: "linux",
    terminal_input: true,
    rev: 1,
    invite: null,
  };
}

function signed(body: RosterStatement["body"], by: Computer): RosterStatement {
  return { body, by: by.id, signature: signRoster(body, by.signing.secretKey) };
}

// 받는 컴퓨터 A의 명단: B는 A가 들였고, C는 A가 들였다 뺐고, D는 명단에 없다(자기 서명뿐).
const a = computer();
const b = computer();
const c = computer();
const d = computer();
const view = rosterView(
  [
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
  ],
  [remoteKeyText(a.signing.publicKey)],
  remoteKeyText(a.signing.publicKey),
);
// core의 `computerSigningKey`와 같은 규칙: 명단 view의 컴퓨터 항목.
const signingKeyOf = (machine: Id<"mch">) =>
  view.devices.find(
    (each) => each.body.kind === "computer" && each.body.machine === machine,
  )?.body.signing_key ?? null;

const appFile = text("console.log('app');\n");
const bundle = text("git bundle bytes");
const changes = text("lophn-folder 1 changes ...");
function releaseJson(machine: Id<"mch">, fileSha: string) {
  return encodeRecord(releaseRecordSchema, {
    format: 1,
    machine,
    app: APP,
    bundle_hash: HASH,
    code_commit: "c".repeat(40),
    declaration_hash: "d".repeat(64),
    data_schema: 1,
    data_changes: [],
    created_at: AT,
    files: [{ path: "app/main.js", size: appFile.byteLength, sha256: fileSha }],
  });
}
const release = releaseJson(b.machine, hex(appFile));
const source = encodeRecord(sourceMetaSchema, {
  format: 1,
  machine: b.machine,
  app: APP,
  n: 1,
  heads: { main: "e".repeat(40) },
  prerequisites: [],
  size: bundle.byteLength,
  sha256: hex(bundle),
  created_at: AT,
});
const record = text("{}\n");

function bodyOf(machine: Id<"mch">, revision = 10): ManifestBody {
  const listed = (path: string, bytes: Uint8Array) => ({
    path,
    size: bytes.byteLength,
    sha256: hex(bytes),
  });
  return {
    format: 1,
    machine,
    revision,
    written_at: AT,
    files: [
      listed(recordPath(machine), record),
      listed(releaseRecordPath(machine, APP, HASH), release),
      listed(sourcePath(machine, APP, 1, "json"), source),
      listed(dataEntryPath(machine, APP, 1, "changes"), changes),
    ],
  };
}

test("명단의 컴퓨터가 자기 이름으로 서명한 manifest만 믿는다", () => {
  assert.ok(signingKeyOf(b.machine) !== null);
  assert.equal(signingKeyOf(c.machine), null, "C는 빠졌다");
  assert.equal(signingKeyOf(d.machine), null, "D는 명단에 없다");

  const good = signManifest(bodyOf(b.machine), b.signing.secretKey);
  assert.deepEqual(verifyManifest(good, signingKeyOf), bodyOf(b.machine));

  const tampered = JSON.parse(good) as { body: ManifestBody };
  tampered.body.files[3]!.sha256 = "0".repeat(64);
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
});

test("든 것보다 revision이 크지 않은 manifest는 받지 않는다", () => {
  const held = bodyOf(b.machine, 10);
  assert.equal(newerManifest(held, bodyOf(b.machine, 10)), false);
  assert.equal(newerManifest(held, bodyOf(b.machine, 9)), false);
  assert.equal(newerManifest(held, bodyOf(b.machine, 11)), true);
  assert.equal(newerManifest(null, bodyOf(b.machine, 1)), true);
});

test("manifest가 싣거나 맞는 목록 file이 덮는 path만 기대값이 있다", () => {
  const body = bodyOf(b.machine);
  const held = new Map<string, Uint8Array>([
    [releaseRecordPath(b.machine, APP, HASH), release],
    [sourcePath(b.machine, APP, 1, "json"), source],
  ]);
  const heldBytes = (path: string) => held.get(path) ?? null;
  const releaseFile = releaseFilePath(b.machine, APP, HASH, "app/main.js");
  const bundlePath = sourcePath(b.machine, APP, 1, "bundle");

  const expected = (path: string) => expectedFile(body, path, heldBytes);
  assert.deepEqual(expected(dataEntryPath(b.machine, APP, 1, "changes")), {
    size: changes.byteLength,
    sha256: hex(changes),
  });
  assert.deepEqual(expected(releaseFile), {
    size: appFile.byteLength,
    sha256: hex(appFile),
  });
  assert.deepEqual(expected(bundlePath), {
    size: bundle.byteLength,
    sha256: hex(bundle),
  });
  // 받은 bytes가 다르면 기대값과 어긋난다.
  assert.notEqual(expected(releaseFile)!.sha256, hex(text("swapped")));

  const none = [
    dataEntryPath(b.machine, APP, 2, "changes"),
    dataEntryPath(a.machine, APP, 1, "changes"),
    releaseFilePath(b.machine, APP, HASH, "app/other.js"),
    releaseFilePath(b.machine, APP, "f".repeat(64), "app/main.js"),
    `machines/${b.machine}/apps/${APP}/releases/${HASH}/files/../release.json`,
    `machines/${b.machine}/manifest.json`,
  ];
  for (const path of none) assert.equal(expected(path), null, path);

  // 받는 쪽이 든 목록 file이 manifest와 다르면(바꿔친 release.json) 덮는 file을 기대하지 않는다.
  const swapped = releaseJson(b.machine, hex(text("swapped")));
  held.set(releaseRecordPath(b.machine, APP, HASH), swapped);
  assert.equal(expected(releaseFile), null);
  assert.equal(expectedFiles(body, heldBytes).has(releaseFile), false);
  held.delete(releaseRecordPath(b.machine, APP, HASH));
  assert.equal(expected(releaseFile), null);
});

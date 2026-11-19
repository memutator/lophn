import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256Hex } from "../../base/mod.ts";
import type { Id } from "../base/ids.ts";
import {
  appRecordSchema,
  changesOf,
  dataEntryPath,
  decodeContainer,
  decodeRecord,
  encodeChanges,
  machineRecordSchema,
} from "./mod.ts";

const MACHINE = "mch_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"mch">;
const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"app">;
const AT = "2026-11-16T00:00:00.000Z";
const RELEASE = { code_commit: "a".repeat(40), data_schema: 3 };
const PATH = dataEntryPath(MACHINE, APP, 1, "changes");
const text = (value: string) => new TextEncoder().encode(value);

const changes = [
  { id: "7", hlc: "123456789012345", bytes: Uint8Array.from([1, 2, 3, 4, 5]) },
  { id: "8", hlc: "123456789012999", bytes: Uint8Array.from([9, 8, 7]) },
  { id: "9", hlc: "123456789013000", bytes: Uint8Array.from([0xff]) },
].map(({ id, hlc, bytes }) => ({
  meta: {
    id,
    hlc,
    origin: "computer" as const,
    operation: "notes.add",
    started_at: AT,
  },
  bytes,
}));

async function goodFile(): Promise<Uint8Array> {
  const file = await encodeChanges({
    machine: MACHINE,
    app: APP,
    n: 1,
    release: RELEASE,
    created_at: AT,
    changes,
  });
  assert.ok(file.ok);
  return file.value;
}

// header를 손으로 짓는다: encode가 버리는 모르는 칸과 다른 판을 싣는다.
async function forge(
  header: Record<string, unknown>,
  payload: Uint8Array,
  version = "2",
): Promise<Uint8Array> {
  const line2 = text(`${JSON.stringify(header)}\n`);
  const line1 = text(
    `lophn-folder ${version} ${String(header.kind)} ${await sha256Hex(line2)}\n`,
  );
  return Uint8Array.from([...line1, ...line2, ...payload]);
}

async function forgedHeader(extra: Record<string, unknown> = {}) {
  const payload = Uint8Array.from(changes.flatMap(({ bytes }) => [...bytes]));
  let offset = 0;
  return {
    payload,
    header: {
      machine: MACHINE,
      app: APP,
      n: 1,
      kind: "changes",
      release: RELEASE,
      created_at: AT,
      payload: { size: payload.byteLength, sha256: await sha256Hex(payload) },
      changes: changes.map(({ meta, bytes }) => {
        const entry = { ...meta, offset, size: bytes.byteLength };
        offset += bytes.byteLength;
        return entry;
      }),
      ...extra,
    },
  };
}

async function refused(bytes: Uint8Array, path = PATH) {
  const decoded = await decodeContainer(bytes, path);
  assert.ok(!decoded.ok, "a broken file must not decode");
  assert.ok(
    decoded.error.code === "invalid_file" ||
      decoded.error.code === "newer_format",
    decoded.error.code,
  );
  return decoded.error.code;
}

// 바깥 도구가 반만 옮긴 file이나 고친 file에서 변경을 하나라도 적용하면 앱 data가 갈라진다.
test("깨지거나 반만 쓰인 변경 file은 아무것도 내놓지 않고, 맞는 file은 넣은 변경을 bytes 그대로 돌려준다", async () => {
  const file = await goodFile();
  const decoded = await decodeContainer(file, PATH);
  assert.ok(decoded.ok);
  assert.deepStrictEqual(
    changesOf(decoded.value.header, decoded.value.payload),
    changes,
  );

  for (
    let length = file.byteLength - 1;
    length >= file.byteLength / 2;
    length--
  ) {
    await refused(file.slice(0, length));
  }
  const flipped = file.slice();
  flipped[flipped.byteLength - 2]! ^= 0x01;
  await refused(flipped);
  const headerDigit = file.slice();
  const digitAt = new TextDecoder().decode(file).indexOf('"data_schema":3');
  assert.ok(digitAt > 0);
  headerDigit[digitAt + '"data_schema":'.length] = "4".charCodeAt(0);
  await refused(headerDigit);
  await refused(Uint8Array.from([...file, 0]));

  const { header, payload } = await forgedHeader();
  assert.equal(
    await refused(await forge(header, payload, "3")),
    "newer_format",
  );
  // header가 제 hash와 맞아도 path의 번호와 다르면 맞는 file이 아니다.
  assert.equal(
    await refused(await forge({ ...header, n: 2 }, payload)),
    "invalid_file",
  );
  await refused(file, dataEntryPath(MACHINE, APP, 1, "snapshot"));
});

// 칸을 더한 새 판 기계의 file을 옛 판이 버리면 기계 사이 교환이 판마다 끊긴다. 꼴 판이 오르면 읽지 않는다.
test("모르는 칸이 더해진 header와 기록은 읽히고, 판이나 format이 범위 밖이면 newer_format이다", async () => {
  const { header, payload } = await forgedHeader({ compression: null });
  const decoded = await decodeContainer(
    await forge(
      {
        ...header,
        release: { ...RELEASE, sealed_by: "x" },
        changes: header.changes.map((each) => ({ ...each, author: "me" })),
      },
      payload,
    ),
    PATH,
  );
  assert.ok(decoded.ok);
  assert.deepStrictEqual(
    changesOf(decoded.value.header, decoded.value.payload),
    changes,
  );

  const appRecord = {
    format: 2,
    machine: MACHINE,
    app: APP,
    revision: 4,
    updated_at: AT,
    slug: "notes",
    name: "Notes",
    description: "",
    sync_to: "personal",
    active_release: {
      code_commit: "b".repeat(40),
      data_schema: 3,
      created_at: AT,
    },
    data: { head: 12, snapshot: 10 },
    source: { head: 2 },
    read: { [MACHINE]: { n: 4, at: AT } },
    settled: "123",
    horizon: null,
  };
  const read = decodeRecord(
    appRecordSchema,
    text(
      JSON.stringify({
        ...appRecord,
        pinned: true,
        data: { ...appRecord.data, rows: 9 },
      }),
    ),
  );
  assert.deepStrictEqual(read, { ok: true, value: appRecord });
  const machineRecord = decodeRecord(
    machineRecordSchema,
    text(
      JSON.stringify({
        format: 2,
        machine: MACHINE,
        revision: 1,
        updated_at: AT,
        name: "desk",
        always_on: null,
        addresses: { lan: [], port: null, relay: null, tailnet: [] },
        lophn: {
          version: "0.23.0",
          protocol: { version: 2, min_version: 2 },
          folder: { version: 2, min_version: 2 },
        },
        battery: "full",
      }),
    ),
  );
  assert.ok(machineRecord.ok);

  const newer = decodeRecord(
    appRecordSchema,
    text(JSON.stringify({ ...appRecord, format: 3, slug: 7 })),
  );
  assert.ok(!newer.ok);
  assert.equal(newer.error.code, "newer_format");
});

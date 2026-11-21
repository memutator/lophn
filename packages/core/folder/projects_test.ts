import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { Id } from "../../protocol/base/ids.ts";
import {
  encodeRecord,
  FOLDER_FORMAT,
  type MachineRecord,
  machineRecordSchema,
  RECORD_MAX_BYTES,
  recordPath,
} from "../../protocol/folder/mod.ts";
import { fitRecord } from "./export/record.ts";
import { peerProjects } from "./import/peer-projects.ts";

const ME = "mch_00000000000000000000000001" as Id<"mch">;
const A = "mch_0000000000000000000000000a" as Id<"mch">;
const B = "mch_0000000000000000000000000b" as Id<"mch">;
const C = "mch_0000000000000000000000000c" as Id<"mch">;

function record(machine: Id<"mch">, key: string): MachineRecord {
  return machineRecordSchema.parse({
    format: FOLDER_FORMAT.version,
    machine,
    revision: 1,
    updated_at: "2026-11-21T00:00:00.000Z",
    name: "pc",
    always_on: null,
    addresses: { lan: [], port: null, relay: null },
    lophn: {
      version: "0.23.0",
      protocol: { version: 5, min_version: 5 },
      folder: FOLDER_FORMAT,
    },
    projects: [
      {
        identity: "pri_00000000000000000000000001",
        remote_key: key,
        separated: false,
      },
    ],
  });
}

function put(root: string, dir: Id<"mch">, value: MachineRecord) {
  const path = join(root, recordPath(dir));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, encodeRecord(machineRecordSchema, value));
}

test("다른 기계의 git project 목록은 `computers` 폴더에서 서명 key를 믿는 기계의 자기 기록에서만 읽는다", () => {
  const computers = mkdtempSync(join(tmpdir(), "lophn-peer-projects-"));
  const named = mkdtempSync(join(tmpdir(), "lophn-named-folder-"));
  try {
    put(computers, A, record(A, "github.com/me/a"));
    // 믿지 않는 기계, 다른 기계 이름을 단 기록, 이 기계 자신은 쓰지 않는다.
    put(computers, B, record(B, "github.com/me/b"));
    put(computers, C, record(A, "github.com/me/forged"));
    put(computers, ME, record(ME, "github.com/me/me"));
    // 이름 붙인 폴더에는 서명이 없다. revision이 커도 읽지 않는다.
    put(named, A, { ...record(A, "github.com/me/forged"), revision: 999 });
    const read = peerProjects(computers, ME, (machine) => machine !== B);
    assert.deepEqual(read, [
      { machine: A, projects: record(A, "github.com/me/a").projects },
    ]);
  } finally {
    rmSync(computers, { recursive: true, force: true });
    rmSync(named, { recursive: true, force: true });
  }
});

test("목록이 길어 기계 기록이 상한을 넘으면 project 줄을 덜어 상한 안에 들고 다른 칸은 그대로다", () => {
  // 한 글자가 3 byte인 하위 폴더 이름: 글자 수 상한(256) 안이지만 줄 512개는 기록 상한을 넘는다.
  const key = `github.com/me/repo#${"가".repeat(230)}`;
  const big = {
    ...record(A, key),
    projects: Array.from({ length: 512 }, (_, n) => ({
      identity: `pri_${String(n).padStart(26, "0")}`,
      remote_key: key,
      separated: false,
    })),
  };
  assert.ok(
    encodeRecord(machineRecordSchema, big).byteLength > RECORD_MAX_BYTES,
  );
  const fitted = fitRecord(big);
  const size = encodeRecord(machineRecordSchema, fitted).byteLength;
  assert.ok(size <= RECORD_MAX_BYTES);
  assert.ok(fitted.projects.length > 0 && fitted.projects.length < 512);
  // 한 줄을 더하면 넘는다: 덜어 낸 것이 꼭 필요한 만큼이다.
  assert.ok(
    encodeRecord(machineRecordSchema, {
      ...big,
      projects: big.projects.slice(0, fitted.projects.length + 1),
    }).byteLength > RECORD_MAX_BYTES,
  );
  assert.deepEqual({ ...fitted, projects: [] }, { ...big, projects: [] });
  const small = record(A, "github.com/me/a");
  assert.equal(fitRecord(small), small);
});

import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createIdSource, manualClock, seededRandom } from "../../base/mod.ts";
import { ensureMachine, readMachineId, readOsMachineId } from "./mod.ts";

const base = await mkdtemp(join(tmpdir(), "lophn-machine-"));
after(() => rm(base, { recursive: true, force: true }));

const clock = manualClock(Date.parse("2026-11-16T00:00:00.000Z"));
const ids = createIdSource({ clock, random: seededRandom(7) });

async function folder(name: string): Promise<string> {
  const path = join(base, name);
  await mkdir(path, { recursive: true });
  return path;
}

function boot(root: string, osValue: string | null) {
  return ensureMachine({
    root,
    osMachineId: async () => osValue,
    hostname: () => "studio.local",
    ids,
    clock,
  });
}

test("OS 값이 같으면 옮긴 machine.json이 같은 id를 지키고, OS 값이 다르면 새 id와 cloned_from이 생기고 이름이 hostname으로 돌아간다", async () => {
  const origin = await folder("origin");
  const first = await boot(origin, "a".repeat(32));
  assert.ok(first.ok);
  const renamed = await first.value.rename("  Desk  ");
  assert.ok(renamed.ok);
  assert.equal(renamed.value.name, "Desk");
  assert.equal(renamed.value.name_source, "person");

  const moved = await folder("moved");
  await copyFile(join(origin, "machine.json"), join(moved, "machine.json"));
  const same = await boot(moved, "a".repeat(32));
  assert.ok(same.ok);
  assert.equal(same.value.id, first.value.id);
  assert.equal(same.value.status().name, "Desk");

  const copied = await folder("copied");
  await copyFile(join(origin, "machine.json"), join(copied, "machine.json"));
  const clone = await boot(copied, "b".repeat(32));
  assert.ok(clone.ok);
  assert.notEqual(clone.value.id, first.value.id);
  assert.deepEqual(clone.value.status(), {
    id: clone.value.id,
    name: "studio",
    name_source: "hostname",
    hostname: "studio.local",
    cloned_from: first.value.id,
    cloned_at: clock.now(),
  });
  const again = await boot(copied, "b".repeat(32));
  assert.ok(again.ok);
  assert.equal(again.value.id, clone.value.id);
  const read = await readMachineId(copied);
  assert.ok(read.ok);
  assert.equal(read.value, clone.value.id);
});

test("OS 값을 읽지 못하면 id와 binding을 그대로 두고, 깨진 machine.json은 덮지 않고 거절한다", async () => {
  const root = await folder("unknown-os");
  const first = await boot(root, "c".repeat(32));
  assert.ok(first.ok);
  const before = await readFile(join(root, "machine.json"), "utf8");
  const blind = await boot(root, null);
  assert.ok(blind.ok);
  assert.equal(blind.value.id, first.value.id);
  assert.equal(await readFile(join(root, "machine.json"), "utf8"), before);

  const broken = await folder("broken");
  await writeFile(join(broken, "machine.json"), '{"id": "mch_');
  const refused = await boot(broken, "c".repeat(32));
  assert.equal(refused.ok ? "ok" : refused.error.code, "unavailable");
  assert.equal(
    await readFile(join(broken, "machine.json"), "utf8"),
    '{"id": "mch_',
  );
  const read = await readMachineId(broken);
  assert.equal(read.ok ? "ok" : read.error.code, "unavailable");
});

// macOS와 Windows는 이 기계에서 돌려 보지 못해 출력 견본으로 parse만 본다.
// parse가 틀리면 복제 판정이 조용히 꺼지거나(null) 기동마다 새 기계가 된다.
test("OS 기계 값을 세 OS의 출력에서 읽고 틀린 꼴은 null로 본다", async () => {
  const uuid = "4C4C4544-0042-3510-8048-B3C04F4E3132";
  const cases: [
    NodeJS.Platform,
    Record<string, string>,
    string,
    string | null,
  ][] = [
    [
      "linux",
      { "/etc/machine-id": "0123456789abcdef0123456789abcdef\n" },
      "",
      "0123456789abcdef0123456789abcdef",
    ],
    [
      "linux",
      {
        "/etc/machine-id": "uninitialized\n",
        "/var/lib/dbus/machine-id": "fedcba9876543210fedcba9876543210\n",
      },
      "",
      "fedcba9876543210fedcba9876543210",
    ],
    ["linux", {}, "", null],
    [
      "darwin",
      {},
      `+-o J316sAP  <class IOPlatformExpertDevice, id 0x100000117, registered, matched, active, busy 0 (0 ms), retain 30>\n    {\n      "IOPlatformSerialNumber" = "C02XXXXX"\n      "IOPlatformUUID" = "${uuid}"\n    }\n`,
      uuid.toLowerCase(),
    ],
    [
      "win32",
      {},
      `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    ${uuid.toLowerCase()}\r\n\r\n`,
      uuid.toLowerCase(),
    ],
    [
      "win32",
      {},
      "ERROR: The system was unable to find the specified registry key or value.",
      null,
    ],
  ];
  for (const [platform, files, out, expected] of cases) {
    const value = await readOsMachineId(platform, {
      readFile: async (path) => {
        const text = files[path];
        if (text === undefined) throw new Error("ENOENT");
        return text;
      },
      exec: async () => out,
    });
    assert.equal(value, expected, platform);
  }
});

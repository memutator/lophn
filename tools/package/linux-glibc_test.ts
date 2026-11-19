import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  compareGlibcVersion,
  exceedingGlibcVersions,
  isElfFile,
  parseGlibcVersions,
  verifyLinuxNativeModules,
} from "./linux-glibc.ts";

const SAMPLE = `
Version symbols section '.gnu.version' contains 42 entries:
 Addr: 0x0000000000001234  Offset: 0x001234  Link: 3 (.dynsym)
  000:   0 (*local*)       2 (GLIBC_2.2.5)   3 (GLIBC_2.34)

Version definition section '.gnu.version_d' contains 1 entry:
  000000: Rev: 1  Flags: BASE  Index: 1  Cnt: 1  Name: GLIBC_2.99

Version needs section '.gnu.version_r' contains 2 entries:
 Addr: 0x0000000000002000  Offset: 0x002000  Link: 4 (.dynstr)
  000000: Version: 1  File: libc.so.6  Cnt: 6
  0x0010:   Name: GLIBC_2.2.5  Flags: none  Version: 2
  0x0020:   Name: GLIBC_2.9  Flags: none  Version: 3
  0x0030:   Name: GLIBC_2.17  Flags: none  Version: 4
  0x0040:   Name: GLIBC_2.34  Flags: none  Version: 5
  0x0050:   Name: GLIBC_2.42  Flags: none  Version: 6
  0x0060:   Name: GLIBC_PRIVATE  Flags: none  Version: 7
  0x0070: Version: 1  File: libstdc++.so.6  Cnt: 1
  0x0080:   Name: GLIBCXX_3.4.22  Flags: none  Version: 8
`;

test("readelf -V parser extracts only .gnu.version_r numeric GLIBC versions and flags versions above 2.35", () => {
  assert.equal(compareGlibcVersion("2.9", "2.17") < 0, true);
  assert.equal(compareGlibcVersion("2.2.5", "2.17") < 0, true);
  assert.equal(compareGlibcVersion("2.35", "2.35"), 0);
  assert.equal(compareGlibcVersion("2.42", "2.35") > 0, true);

  assert.deepEqual(parseGlibcVersions(SAMPLE), [
    "2.2.5",
    "2.9",
    "2.17",
    "2.34",
    "2.42",
  ]);
  assert.deepEqual(exceedingGlibcVersions(SAMPLE), ["2.42"]);
  assert.deepEqual(exceedingGlibcVersions(SAMPLE, "2.42"), []);
  assert.deepEqual(exceedingGlibcVersions(SAMPLE, "2.17"), ["2.34", "2.42"]);
});

test("verifyLinuxNativeModules skips non-ELF prebuild .node files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lophn-glibc-test-"));
  try {
    const macho = join(dir, "darwin.node");
    const elf = join(dir, "linux.elf");
    await writeFile(macho, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x00]));
    await writeFile(elf, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02]));
    assert.equal(await isElfFile(macho), false);
    assert.equal(await isElfFile(elf), true);
    await verifyLinuxNativeModules(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

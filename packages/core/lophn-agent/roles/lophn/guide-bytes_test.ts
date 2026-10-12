import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { sha256Hex } from "@lophn/base";
import { GUIDE_SOURCES } from "./guides/catalog.ts";
import { decodeGuideUtf8 } from "./model.ts";
import { guideBytesFromFiles, loadProductGuides } from "./work.ts";

const PRODUCT_VERSION = "test-fixture";
const GUIDE_DIR = new URL("./guides/", import.meta.url);

async function filesFromSources(): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  for (const source of GUIDE_SOURCES) {
    files[source.path] = await Deno.readFile(
      new URL(source.path.split("/").at(-1)!, GUIDE_DIR),
    );
  }
  return files;
}

function withPrefix(prefix: Uint8Array, bytes: Uint8Array): Uint8Array {
  const combined = new Uint8Array(prefix.length + bytes.length);
  combined.set(prefix);
  combined.set(bytes, prefix.length);
  return combined;
}

function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

Deno.test("lophn-agent/roles/lophn#R17 malformed UTF-8 is rejected without normalizing bytes", async () => {
  const files = await filesFromSources();
  const path = GUIDE_SOURCES[0].path;
  files[path] = new Uint8Array([0xff, 0xfe, 0x41]);
  await assertRejects(
    () => loadProductGuides(PRODUCT_VERSION, guideBytesFromFiles(files)),
    Error,
    "not UTF-8",
  );
  assertEquals(Array.from(files[path]), [0xff, 0xfe, 0x41]);
  assertThrows(() => decodeGuideUtf8(path, files[path]), Error, "not UTF-8");
});

Deno.test("lophn-agent/roles/lophn#R17 decode keeps BOM CRLF and Unicode form bytes exact", () => {
  const path = GUIDE_SOURCES[0].path;
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const cases = [
    withPrefix(bom, textBytes("# Features and screens\n")),
    textBytes("# Features and screens\r\n## Find an existing answer first\r\n"),
    textBytes("café"),
    textBytes("café"),
    textBytes("안"),
  ];
  for (const bytes of cases) {
    const text = decodeGuideUtf8(path, bytes);
    assertEquals(Array.from(new TextEncoder().encode(text)), Array.from(bytes));
    if (bytes[0] === 0xef) assert(text.startsWith("﻿"));
  }
});

Deno.test("lophn-agent/roles/lophn#R17 a deferred loader mutation does not change the hash", async () => {
  const files = await filesFromSources();
  const firstPath = GUIDE_SOURCES[0].path;
  const shared = new Uint8Array(files[firstPath]);
  const before = Array.from(shared);
  let handed = false;
  const product = loadProductGuides(PRODUCT_VERSION, (requested) => {
    if (requested !== firstPath) return Promise.resolve(files[requested]);
    handed = true;
    return Promise.resolve(shared);
  });
  await Promise.resolve();
  assert(handed);
  shared[0] = shared[0] ^ 0xff;
  const loaded = await product;
  const guide = loaded.guides[0];
  assertEquals(guide.content_hash, await sha256Hex(new Uint8Array(before)));
  assertEquals(Array.from(loaded.files[0].bytes), before);
  assert(loaded.files[0].bytes[0] !== shared[0]);
});

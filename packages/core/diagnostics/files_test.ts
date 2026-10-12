import { assert, assertEquals, assertRejects } from "@std/assert";
import { createLogFiles, LOG_FILE_COUNT, LOG_FILE_MAX_BYTES } from "./mod.ts";

Deno.test("platform/diagnostics#R12 oldest-first five 10MiB logs leave ledger untouched", async () => {
  const root = await Deno.makeTempDir({ prefix: "io-log-" });
  try {
    await Deno.writeTextFile(`${root}/lophn.db`, "ledger sentinel");
    const files = await createLogFiles(root);
    const bytes = new Uint8Array(LOG_FILE_MAX_BYTES).fill(65);
    for (let i = 0; i < 7; i++) {
      bytes[0] = 65 + i;
      await files.write(bytes);
    }
    const entries = [];
    for await (const entry of Deno.readDir(`${root}/logs`)) {
      entries.push(entry.name);
    }
    assertEquals(entries.length, LOG_FILE_COUNT);
    for (let i = 0; i < 5; i++) {
      assertEquals(
        (await Deno.stat(`${root}/logs/platform-${i}.jsonl`)).size,
        LOG_FILE_MAX_BYTES,
      );
      const file = await Deno.open(`${root}/logs/platform-${i}.jsonl`);
      try {
        const first = new Uint8Array(1);
        await file.read(first);
        assertEquals(first[0], 71 - i);
      } finally {
        file.close();
      }
    }
    assertEquals(
      await Deno.readTextFile(`${root}/lophn.db`),
      "ledger sentinel",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/diagnostics#R2 platform/redaction#R15 no symlink traversal or hardlink write", async () => {
  const root = await Deno.makeTempDir({ prefix: "io-safety-" });
  const outside = await Deno.makeTempDir({ prefix: "io-outside-" });
  try {
    await Deno.symlink(outside, `${root}/logs`);
    await assertRejects(() => createLogFiles(root));
    await Deno.remove(`${root}/logs`);
    const files = await createLogFiles(root);
    await Deno.writeTextFile(`${outside}/sentinel`, "untouched");
    await Deno.symlink(`${outside}/sentinel`, `${root}/logs/platform-0.jsonl`);
    await assertRejects(() => files.write(new Uint8Array([1])));
    await Deno.remove(`${root}/logs/platform-0.jsonl`);
    await Deno.link(`${outside}/sentinel`, `${root}/logs/platform-0.jsonl`);
    await assertRejects(() => files.write(new Uint8Array([1])));
    assertEquals(await Deno.readTextFile(`${outside}/sentinel`), "untouched");
    await assertRejects(() =>
      createLogFiles(`${root}/../${root.split("/").at(-1)}`)
    );
    assert((await Deno.stat(`${outside}/sentinel`)).isFile);
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

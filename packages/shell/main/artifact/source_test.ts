import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { nodeArtifactFs, resolveSource } from "./source.ts";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "lophn-artifact-source-"));
  const artifacts = join(root, "domains", "dom_a", "artifacts");
  await mkdir(artifacts, { recursive: true });
  return { root, artifacts };
}

test("artifact 이름이 slug가 아니거나 폴더가 artifacts 밖을 가리키면 거절한다", async () => {
  const { root, artifacts } = await setup();
  try {
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "index.html"), "<html></html>");
    await symlink(outside, join(artifacts, "escape"));
    // 다른 domain의 artifact를 가리키는 symlink도 artifacts 밖이다.
    const other = join(root, "domains", "dom_b", "artifacts", "theirs");
    await mkdir(other, { recursive: true });
    await writeFile(join(other, "index.html"), "<html></html>");
    await symlink(other, join(artifacts, "borrowed"));
    await mkdir(join(artifacts, "good"));
    await writeFile(join(artifacts, "good", "index.html"), "<html></html>");

    const open = (name: string) =>
      resolveSource(
        root,
        { kind: "artifact", domain: "dom_a", name },
        nodeArtifactFs,
      );
    const bad = await open("../outside");
    assert.equal(!bad.ok && bad.error.code, "invalid_input");
    const escaped = await open("escape");
    assert.equal(!escaped.ok && escaped.error.code, "not_found");
    const borrowed = await open("borrowed");
    assert.equal(!borrowed.ok && borrowed.error.code, "not_found");
    const good = await open("good");
    assert.equal(good.ok && good.value.entry, "index.html");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(".html이 아니거나 일반 file이 아닌 대상은 file 대상으로 열리지 않는다", async () => {
  const { root } = await setup();
  try {
    const open = (path: string) =>
      resolveSource(root, { kind: "file", project: "p", path }, nodeArtifactFs);
    await writeFile(join(root, "a.txt"), "x");
    await mkdir(join(root, "dir.html"));
    await writeFile(join(root, "a.html"), "x");

    const txt = await open(join(root, "a.txt"));
    assert.equal(!txt.ok && txt.error.code, "invalid_input");
    const relative = await open("a.html");
    assert.equal(!relative.ok && relative.error.code, "invalid_input");
    const dir = await open(join(root, "dir.html"));
    assert.equal(!dir.ok && dir.error.code, "not_found");
    const ok = await open(join(root, "a.html"));
    assert.ok(ok.ok && ok.value.name === null && ok.value.entry === "a.html");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

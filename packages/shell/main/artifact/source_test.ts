import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { nodeArtifactFs, resolveSource } from "./source.ts";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "lophn-artifact-source-"));
  const artifacts = join(root, "projects", "prj_a", "artifacts");
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
    // 다른 그릇의 artifact를 가리키는 symlink도 artifacts 밖이다.
    const other = join(root, "apps", "app_b", "artifacts", "theirs");
    await mkdir(other, { recursive: true });
    await writeFile(join(other, "index.html"), "<html></html>");
    await symlink(other, join(artifacts, "borrowed"));
    await mkdir(join(artifacts, "good"));
    await writeFile(join(artifacts, "good", "index.html"), "<html></html>");

    const open = (name: string) =>
      resolveSource(
        root,
        { kind: "artifact", project: "prj_a", name },
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

test("workflow artifact는 그 project의 workflows/ 밖으로 root를 풀지 못한다", async () => {
  const { root } = await setup();
  try {
    const A = "prj_a";
    const workflows = join(root, "projects", A, "workflows");
    const folder = join(workflows, "flow", "artifacts");
    await mkdir(join(folder, "instance"), { recursive: true });
    await writeFile(join(folder, "instance", "index.html"), "<html></html>");
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "index.html"), "<html></html>");
    await symlink(outside, join(folder, "static"));
    // 다른 project의 workflow artifact를 가리키는 symlink도 workflows/ 밖이다.
    const other = join(
      root,
      "projects",
      "prj_b",
      "workflows",
      "flow",
      "artifacts",
      "static",
    );
    await mkdir(other, { recursive: true });
    await writeFile(join(other, "index.html"), "<html></html>");
    await mkdir(join(workflows, "other", "artifacts"), { recursive: true });
    await symlink(other, join(workflows, "other", "artifacts", "static"));

    const open = (
      workflow: string,
      view: "static" | "instance",
      instance?: string,
    ) =>
      resolveSource(
        root,
        { kind: "workflow", project: A, workflow, view, instance },
        nodeArtifactFs,
      );
    const bad = await open("../x", "static");
    assert.equal(!bad.ok && bad.error.code, "invalid_input");
    const missing = await open("flow", "instance");
    assert.equal(!missing.ok && missing.error.code, "invalid_input");
    const escaped = await open("flow", "static");
    assert.equal(!escaped.ok && escaped.error.code, "not_found");
    const borrowed = await open("other", "static");
    assert.equal(!borrowed.ok && borrowed.error.code, "not_found");
    const good = await open(
      "flow",
      "instance",
      "wfi_01jz0000000000000000000000",
    );
    assert.ok(good.ok && good.value.entry === "index.html");
    assert.equal(good.value.scope, "wfi_01jz0000000000000000000000");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

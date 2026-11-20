import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import {
  ARTIFACT_FILE_MAX_BYTES,
  artifactHandlers,
  listArtifacts,
  readArtifactFile,
} from "./mod.ts";

const PROJECT = `prj_0${"1".repeat(25)}`;
const APP = `app_0${"2".repeat(25)}`;
const ctx = {} as AuthenticatedContext;
const NO_FILE_SYMLINK =
  "Windows에서 file symlink 권한이 없다(개발자 모드 꺼짐)";

async function setup() {
  const base = await realpath(
    await mkdtemp(join(tmpdir(), "lophn-core-artifacts-")),
  );
  const dataRoot = join(base, "data");
  const outside = join(base, "outside");
  const artRoot = join(dataRoot, "projects", PROJECT, "artifacts");
  const good = join(artRoot, "report");
  const sibling = join(artRoot, "report-evil");
  const appArt = join(dataRoot, "apps", APP, "artifacts", "dash");

  await mkdir(join(good, "data", "sub"), { recursive: true });
  await mkdir(sibling, { recursive: true });
  await mkdir(appArt, { recursive: true });
  await mkdir(outside, { recursive: true });

  await writeFile(
    join(good, "index.html"),
    '<title>Weekly Report</title><meta name="description" content="Summary"><p>ok</p>',
  );
  await writeFile(join(good, "data", "a.json"), '{"v":1}');
  await writeFile(join(sibling, "secret.txt"), "sibling-secret");
  await writeFile(join(outside, "secret.txt"), "outside-secret");
  await writeFile(join(outside, "index.html"), "<title>Escape</title>");
  await writeFile(join(appArt, "index.html"), "<title>App Dash</title>");

  try {
    await symlink(join(outside, "secret.txt"), join(good, "out-file"));
  } catch (thrown) {
    if (process.platform !== "win32") throw thrown;
    await rm(base, { recursive: true });
    return null;
  }
  await symlink(outside, join(artRoot, "escape-dir"), "junction");
  await symlink(outside, join(good, "out-dir"), "junction");
  await symlink(sibling, join(good, "sibling-dir"), "junction");
  await symlink(join(outside, "secret.txt"), join(good, "data", "leak.json"));
  await symlink(join(good, "index.html"), join(good, "inner-link.html"));
  return { base, dataRoot, outside, good };
}

test("artifacts/list는 일반 폴더와 일반 index.html만 이름 순으로 내고 symlink 폴더는 건너뛴다", async (t) => {
  const made = await setup();
  if (made === null) return t.skip(NO_FILE_SYMLINK);
  try {
    const listed = await listArtifacts(made.dataRoot, {
      kind: "project",
      id: PROJECT,
    });
    assert.deepEqual(
      listed.map((item) => ({
        name: item.name,
        title: item.title,
        description: item.description,
      })),
      [{ name: "report", title: "Weekly Report", description: "Summary" }],
    );

    const appListed = await listArtifacts(made.dataRoot, {
      kind: "app",
      id: APP,
    });
    assert.deepEqual(
      appListed.map((item) => item.name),
      ["dash"],
    );
  } finally {
    await rm(made.base, { recursive: true });
  }
});

test("artifacts/file은 artifact 폴더 밖(.., symlink, 형제 폴더)과 크기 초과를 거절하고 _entries.json을 낸다", async (t) => {
  const made = await setup();
  if (made === null) return t.skip(NO_FILE_SYMLINK);
  try {
    const handlers = artifactHandlers(made.dataRoot);

    // 정상 file(project·app)과 폴더 안 symlink는 읽힌다.
    const okHtml = await readArtifactFile(made.dataRoot, {
      project: PROJECT,
      name: "report",
      path: "index.html",
    });
    assert.equal(okHtml.ok, true);
    assert.match(new TextDecoder().decode(okHtml.value), /Weekly Report/);

    const okInner = await readArtifactFile(made.dataRoot, {
      project: PROJECT,
      name: "report",
      path: "inner-link.html",
    });
    assert.equal(okInner.ok, true);

    const okApp = await readArtifactFile(made.dataRoot, {
      app: APP,
      name: "dash",
      path: "index.html",
    });
    assert.equal(okApp.ok, true);

    // data/_entries.json은 일반 file만 싣고 바깥 symlink는 뺀다.
    const entriesRes = await readArtifactFile(made.dataRoot, {
      project: PROJECT,
      name: "report",
      path: "data/_entries.json",
    });
    assert.equal(entriesRes.ok, true);
    const entries = JSON.parse(new TextDecoder().decode(entriesRes.value)) as {
      name: string;
    }[];
    assert.deepEqual(
      entries.map((entry) => entry.name),
      ["a.json"],
    );

    // 바깥을 가리키는 symlink, 형제 폴더, symlink artifact 폴더, 폴더 자체는 모두 not_found다.
    for (const bad of [
      { project: PROJECT, name: "report", path: "out-file" },
      { project: PROJECT, name: "report", path: "out-dir/secret.txt" },
      { project: PROJECT, name: "report", path: "sibling-dir/secret.txt" },
      { project: PROJECT, name: "escape-dir", path: "index.html" },
      { project: PROJECT, name: "report", path: "data" },
    ]) {
      const res = await readArtifactFile(made.dataRoot, bad);
      assert.equal(res.ok, false, JSON.stringify(bad));
      assert.equal(res.error.code, "not_found");
    }

    // schema 수준에서 `..`·절대 path·잘못된 slug는 invalid_input이다.
    for (const invalid of [
      { project: PROJECT, name: "report", path: "../report-evil/secret.txt" },
      { project: PROJECT, name: "report", path: "/etc/passwd" },
      { project: PROJECT, name: "BAD_NAME", path: "index.html" },
    ]) {
      const res = await handlers.file(ctx, invalid);
      assert.equal(res.ok, false, JSON.stringify(invalid));
      assert.equal(res.error.code, "invalid_input");
    }

    // 4 MiB를 넘는 file은 not_found로 거절한다.
    await writeFile(
      join(made.good, "huge.bin"),
      new Uint8Array(ARTIFACT_FILE_MAX_BYTES + 1),
    );
    const huge = await readArtifactFile(made.dataRoot, {
      project: PROJECT,
      name: "report",
      path: "huge.bin",
    });
    assert.equal(huge.ok, false);
    assert.equal(huge.error.code, "not_found");
  } finally {
    await rm(made.base, { recursive: true });
  }
});

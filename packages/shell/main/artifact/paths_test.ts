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

import { listDataEntries } from "./entries.ts";
import { resolveInsideRoot } from "./paths.ts";
import { createArtifactViews } from "./registry.ts";
import { createRemoteArtifacts } from "./remote.ts";
import { createArtifactRoots } from "./roots.ts";
import { createArtifactServer } from "./serve.ts";

// file symlink는 Windows에서 개발자 모드나 관리자 권한이 있어야 만들어진다. 없으면 test를 건너뛴다.
const NO_FILE_SYMLINK =
  "Windows에서 file symlink 권한이 없다(개발자 모드 꺼짐)";

// 바깥 폴더 `out`과, root와 접두사만 같은 형제 `art-evil`을 root 옆에 둔다. file symlink를 못 만들면 null이다.
async function setup() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lophn-artifact-")));
  const root = join(base, "art");
  await mkdir(join(root, "data", "sub"), { recursive: true });
  await mkdir(join(base, "out"));
  await mkdir(join(base, "art-evil"));
  await writeFile(join(root, "index.html"), "home");
  await writeFile(join(root, "data", "a.json"), "{}");
  await writeFile(join(root, "big.bin"), "x".repeat(100));
  await writeFile(join(base, "out", "secret.txt"), "secret");
  await writeFile(join(base, "art-evil", "secret.txt"), "secret");
  try {
    await symlink(join(base, "out", "secret.txt"), join(root, "out-file"));
  } catch (thrown) {
    if (process.platform !== "win32") throw thrown;
    await rm(base, { recursive: true });
    return null;
  }
  // 폴더 연결은 junction으로 만든다. POSIX는 type을 무시한다.
  await symlink(join(base, "out"), join(root, "out-dir"), "junction");
  await symlink(join(base, "art-evil"), join(root, "evil-dir"), "junction");
  await symlink(join(root, "index.html"), join(root, "inner-link"));
  await symlink(join(base, "out", "secret.txt"), join(root, "data", "leak"));
  const roots = createArtifactRoots();
  const host = roots.register(root);
  const serve = createArtifactServer({
    rootOf: roots.rootOf,
    scopeOf: roots.scopeOf,
    remoteOf: roots.remoteOf,
    readRemote: () => Promise.resolve(null),
    readInstance: () => Promise.resolve(null),
    kit: () => Promise.resolve(null),
    maxBytes: 90,
  });
  const get = (path: string) =>
    serve(new Request(`lophn-artifact://${host}${path}`));
  return { base, root, get };
}

test("봉한 scheme은 root 밖을 가리키는 path와 일반 file이 아닌 것, 상한을 넘는 file을 거절한다", async (t) => {
  const made = await setup();
  if (made === null) return t.skip(NO_FILE_SYMLINK);
  const { base, root, get } = made;
  try {
    const denied = [
      "/../out/secret.txt",
      "/%2e%2e/out/secret.txt",
      "/%2E%2E%2Fout/secret.txt",
      "/art/../out/secret.txt",
      "/..%5Cout%5Csecret.txt",
      "/index.html%00",
      "/%E0%A4%A",
      `/${join(base, "out", "secret.txt")}`,
      "/out-file",
      "/out-dir/secret.txt",
      "/evil-dir/secret.txt",
      "/data/",
      "/data",
      "/big.bin",
    ];
    for (const path of denied) {
      const response = await get(path);
      assert.equal(response.status, 404, path);
      assert.notEqual(await response.text(), "secret", path);
    }
    // URL 파서가 먼저 정리해 주는 `..`도 해석기 자체가 거절해야 한다.
    for (const path of [
      "../out/secret.txt",
      "%2e%2e/out/secret.txt",
      "a/../../out",
    ]) {
      assert.equal(await resolveInsideRoot(root, path), null, path);
    }
    for (const path of ["/", "/index.html", "/inner-link"]) {
      const response = await get(path);
      assert.equal(response.status, 200, path);
      assert.equal(await response.text(), "home", path);
    }
  } finally {
    await rm(base, { recursive: true });
  }
});

test("_entries.json은 밖으로 가는 symlink와 하위 폴더를 싣지 않는다", async (t) => {
  const made = await setup();
  if (made === null) return t.skip(NO_FILE_SYMLINK);
  const { base, root, get } = made;
  try {
    const names = (entries: string) =>
      JSON.parse(entries).map((e: { name: string }) => e.name);
    assert.deepEqual(names(await listDataEntries(root)), ["a.json"]);
    const served = await get("/data/_entries.json");
    assert.deepEqual(names(await served.text()), ["a.json"]);
    // data/ 자체가 밖으로 가는 symlink면 목록은 비어 있다.
    await rm(join(root, "data"), { recursive: true });
    await symlink(join(base, "out"), join(root, "data"), "junction");
    assert.deepEqual(names(await listDataEntries(root)), []);
  } finally {
    await rm(base, { recursive: true });
  }
});

test("다른 컴퓨터의 artifact도 같은 봉한 scheme·CSP·상한·path 검사로 읽고 watch·annotate를 열지 않는다", async () => {
  const machine = `mch_0${"1".repeat(25)}`;
  const project = `prj_0${"2".repeat(25)}`;
  const files: Record<string, string> = {
    "index.html": "<title>Remote</title><p>hi</p>",
    "data/_entries.json": JSON.stringify([
      { name: "a.json", size: 2, modified: "2026-11-20T00:00:00.000Z" },
    ]),
    "big.bin": "x".repeat(100),
  };
  const remote = createRemoteArtifacts((id) =>
    id === machine
      ? {
          call: async ({ resource, method, body }) => {
            if (resource === "artifacts" && method === "list") {
              return {
                ok: true,
                value: {
                  artifacts: [
                    {
                      name: "report",
                      title: "Remote",
                      description: "desc",
                      modified: "2026-11-20T00:00:00.000Z",
                    },
                  ],
                },
              };
            }
            if (resource === "artifacts" && method === "file") {
              const path = (body as { path: string }).path;
              const content = files[path];
              if (content === undefined) {
                return {
                  ok: false,
                  error: { code: "not_found", message: "missing" },
                };
              }
              return {
                ok: true,
                value: {
                  content_type: "application/octet-stream",
                  base64: Buffer.from(content).toString("base64"),
                },
              };
            }
            return {
              ok: false,
              error: { code: "not_found", message: "unknown" },
            };
          },
        }
      : undefined,
  );

  const roots = createArtifactRoots();
  const host = roots.registerRemote({
    machine,
    workspace: { kind: "project", id: project },
    name: "report",
  });
  const serve = createArtifactServer({
    rootOf: roots.rootOf,
    scopeOf: roots.scopeOf,
    remoteOf: roots.remoteOf,
    readRemote: remote.read,
    readInstance: () => Promise.resolve(null),
    kit: (name) =>
      Promise.resolve(
        name === "kit.js" ? new TextEncoder().encode("/*kit*/") : null,
      ),
    maxBytes: 90,
  });
  const get = (path: string) =>
    serve(new Request(`lophn-artifact://${host}${path}`));

  const html = await get("/");
  assert.equal(html.status, 200);
  assert.match(html.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(
    html.headers.get("content-security-policy") ?? "",
    /connect-src 'self'/,
  );
  assert.equal(await html.text(), files["index.html"]);

  const entries = await get("/data/_entries.json");
  assert.equal(entries.status, 200);
  assert.deepEqual(
    JSON.parse(await entries.text()).map((e: { name: string }) => e.name),
    ["a.json"],
  );

  const kit = await get("/_lophn/kit.js");
  assert.equal(kit.status, 200);
  assert.equal(await kit.text(), "/*kit*/");

  // 상한 초과와 path 탈출 시도는 모두 404다.
  for (const denied of [
    "/big.bin",
    "/%2e%2e/secret.txt",
    "/%2e%2e%2fsecret.txt",
    "/a%5Cb",
    "/index.html%00",
    "/%E0%A4%A",
  ]) {
    assert.equal((await get(denied)).status, 404, denied);
  }
  assert.equal(
    (await serve(new Request(`lophn-artifact://${host}/`, { method: "POST" })))
      .status,
    405,
  );

  // registry: 원격 view는 local watch를 열지 않고 annotate도 거절하며, 없는 artifact는 not_found다.
  let watched = 0;
  const views = createArtifactViews({
    host: {
      guest: () => {
        throw new Error("unused");
      },
    },
    activation: {
      mark: () => {},
      fresh: () => false,
      freshPerson: () => false,
      forget: () => {},
    },
    resolve: (source) => {
      if (source.kind === "artifact" && source.machine !== undefined) {
        return remote.resolve({ ...source, machine: source.machine });
      }
      return Promise.resolve({
        ok: false,
        error: { code: "not_found", message: "missing" },
      });
    },
    ensureSession: () => Promise.resolve(),
    registerRoot: roots.register,
    registerRemoteRoot: roots.registerRemote,
    watch: () => {
      watched += 1;
      return { stop() {} };
    },
    ids: { viewSession: () => "art-remote-1" },
    pushState: () => {},
    pushEvent: () => {},
  });

  const opened = await views.open("win-1", {
    kind: "artifact",
    project,
    name: "report",
    machine,
  });
  assert.equal(opened.ok, true);
  assert.equal(watched, 0);
  assert.equal(views.annotateView("art-remote-1"), undefined);

  const missing = await views.open("win-1", {
    kind: "artifact",
    project,
    name: "nope",
    machine,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "not_found");
  views.dispose();
});

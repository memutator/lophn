import { assert, assertEquals } from "@std/assert";
import {
  canonicalOrder,
  containsProtected,
  isSameOrInside,
  type PathResolver,
  type ProtectedRoots,
  type ResolvedRequirement,
  resolveRequirement,
} from "./mod.ts";

const roots: ProtectedRoots = {
  credentialRoots: [
    "/home/owner/.ssh",
    "/home/owner/.aws",
    "/home/owner/.gnupg",
  ],
  dataRoot: "/home/owner/.lophn",
  appRoots: ["/home/owner/.lophn/apps/other"],
  sourceRoots: ["/src/other"],
};

function resolver(
  paths: Record<string, string>,
  directories: ReadonlySet<string>,
  links: Record<string, { link: string; target?: string }[]>,
): PathResolver {
  return {
    realPath(path) {
      return Promise.resolve(paths[path]);
    },
    isDirectory(path) {
      return Promise.resolve(directories.has(path));
    },
    linksIn(directory) {
      return Promise.resolve(links[directory] ?? []);
    },
  };
}

const none = resolver({}, new Set(), {});

function rejected(
  result: { ok: boolean; error?: { code: string } },
  code: string,
) {
  assert(!result.ok);
  assertEquals(result.error?.code, code);
}

Deno.test("apps/permissions#R5: write grant does not include read and string prefix is not containment", () => {
  const write: ResolvedRequirement = {
    kind: "fs.write",
    scope: { path: "/data/notes", recursive: true, outsideLinks: [] },
    reason: "save notes",
  };
  assert(write.kind !== "fs.read");
  assert(isSameOrInside("/data/notes/a.txt", "/data/notes"));
  assert(!isSameOrInside("/data/notes-other/a.txt", "/data/notes"));
  assert(!isSameOrInside("/data/notes", "/data/notes-other"));
});

Deno.test("apps/permissions#R6: tilde, relative path and symlink resolve to a real absolute path", async () => {
  const paths = resolver(
    { "~/notes": "/home/owner/notes", "notes": "/work/notes" },
    new Set(["/home/owner/notes", "/work/notes"]),
    {
      "/home/owner/notes": [{
        link: "/home/owner/notes/out",
        target: "/var/outside",
      }],
    },
  );
  const home = await resolveRequirement(
    {
      kind: "fs.read",
      scope: { path: "~/notes", recursive: true },
      reason: "read notes",
    },
    roots,
    paths,
  );
  assert(home.ok);
  if (home.ok && home.value.kind === "fs.read") {
    assertEquals(home.value.scope.path, "/home/owner/notes");
    assertEquals(home.value.scope.outsideLinks, ["/home/owner/notes/out"]);
  }
  const relative = await resolveRequirement(
    {
      kind: "fs.read",
      scope: { path: "notes", recursive: true },
      reason: "read",
    },
    roots,
    paths,
  );
  assert(relative.ok);
  if (relative.ok && relative.value.kind === "fs.read") {
    assertEquals(relative.value.scope.path, "/work/notes");
  }
});

Deno.test("apps/permissions#R6: a link aimed at a protected root rejects the whole grant", async () => {
  const paths = resolver(
    { "/data/box": "/data/box" },
    new Set(["/data/box"]),
    {
      "/data/box": [{ link: "/data/box/keys", target: "/home/owner/.ssh/id" }],
    },
  );
  rejected(
    await resolveRequirement(
      {
        kind: "fs.read",
        scope: { path: "/data/box", recursive: true },
        reason: "box",
      },
      roots,
      paths,
    ),
    "forbidden",
  );
});

Deno.test("apps/permissions#R7: a parent covering home credentials, data root, another app or source is rejected", async () => {
  for (
    const path of [
      "/home/owner",
      "/home/owner/.ssh",
      "/home/owner/.lophn",
      "/src",
    ]
  ) {
    assert(containsProtected(path, roots));
    const paths = resolver({ [path]: path }, new Set([path]), {});
    rejected(
      await resolveRequirement(
        { kind: "fs.write", scope: { path, recursive: true }, reason: "wide" },
        roots,
        paths,
      ),
      "forbidden",
    );
  }
  const file = resolver(
    { "/data/notes.txt": "/data/notes.txt" },
    new Set(),
    {},
  );
  const allowed = await resolveRequirement(
    {
      kind: "fs.read",
      scope: { path: "/data/notes.txt", recursive: false },
      reason: "one file",
    },
    roots,
    file,
  );
  assert(allowed.ok);
});

Deno.test("apps/permissions#R8: wildcard host and port 0 are rejected", async () => {
  for (
    const scope of [
      { host: "*.example.com", port: 443 },
      { host: "example.com", port: 0 },
    ]
  ) {
    rejected(
      await resolveRequirement(
        { kind: "net.fetch", scope, reason: "wide" },
        roots,
        none,
      ),
      "invalid_input",
    );
  }
  const exact = await resolveRequirement(
    {
      kind: "net.fetch",
      scope: { host: "example.com", port: 443 },
      reason: "one",
    },
    roots,
    none,
  );
  assert(exact.ok);
});

Deno.test("apps/permissions#R9: a non-recursive directory grant is rejected", async () => {
  const paths = resolver(
    { "/data/box": "/data/box" },
    new Set(["/data/box"]),
    {},
  );
  rejected(
    await resolveRequirement(
      {
        kind: "fs.read",
        scope: { path: "/data/box", recursive: false },
        reason: "dir",
      },
      roots,
      paths,
    ),
    "invalid_input",
  );
});

Deno.test("apps/permissions#R9: listen is rejected because direction cannot be enforced", async () => {
  for (const host of ["localhost", "127.0.0.1", "::1"]) {
    rejected(
      await resolveRequirement(
        { kind: "net.listen", scope: { host, port: 1455 }, reason: "callback" },
        roots,
        none,
      ),
      "forbidden",
    );
  }
});

Deno.test("apps/permissions#R10: localhost and 127.0.0.1 stay distinct scopes", async () => {
  const first = await resolveRequirement(
    {
      kind: "net.fetch",
      scope: { host: "localhost", port: 1455 },
      reason: "a",
    },
    roots,
    none,
  );
  const second = await resolveRequirement(
    {
      kind: "net.fetch",
      scope: { host: "127.0.0.1", port: 1455 },
      reason: "b",
    },
    roots,
    none,
  );
  assert(first.ok && second.ok);
  assert(
    JSON.stringify(first.value.scope) !== JSON.stringify(second.value.scope),
  );
});

Deno.test("apps/permissions#R12: order does not change the result and duplicates are rejected", () => {
  const read: ResolvedRequirement = {
    kind: "fs.read",
    scope: { path: "/data/a", recursive: true, outsideLinks: [] },
    reason: "a",
  };
  const fetch: ResolvedRequirement = {
    kind: "net.fetch",
    scope: { host: "example.com", port: 443 },
    reason: "b",
  };
  const forward = canonicalOrder([read, fetch]);
  const backward = canonicalOrder([fetch, read]);
  assert(forward.ok && backward.ok);
  assertEquals(forward.value, backward.value);
  rejected(canonicalOrder([read, read]), "invalid_input");
});

import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../base/mod.ts";
import {
  addGitDir,
  addLophnDataDir,
  addOutsideSymlink,
  copyFixture,
  editExternally,
  removeFixtureCopy,
} from "../../../../fixtures/projects/scenarios.ts";
import { directoryScanner, openedFileEscapes } from "./scan.ts";
import { PREVIEW_PAGE, previewTracking } from "./work.ts";

const project = "prj_01arz3ndektsv4rrffq69g5fav";
const proposal = {
  enabled: true,
  patterns: [{ effect: "include" as const, glob: "**/*.md" }],
  use_gitignore: true,
};

function value<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code} ${result.error.message}`);
  }
  return result.value;
}

Deno.test("documents/projects#R3: a new tree stays untracked until the proposal is applied", async () => {
  const root = await copyFixture("notes-basic");
  try {
    const off = value(previewTracking(directoryScanner(), {
      project,
      baseRevision: "1",
      folders: [{ path: root, description: "" }],
      tracking: { ...proposal, enabled: false },
      observedAt: "2026-10-04T00:00:00.000Z",
    }));
    assertEquals(off.entries.some((entry) => entry.included), false);
    const on = value(previewTracking(directoryScanner(), {
      project,
      baseRevision: "1",
      folders: [{ path: root, description: "" }],
      tracking: proposal,
      observedAt: "2026-10-04T00:00:00.000Z",
    }));
    const included = on.entries.filter((entry) => entry.included).map((entry) =>
      entry.path
    );
    assert(included.includes("index.md"));
    assert(included.includes("deep/outer.md"));
    assert(included.includes("deep/sub/inner.md"));
    assert(!included.includes("ignored/hidden.md"));
    assert(!included.includes("private.secret.md"));
    assert(!included.includes("notes.txt"));
  } finally {
    await removeFixtureCopy(root);
  }
});

Deno.test("documents/projects#R4: the same relative path gets the same decision in two roots", async () => {
  const root = await copyFixture("multi-folder");
  try {
    const preview = value(previewTracking(directoryScanner(), {
      project,
      baseRevision: "1",
      folders: [
        { path: `${root}/root-a`, description: "one" },
        { path: `${root}/root-b`, description: "two" },
      ],
      tracking: {
        enabled: true,
        patterns: [
          { effect: "include", glob: "**/*.md" },
          { effect: "exclude", glob: "notes/**" },
          { effect: "include", glob: "notes/plan.md" },
        ],
        use_gitignore: false,
      },
      observedAt: "2026-10-04T00:00:00.000Z",
    }));
    const one = preview.entries.find((entry) =>
      entry.folder_path.endsWith("/root-a") && entry.path === "notes/plan.md"
    );
    const two = preview.entries.find((entry) =>
      entry.folder_path.endsWith("/root-b") && entry.path === "notes/plan.md"
    );
    assert(one !== undefined && two !== undefined);
    assertEquals(one.included, two.included);
    assertEquals(one.reason, two.reason);
    assertEquals(one.included, true);
  } finally {
    await removeFixtureCopy(root);
  }
});

Deno.test("documents/projects#R5: git, lophn data, and an outside symlink stay excluded under an include-all glob", async () => {
  const root = await copyFixture("notes-basic");
  const outside = await addOutsideSymlink(root, "outside");
  try {
    await addGitDir(root);
    await addLophnDataDir(root);
    const preview = value(previewTracking(directoryScanner(), {
      project,
      baseRevision: "1",
      folders: [{ path: root, description: "" }],
      tracking: {
        enabled: true,
        patterns: [{ effect: "include", glob: "**/*" }],
        use_gitignore: true,
      },
      observedAt: "2026-10-04T00:00:00.000Z",
    }));
    const byPath = new Map(preview.entries.map((entry) => [entry.path, entry]));
    assertEquals(byPath.get(".git/notes.md")?.included, false);
    assertEquals(byPath.get(".git/notes.md")?.reason, "inside .git");
    assertEquals(
      byPath.get(".lophn/documents/x.md")?.reason,
      "inside lophn data",
    );
    assertEquals(byPath.get("outside")?.included, false);
    assertEquals(byPath.get("outside")?.reason, "symlink outside root");
    assertEquals(byPath.has("outside/outside.md"), false);
    const real = await Deno.realPath(`${root}/index.md`);
    assertEquals(value(openedFileEscapes(root, real)), false);
    assertEquals(value(openedFileEscapes(root, `${outside}/outside.md`)), true);
  } finally {
    await removeFixtureCopy(root);
    await removeFixtureCopy(outside);
  }
});

Deno.test("documents/projects#R6: a file created after preview is judged by the applied rule, and pages keep order", async () => {
  const root = await copyFixture("notes-basic");
  try {
    const first = value(previewTracking(directoryScanner(), {
      project,
      baseRevision: "1",
      folders: [{ path: root, description: "" }],
      tracking: proposal,
      observedAt: "2026-10-04T00:00:00.000Z",
    }));
    assertEquals(
      first.entries.some((entry) => entry.path === "later.md"),
      false,
    );
    await editExternally(root, "later.md", "# later\n");
    const again = value(previewTracking(directoryScanner(), {
      project,
      baseRevision: "1",
      folders: [{ path: root, description: "" }],
      tracking: proposal,
      observedAt: "2026-10-04T00:00:01.000Z",
    }));
    const later = again.entries.find((entry) => entry.path === "later.md");
    assertEquals(later?.included, true);
    assertEquals(later?.reason, "include **/*.md");
    const many = Array.from({ length: PREVIEW_PAGE + 3 }, (_, index) => ({
      name: `f${index}.md`,
      kind: "file" as const,
    }));
    const page = value(previewTracking({
      list: () => ({ ok: true, value: many }),
      gitignore: () => ({ ok: true, value: null }),
    }, {
      project,
      baseRevision: "1",
      folders: [{ path: "/work/notes", description: "" }],
      tracking: proposal,
      observedAt: "2026-10-04T00:00:00.000Z",
    }));
    assertEquals(page.complete, false);
    assertEquals(page.entries.length, PREVIEW_PAGE);
    assert(page.next_cursor !== null);
    const rest = value(previewTracking({
      list: () => ({ ok: true, value: many }),
      gitignore: () => ({ ok: true, value: null }),
    }, {
      project,
      baseRevision: "1",
      folders: [{ path: "/work/notes", description: "" }],
      tracking: proposal,
      observedAt: "2026-10-04T00:00:00.000Z",
      cursor: page.next_cursor ?? undefined,
    }));
    assertEquals(rest.complete, true);
    assertEquals(rest.next_cursor, null);
    assertEquals(rest.entries.length, 3);
  } finally {
    await removeFixtureCopy(root);
  }
});

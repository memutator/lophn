import assert from "node:assert/strict";
import { test } from "node:test";
import { createSaved, type SavedFiles } from "./saved.ts";

function memoryFiles(): SavedFiles & { paths(): string[] } {
  const files = new Map<string, string>();
  return {
    readText: (path) => files.get(path) ?? null,
    write: (path, text) => void files.set(path, text),
    remove(path) {
      for (const key of [...files.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) files.delete(key);
      }
    },
    list(path) {
      const prefix = path === "" ? "" : `${path}/`;
      return [
        ...new Set(
          [...files.keys()]
            .filter((key) => key.startsWith(prefix))
            .map((key) => key.slice(prefix.length).split("/")[0]!),
        ),
      ];
    },
    paths: () => [...files.keys()].sort(),
  };
}

const PNG = { content_type: "image/png", data: "iVBORw0KGgo=" } as const;

test("a computer's lists and icons outlive the run that read them; an app it dropped loses its icon", () => {
  const files = memoryFiles();
  const first = createSaved(files);
  first.setLists("pc", {
    apps: [
      { id: "app_orders", name: "Orders" },
      { id: "app_old", name: "Old" },
    ],
    projects: [{ id: "prj_one", title: "One" }],
  });
  first.setIcon("pc", "app", "app_orders", PNG);
  first.setIcon("pc", "app", "app_old", { lucide: "calendar" });
  first.setIcon("pc", "project", "prj_one", null);

  // The phone app starts again with the computer away.
  const next = createSaved(files);
  assert.deepEqual(next.lists("pc")?.apps.map((one) => one.id), ["app_orders", "app_old"]);
  assert.deepEqual(next.icon("pc", "app", "app_orders"), PNG);
  assert.equal(next.icon("pc", "project", "prj_one"), null);
  assert.equal(next.icon("pc", "app", "app_never"), undefined);

  next.setLists("pc", { apps: [{ id: "app_orders", name: "Orders" }], projects: [] });
  assert.equal(next.icon("pc", "app", "app_old"), undefined);
  assert.deepEqual(files.paths(), ["pc/icons/app-app_orders.json", "pc/lists.json"]);
});

test("a computer the phone no longer has loses everything kept of it", () => {
  const files = memoryFiles();
  const saved = createSaved(files);
  for (const computer of ["kept", "removed"]) {
    saved.setLists(computer, { apps: [{ id: "app_a", name: "A" }], projects: [] });
    saved.setIcon(computer, "app", "app_a", PNG);
  }
  saved.forget(["kept"]);
  assert.equal(saved.lists("removed"), null);
  assert.deepEqual(files.paths(), ["kept/icons/app-app_a.json", "kept/lists.json"]);
});

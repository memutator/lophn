import { readdir, readFile } from "node:fs/promises";

import { checkStyles, type StyleIssue } from "./model.ts";

// design은 base에 기대지 않는다. file 오류의 code(`ENOENT` …)를 그 자리에서 읽는다.
function codeOf(thrown: unknown): unknown {
  return (thrown as { code?: unknown } | null)?.code;
}

async function cssFiles(directory: URL): Promise<URL[]> {
  const files: URL[] = [];
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (["node_modules", "dist", "testdata"].includes(entry.name)) continue;
      const path = new URL(
        `${entry.name}${entry.isDirectory() ? "/" : ""}`,
        directory,
      );
      if (entry.isDirectory()) files.push(...(await cssFiles(path)));
      else if (entry.isFile() && entry.name.endsWith(".css")) files.push(path);
    }
  } catch (error) {
    if (codeOf(error) !== "ENOENT") throw error;
  }
  return files;
}

export async function checkRepositoryStyles(root: URL): Promise<StyleIssue[]> {
  const directories = ["packages/shell/renderer/", "packages/design/"];
  try {
    for (const entry of await readdir(new URL("packages/sdk/", root), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory() && entry.name.startsWith("ui-")) {
        directories.push(`packages/sdk/${entry.name}/`);
      }
    }
  } catch (error) {
    if (codeOf(error) !== "ENOENT") throw error;
  }
  const files = (
    await Promise.all(
      directories.map((directory) => cssFiles(new URL(directory, root))),
    )
  )
    .flat()
    .sort((a, b) => a.href.localeCompare(b.href));
  const issues: StyleIssue[] = [];
  for (const file of files) {
    const name = decodeURIComponent(file.pathname.slice(root.pathname.length));
    issues.push(...checkStyles(await readFile(file, "utf8"), name));
  }
  return issues;
}

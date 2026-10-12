import { checkStyles, type StyleIssue } from "./model.ts";

async function cssFiles(directory: URL): Promise<URL[]> {
  const files: URL[] = [];
  try {
    for await (const entry of Deno.readDir(directory)) {
      if (["node_modules", "dist", "testdata"].includes(entry.name)) continue;
      const path = new URL(
        `${entry.name}${entry.isDirectory ? "/" : ""}`,
        directory,
      );
      if (entry.isDirectory) files.push(...await cssFiles(path));
      else if (entry.isFile && entry.name.endsWith(".css")) files.push(path);
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return files;
}

export async function checkRepositoryStyles(root: URL): Promise<StyleIssue[]> {
  const directories = ["packages/shell/renderer/", "packages/design/"];
  try {
    for await (const entry of Deno.readDir(new URL("packages/sdk/", root))) {
      if (entry.isDirectory && entry.name.startsWith("ui-")) {
        directories.push(`packages/sdk/${entry.name}/`);
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const files = (await Promise.all(
    directories.map((directory) => cssFiles(new URL(directory, root))),
  ))
    .flat().sort((a, b) => a.href.localeCompare(b.href));
  const issues: StyleIssue[] = [];
  for (const file of files) {
    const name = decodeURIComponent(file.pathname.slice(root.pathname.length));
    issues.push(...checkStyles(await Deno.readTextFile(file), name));
  }
  return issues;
}

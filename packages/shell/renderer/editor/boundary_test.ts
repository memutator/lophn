import { assertEquals } from "@std/assert";

const root = new URL("../../../../", import.meta.url);
const editor = new URL("./", import.meta.url);

async function sources(directory: URL): Promise<URL[]> {
  const found: URL[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const url = new URL(
      `${entry.name}${entry.isDirectory ? "/" : ""}`,
      directory,
    );
    if (entry.isDirectory) found.push(...await sources(url));
    else if (/\.(ts|tsx|json)$/.test(entry.name)) found.push(url);
  }
  return found;
}

Deno.test("shell/editor#R7: CodeMirror는 shell renderer의 editor 폴더에만 있고 SDK·design에 공개하지 않는다", async () => {
  const outside: string[] = [];
  const places = [
    new URL("packages/sdk/", root),
    new URL("packages/design/", root),
    new URL("packages/protocol/", root),
    new URL("packages/shell/renderer/", root),
  ];
  for (const place of places) {
    for (const file of await sources(place)) {
      if (file.href.startsWith(editor.href)) continue;
      // renderer import map은 editor가 쓰는 판을 고정하는 자리다.
      if (
        file.href === new URL("packages/shell/renderer/deno.json", root).href
      ) {
        continue;
      }
      const text = await Deno.readTextFile(file);
      if (/["']@codemirror\//.test(text)) {
        outside.push(file.href.slice(root.href.length));
      }
    }
  }
  assertEquals(outside, []);
});

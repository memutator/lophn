import { assert, assertEquals } from "@std/assert";

const root = new URL("./", import.meta.url);

async function sources(directory: URL): Promise<URL[]> {
  const found: URL[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const url = new URL(
      `${entry.name}${entry.isDirectory ? "/" : ""}`,
      directory,
    );
    if (entry.isDirectory) found.push(...await sources(url));
    else if (/\.tsx?$/.test(entry.name)) found.push(url);
  }
  return found;
}

Deno.test("apps/sdk#R4: @lophn/ui-chart는 정확한 1.0.0이고 mod.ts 하나로 낸다", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(new URL("deno.json", root)),
  );
  assertEquals(config.name, "@lophn/ui-chart");
  assertEquals(config.version, "1.0.0");
  assertEquals(config.exports, "./mod.ts");
  // 의존성은 범위가 아니라 정확한 판으로 고정한다.
  for (const specifier of Object.values(config.imports) as string[]) {
    assert(/@\d+\.\d+\.\d+(\/|$)/.test(specifier), specifier);
  }
});

Deno.test("apps/sdk#R38: @lophn/ui-chart는 contracts를 import하지 않고 HTML을 직접 넣거나 실행하지 않는다", async () => {
  for (const file of await sources(root)) {
    if (/_test\.tsx?$/.test(file.pathname)) continue;
    const text = await Deno.readTextFile(file);
    for (
      const banned of [
        "@lophn/protocol",
        "dangerouslySetInnerHTML",
        "innerHTML",
        "eval(",
        "new Function",
      ]
    ) {
      assert(!text.includes(banned), `${file.pathname}: ${banned}`);
    }
  }
});

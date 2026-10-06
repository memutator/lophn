import { assert, assertEquals } from "@std/assert";
import { checkSource, errorsOf } from "@lophn/wording/check";

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

Deno.test("apps/sdk#R4: @lophn/ui-stat는 정확한 1.0.0이고 의존을 정확한 판으로 고정한다", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(new URL("deno.json", root)),
  );
  assertEquals(config.name, "@lophn/ui-stat");
  assertEquals(config.version, "1.0.0");
  assertEquals(config.exports, "./mod.ts");
  for (const specifier of Object.values(config.imports) as string[]) {
    assert(/@\d+\.\d+\.\d+(\/|$)/.test(specifier), specifier);
  }
});

Deno.test("apps/sdk#R41: @lophn/ui-stat의 고정 문구는 wording key만 쓴다", async () => {
  for (const file of await sources(root)) {
    if (
      !file.pathname.endsWith(".tsx") || file.pathname.endsWith("_test.tsx")
    ) {
      continue;
    }
    const findings = checkSource(file.pathname, await Deno.readTextFile(file));
    assertEquals(errorsOf(findings), []);
  }
});

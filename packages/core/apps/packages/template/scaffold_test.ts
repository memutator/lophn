import { assertEquals } from "@std/assert";
import { scaffoldApp } from "./scaffold.ts";

const files = [
  { path: "main.ts", bytes: new TextEncoder().encode("// {{APP}}\n") },
  { path: "src/items.ts", bytes: new TextEncoder().encode("template\n") },
];

Deno.test("이미 있는 앱 폴더의 파일은 덮지 않고 빠진 파일만 채운다", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/main.ts`, "mine\n");
    const result = await scaffoldApp({ files, dir, app: "demo" });
    assertEquals(result.ok && result.value.files, ["src/items.ts"]);
    assertEquals(await Deno.readTextFile(`${dir}/main.ts`), "mine\n");
    assertEquals(await Deno.readTextFile(`${dir}/src/items.ts`), "template\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

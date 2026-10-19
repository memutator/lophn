import { assertEquals } from "@std/assert";
import { checkSource } from "./check-source.ts";

Deno.test("core main graph의 bare fetch는 check가 막는다", async () => {
  const root = await Deno.makeTempDir();
  try {
    const put = async (file: string, text: string) => {
      await Deno.mkdir(`${root}/${file.slice(0, file.lastIndexOf("/"))}`, {
        recursive: true,
      });
      await Deno.writeTextFile(`${root}/${file}`, text);
    };
    await put(
      "packages/core/main/daemon/main.ts",
      'import "../../x/call.ts";\n',
    );
    await put(
      "packages/core/x/call.ts",
      "export const a = (deps) => deps.fetch('u');\nexport const b = () => fetch('u');\n",
    );
    // main에서 import로 닿지 않는 child worker 쪽 file은 graph 밖이다.
    await put(
      "packages/core/x/worker.ts",
      "export const c = () => fetch('u');\n",
    );
    const issues = (await checkSource(root)).filter((i) =>
      i.file.startsWith("packages/core/x/")
    );
    assertEquals(
      issues.map((i) => `${i.file}:${i.line}:${i.rule}`),
      ["packages/core/x/call.ts:2:EXTERNAL_FETCH"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

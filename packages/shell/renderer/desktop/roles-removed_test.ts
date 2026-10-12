import { assert, assertEquals } from "@std/assert";

const read = (path: string) =>
  Deno.readTextFile(new URL(path, import.meta.url));

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(new URL(path, import.meta.url));
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

Deno.test("shell/desktop#R28: Roles 화면 폴더와 작업대 Operator 안내 파일이 없다", async () => {
  assertEquals(await exists("./lophn-space/roles"), false);
  assertEquals(await exists("../workspace/operator-entry.tsx"), false);
});

Deno.test("shell/desktop#R28: #roles 시작 자리와 roles 통로가 desktop 배선에 없다", async () => {
  const entry = await read("./entry.tsx");
  assert(!entry.includes("#roles"));
  assert(!entry.includes("coreRolesSource"));
  const main = await read("./main.tsx");
  assert(!main.includes("RolesSource"));
  assert(!main.includes("onOpenOperator"));
  assert(!main.includes('openLophn("roles")'));
  const router = await read("./router.ts");
  assert(!router.includes("roles"));
});

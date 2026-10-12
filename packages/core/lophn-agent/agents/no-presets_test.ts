import { assert, assertEquals } from "@std/assert";
import { ROLE_CAPS } from "./mod.ts";

// lophn-agent/agents#R1 [agent-R12]: preset 판과 그 모듈은 없어졌다. 역할 상한만 agents에 남아
// built-in 정의가 쓴다. 옛 모듈을 부르는 import가 어느 코드에도 남지 않았는지 소스를 훑어 본다.

const ROOTS = ["../../../"].map((path) => new URL(path, import.meta.url));

function* sources(directory: URL): Generator<URL> {
  for (const entry of Deno.readDirSync(directory)) {
    const child = new URL(
      `${entry.name}${entry.isDirectory ? "/" : ""}`,
      directory,
    );
    if (entry.isDirectory) {
      if (entry.name !== "node_modules" && entry.name !== "testdata") {
        yield* sources(child);
      }
    } else if (/\.(ts|tsx)$/.test(entry.name)) yield child;
  }
}

Deno.test("lophn-agent/agents#R1 [agent-R12]: the presets module is gone, no code imports it and the role caps stay in agents", () => {
  assertEquals(
    Array.from(
      Deno.readDirSync(new URL("../", import.meta.url)),
    ).some((entry) => entry.name === "presets"),
    false,
  );
  const importing: string[] = [];
  for (const root of ROOTS) {
    for (const file of sources(root)) {
      if (file.pathname === new URL(import.meta.url).pathname) continue;
      if (
        /lophn-agent\/presets\/|["']\.\.?\/(\.\.\/)*presets\/mod\.ts["']/.test(
          Deno.readTextFileSync(file),
        )
      ) importing.push(file.pathname);
    }
  }
  assertEquals(importing, []);
  assert(ROLE_CAPS.get("operator") !== undefined);
});

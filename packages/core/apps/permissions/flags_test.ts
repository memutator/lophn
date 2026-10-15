import { assert, assertEquals } from "@std/assert";
import { appFlags } from "./flags.ts";

Deno.test("앱 process는 자기 DB 파일 밖에 쓰지 못한다", () => {
  const flags = appFlags(
    [],
    { bundle: "/b", data: "/d/app" },
    { ports: [] },
    [],
  );
  assert(flags.ok);
  const write = flags.value.args.filter((arg) =>
    arg.startsWith("--allow-write=")
  );
  assertEquals(write, [
    "--allow-write=/d/app/app.sqlite,/d/app/app.sqlite-journal,/d/app/app.sqlite-shm,/d/app/app.sqlite-wal",
  ]);
});

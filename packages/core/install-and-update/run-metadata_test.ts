import { assertEquals } from "@std/assert";
import { writeUserToken } from "./run-metadata.ts";

Deno.test("user token file은 token 원문만 담고 소유자만 읽고 쓴다(0600)", async () => {
  const runDir = await Deno.makeTempDir();
  try {
    // 앞 core가 넓은 mode로 남긴 file의 mode가 이어지면 안 된다.
    await Deno.writeTextFile(`${runDir}/user-token`, "old", { mode: 0o644 });
    await Deno.chmod(`${runDir}/user-token`, 0o644);
    const written = await writeUserToken(runDir, "tok-abc");
    assertEquals(written.ok, true);
    const info = await Deno.stat(`${runDir}/user-token`);
    assertEquals((info.mode ?? 0) & 0o777, 0o600);
    assertEquals(await Deno.readTextFile(`${runDir}/user-token`), "tok-abc");
  } finally {
    await Deno.remove(runDir, { recursive: true });
  }
});

import { assertEquals } from "@std/assert";
import { join } from "node:path";
import { type Mode, resolveInPlace } from "./scope.ts";

Deno.test("file tool은 place 폴더 밖과 밖으로 나가는 symlink를 거절한다", async () => {
  const temp = await Deno.makeTempDir();
  try {
    const place = join(temp, "place");
    const outside = join(temp, "outside");
    await Deno.mkdir(join(place, "sub"), { recursive: true });
    await Deno.mkdir(outside);
    await Deno.writeTextFile(join(place, "inside.txt"), "in");
    await Deno.writeTextFile(join(outside, "secret.txt"), "out");
    await Deno.symlink(outside, join(place, "link"));
    await Deno.symlink(join(outside, "secret.txt"), join(place, "linkfile"));
    await Deno.symlink(join(outside, "missing"), join(place, "dangling"));
    await Deno.symlink(join(place, "inside.txt"), join(place, "same"));

    const roots = { read: [place], write: [place] };
    const cases: [string, string, Mode, boolean][] = [
      ["상대 경로", "inside.txt", "read", true],
      ["새 파일", "sub/new.txt", "write", true],
      ["없는 폴더 아래 새 파일", "a/b/new.txt", "write", true],
      ["안쪽 절대 경로", join(place, "inside.txt"), "read", true],
      ["폴더 안을 가리키는 symlink", "same", "read", true],
      ["..로 나감", "../outside/secret.txt", "read", false],
      [
        "안에서 ..로 나갔다 들어옴",
        "sub/../../outside/secret.txt",
        "read",
        false,
      ],
      ["바깥 절대 경로", join(outside, "secret.txt"), "read", false],
      ["밖을 가리키는 폴더 symlink", "link/secret.txt", "read", false],
      [
        "밖을 가리키는 폴더 symlink 아래 새 파일",
        "link/new.txt",
        "write",
        false,
      ],
      ["밖을 가리키는 파일 symlink", "linkfile", "write", false],
      ["끊어진 symlink에 쓰기", "dangling", "write", false],
    ];
    for (const [name, path, mode, allowed] of cases) {
      const resolved = await resolveInPlace(roots, path, mode);
      assertEquals(resolved.ok, allowed, name);
      if (!resolved.ok) assertEquals(resolved.error.code, "forbidden", name);
    }

    // 읽기만 열린 place(lophn)는 쓰기를 거절한다.
    const readOnly = { read: [place], write: [] };
    assertEquals(
      (await resolveInPlace(readOnly, "inside.txt", "read")).ok,
      true,
    );
    assertEquals(
      (await resolveInPlace(readOnly, "inside.txt", "write")).ok,
      false,
    );
  } finally {
    await Deno.remove(temp, { recursive: true });
  }
});

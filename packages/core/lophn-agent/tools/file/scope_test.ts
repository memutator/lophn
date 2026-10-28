import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type Mode, resolveInPlace } from "./scope.ts";

test("file tool은 place 폴더 밖과 밖으로 나가는 symlink를 거절한다", async () => {
  const temp = await mkdtemp(join(tmpdir(), "lophn-scope-"));
  try {
    const place = join(temp, "place");
    const outside = join(temp, "outside");
    await mkdir(join(place, "sub"), { recursive: true });
    await mkdir(outside);
    await writeFile(join(place, "inside.txt"), "in");
    await writeFile(join(outside, "secret.txt"), "out");
    await symlink(outside, join(place, "link"));
    await symlink(join(outside, "secret.txt"), join(place, "linkfile"));
    await symlink(join(outside, "missing"), join(place, "dangling"));
    await symlink(join(place, "inside.txt"), join(place, "same"));

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
      assert.equal(resolved.ok, allowed, name);
      if (!resolved.ok) assert.equal(resolved.error.code, "forbidden", name);
    }

    // 읽기만 열린 place(lophn)는 쓰기를 거절한다.
    const readOnly = { read: [place], write: [] };
    assert.equal(
      (await resolveInPlace(readOnly, "inside.txt", "read")).ok,
      true,
    );
    assert.equal(
      (await resolveInPlace(readOnly, "inside.txt", "write")).ok,
      false,
    );

    // 폴더 없는 project place의 session: 상대 경로는 base(project의 data 폴더)에서 풀리고 base 자체는 허락이 아니다.
    const data = join(temp, "projects", "prj_a");
    await mkdir(join(data, "skills"), { recursive: true });
    const noFolder = {
      read: [join(data, "skills"), join(data, "kinds.yaml")],
      write: [join(data, "skills"), join(data, "kinds.yaml")],
      base: data,
    };
    const skill = await resolveInPlace(noFolder, "skills/x/SKILL.md", "write");
    assert.deepStrictEqual(
      skill.ok && skill.value.path,
      join(await realpath(data), "skills", "x", "SKILL.md"),
    );
    const kindsFile = await resolveInPlace(noFolder, "kinds.yaml", "write");
    assert.deepStrictEqual(
      kindsFile.ok && kindsFile.value.path,
      join(await realpath(data), "kinds.yaml"),
    );
    assert.equal(
      (await resolveInPlace(noFolder, "other.md", "write")).ok,
      false,
    );
  } finally {
    await rm(temp, { recursive: true });
  }
});

test("파일 entry는 그 파일(아직 없는 파일 포함)만 열고 같은 폴더의 다른 파일과 하위 경로는 거절한다", async () => {
  const temp = await mkdtemp(join(tmpdir(), "lophn-scope-"));
  try {
    const project = join(temp, "projects", "p");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "extensions.json"), "{}");
    const kinds = join(project, "kinds.yaml");
    const cases: [string, string, boolean][] = [
      ["아직 없는 파일", kinds, true],
      ["같은 폴더의 다른 파일", join(project, "extensions.json"), false],
      ["같은 폴더의 새 파일", join(project, "other.yaml"), false],
      ["파일 아래 경로", join(kinds, "x"), false],
      ["밖", join(temp, "kinds.yaml"), false],
    ];
    for (const mode of ["read", "write"] as const) {
      for (const [name, path, allowed] of cases) {
        const resolved = await resolveInPlace(
          { read: [kinds], write: [kinds] },
          path,
          mode,
        );
        assert.equal(resolved.ok, allowed, `${mode} ${name}`);
      }
    }

    // 있는 파일이 되어도 root는 부모 폴더, relative는 파일 이름이다(rewind 기록이 쓴다).
    await writeFile(kinds, "kinds: []");
    const resolved = await resolveInPlace(
      { read: [kinds], write: [kinds] },
      kinds,
      "write",
    );
    assert.deepStrictEqual(
      resolved.ok && [resolved.value.root, resolved.value.relative],
      [await realpath(project), "kinds.yaml"],
    );
  } finally {
    await rm(temp, { recursive: true });
  }
});

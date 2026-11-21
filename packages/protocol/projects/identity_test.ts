import assert from "node:assert/strict";
import { test } from "node:test";
import { remoteKeyOf } from "./identity.ts";

test("remote URL의 자격(user:token@)이 key와 url 어디에도 남지 않는다", () => {
  for (const url of [
    "https://me:ghp_secret@github.com/Me/Notes.git",
    "https://ghp_secret@github.com/Me/Notes.git/",
    "https://me:p@ss@ghp_secret@github.com:443/Me/Notes",
    "ssh://git:ghp_secret@github.com:22/Me/Notes.git",
  ]) {
    const remote = remoteKeyOf([{ name: "origin", url }], "");
    assert.ok(remote !== null, url);
    assert.deepStrictEqual(remote.key, "github.com/me/notes");
    assert.ok(!remote.url.includes("secret"), remote.url);
    assert.ok(!remote.url.includes("p@ss"), remote.url);
  }
  // scp 꼴의 사용자 이름은 자격이 아니라 남긴다. 하위 폴더 project는 key가 갈린다.
  assert.deepStrictEqual(
    remoteKeyOf(
      [
        { name: "backup", url: "/mnt/backup/notes.git" },
        { name: "origin", url: "git@GitHub.com:Me/Notes.git" },
      ],
      "apps/web",
    ),
    { key: "github.com/me/notes#apps/web", url: "git@GitHub.com:Me/Notes.git" },
  );
});

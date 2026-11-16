import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseIdentityFile,
  remoteKeyOf,
  serializeIdentityFile,
} from "./identity.ts";

const OLDER = "pri_01hzzzzzzzzzzzzzzzzzzzzzzz";
const NEWER = "pri_02aaaaaaaaaaaaaaaaaaaaaaaa";

function conflicted(top: string, bottom: string, base?: string): string {
  return [
    "{",
    '  "lophn_project": 1,',
    "<<<<<<< HEAD",
    `  "id": "${top}"`,
    ...(base === undefined ? [] : ["||||||| merged common ancestors"]),
    ...(base === undefined ? [] : [`  "id": "${base}"`]),
    "=======",
    `  "id": "${bottom}"`,
    ">>>>>>> other",
    "}",
    "",
  ].join("\n");
}

test("충돌 표지가 든 file은 어느 쪽 순서로 놓여도 가장 작은 id로 읽히고, 판이 더 높은 file은 unreadable이다", () => {
  assert.deepStrictEqual(parseIdentityFile(serializeIdentityFile(OLDER)), {
    kind: "ok",
    id: OLDER,
  });
  const expected = { kind: "conflict", id: OLDER, ids: [OLDER, NEWER] };
  assert.deepStrictEqual(parseIdentityFile(conflicted(OLDER, NEWER)), expected);
  assert.deepStrictEqual(parseIdentityFile(conflicted(NEWER, OLDER)), expected);
  // diff3의 base 쪽 id는 어느 쪽도 아니다.
  const base = "pri_00000000000000000000000001";
  assert.deepStrictEqual(
    parseIdentityFile(conflicted(NEWER, OLDER, base)),
    expected,
  );
  assert.deepStrictEqual(
    parseIdentityFile(JSON.stringify({ lophn_project: 2, id: OLDER })),
    { kind: "unreadable", reason: "newer_format" },
  );
});

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

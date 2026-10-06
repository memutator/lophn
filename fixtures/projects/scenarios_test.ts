import assert from "node:assert/strict";
import { lstat, readFile, readlink, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  addGitDir,
  addLophnDataDir,
  addOutsideSymlink,
  copyFixture,
  deleteAndRecreate,
  editExternally,
  FIXTURE_NAMES,
  fixturePath,
  modifyKeepingSizeAndMtime,
  removeFixtureCopy,
  removePermission,
  renameFile,
} from "./scenarios.ts";

const EXPECTED_FILES: Record<(typeof FIXTURE_NAMES)[number], string[]> = {
  "notes-basic": [
    ".gitignore",
    "index.md",
    "setext.md",
    "fenced.md",
    "multi-h1.md",
    "dup-anchor.md",
    "notes.txt",
    "private.secret.md",
    "ignored/hidden.md",
    "encoding/bom-crlf.md",
    "encoding/nfd-hangul.md",
    "deep/outer.md",
    "deep/sub/inner.md",
  ],
  "multi-folder": [
    "root-a/notes/plan.md",
    "root-a/nested/inner-root/readme.md",
    "root-b/notes/plan.md",
  ],
  "mixed-formats": [
    "page.html",
    "doc.xhtml",
    "plain.txt",
    "sample.pdf",
    "pixel.png",
    "blob.bin",
  ],
  "weekly-report": [
    "P001.md",
    "P002.md",
    "v0.2.md",
    "v0.9.md",
    "v0.10.md",
    "v0.2.1.md",
    "kickoff-notes.md",
  ],
  "korean-search": [
    "migration.md",
    "glossary.md",
  ],
  "two-apps": [
    "app-a/blueprint.json",
    "app-a/main.ts",
    "app-a/docs/plan.md",
    "app-b/blueprint.json",
    "app-b/main.ts",
    "app-b/docs/plan.md",
  ],
};

async function withCopy(
  name: (typeof FIXTURE_NAMES)[number],
  body: (root: string) => Promise<void>,
): Promise<void> {
  const root = await copyFixture(name);
  try {
    await body(root);
  } finally {
    await removeFixtureCopy(root);
  }
}

// node:fs/promises는 OS 오류를 errno 숫자로 준다.
function isAccessDenied(error: unknown): boolean {
  if (error instanceof Deno.errors.PermissionDenied) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return code === "EACCES" || code === "EPERM";
}

Deno.test("fixtures/projects: 복사가 fixture 파일을 한 개도 빠뜨리지 않는다", async () => {
  for (const name of FIXTURE_NAMES) {
    await withCopy(name, async (root) => {
      for (const rel of EXPECTED_FILES[name]) {
        const info = await lstat(join(root, rel));
        assert.ok(info.isFile(), `${name}/${rel} 가 파일이 아니다`);
      }
    });
  }
});

Deno.test("fixtures/projects: BOM과 CRLF이 바이트 그대로 복사된다", async () => {
  await withCopy("notes-basic", async (root) => {
    const original = new Uint8Array(
      await readFile(join(fixturePath("notes-basic"), "encoding/bom-crlf.md")),
    );
    const copied = new Uint8Array(
      await readFile(join(root, "encoding/bom-crlf.md")),
    );
    assert.deepEqual([...copied], [...original]);
    assert.equal(copied[0], 0xef);
    assert.equal(copied[1], 0xbb);
    assert.equal(copied[2], 0xbf);
    const text = new TextDecoder().decode(copied);
    const lfOnly = text.replaceAll("\r\n", "");
    assert.equal(lfOnly.includes("\r"), false);
    assert.equal(text.includes("\r\n"), true);
  });
});

Deno.test("fixtures/projects: 분해형 한글 fixture는 NFC 정규화 결과와 바이트가 다르다", async () => {
  await withCopy("notes-basic", async (root) => {
    const path = join(root, "encoding/nfd-hangul.md");
    const onDisk = new Uint8Array(await readFile(path));
    const nfc = new TextEncoder().encode(
      new TextDecoder().decode(onDisk).normalize("NFC"),
    );
    assert.notDeepEqual(
      [...onDisk],
      [...nfc],
      "fixture가 이미 NFC면 분해형 한글을 검사할 수 없다",
    );
    assert.ok(onDisk.length > nfc.length);
  });
});

Deno.test("fixtures/projects: PNG fixture는 바이트 그대로 복사된다", async () => {
  await withCopy("mixed-formats", async (root) => {
    const original = await readFile(
      join(fixturePath("mixed-formats"), "pixel.png"),
    );
    const copied = await readFile(join(root, "pixel.png"));
    assert.deepEqual([...new Uint8Array(copied)], [
      ...new Uint8Array(original),
    ]);
    assert.deepEqual(
      [...new Uint8Array(copied).slice(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    );
  });
});

Deno.test("fixtures/projects: 원본의 _gitignore가 사본에서 .gitignore가 된다", async () => {
  await withCopy("notes-basic", async (root) => {
    const rules = new TextDecoder().decode(
      await readFile(join(root, ".gitignore")),
    );
    assert.ok(rules.includes("ignored/"));
    assert.ok(rules.includes("*.secret.md"));
    await assert.rejects(() => lstat(join(root, "_gitignore")));
    // 저장소 원본은 그대로 `_gitignore`로 남는다.
    const sourceRules = new TextDecoder().decode(
      await readFile(join(fixturePath("notes-basic"), "_gitignore")),
    );
    assert.ok(sourceRules.includes("ignored/"));
  });
});

Deno.test("fixtures/projects: 바깥에서 고친 내용이 사본에 남는다", async () => {
  await withCopy("notes-basic", async (root) => {
    await editExternally(root, "index.md", "# 바꾼 제목\n");
    const text = new TextDecoder().decode(
      await readFile(join(root, "index.md")),
    );
    assert.equal(text, "# 바꾼 제목\n");
  });
});

Deno.test("fixtures/projects: 지우고 같은 경로에 다시 만든 파일이 새 inode로 남는다", async () => {
  await withCopy("notes-basic", async (root) => {
    const path = join(root, "index.md");
    const before = await stat(path);
    await deleteAndRecreate(root, "index.md", "# 새로 만든 문서\n");
    const after = await stat(path);
    assert.equal(after.size, (await readFile(path)).byteLength);
    assert.notEqual(after.ino, before.ino);
    const text = new TextDecoder().decode(await readFile(path));
    assert.equal(text, "# 새로 만든 문서\n");
  });
});

Deno.test("fixtures/projects: 이름 바꾼 뒤 옛 자리에는 파일이 없다", async () => {
  await withCopy("notes-basic", async (root) => {
    await renameFile(root, "index.md", "moved/index.md");
    await assert.rejects(() => lstat(join(root, "index.md")));
    const text = new TextDecoder().decode(
      await readFile(join(root, "moved/index.md")),
    );
    assert.ok(text.includes("# 프로젝트 노트"));
  });
});

Deno.test("fixtures/projects: root 밖을 가리키는 symlink가 만들어진다", async () => {
  await withCopy("notes-basic", async (root) => {
    const outside = await addOutsideSymlink(root, "escape");
    try {
      const link = join(root, "escape");
      assert.ok((await lstat(link)).isSymbolicLink());
      assert.equal(await readlink(link), outside);
      assert.equal(outside.startsWith(root), false);
      const target = new TextDecoder().decode(
        await readFile(join(outside, "outside.md")),
      );
      assert.ok(target.includes("# 루트 밖 문서"));
    } finally {
      await removeFixtureCopy(outside);
    }
  });
});

Deno.test("fixtures/projects: .git 폴더와 lophn 데이터 폴더가 만들어진다", async () => {
  await withCopy("notes-basic", async (root) => {
    const git = await addGitDir(root);
    assert.ok((await stat(join(git, "HEAD"))).isFile());
    assert.ok((await stat(join(git, "config"))).isFile());
    assert.ok((await stat(join(git, "notes.md"))).isFile());

    const data = await addLophnDataDir(root);
    assert.ok((await stat(join(data, "lophn.db"))).isFile());
    assert.ok((await stat(join(data, "documents", "x.md"))).isFile());
  });
});

Deno.test(
  "fixtures/projects: 같은 size와 mtime을 두고 바이트만 바꾸면 관측이 어렵다",
  async () => {
    await withCopy("notes-basic", async (root) => {
      const path = join(root, "index.md");
      const before = await stat(path);
      const beforeBytes = new Uint8Array(await readFile(path));
      await modifyKeepingSizeAndMtime(root, "index.md");
      const after = await stat(path);
      const afterBytes = new Uint8Array(await readFile(path));
      assert.equal(after.size, before.size);
      assert.equal(afterBytes.length, beforeBytes.length);
      assert.notDeepEqual([...afterBytes], [...beforeBytes]);
      // 파일 시스템이 mtime을 밀리초 아래까지 주는데 utimes는 밀리초로 되돌린다.
      assert.ok(Math.abs(after.mtimeMs - before.mtimeMs) < 1);
    });
  },
);

Deno.test("fixtures/projects: 권한을 뺀 파일은 읽지 못하고 되돌리면 읽는다", async () => {
  await withCopy("notes-basic", async (root) => {
    const restore = await removePermission(root, "index.md");
    try {
      // uid 0은 DAC를 건너뛰므로 못 읽는지 여부로 판단한다(uid를 보려면 --allow-sys가 필요하다).
      const readable = await readFile(join(root, "index.md")).then(
        () => true,
        () => false,
      );
      if (readable) {
        assert.equal(
          Deno.uid(),
          0,
          "권한을 뺀 파일을 읽을 수 있는 건 uid 0이어야 한다",
        );
      } else {
        await assert.rejects(
          () => readFile(join(root, "index.md")),
          isAccessDenied,
        );
      }
    } finally {
      await restore();
    }
    const text = new TextDecoder().decode(
      await readFile(join(root, "index.md")),
    );
    assert.ok(text.includes("# 프로젝트 노트"));
  });
});

Deno.test("fixtures/projects: 사본을 지울 때 권한을 되돌린 뒤 임시 폴더를 없앤다", async () => {
  const root = await copyFixture("notes-basic");
  // 권한을 되돌리는 함수를 버리고, 지우는 쪽이 되돌리도록 둔다.
  await removePermission(root, "index.md");
  await removeFixtureCopy(root);
  await assert.rejects(() => lstat(root));
});

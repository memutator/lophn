import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FILE_VIEW_MAX_BYTES } from "../../ipc/files.ts";
import {
  createFileAdapter,
  type FileAdapterOptions,
  sha256,
} from "./file-adapter.ts";

async function setup(
  fs?: FileAdapterOptions["fs"],
  trash?: FileAdapterOptions["trash"],
) {
  const dir = await mkdtemp(join(tmpdir(), "lophn-file-adapter-"));
  // 가짜 휴지통은 dir 밖 폴더로 옮긴다. 실제 휴지통처럼 원래 자리에서는 사라진다.
  const bin = await mkdtemp(join(tmpdir(), "lophn-file-trash-"));
  const trashed: string[] = [];
  const adapter = createFileAdapter({
    dataRoot: join(dir, "root"),
    folders: () => Promise.resolve([dir]),
    notify: () => {},
    trash:
      trash ??
      (async (path) => {
        trashed.push(path);
        await rename(path, join(bin, `${trashed.length}`));
      }),
    reveal: () => {},
    fs,
  });
  return {
    dir,
    adapter,
    trashed,
    bin,
    done: () =>
      Promise.all([
        rm(dir, { recursive: true, force: true }),
        rm(bin, { recursive: true, force: true }),
      ]).then(() => {}),
  };
}

const hashOf = (text: string) => sha256(new TextEncoder().encode(text));

test("write는 기대 hash가 디스크와 다르면 conflict이고 원본을 바꾸지 않는다", async () => {
  const { dir, adapter, done } = await setup();
  try {
    const file = join(dir, "a.md");
    await writeFile(file, "disk");
    const cases: [string, string | null, string][] = [
      // 설명, 기대 hash, 쓰기 뒤 파일 내용
      ["같은 hash", hashOf("disk"), "new"],
      ["다른 hash", hashOf("other"), "disk"],
      ["null인데 파일이 있음", null, "disk"],
    ];
    for (const [label, base, after] of cases) {
      await writeFile(file, "disk");
      const reply = await adapter.write(1, {
        path: file,
        base_hash: base,
        text: "new",
      });
      assert.equal(reply.ok, after === "new", label);
      if (!reply.ok) assert.equal(reply.code, "conflict", label);
      else assert.equal(reply.value.hash, hashOf("new"), label);
      assert.equal(await readFile(file, "utf8"), after, label);
    }
    // 새 파일은 기대 hash가 null일 때만 만든다. 없는 파일에 hash를 기대하면 conflict다.
    const fresh = join(dir, "fresh.md");
    const missing = await adapter.write(1, {
      path: fresh,
      base_hash: hashOf("x"),
      text: "t",
    });
    assert.deepEqual(missing, { ok: false, code: "conflict" });
    const created = await adapter.write(1, {
      path: fresh,
      base_hash: null,
      text: "t",
    });
    assert.equal(created.ok, true);
    assert.equal(await readFile(fresh, "utf8"), "t");
  } finally {
    await done();
  }
});

test("쓰기가 끊겨도 원본이 남고 임시 파일은 치운다", async () => {
  for (const broken of ["writeTemp", "rename"] as const) {
    const { dir, adapter, done } = await setup(
      broken === "writeTemp"
        ? {
            writeTemp: async (path) => {
              await writeFile(path, "half");
              throw new Error("disk full");
            },
          }
        : { rename: () => Promise.reject(new Error("interrupted")) },
    );
    try {
      const file = join(dir, "a.md");
      await writeFile(file, "disk");
      const reply = await adapter.write(1, {
        path: file,
        base_hash: hashOf("disk"),
        text: "new",
      });
      assert.equal(reply.ok, false, broken);
      assert.equal(await readFile(file, "utf8"), "disk", broken);
      assert.deepEqual(await readdir(dir), ["a.md"], broken);
    } finally {
      await done();
    }
  }
});

test("지우기는 휴지통으로 가고, 휴지통을 못 쓰면 아무것도 지우지 않는다", async () => {
  const { dir, adapter, trashed, bin, done } = await setup();
  const broken = await setup(undefined, () =>
    Promise.reject(new Error("no trash")),
  );
  try {
    // 비어 있지 않은 폴더도 휴지통으로 간다.
    const folder = join(dir, "notes");
    await mkdir(folder);
    await writeFile(join(folder, "a.md"), "keep");
    assert.deepEqual(await adapter.delete({ path: folder }), {
      ok: true,
      value: {},
    });
    assert.deepEqual(trashed, [folder]);
    assert.equal(await readFile(join(bin, "1", "a.md"), "utf8"), "keep");

    // 휴지통이 실패하면 영구 삭제로 되돌아가지 않는다.
    const kept = join(broken.dir, "kept.md");
    await writeFile(kept, "keep");
    const loose = join(broken.dir, "folder");
    await mkdir(loose);
    await writeFile(join(loose, "b.md"), "keep");
    for (const path of [kept, loose]) {
      assert.deepEqual(await broken.adapter.delete({ path }), {
        ok: false,
        code: "unavailable",
      });
    }
    assert.equal(await readFile(kept, "utf8"), "keep");
    assert.equal(await readFile(join(loose, "b.md"), "utf8"), "keep");
  } finally {
    await done();
    await broken.done();
  }
});

test("새로 만들기는 이미 있는 파일과 폴더를 덮어쓰지 않고 위쪽 폴더는 만든다", async () => {
  const { dir, adapter, done } = await setup();
  try {
    const file = join(dir, "a.md");
    await writeFile(file, "mine");
    const folder = join(dir, "docs");
    await mkdir(folder);
    await writeFile(join(folder, "x.md"), "mine");
    for (const [path, kind] of [
      [file, "file"],
      [file, "folder"],
      [folder, "folder"],
      [folder, "file"],
    ] as const) {
      assert.deepEqual(
        await adapter.create({ path, kind }),
        {
          ok: false,
          code: "conflict",
        },
        `${kind} ${path}`,
      );
    }
    assert.equal(await readFile(file, "utf8"), "mine");
    assert.equal(await readFile(join(folder, "x.md"), "utf8"), "mine");

    const deep = join(dir, "a", "b", "c.md");
    assert.equal((await adapter.create({ path: deep, kind: "file" })).ok, true);
    assert.equal(await readFile(deep, "utf8"), "");
    assert.equal(
      (await adapter.create({ path: join(dir, "a", "d"), kind: "folder" })).ok,
      true,
    );
    assert.equal((await stat(join(dir, "a", "d"))).isDirectory(), true);
  } finally {
    await done();
  }
});

test("옮기기는 같은 이름이 있는 자리와 자기 안을 거절하고 아무것도 바꾸지 않는다", async () => {
  const { dir, adapter, done } = await setup();
  try {
    await mkdir(join(dir, "one", "inner"), { recursive: true });
    await mkdir(join(dir, "two"));
    await writeFile(join(dir, "one", "a.md"), "one");
    await writeFile(join(dir, "two", "a.md"), "two");
    const cases: [string, string, string][] = [
      // 설명, from, to
      ["같은 이름의 파일", join(dir, "one", "a.md"), join(dir, "two", "a.md")],
      ["같은 이름의 폴더", join(dir, "one"), join(dir, "two")],
      ["자기 안", join(dir, "one"), join(dir, "one", "inner", "one")],
    ];
    for (const [label, from, to] of cases) {
      const reply = await adapter.rename({ from, to });
      assert.equal(reply.ok, false, label);
    }
    assert.equal(await readFile(join(dir, "one", "a.md"), "utf8"), "one");
    assert.equal(await readFile(join(dir, "two", "a.md"), "utf8"), "two");
    assert.deepEqual(await readdir(join(dir, "one", "inner")), []);

    const moved = await adapter.rename({
      from: join(dir, "one", "a.md"),
      to: join(dir, "two", "b.md"),
    });
    assert.equal(moved.ok, true);
    assert.equal(await readFile(join(dir, "two", "b.md"), "utf8"), "one");
  } finally {
    await done();
  }
});

test("복사와 writeBytes는 이미 있는 대상을 덮지 않는다(사용자 file이 남는다)", async () => {
  const { dir, adapter, done } = await setup();
  try {
    const from = join(dir, "one", "a.md");
    const to = join(dir, "two", "a.md");
    await mkdir(join(dir, "one"), { recursive: true });
    await mkdir(join(dir, "two"));
    await writeFile(from, "one");
    await writeFile(to, "two");
    assert.deepEqual(await adapter.copy({ from, to }), {
      ok: false,
      code: "conflict",
    });
    assert.equal(await readFile(to, "utf8"), "two");

    // 폴더 복사는 아래 file까지 같이 온다.
    const tree = join(dir, "tree");
    await mkdir(join(tree, "inner"), { recursive: true });
    await writeFile(join(tree, "inner", "x.md"), "x");
    assert.deepEqual(
      await adapter.copy({ from: tree, to: join(dir, "deep", "copy") }),
      {
        ok: true,
        value: {},
      },
    );
    assert.equal(
      await readFile(join(dir, "deep", "copy", "inner", "x.md"), "utf8"),
      "x",
    );

    // 이미 있는 폴더도 덮지 않는다.
    const taken = join(dir, "taken");
    await mkdir(taken);
    await writeFile(join(taken, "keep.md"), "keep");
    assert.deepEqual(await adapter.copy({ from: tree, to: taken }), {
      ok: false,
      code: "conflict",
    });
    assert.deepEqual(await readdir(taken), ["keep.md"]);

    // writeBytes는 새 file만 만든다.
    const bytes = new Uint8Array([1, 2, 3]);
    assert.deepEqual(await adapter.writeBytes({ path: to, bytes }), {
      ok: false,
      code: "conflict",
    });
    assert.equal(await readFile(to, "utf8"), "two");
    const fresh = join(dir, "paste", "new.png");
    assert.deepEqual(await adapter.writeBytes({ path: fresh, bytes }), {
      ok: true,
      value: { hash: sha256(bytes) },
    });
    assert.deepEqual(new Uint8Array(await readFile(fresh)), bytes);
  } finally {
    await done();
  }
});

test("writeBytes는 상한을 넘으면 too_large이고 secret 파일을 거절한다", async () => {
  const { dir, adapter, done } = await setup();
  try {
    const big = join(dir, "big.png");
    assert.deepEqual(
      await adapter.writeBytes({
        path: big,
        bytes: new Uint8Array(FILE_VIEW_MAX_BYTES + 1),
      }),
      { ok: false, code: "too_large" },
    );
    assert.equal(
      await stat(big).then(
        () => true,
        () => false,
      ),
      false,
    );

    const secrets = join(dir, "root", "secrets.json");
    assert.deepEqual(
      await adapter.copy({ from: secrets, to: join(dir, "x") }),
      {
        ok: false,
        code: "forbidden",
      },
    );
    assert.deepEqual(
      await adapter.writeBytes({ path: secrets, bytes: new Uint8Array([1]) }),
      { ok: false, code: "forbidden" },
    );
  } finally {
    await done();
  }
});

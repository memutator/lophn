import { assert, assertEquals, assertFalse } from "@std/assert";
import { createHash } from "node:crypto";
import { denoFileOps } from "./adapters/file-ops.ts";
import { WRITE_TEMP_PREFIX } from "../registry/mod.ts";
import { createFileSerializer, FileOpFault, type FileOps } from "./file-ops.ts";
import {
  deleteFile,
  type FileDeps,
  renameFile,
  writeFile,
  type WriteInput,
} from "./files.ts";

const encoder = new TextEncoder();

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function* chunks(text: string): AsyncIterable<Uint8Array> {
  const bytes = encoder.encode(text);
  // 여러 chunk로 흘려서 stream 쓰기도 지나가게 한다.
  for (let at = 0; at < bytes.length; at += 4) {
    yield bytes.subarray(at, at + 4);
  }
}

function depsOver(ops: FileOps = denoFileOps()): FileDeps {
  let counter = 0;
  return {
    ops,
    serializer: createFileSerializer(),
    clock: { nowIso: () => "2026-10-06T00:00:00.000Z" },
    token: () => `t${++counter}`,
  };
}

function writing(
  root: string,
  name: string,
  baseHash: string | null,
  text: string,
): WriteInput {
  return {
    root,
    path: `${root}/${name}`,
    baseHash,
    content: chunks(text),
    contentHash: sha(text),
  };
}

async function withRoot(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-files-" }),
  );
  try {
    await run(root);
  } finally {
    await Deno.chmod(root, 0o755).catch(() => {});
    await Deno.remove(root, { recursive: true });
  }
}

async function names(root: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(root)) found.push(entry.name);
  return found.sort();
}

// 포트의 일부 호출을 바꿔 끼운다. 나머지는 실제 파일 시스템이다.
function patched(over: Partial<FileOps>): FileOps {
  return { ...denoFileOps(), ...over };
}

Deno.test("documents/file-tracking#R11: 기존 파일 저장은 base_hash가 맞으면 새 바이트로 바뀌고 관측 결과를 낸다", async () => {
  await withRoot(async (root) => {
    await Deno.writeTextFile(`${root}/a.md`, "one");
    const done = await writeFile(
      depsOver(),
      writing(root, "a.md", sha("one"), "two two"),
    );
    assert(done.ok);
    assertEquals(done.value.outcome, "written");
    assertEquals(done.value.beforeHash, sha("one"));
    assertEquals(done.value.writtenHash, sha("two two"));
    assertEquals(done.value.observedHash, sha("two two"));
    assertEquals(done.value.changedAgain, false);
    assertEquals(done.value.beforePath, `${root}/a.md`);
    assertEquals(await Deno.readTextFile(`${root}/a.md`), "two two");
    assertEquals(await names(root), ["a.md"]);
  });
});

Deno.test("documents/file-tracking#R11: 외부에서 먼저 고친 파일은 시작 대조에서 409 conflict고 외부 내용이 남는다", async () => {
  await withRoot(async (root) => {
    await Deno.writeTextFile(`${root}/a.md`, "mine");
    // 편집기를 연 뒤 밖에서 고쳤다.
    await Deno.writeTextFile(`${root}/a.md`, "external");
    const done = await writeFile(
      depsOver(),
      writing(root, "a.md", sha("mine"), "overwrite"),
    );
    assert(!done.ok);
    assertEquals(done.error.code, "conflict");
    assertEquals(await Deno.readTextFile(`${root}/a.md`), "external");
    assertEquals(await names(root), ["a.md"]);
  });
});

Deno.test("documents/file-tracking#R11: 시작 대조 뒤 교체 직전에 바뀐 파일도 conflict고 덮어쓰지 않는다", async () => {
  await withRoot(async (root) => {
    await Deno.writeTextFile(`${root}/a.md`, "base");
    const real = denoFileOps();
    // 임시 파일을 sync한 뒤(교체 직전 대조 전) 외부 편집기가 저장한다.
    const ops = patched({
      createTemp: async (path, mode) => {
        const temp = await real.createTemp(path, mode);
        return {
          path: temp.path,
          write: (chunk) => temp.write(chunk),
          sync: async () => {
            await temp.sync();
            await Deno.writeTextFile(`${root}/a.md`, "external edit");
          },
          close: () => temp.close(),
        };
      },
    });
    const done = await writeFile(
      depsOver(ops),
      writing(root, "a.md", sha("base"), "mine"),
    );
    assert(!done.ok);
    assertEquals(done.error.code, "conflict");
    assertEquals(await Deno.readTextFile(`${root}/a.md`), "external edit");
    // 임시 파일은 남지 않는다.
    assertEquals(await names(root), ["a.md"]);
  });
});

Deno.test("documents/file-tracking#R11: 교체 직전에 같은 크기·mtime로 바뀐 내용도 hash 재검사가 잡는다", async () => {
  await withRoot(async (root) => {
    await Deno.writeTextFile(`${root}/a.md`, "base");
    const before = await Deno.stat(`${root}/a.md`);
    const real = denoFileOps();
    const ops = patched({
      createTemp: async (path, mode) => {
        const temp = await real.createTemp(path, mode);
        return {
          path: temp.path,
          write: (chunk) => temp.write(chunk),
          sync: async () => {
            await temp.sync();
            // 같은 inode에 같은 길이로 고치고 mtime을 되돌린다.
            await Deno.writeTextFile(`${root}/a.md`, "BASE");
            await Deno.utime(`${root}/a.md`, before.atime!, before.mtime!);
          },
          close: () => temp.close(),
        };
      },
    });
    const done = await writeFile(
      depsOver(ops),
      writing(root, "a.md", sha("base"), "mine"),
    );
    assert(!done.ok);
    assertEquals(done.error.code, "conflict");
    assertEquals(await Deno.readTextFile(`${root}/a.md`), "BASE");
  });
});

Deno.test("documents/file-tracking#R11: 같은 목표의 동시 저장은 줄을 서서 하나만 성공하고 하나는 conflict다", async () => {
  await withRoot(async (root) => {
    await Deno.writeTextFile(`${root}/a.md`, "base");
    const deps = depsOver();
    const [first, second] = await Promise.all([
      writeFile(deps, writing(root, "a.md", sha("base"), "first")),
      writeFile(deps, writing(root, "a.md", sha("base"), "second")),
    ]);
    assertEquals([first.ok, second.ok].filter(Boolean).length, 1);
    const failed = first.ok ? second : first;
    assert(!failed.ok);
    assertEquals(failed.error.code, "conflict");
    assertEquals(
      await Deno.readTextFile(`${root}/a.md`),
      first.ok ? "first" : "second",
    );
  });
});

Deno.test("documents/file-tracking#R11: 새 파일은 목표가 이미 있으면 conflict고, 확인과 설치 사이에 생긴 파일도 덮지 않는다", async () => {
  await withRoot(async (root) => {
    await Deno.writeTextFile(`${root}/exists.md`, "keep");
    const exists = await writeFile(
      depsOver(),
      writing(root, "exists.md", null, "new"),
    );
    assert(!exists.ok);
    assertEquals(exists.error.code, "conflict");
    assertEquals(await Deno.readTextFile(`${root}/exists.md`), "keep");

    // 임시 파일을 만든 뒤 설치 직전에 다른 프로세스가 같은 이름을 만든다.
    const real = denoFileOps();
    const raced = patched({
      install: async (temp, target) => {
        await Deno.writeTextFile(target, "raced in");
        await real.install(temp, target);
      },
    });
    const done = await writeFile(
      depsOver(raced),
      writing(root, "fresh.md", null, "mine"),
    );
    assert(!done.ok);
    assertEquals(done.error.code, "conflict");
    assertEquals(await Deno.readTextFile(`${root}/fresh.md`), "raced in");
    assertEquals(await names(root), ["exists.md", "fresh.md"]);
  });
});

Deno.test("documents/file-tracking#R11: 새 파일 저장은 없는 자리에 설치하고 부모 폴더에 임시 파일을 남기지 않는다", async () => {
  await withRoot(async (root) => {
    const done = await writeFile(
      depsOver(),
      writing(root, "fresh.md", null, "hello"),
    );
    assert(done.ok);
    assertEquals(done.value.beforePath, null);
    assertEquals(done.value.beforeHash, null);
    assertEquals(await Deno.readTextFile(`${root}/fresh.md`), "hello");
    assertEquals(await names(root), ["fresh.md"]);
  });
});

Deno.test("documents/file-tracking#R12: 교체 직전에 끊겨도 완전한 이전 파일이 남고, 교체 직후에 끊겨도 완전한 새 파일이 남는다", async () => {
  await withRoot(async (root) => {
    await Deno.writeTextFile(`${root}/a.md`, "old complete");
    const real = denoFileOps();
    // 프로세스가 죽는 것을 흉내 낸다: 교체 호출 앞에서 던지고 정리도 하지 못한다.
    const diesBefore = patched({
      replace: () => Promise.reject(new Error("killed before replace")),
      remove: () => Promise.reject(new Error("killed")),
    });
    const before = await writeFile(
      depsOver(diesBefore),
      writing(root, "a.md", sha("old complete"), "new complete"),
    );
    assert(!before.ok);
    assertEquals(before.error.code, "unavailable");
    assertEquals(await Deno.readTextFile(`${root}/a.md`), "old complete");

    // 임시 파일이 남았더라도 원본은 온전하고, 임시 파일은 완전한 새 내용이다(부분 본문 아님).
    const leftovers = (await names(root)).filter((name) =>
      name.startsWith(WRITE_TEMP_PREFIX)
    );
    assertEquals(leftovers.length, 1);
    assertEquals(
      await Deno.readTextFile(`${root}/${leftovers[0]}`),
      "new complete",
    );
    await Deno.remove(`${root}/${leftovers[0]}`);

    const diesAfter = patched({
      replace: async (temp, target) => {
        await real.replace(temp, target);
        throw new Error("killed after replace");
      },
    });
    const after = await writeFile(
      depsOver(diesAfter),
      writing(root, "a.md", sha("old complete"), "new complete"),
    );
    // 교체가 일어났는지 현재 파일로 확인한다: 새 파일이 남았으면 쓰기 성공이다.
    assert(after.ok);
    assertEquals(after.value.outcome, "written");
    assertEquals(await Deno.readTextFile(`${root}/a.md`), "new complete");
    assertEquals(await names(root), ["a.md"]);
  });
});

Deno.test("documents/file-tracking#R12: 원자 교체를 지원하지 않는 대상은 unavailable이고 truncate·복사로 바꾸지 않는다", async () => {
  await withRoot(async (root) => {
    await Deno.writeTextFile(`${root}/a.md`, "old");
    const noReplace = patched({
      replace: () => Promise.reject(new FileOpFault("unsupported", "EXDEV")),
    });
    const existing = await writeFile(
      depsOver(noReplace),
      writing(root, "a.md", sha("old"), "new"),
    );
    assert(!existing.ok);
    assertEquals(existing.error.code, "unavailable");
    assertEquals(await Deno.readTextFile(`${root}/a.md`), "old");
    assertEquals(await names(root), ["a.md"]);

    const noInstall = patched({
      install: () => Promise.reject(new FileOpFault("unsupported", "EPERM")),
    });
    const created = await writeFile(
      depsOver(noInstall),
      writing(root, "b.md", null, "new"),
    );
    assert(!created.ok);
    assertEquals(created.error.code, "unavailable");
    assertEquals(await names(root), ["a.md"]);
  });
});

Deno.test("documents/file-tracking#R16: 쓰기 권한이 없거나 용량이 모자라면 unavailable이고 오류에 경로·본문이 없다", async () => {
  await withRoot(async (root) => {
    await Deno.writeTextFile(`${root}/a.md`, "old");
    await Deno.chmod(root, 0o555);
    const denied = await writeFile(
      depsOver(),
      writing(root, "a.md", sha("old"), "secret body"),
    );
    await Deno.chmod(root, 0o755);
    assert(!denied.ok);
    assertEquals(denied.error.code, "unavailable");
    assertFalse(denied.error.message.includes("secret body"));
    assertFalse(denied.error.message.includes(root));
    assertEquals(await Deno.readTextFile(`${root}/a.md`), "old");

    const real = denoFileOps();
    const full = patched({
      createTemp: async (path, mode) => {
        const temp = await real.createTemp(path, mode);
        return {
          path: temp.path,
          write: () => Promise.reject(new FileOpFault("no_space", "ENOSPC")),
          sync: () => temp.sync(),
          close: () => temp.close(),
        };
      },
    });
    const noSpace = await writeFile(
      depsOver(full),
      writing(root, "a.md", sha("old"), "secret body"),
    );
    assert(!noSpace.ok);
    assertEquals(noSpace.error.code, "unavailable");
    assert(noSpace.error.message.includes("ENOSPC"));
    assertFalse(noSpace.error.message.includes("secret body"));
    assertFalse(noSpace.error.message.includes(root));
    assertEquals(await Deno.readTextFile(`${root}/a.md`), "old");
    assertEquals(await names(root), ["a.md"]);
  });
});

Deno.test("documents/file-tracking#R16: 읽기 전용 파일 시스템 오류와 quota 오류도 같은 unavailable이다", async () => {
  await withRoot(async (root) => {
    await Deno.writeTextFile(`${root}/a.md`, "old");
    for (const kind of ["read_only", "no_space", "denied"] as const) {
      const failing = patched({
        createTemp: () => Promise.reject(new FileOpFault(kind)),
      });
      const done = await writeFile(
        depsOver(failing),
        writing(root, "a.md", sha("old"), "new"),
      );
      assert(!done.ok);
      assertEquals(done.error.code, "unavailable");
    }
  });
});

Deno.test("documents/file-tracking#R11: 준 hash와 실제 바이트가 다르면 설치하지 않는다", async () => {
  await withRoot(async (root) => {
    await Deno.writeTextFile(`${root}/a.md`, "old");
    const done = await writeFile(depsOver(), {
      root,
      path: `${root}/a.md`,
      baseHash: sha("old"),
      content: chunks("actual"),
      contentHash: sha("claimed"),
    });
    assert(!done.ok);
    assertEquals(done.error.code, "invalid_input");
    assertEquals(await Deno.readTextFile(`${root}/a.md`), "old");
    assertEquals(await names(root), ["a.md"]);
  });
});

Deno.test("documents/file-tracking#R11: 교체 직후 다시 바뀐 파일은 changed_again이 true다", async () => {
  await withRoot(async (root) => {
    await Deno.writeTextFile(`${root}/a.md`, "old");
    const ops = patched({
      syncDirectory: async () => {
        await Deno.writeTextFile(`${root}/a.md`, "edited again");
      },
    });
    const done = await writeFile(
      depsOver(ops),
      writing(root, "a.md", sha("old"), "new"),
    );
    assert(done.ok);
    assertEquals(done.value.outcome, "written");
    assertEquals(done.value.observedHash, sha("edited again"));
    assertEquals(done.value.changedAgain, true);
  });
});

Deno.test("documents/file-tracking#R2 documents/file-tracking#R1: 등록 root 밖·.git·링크·폴더·임시 파일 이름은 모두 같은 invalid_input이다", async () => {
  await withRoot(async (root) => {
    const outside = await Deno.makeTempDir({ prefix: "lophn-files-out-" });
    try {
      await Deno.writeTextFile(`${outside}/secret.md`, "outside");
      await Deno.mkdir(`${root}/.git`);
      await Deno.mkdir(`${root}/dir`);
      await Deno.symlink(`${outside}/secret.md`, `${root}/link.md`);
      await Deno.symlink(outside, `${root}/linked-dir`);
      await Deno.writeTextFile(`${root}/real.md`, "x");
      await Deno.symlink(`${root}/real.md`, `${root}/inside-link.md`);
      const attempts = [
        `${outside}/secret.md`,
        `${root}/../escape.md`,
        `${root}/.git/config`,
        `${root}/link.md`,
        `${root}/inside-link.md`,
        `${root}/linked-dir/new.md`,
        `${root}/dir`,
        `${root}/missing-dir/new.md`,
        `${root}/${WRITE_TEMP_PREFIX}x.tmp`,
        `${root}-sibling/new.md`,
        "relative.md",
      ];
      const messages = new Set<string>();
      for (const path of attempts) {
        const done = await writeFile(depsOver(), {
          root,
          path,
          baseHash: null,
          content: chunks("body"),
          contentHash: sha("body"),
        });
        assert(!done.ok, path);
        assertEquals(done.error.code, "invalid_input", path);
        messages.add(done.error.message);
      }
      // 존재를 새지 않는다: 이유가 달라도 문구는 하나다.
      assertEquals(messages.size, 1);
      assertEquals(await Deno.readTextFile(`${outside}/secret.md`), "outside");
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
  });
});

Deno.test("documents/file-tracking#R11: 이름 변경은 새 목표가 없을 때만 하고, 옛 이름은 사라진다", async () => {
  await withRoot(async (root) => {
    await Deno.writeTextFile(`${root}/a.md`, "content");
    await Deno.writeTextFile(`${root}/taken.md`, "taken");
    const deps = depsOver();
    const taken = await renameFile(deps, {
      root,
      path: `${root}/a.md`,
      newPath: `${root}/taken.md`,
      baseHash: sha("content"),
    });
    assert(!taken.ok);
    assertEquals(taken.error.code, "conflict");
    assertEquals(await Deno.readTextFile(`${root}/taken.md`), "taken");

    const stale = await renameFile(deps, {
      root,
      path: `${root}/a.md`,
      newPath: `${root}/b.md`,
      baseHash: sha("stale"),
    });
    assert(!stale.ok);
    assertEquals(stale.error.code, "conflict");

    const done = await renameFile(deps, {
      root,
      path: `${root}/a.md`,
      newPath: `${root}/b.md`,
      baseHash: sha("content"),
    });
    assert(done.ok);
    assertEquals(done.value.outcome, "renamed");
    assertEquals(done.value.beforePath, `${root}/a.md`);
    assertEquals(done.value.afterPath, `${root}/b.md`);
    assertEquals(done.value.observedHash, sha("content"));
    assertEquals(await names(root), ["b.md", "taken.md"]);
  });
});

Deno.test("documents/file-tracking#R11: 이름 변경 중 옛 파일이 바뀌면 새 이름을 거두고 conflict다", async () => {
  await withRoot(async (root) => {
    await Deno.writeTextFile(`${root}/a.md`, "content");
    const real = denoFileOps();
    const ops = patched({
      install: async (temp, target) => {
        await real.install(temp, target);
        // 같은 inode를 외부 편집기가 제자리에서 고친다.
        await Deno.writeTextFile(`${root}/a.md`, "edited");
      },
    });
    const done = await renameFile(depsOver(ops), {
      root,
      path: `${root}/a.md`,
      newPath: `${root}/b.md`,
      baseHash: sha("content"),
    });
    assert(!done.ok);
    assertEquals(done.error.code, "conflict");
    assertEquals(await names(root), ["a.md"]);
    assertEquals(await Deno.readTextFile(`${root}/a.md`), "edited");
  });
});

Deno.test("documents/file-tracking#R11: 삭제는 hash가 같을 때만 하고 외부에서 고친 파일은 남긴다", async () => {
  await withRoot(async (root) => {
    await Deno.writeTextFile(`${root}/a.md`, "mine");
    await Deno.writeTextFile(`${root}/b.md`, "mine");
    const deps = depsOver();
    await Deno.writeTextFile(`${root}/a.md`, "external");
    const stale = await deleteFile(deps, {
      root,
      path: `${root}/a.md`,
      baseHash: sha("mine"),
    });
    assert(!stale.ok);
    assertEquals(stale.error.code, "conflict");
    assertEquals(await Deno.readTextFile(`${root}/a.md`), "external");

    const done = await deleteFile(deps, {
      root,
      path: `${root}/b.md`,
      baseHash: sha("mine"),
    });
    assert(done.ok);
    assertEquals(done.value.outcome, "deleted");
    assertEquals(done.value.afterPath, null);
    assertEquals(done.value.beforeHash, sha("mine"));
    assertEquals(await names(root), ["a.md"]);

    const gone = await deleteFile(deps, {
      root,
      path: `${root}/b.md`,
      baseHash: sha("mine"),
    });
    assert(!gone.ok);
    assertEquals(gone.error.code, "conflict");
  });
});

Deno.test("documents/file-tracking#R11: 삭제 직전에 바뀐 파일은 지우지 않는다", async () => {
  await withRoot(async (root) => {
    await Deno.writeTextFile(`${root}/a.md`, "mine");
    const real = denoFileOps();
    let reads = 0;
    // 시작 hash를 읽은 뒤(두 번째 read부터) 외부 편집기가 저장한다.
    const ops = patched({
      read: (path) => {
        reads += 1;
        if (reads === 2) {
          return (async function* () {
            await Deno.writeTextFile(`${root}/a.md`, "mine!");
            yield* real.read(path);
          })();
        }
        return real.read(path);
      },
    });
    const done = await deleteFile(depsOver(ops), {
      root,
      path: `${root}/a.md`,
      baseHash: sha("mine"),
    });
    assert(!done.ok);
    assertEquals(done.error.code, "conflict");
    assertEquals(await Deno.readTextFile(`${root}/a.md`), "mine!");
  });
});

// 실제 프로세스를 지정한 지점에서 SIGKILL로 끝낸다. 표시 파일이 생기면 그 지점에 닿은 것이다.
async function killedAt(
  root: string,
  point: "before" | "after",
  baseHash: string,
  text: string,
): Promise<void> {
  const script = new URL("./testing/crash-write.ts", import.meta.url).pathname;
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", script, root, point, baseHash, text],
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
  const marker = `${root}.marker`;
  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        await Deno.stat(marker);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    await Deno.stat(marker);
  } finally {
    child.kill("SIGKILL");
    await child.status;
    await Deno.remove(marker).catch(() => {});
  }
}

Deno.test("documents/file-tracking#R12: 실제 프로세스를 교체 직전에 SIGKILL해도 a.md는 완전한 이전 내용이고, 직후에 해도 완전한 새 내용이다", async () => {
  await withRoot(async (root) => {
    await Deno.writeTextFile(`${root}/a.md`, "old complete");
    await killedAt(root, "before", sha("old complete"), "new complete");
    assertEquals(await Deno.readTextFile(`${root}/a.md`), "old complete");
    for (const name of await names(root)) {
      if (name.startsWith(WRITE_TEMP_PREFIX)) {
        // 남은 임시 파일도 부분 본문이 아니다.
        assertEquals(
          await Deno.readTextFile(`${root}/${name}`),
          "new complete",
        );
        await Deno.remove(`${root}/${name}`);
      }
    }
    await killedAt(root, "after", sha("old complete"), "new complete");
    assertEquals(await Deno.readTextFile(`${root}/a.md`), "new complete");
    assertEquals(await names(root), ["a.md"]);
  });
});

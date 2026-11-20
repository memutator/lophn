import assert from "node:assert/strict";
import { test } from "node:test";
import type { CoreSource } from "../connection/connection.ts";
import { createRemoteFiles } from "./remote-files.ts";

const MACHINE = `mch_0${"1".repeat(25)}`;
const PROJECT = `prj_0${"1".repeat(25)}`;
const ROOT = "/remote/repo";

type CallReq = Parameters<CoreSource["call"]>[0];
type CallHandler = (req: CallReq) => Promise<{
  ok: boolean;
  value?: unknown;
  error?: { code: string; message: string };
}>;

function makeCore(handler: CallHandler): {
  core: CoreSource;
  calls: CallReq[];
} {
  const calls: CallReq[] = [];
  const core: CoreSource = {
    subscribe: () => () => {},
    current: () => ({ state: "ready", confirmedAt: null }),
    async call(request) {
      calls.push(request);
      return await handler(request);
    },
    onEvent: () => () => {},
  };
  return { core, calls };
}

test("remote-files: 폴더 목록 cache, in-flight 중복 제거, stale-while-revalidate가 동작한다", async () => {
  let time = 1000;
  let version = 1;
  let releaseFirst: (() => void) | null = null;
  let releaseSecond: (() => void) | null = null;

  const { core, calls } = makeCore(async (req) => {
    assert.equal(req.resource, "project_files");
    assert.equal(req.method, "list");
    if (version === 1) {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return {
        ok: true,
        value: {
          entries: [
            {
              name: "a.md",
              kind: "file",
              size: 10,
              modified_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      };
    }
    await new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    return {
      ok: true,
      value: {
        entries: [
          {
            name: "a.md",
            kind: "file",
            size: 10,
            modified_at: "2026-01-01T00:00:00.000Z",
          },
          {
            name: "b.md",
            kind: "file",
            size: 20,
            modified_at: "2026-01-01T00:01:00.000Z",
          },
        ],
      },
    };
  });

  const remote = createRemoteFiles(MACHINE, core, {
    now: () => time,
    staleMs: 2_000,
  });
  remote.registerProject(PROJECT, [{ path: ROOT }]);

  // 같은 폴더의 동시 요청 둘은 RPC 한 번만 보낸다(in-flight deduplication).
  const p1 = remote.workspaceFiles.list(ROOT);
  const p2 = remote.workspaceFiles.list(ROOT);
  // locate가 동기 hit라 바로 list call이 나간다.
  await Promise.resolve();
  assert.equal(calls.length, 1);
  releaseFirst!();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.ok(r1.ok && r2.ok);
  assert.deepEqual(
    r1.value.map((e) => e.name),
    ["a.md"],
  );
  // 동기 cache hit(0ms)
  assert.deepEqual(
    remote.workspaceFiles.listCached?.(ROOT)?.map((e) => e.name),
    ["a.md"],
  );

  // fresh 구간 안에서는 추가 RPC 없이 즉시 답한다.
  time += 500;
  const fresh = await remote.workspaceFiles.list(ROOT);
  assert.ok(fresh.ok);
  assert.equal(calls.length, 1);

  // stale 구간 뒤 호출은 cache를 즉시 돌려주고(SWR) 뒤에서 갱신해 listener로 알린다.
  const updates: string[][] = [];
  remote.workspaceFiles.onDirectoryUpdated?.((path, entries) => {
    assert.equal(path, ROOT);
    updates.push(entries.map((e) => e.name));
  });
  version = 2;
  time += 3_000;
  const stale = await remote.workspaceFiles.list(ROOT);
  assert.ok(stale.ok);
  assert.deepEqual(
    stale.value.map((e) => e.name),
    ["a.md"],
  );
  assert.equal(calls.length, 2);
  releaseSecond!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(updates, [["a.md", "b.md"]]);
  assert.deepEqual(
    remote.workspaceFiles.listCached?.(ROOT)?.map((e) => e.name),
    ["a.md", "b.md"],
  );
});

test("remote-files: 동시 list 갱신 수를 maxConcurrent 이하로 묶는다", async () => {
  let active = 0;
  let peak = 0;
  const gates: (() => void)[] = [];
  const { core } = makeCore(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => gates.push(resolve));
    active -= 1;
    return { ok: true, value: { entries: [] } };
  });

  const remote = createRemoteFiles(MACHINE, core, { maxConcurrent: 2 });
  remote.registerProject(PROJECT, [{ path: ROOT }]);

  const pending = [
    remote.workspaceFiles.list(`${ROOT}/d1`, { force: true }),
    remote.workspaceFiles.list(`${ROOT}/d2`, { force: true }),
    remote.workspaceFiles.list(`${ROOT}/d3`, { force: true }),
    remote.workspaceFiles.list(`${ROOT}/d4`, { force: true }),
  ];

  // microtask가 semaphore에 들어가도록 양보한다.
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(active <= 2, `active=${active}`);
    gates.shift()?.();
  }
  await Promise.all(pending);
  assert.equal(peak, 2);
});

test("remote-files: 파일 읽기 cache, 변이 시 영향 폴더만 무효화, 충돌 시 cache 비우기와 forbidden 전파", async () => {
  let time = 1000;
  let fileText = "hello";
  let fileHash = "a".repeat(64);
  let fileMtime = "2026-01-01T00:00:00.000Z";
  let writeMode: "ok" | "conflict" | "forbidden" = "ok";

  const { core, calls } = makeCore(async (req) => {
    const key = `${req.resource}/${req.method}`;
    if (key === "project_files/list") {
      const p = (req.body as { path?: string }).path ?? "";
      return {
        ok: true,
        value: {
          entries:
            p === "src"
              ? [
                  {
                    name: "app.ts",
                    kind: "file",
                    size: fileText.length,
                    modified_at: fileMtime,
                  },
                ]
              : [
                  {
                    name: "src",
                    kind: "folder",
                    size: 0,
                    modified_at: fileMtime,
                  },
                ],
        },
      };
    }
    if (key === "project_files/read") {
      const p = (req.body as { path: string }).path;
      if (p === "big.txt") {
        return {
          ok: true,
          value: { text: "partial", truncated: true, modified_at: fileMtime },
        };
      }
      return {
        ok: true,
        value: {
          text: fileText,
          truncated: false,
          hash: fileHash,
          modified_at: fileMtime,
        },
      };
    }
    if (key === "project_files/write") {
      if (writeMode === "conflict") {
        return { ok: false, error: { code: "conflict", message: "changed" } };
      }
      if (writeMode === "forbidden") {
        return { ok: false, error: { code: "forbidden", message: "no grant" } };
      }
      fileText = (req.body as { text: string }).text;
      fileHash = "b".repeat(64);
      return { ok: true, value: { hash: fileHash } };
    }
    if (key === "project_files/create") {
      if (writeMode === "forbidden") {
        return { ok: false, error: { code: "forbidden", message: "no grant" } };
      }
      return { ok: true, value: {} };
    }
    if (key === "project_files/rename" || key === "project_files/remove") {
      return { ok: true, value: {} };
    }
    return { ok: false, error: { code: "not_found", message: "unknown" } };
  });

  const remote = createRemoteFiles(MACHINE, core, { now: () => time });
  remote.registerProject(PROJECT, [{ path: ROOT }]);

  // 두 폴더를 cache한다.
  await remote.workspaceFiles.list(ROOT);
  await remote.workspaceFiles.list(`${ROOT}/src`);
  assert.ok(remote.workspaceFiles.listCached?.(ROOT) !== undefined);
  assert.ok(remote.workspaceFiles.listCached?.(`${ROOT}/src`) !== undefined);

  // src에 파일을 만들면 src와 조상만 무효화되고, 다른 형제 폴더는 남는다.
  await remote.workspaceFiles.list(`${ROOT}/other`);
  const created = await remote.workspaceFiles.create(
    `${ROOT}/src/new.ts`,
    "file",
  );
  assert.ok(created.ok);
  assert.equal(remote.workspaceFiles.listCached?.(`${ROOT}/src`), undefined);
  assert.ok(remote.workspaceFiles.listCached?.(`${ROOT}/other`) !== undefined);

  // 파일 읽기 cache hit.
  const callsBeforeRead = calls.length;
  const firstRead = await remote.editorFiles.read({
    path: `${ROOT}/src/app.ts`,
  });
  assert.ok(firstRead.ok && firstRead.value.text === "hello");
  const secondRead = await remote.editorFiles.read({
    path: `${ROOT}/src/app.ts`,
  });
  assert.ok(secondRead.ok && secondRead.value.text === "hello");
  assert.equal(calls.length, callsBeforeRead + 1);

  // list에서 mtime이 바뀌면 해당 파일 읽기 cache가 무효화된다.
  fileText = "externally edited";
  fileHash = "c".repeat(64);
  fileMtime = "2026-01-01T00:05:00.000Z";
  await remote.workspaceFiles.list(`${ROOT}/src`, { force: true });
  const afterExternal = await remote.editorFiles.read({
    path: `${ROOT}/src/app.ts`,
  });
  assert.ok(
    afterExternal.ok && afterExternal.value.text === "externally edited",
  );

  // write 충돌 시 file cache가 비워져 다음 read가 디스크 원본을 다시 읽는다.
  writeMode = "conflict";
  const conflictWrite = await remote.editorFiles.write({
    path: `${ROOT}/src/app.ts`,
    base_hash: fileHash,
    text: "mine",
  });
  assert.ok(!conflictWrite.ok && conflictWrite.code === "conflict");
  fileText = "latest on disk";
  const reread = await remote.editorFiles.read({ path: `${ROOT}/src/app.ts` });
  assert.ok(reread.ok && reread.value.text === "latest on disk");

  // truncated 파일은 read가 too_large이고 readBytes가 읽기 전용 미리 보기를 돌려준다.
  const big = await remote.editorFiles.read({ path: `${ROOT}/big.txt` });
  assert.ok(!big.ok && big.code === "too_large");
  const preview = await remote.editorFiles.readBytes({
    path: `${ROOT}/big.txt`,
  });
  assert.ok(preview.ok);
  assert.equal(new TextDecoder().decode(preview.value.bytes), "partial");

  // 허락 없는 기기의 forbidden은 그대로 전파된다.
  writeMode = "forbidden";
  const deniedCreate = await remote.workspaceFiles.create(
    `${ROOT}/src/x.ts`,
    "file",
  );
  assert.ok(!deniedCreate.ok && deniedCreate.code === "forbidden");
  const deniedWrite = await remote.editorFiles.write({
    path: `${ROOT}/src/app.ts`,
    base_hash: fileHash,
    text: "nope",
  });
  assert.ok(!deniedWrite.ok && deniedWrite.code === "forbidden");
  time += 1;
});

import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "../../../base/mod.ts";
import type { AgentPlace } from "../../../protocol/lophn-agent/mod.ts";
import { createNodeAgentFiles } from "./adapters/node-fs.ts";
import {
  agentFileName,
  type AgentFileSystem,
  createAgentStore,
  SETTINGS_FILE,
} from "./mod.ts";

const PRJ: AgentPlace = {
  kind: "project",
  id: "prj_01arz3ndektsv4rrffq69g5fa1",
};
const APP: AgentPlace = { kind: "app", id: "app_01arz3ndektsv4rrffq69g5fa2" };
const ASG = "asg_01arz3ndektsv4rrffq69g5fa6";
const ROOT = "/data";

// 파일 IO를 바꿔 끼우는 시험용 메모리 disk. 실패를 켜면 쓰기와 지우기가 던지고 파일은 그대로다.
function memoryFiles(): AgentFileSystem & {
  files: Map<string, string>;
  failing: boolean;
  readFailing: boolean;
} {
  const files = new Map<string, string>();
  const disk = {
    files,
    failing: false,
    readFailing: false,
    read(path: string) {
      if (disk.readFailing) throw new Error("read failure");
      return files.get(path) ?? null;
    },
    writeAtomic(path: string, text: string) {
      if (disk.failing) throw new Error("write failure");
      files.set(path, text);
    },
    remove(path: string) {
      if (disk.failing) throw new Error("remove failure");
      files.delete(path);
    },
  };
  return disk;
}

Deno.test("lophn-agent/agents#R3 [agent-I9]: file names follow the role and the place folder is under the data root", () => {
  assertEquals(agentFileName("lophn", ASG), "lophn.md");
  assertEquals(agentFileName("context_engineer", ASG), "context-engineer.md");
  assertEquals(agentFileName("app_engineer", ASG), "app-engineer.md");
  // Operator 파일 이름이 assignment ID라 이름을 바꿔도 연결이 변하지 않는다.
  assertEquals(agentFileName("operator", ASG), `${ASG}.md`);
  assertEquals(SETTINGS_FILE, "settings.md");

  const disk = memoryFiles();
  const store = createAgentStore(disk, ROOT);
  assert(store.write(PRJ, "lophn.md", "project\n").ok);
  assert(store.write(APP, `${ASG}.md`, "app\n").ok);
  assertEquals([...disk.files.keys()].sort(), [
    `/data/apps/${APP.id}/agents/${ASG}.md`,
    `/data/projects/${PRJ.id}/agents/lophn.md`,
  ]);
});

Deno.test("lophn-agent/agents#R4 [agent-I9]: a stored file reads back with the sha256 of its text, and a missing file is null", async () => {
  const store = createAgentStore(memoryFiles(), ROOT);
  const missing = store.read(PRJ, "lophn.md");
  assert(missing.ok);
  assertEquals(missing.value, null);

  const text = "---\nname: Reviewer\n---\n\n안녕\n";
  const written = store.write(PRJ, `${ASG}.md`, text);
  assert(written.ok);
  assertEquals(written.value, await sha256Hex(text));
  const read = store.read(PRJ, `${ASG}.md`);
  assert(read.ok);
  assertEquals(read.value, { text, hash: await sha256Hex(text) });
});

Deno.test("lophn-agent/agents#R4 [agent-I9]: a failed write is unavailable and keeps the previous file", () => {
  const disk = memoryFiles();
  const store = createAgentStore(disk, ROOT);
  assert(store.write(PRJ, "lophn.md", "old\n").ok);
  disk.failing = true;
  const failed = store.write(PRJ, "lophn.md", "new\n");
  assert(!failed.ok);
  assertEquals(failed.error.code, "unavailable");
  disk.failing = false;
  const read = store.read(PRJ, "lophn.md");
  assert(read.ok);
  assertEquals(read.value?.text, "old\n");
});

Deno.test("lophn-agent/agents#R4 [agent-I9]: a failed read or remove is unavailable, not an empty file", () => {
  const disk = memoryFiles();
  const store = createAgentStore(disk, ROOT);
  assert(store.write(PRJ, "lophn.md", "old\n").ok);
  disk.readFailing = true;
  const read = store.read(PRJ, "lophn.md");
  assert(!read.ok);
  assertEquals(read.error.code, "unavailable");
  disk.readFailing = false;
  disk.failing = true;
  const removed = store.remove(PRJ, "lophn.md");
  assert(!removed.ok);
  assertEquals(removed.error.code, "unavailable");
  assertEquals(disk.files.size, 1);
});

Deno.test("lophn-agent/agents#R4 [agent-I9]: remove deletes the file and a second remove is not an error", () => {
  const store = createAgentStore(memoryFiles(), ROOT);
  assert(store.write(PRJ, `${ASG}.md`, "x\n").ok);
  assert(store.remove(PRJ, `${ASG}.md`).ok);
  const read = store.read(PRJ, `${ASG}.md`);
  assert(read.ok);
  assertEquals(read.value, null);
  assert(store.remove(PRJ, `${ASG}.md`).ok);
});

Deno.test("lophn-agent/agents#R4 [agent-I9]: the node adapter writes through a temp file and replaces the old one whole", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-agent-store-" });
  try {
    const files = createNodeAgentFiles();
    const path = `${dir}/projects/p/agents/lophn.md`;
    assertEquals(files.read(path), null);
    // 없는 폴더는 만들어 쓴다.
    files.writeAtomic(path, "first\n");
    assertEquals(files.read(path), "first\n");
    files.writeAtomic(path, "second\n");
    assertEquals(files.read(path), "second\n");
    // 임시 파일이 남지 않는다.
    const names = [...Deno.readDirSync(`${dir}/projects/p/agents`)].map((e) =>
      e.name
    );
    assertEquals(names, ["lophn.md"]);
    files.remove(path);
    assertEquals(files.read(path), null);
    files.remove(path);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("lophn-agent/agents#R4 [agent-I9]: when the replace fails the old file stays and no temp file is left", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-agent-store-" });
  try {
    const files = createNodeAgentFiles();
    const folder = `${dir}/agents`;
    const path = `${folder}/lophn.md`;
    files.writeAtomic(path, "old\n");
    // 대상이 비어 있지 않은 폴더이면 바꿔 끼우기가 실패한다.
    const blocked = `${folder}/settings.md`;
    Deno.mkdirSync(blocked);
    Deno.writeTextFileSync(`${blocked}/keep`, "keep");
    let thrown = false;
    try {
      files.writeAtomic(blocked, "new\n");
    } catch {
      thrown = true;
    }
    assert(thrown);
    assertEquals(files.read(path), "old\n");
    assertEquals(
      [...Deno.readDirSync(folder)].map((e) => e.name).sort(),
      ["lophn.md", "settings.md"],
    );
    assertEquals(Deno.readTextFileSync(`${blocked}/keep`), "keep");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

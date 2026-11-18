// core 안 extension host(`ExtensionHost`). registry, spawner, ACP handle을 묶는다. core의 다른 쪽(route handler, 사람 권한의
// route 호출, 설정)은 wiring이 deps로 꽂는다.
import {
  mkdir,
  readdir,
  readFile,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import type { Clock } from "../../base/clock.ts";
import type { IdSource } from "../../base/id.ts";
import type { Result } from "../../base/result.ts";
import type {
  ExtensionContext,
  ExtensionToolCall,
  ExtensionToolContent,
} from "../../protocol/extensions/manifest.ts";
import { type AcpHandle, createAcp } from "./acp.ts";
import type { ExtensionHost } from "./ports.ts";
import { createExtensionRegistry, type ExtensionFiles } from "./registry.ts";
import { createSpawner } from "./spawner.ts";

const nodeFiles: ExtensionFiles = {
  read: (path) => readFile(path, "utf8").catch(() => null),
  write: async (path, text) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  },
  list: (dir) => readdir(dir).catch(() => null),
  mkdir: async (path) => void (await mkdir(path, { recursive: true })),
  // rmdir는 빈 폴더만 지운다. file은 rm이 지운다.
  remove: async (path) => {
    try {
      await rm(path);
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      if (code !== "EISDIR" && code !== "EPERM") throw cause;
      await rmdir(path);
    }
  },
};

/** tool 호출을 부른 쪽. `credential`은 그 호출만 쓰는 agent 자격이다. handler의 `core`가 이것으로 부른다. */
export type ToolCaller = Omit<ExtensionToolCall, "core"> & {
  credential: string;
};

export function createExtensionHost(deps: {
  // `<root>/<id>/manifest.json` 꼴의 폴더들.
  roots: readonly string[];
  dataRoot: string;
  // entry file의 절대 경로를 load한다.
  load(path: string): Promise<unknown>;
  // 사람 권한의 route 호출(`ctx.core`).
  core: ExtensionContext["core"];
  // 그 agent 자격으로 부르는 route 호출(tool handler의 `core`).
  coreAs(credential: string): ExtensionContext["core"];
  settings: ExtensionContext["settings"];
  // 사람의 env와 `lophn` 경로.
  env(): Promise<Record<string, string>>;
  cli(): string | null;
  // harness-gui가 연 handle. GUI 화면이 붙는 쪽이 받는다.
  acpOpened(handle: AcpHandle): void;
  clock: Clock;
  ids: IdSource;
  log(message: string): void;
}): ExtensionHost {
  const spawner = createSpawner({
    dataRoot: deps.dataRoot,
    env: deps.env,
    cli: deps.cli,
  });
  const { acp, tab } = createAcp(deps.ids, deps.acpOpened);
  const registry = createExtensionRegistry({
    roots: deps.roots,
    dataRoot: deps.dataRoot,
    files: nodeFiles,
    load: deps.load,
    settings: deps.settings,
    core: deps.core,
    spawn: spawner.spawn,
    acp,
    clock: deps.clock,
    ids: deps.ids,
    log: deps.log,
  });
  return {
    list: () => registry.list(),
    install: (id) => registry.install(id),
    remove: (id) => registry.remove(id),
    run: (command) => registry.run(command),
    // port의 caller에는 자격이 없다(계약 바꾸기 요청). extension-tools wiring이 `credential`을 실어 부른다.
    callTool(
      extension: string,
      tool: string,
      input: unknown,
      caller: ToolCaller,
    ): Promise<Result<ExtensionToolContent[]>> {
      return registry.callTool(extension, tool, input, {
        session: caller.session,
        workspace: caller.workspace,
        core: deps.coreAs(caller.credential),
      });
    },
    catalog: () => registry.catalog(),
    tabHandlers: () => tab() ?? null,
    // extension이 activate될 때 사람의 env가 있어야 띄우는 CLI가 사람의 PATH를 얻는다.
    async sync() {
      await spawner.ready();
      await registry.sync();
    },
    async stop() {
      await registry.stop();
      spawner.stopAll();
    },
  };
}

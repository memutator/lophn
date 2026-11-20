// extension registry. manifest가 든 폴더 목록(roots)만 읽고, 켜진 extension의 entry만 load해 activate한다.
// 지금 roots는 본체 안 폴더 하나이고, 뒤에 따로 받는 package가 `<data>/extensions/`를 더한다.
// sync마다 판이 맞는 manifest의 tool 목록(`catalog`)을 켜진 것과 꺼진 것 상관없이 새로 둔다.
// 끄면 deactivate하고, 지울 때는 extension이 ctx.files로 쓴 file만 표시 file(`.lophn-extension`)을 보고 지운다.
import type { Clock } from "../../base/clock.ts";
import type { IdSource } from "../../base/id.ts";
import type { Result } from "../../base/result.ts";
import type {
  ExtensionStatus,
  ExtensionView,
} from "../../protocol/extensions/routes.ts";
import type { PublishedExtension } from "../../protocol/lophn-agent/extension-tools.ts";
import {
  EXTENSION_ID,
  EXTENSION_MANIFEST_FILE,
  type ExtensionContext,
  type ExtensionManifest,
  type ExtensionModule,
  type ExtensionSpawn,
  type ExtensionToolCall,
  type ExtensionToolContent,
  type ExtensionToolHandler,
  extensionManifestSchema,
  extensionSettingKey,
  parseExtensionCommand,
} from "../../protocol/extensions/mod.ts";

export const EXTENSION_MARKER = ".lophn-extension";
type CommandHandler = () => void | Promise<void>;

export type ExtensionFiles = {
  read(path: string): Promise<string | null>;
  /** 상위 폴더도 만든다. */
  write(path: string, text: string): Promise<void>;
  /** 폴더가 없으면 null. */
  list(dir: string): Promise<string[] | null>;
  /** 상위 폴더도 만든다. 이미 있으면 그대로 둔다. */
  mkdir(path: string): Promise<void>;
  /** file이나 빈 폴더. 없으면 아무 일 없고, 비지 않은 폴더는 reject다. */
  remove(path: string): Promise<void>;
};

export type RegistryDeps = {
  /** `<root>/<id>/manifest.json` 꼴의 폴더들. */
  roots: readonly string[];
  /** `<dataRoot>/extensions/<id>/`에 표시 file과 extension이 쓴 file이 선다. */
  dataRoot: string;
  files: ExtensionFiles;
  /** entry file의 절대 경로를 load한다. 꺼진 extension에는 부르지 않는다. */
  load(path: string): Promise<unknown>;
  settings: ExtensionContext["settings"];
  core: ExtensionContext["core"];
  spawn: ExtensionSpawn;
  acp: ExtensionContext["acp"];
  clock: Clock;
  ids: IdSource;
  log(message: string): void;
};

type Found = {
  id: string;
  folder: string;
  manifest?: ExtensionManifest;
  invalid?: string;
};

export function createExtensionRegistry(deps: RegistryDeps) {
  const { files } = deps;
  const base = `${deps.dataRoot}/extensions`;
  // 켜진 extension마다 그 module과 등록한 command·tool handler. 끄면 함께 버린다.
  const active = new Map<
    string,
    {
      module: ExtensionModule;
      commands: Map<string, CommandHandler>;
      tools: Map<string, ExtensionToolHandler>;
    }
  >();
  const problem = new Map<
    string,
    { status: ExtensionStatus; reason: string }
  >();
  let queue: Promise<unknown> = Promise.resolve();
  let catalog: readonly PublishedExtension[] = [];

  async function discover(): Promise<Found[]> {
    const found = new Map<string, Found>();
    for (const root of deps.roots) {
      for (const name of (await files.list(root)) ?? []) {
        if (found.has(name)) continue;
        const folder = `${root}/${name}`;
        const text = await files.read(`${folder}/${EXTENSION_MANIFEST_FILE}`);
        if (text === null) continue;
        let parsed: ReturnType<typeof extensionManifestSchema.safeParse>;
        try {
          parsed = extensionManifestSchema.safeParse(JSON.parse(text));
        } catch {
          found.set(name, {
            id: name,
            folder,
            invalid: "manifest is not JSON",
          });
          continue;
        }
        if (!parsed.success || parsed.data.id !== name) {
          found.set(name, {
            id: name,
            folder,
            invalid: "manifest is not valid or its id differs from the folder",
          });
        } else found.set(name, { id: name, folder, manifest: parsed.data });
      }
    }
    return [...found.values()];
  }

  // 표시 file은 쓰기 전에 먼저 둔다. 쓰다 멈춰도 다음에 우리 file로 알아본다.
  async function markerFiles(id: string): Promise<string[]> {
    const text = await files.read(`${base}/${id}/${EXTENSION_MARKER}`);
    if (text === null) return [];
    try {
      const value = JSON.parse(text) as { files?: unknown };
      return Array.isArray(value.files)
        ? value.files.filter((f): f is string => typeof f === "string")
        : [];
    } catch {
      return [];
    }
  }
  const writeMarker = (id: string, names: string[]) =>
    files.write(
      `${base}/${id}/${EXTENSION_MARKER}`,
      `${JSON.stringify({ files: names })}\n`,
    );

  const safeName = (name: string) =>
    name.split("/").every((p) => p !== "" && p !== "." && p !== "..") &&
    !name.includes("\\") &&
    !name.startsWith("/");

  function contextFor(
    id: string,
    commands: Map<string, CommandHandler>,
    tools: Map<string, ExtensionToolHandler>,
  ): ExtensionContext {
    return {
      core: deps.core,
      settings: deps.settings,
      spawn: deps.spawn,
      acp: deps.acp,
      clock: deps.clock,
      ids: deps.ids,
      commands: {
        register(name, handler) {
          commands.set(name, handler);
          return () => {
            if (commands.get(name) === handler) commands.delete(name);
          };
        },
      },
      tools: {
        handle(name, handler) {
          tools.set(name, handler);
          return () => {
            if (tools.get(name) === handler) tools.delete(name);
          };
        },
      },
      files: {
        async write(name, text) {
          const safe =
            name !== EXTENSION_MARKER &&
            name !== EXTENSION_MANIFEST_FILE &&
            safeName(name);
          if (!safe) {
            return {
              ok: false,
              error: {
                code: "invalid_input",
                message: "file name is not safe",
              },
            };
          }
          const names = await markerFiles(id);
          if (!names.includes(name)) await writeMarker(id, [...names, name]);
          await files.write(`${base}/${id}/${name}`, text);
          return { ok: true, value: undefined };
        },
      },
      async dataFolder(name) {
        if (!safeName(name)) {
          return {
            ok: false,
            error: {
              code: "invalid_input",
              message: "folder name is not safe",
            },
          };
        }
        const path = `${deps.dataRoot}/${name}`;
        await files.mkdir(path);
        return { ok: true, value: path };
      },
    };
  }

  async function activate(found: Found & { manifest: ExtensionManifest }) {
    const { id, manifest } = found;
    try {
      const loaded = (await deps.load(`${found.folder}/${manifest.entry}`)) as
        | Partial<ExtensionModule>
        | undefined;
      if (
        typeof loaded?.activate !== "function" ||
        typeof loaded.deactivate !== "function"
      ) {
        throw new Error("entry does not export activate and deactivate");
      }
      const module = loaded as ExtensionModule;
      await writeMarker(id, await markerFiles(id));
      const commands = new Map<string, CommandHandler>();
      const tools = new Map<string, ExtensionToolHandler>();
      try {
        await module.activate(contextFor(id, commands, tools));
      } catch (cause) {
        await Promise.resolve(module.deactivate()).catch(() => {});
        throw cause;
      }
      active.set(id, { module, commands, tools });
      problem.delete(id);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      deps.log(`extension ${id} failed to start: ${reason}`);
      problem.set(id, { status: "failed", reason });
    }
  }

  async function deactivate(id: string) {
    const running = active.get(id);
    active.delete(id);
    try {
      await running?.module.deactivate();
    } catch (cause) {
      deps.log(`extension ${id} failed to stop: ${String(cause)}`);
    }
  }

  async function runSync() {
    const discovered = await discover();
    for (const found of discovered) {
      const { id, manifest } = found;
      if (manifest === undefined) {
        problem.set(id, { status: "invalid", reason: found.invalid ?? "" });
        continue;
      }
      if (manifest.builtin === true) {
        if (!active.has(id)) await activate({ ...found, manifest });
        continue;
      }
      const enabled = await deps.settings.get(extensionSettingKey(id));
      // 읽지 못한 때(core 불안정)는 켜진 것을 끄지 않는다.
      if (!enabled.ok) continue;
      const bad: { status: ExtensionStatus; reason: string } | undefined =
        enabled.value === undefined
          ? {
              status: "no_setting",
              reason: `setting ${extensionSettingKey(id)} is not declared`,
            }
          : undefined;
      if (bad === undefined && enabled.value === true) {
        if (!active.has(id)) await activate({ ...found, manifest });
        continue;
      }
      if (active.has(id)) await deactivate(id);
      if (bad) problem.set(id, bad);
      else problem.delete(id);
    }
    catalog = discovered.flatMap(({ manifest }) =>
      manifest !== undefined && manifest.contributes.tools.length > 0
        ? [
            {
              id: manifest.id,
              name: manifest.name,
              description: manifest.description,
              tools: manifest.contributes.tools,
            },
          ]
        : [],
    );
  }

  return {
    /** 켜진 것을 맞춘다. 겹쳐 불러도 차례로 돈다. */
    sync(): Promise<void> {
      const run = queue.then(runSync, runSync);
      queue = run.catch(() => {});
      return run;
    },

    /** 마지막 sync가 읽은, 판이 맞는 manifest의 tool 전부(켜진 것과 꺼진 것). */
    catalog: (): readonly PublishedExtension[] => catalog,

    async list(): Promise<ExtensionView[]> {
      const infos: ExtensionView[] = [];
      for (const found of await discover()) {
        const bad = problem.get(found.id);
        const builtin = found.manifest?.builtin === true;
        const status: ExtensionStatus = active.has(found.id)
          ? "on"
          : (bad?.status ?? "off");
        infos.push({
          id: found.id,
          name: found.manifest?.name ?? found.id,
          description: found.manifest?.description ?? "",
          status,
          ...(bad ? { reason: bad.reason } : {}),
          installed:
            builtin ||
            (await files.read(`${base}/${found.id}/${EXTENSION_MARKER}`)) !==
              null,
          ...(builtin ? { builtin: true } : {}),
          ...(status === "on" && found.manifest !== undefined
            ? { contributes: found.manifest.contributes }
            : {}),
        });
      }
      return infos;
    },

    /** `ext.<id>.<name>`을 켜진 extension이 등록한 handler로 부른다. 없으면 not_found, handler가 던지면 internal이다. */
    async run(command: string): Promise<Result<void>> {
      const parsed = parseExtensionCommand(command);
      const handler =
        parsed === null
          ? undefined
          : active.get(parsed.extension)?.commands.get(parsed.name);
      if (handler === undefined) {
        return {
          ok: false,
          error: { code: "not_found", message: "command is not running" },
        };
      }
      try {
        await handler();
        return { ok: true, value: undefined };
      } catch (cause) {
        deps.log(`command ${command} failed: ${String(cause)}`);
        return {
          ok: false,
          error: { code: "internal", message: "command failed" },
        };
      }
    },

    /** 켜진 extension이 `ctx.tools.handle`로 등록한 handler를 부른다. 없으면 not_found, handler가 던지면 internal이다. */
    async callTool(
      extension: string,
      tool: string,
      input: unknown,
      call: ExtensionToolCall,
    ): Promise<Result<ExtensionToolContent[]>> {
      const handler = active.get(extension)?.tools.get(tool);
      if (handler === undefined) {
        return {
          ok: false,
          error: { code: "not_found", message: "tool is not running" },
        };
      }
      try {
        return await handler(input, call);
      } catch (cause) {
        deps.log(`tool ${extension}.${tool} failed: ${String(cause)}`);
        return {
          ok: false,
          error: { code: "internal", message: "tool failed" },
        };
      }
    },

    /** 표시 file만 둔다(내려받기는 아직 없다). 이미 있으면 그대로다. */
    async install(id: string): Promise<Result<void>> {
      if (!EXTENSION_ID.test(id)) {
        return {
          ok: false,
          error: {
            code: "invalid_input",
            message: "extension id is not valid",
          },
        };
      }
      const run = async (): Promise<Result<void>> => {
        if (!(await discover()).some((found) => found.id === id)) {
          return {
            ok: false,
            error: { code: "not_found", message: "extension is not found" },
          };
        }
        if ((await files.read(`${base}/${id}/${EXTENSION_MARKER}`)) === null) {
          await writeMarker(id, []);
        }
        return { ok: true, value: undefined };
      };
      const result = queue.then(run, run);
      queue = result.catch(() => {});
      return result;
    },

    /** extension이 쓴 file과 표시 file만 지운다. 켜져 있으면 conflict다. */
    async remove(id: string): Promise<Result<void>> {
      if (!EXTENSION_ID.test(id)) {
        return {
          ok: false,
          error: {
            code: "invalid_input",
            message: "extension id is not valid",
          },
        };
      }
      const run = async (): Promise<Result<void>> => {
        const found = (await discover()).find((item) => item.id === id);
        if (found?.manifest?.builtin === true) {
          return {
            ok: false,
            error: {
              code: "conflict",
              message: "built-in extensions cannot be removed",
            },
          };
        }
        const enabled = await deps.settings.get(extensionSettingKey(id));
        if (!enabled.ok) return enabled;
        if (active.has(id) || enabled.value === true) {
          return {
            ok: false,
            error: {
              code: "conflict",
              message: "turn the extension off first",
            },
          };
        }
        const folder = `${base}/${id}`;
        const names = await markerFiles(id);
        for (const name of names) await files.remove(`${folder}/${name}`);
        await files.remove(`${folder}/${EXTENSION_MARKER}`);
        // 사람 file이 남은 폴더는 비지 않아 그대로 남는다.
        const dirs = new Set([folder]);
        for (const name of names) {
          const parts = name.split("/").slice(0, -1);
          for (let at = 1; at <= parts.length; at++) {
            dirs.add(`${folder}/${parts.slice(0, at).join("/")}`);
          }
        }
        for (const dir of [...dirs, base].toSorted(
          (a, b) => b.length - a.length,
        )) {
          await files.remove(dir).catch(() => {});
        }
        return { ok: true, value: undefined };
      };
      const result = queue.then(run, run);
      queue = result.catch(() => {});
      return result;
    },

    /** core가 끝날 때. 켜진 것을 모두 deactivate한다. */
    async stop(): Promise<void> {
      const run = async () => {
        for (const id of [...active.keys()]) await deactivate(id);
      };
      queue = queue.then(run, run);
      await queue;
    },
  };
}

import { z } from "zod";
// shell main tsc도 host-queue.ts를 거쳐 noUncheckedIndexedAccess를 켠 채 보므로 base/mod.ts 전체 대신 쓰는 file만 import한다.
import type { Clock } from "../../base/clock.ts";
import type { IdSource } from "../../base/id.ts";
import type { Result } from "../../base/result.ts";
import type { ExtensionAcp } from "./acp-session.ts";

// extension 하나는 폴더 하나다. 폴더 이름이 id이고 manifest.json이 그 안에 있다.
// 일반 extension의 켜기는 사람이 설정 `extensions.<id>.enabled`로만 한다. `builtin: true`인 내장 extension은 설정 없이 늘 켜진다.
export const EXTENSION_ID = /^[a-z][a-z0-9-]*$/;
export const EXTENSION_MANIFEST_FILE = "manifest.json";

export function extensionSettingKey(id: string): string {
  return `extensions.${id}.enabled`;
}

/** `ext.<extension id>.<name>`의 `<name>`. */
export const EXTENSION_COMMAND_NAME = /^[a-z][a-z0-9-]*$/;

/** `ext.<extension id>.<name>`을 id와 name으로 나눈다. 꼴이 아니면 null이다. */
export function parseExtensionCommand(
  command: string,
): { extension: string; name: string } | null {
  const match = /^ext\.([a-z][a-z0-9-]*)\.([a-z][a-z0-9-]*)$/.exec(command);
  return match === null ? null : { extension: match[1]!, name: match[2]! };
}

/** `ext__<extension id>__<tool name>`의 `<tool name>`. `__`가 없어야 model 이름에서 id와 tool을 가른다. */
export const EXTENSION_TOOL_NAME = /^[a-z][a-z0-9_]*$/;
export const EXTENSION_TOOL_PREFIX = "ext__";
/** provider가 받는 tool 이름 상한(`WIRE_TOOL_NAME_PATTERN`의 64)이다. */
const MODEL_NAME_MAX = 64;

/** model에 보이는 이름이다. 내장(`_` 하나)과 MCP(`mcp__`)와 겹치지 않는다. */
export function extensionToolModelName(extension: string, tool: string) {
  return `${EXTENSION_TOOL_PREFIX}${extension}__${tool}`;
}

export const EXTENSION_TOOL_EFFECTS = ["read", "write", "external"] as const;

/** 기여하는 tool 하나. schema는 정적이다. */
export const extensionToolSchema = z.strictObject({
  name: z
    .string()
    .regex(EXTENSION_TOOL_NAME)
    .refine((name) => !name.includes("__"), {
      message: "tool name must not contain __",
    }),
  description: z.string().min(1).max(2000),
  inputSchema: z
    .record(z.string(), z.unknown())
    .refine((schema) => schema.type === "object", {
      message: "inputSchema must be a JSON Schema object",
    }),
  effect: z.enum(EXTENSION_TOOL_EFFECTS),
});
export type ExtensionToolDefinition = z.infer<typeof extensionToolSchema>;

/** handler가 돌려주는 결과 한 조각이다. MCP content 꼴이고 image는 base64다. */
export const extensionToolContentSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), text: z.string() }),
  z.strictObject({
    type: z.literal("image"),
    mimeType: z.string().min(1),
    data: z.string(),
  }),
]);
export type ExtensionToolContent = z.infer<typeof extensionToolContentSchema>;

/**
 * 기여하는 command와 key. `keybindings`의 `command`는 내장 command(`agent.cycle-mode`)나 이 extension의
 * `ext.<id>.<name>`이다. `key.mac`이 없으면 `key.other`와 같다.
 */
export const extensionContributesSchema = z.strictObject({
  commands: z
    .array(
      z.strictObject({
        name: z.string().regex(EXTENSION_COMMAND_NAME).max(64),
        title: z.string().min(1).max(80),
      }),
    )
    .max(64)
    .default([]),
  keybindings: z
    .array(
      z.strictObject({
        command: z.string().min(1).max(80),
        key: z.strictObject({
          other: z.string().min(1).max(40),
          mac: z.string().min(1).max(40).optional(),
        }),
        context: z.string().min(1).max(64).optional(),
      }),
    )
    .max(128)
    .default([]),
  tools: z.array(extensionToolSchema).max(64).default([]),
});
export type ExtensionContributes = z.infer<typeof extensionContributesSchema>;

export const extensionManifestSchema = z
  .strictObject({
    id: z.string().regex(EXTENSION_ID).max(64),
    name: z.string().min(1).max(80),
    description: z.string().max(500),
    /** 폴더 안 상대 경로. 따로 빌드한 CJS file이고, 폴더 밖을 가리키지 못한다. */
    entry: z
      .string()
      .min(1)
      .max(200)
      .refine(
        (path) =>
          !path.startsWith("/") &&
          !path.includes("\\") &&
          path.split("/").every((part) => part !== ".." && part !== ""),
        { message: "entry must stay inside the extension folder" },
      ),
    /** 들어 있는 것의 이름들(설정 화면에 보인다). */
    provides: z.array(z.string().min(1).max(64)).max(16),
    /** 본체에 기본으로 늘 켜지는 내장 extension인가. 설정·설치·제거 대상이 아니다. */
    builtin: z.boolean().optional(),
    contributes: extensionContributesSchema.default({
      commands: [],
      keybindings: [],
      tools: [],
    }),
  })
  .superRefine((manifest, context) => {
    const seen = new Set<string>();
    manifest.contributes.tools.forEach((tool, index) => {
      const path = ["contributes", "tools", index, "name"];
      if (seen.has(tool.name)) {
        context.addIssue({ code: "custom", path, message: "duplicate tool" });
      }
      seen.add(tool.name);
      if (
        extensionToolModelName(manifest.id, tool.name).length > MODEL_NAME_MAX
      ) {
        context.addIssue({
          code: "custom",
          path,
          message: "model tool name is longer than 64",
        });
      }
    });
  });
export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;

export type ExtensionProcess = {
  readonly pid: number | undefined;
  write(text: string): void;
  /** stdin을 닫는다. stdin이 끝나기를 기다리는 CLI(`codex exec`)가 있다. */
  end(): void;
  kill(): void;
  /** stdout과 stderr는 따로 온다. 섞으면 줄 단위 JSON 출력이 stderr 글과 엉킨다. */
  onStdout(listener: (text: string) => void): void;
  onStderr(listener: (text: string) => void): void;
  /** 시작하지 못한 경우도 code null로 온다. */
  onExit(listener: (code: number | null) => void): void;
};
export type ExtensionSpawn = (
  command: string,
  args: readonly string[],
  options?: { cwd?: string; env?: Record<string, string> },
) => ExtensionProcess;

/** tool을 부른 session의 자리다. home에는 workspace가 없다. */
export type ExtensionToolWorkspace =
  | { kind: "home" }
  | { kind: "project"; id: string }
  | { kind: "app"; id: string };

/** `ctx.tools.handle`의 handler가 받는 호출 맥락이다. `core`는 그 호출 session의 agent 자격으로 부르고 `ctx.core`(사람 권한)와 다르다. */
export type ExtensionToolCall = {
  session: string;
  workspace: ExtensionToolWorkspace;
  core: ExtensionContext["core"];
};
export type ExtensionToolHandler = (
  input: unknown,
  call: ExtensionToolCall,
) => Promise<Result<ExtensionToolContent[]>>;

/** extension code가 lophn에 닿는 유일한 길이다. core 내부 module은 import하지 못한다. */
export type ExtensionContext = {
  /** core protocol route 호출. 사람 권한이다. */
  core: {
    call(
      kind: string,
      resource: string,
      method: string,
      input: unknown,
    ): Promise<Result<unknown>>;
  };
  /** 선언된 설정 값(기본값 포함). 선언이 없거나 기본값 없이 고르지 않았으면 undefined다. */
  settings: { get(key: string): Promise<Result<unknown>> };
  spawn: ExtensionSpawn;
  /** CLI session을 ACP로 내는 창(`harness-gui`). */
  acp: ExtensionAcp;
  clock: Clock;
  ids: IdSource;
  /**
   * `<data root>/extensions/<id>/` 안에 쓴다. 쓴 file 이름이 표시 file에 남아 지울 때 이것만 지운다.
   * 이름은 폴더 안 상대 경로다.
   */
  files: { write(name: string, text: string): Promise<Result<void>> };
  /** `<data root>/<name>/`을 (없으면) 만들고 절대 경로를 준다. 이름은 data root 안 상대 경로다. 지우지 않는다. */
  dataFolder(name: string): Promise<Result<string>>;
  /** main에서 도는 command를 `ext.<id>.<name>`으로 올린다. renderer가 key나 팔레트로 부르면 여기로 온다. 돌려받은 함수로 지운다. */
  commands: {
    register(name: string, handler: () => void | Promise<void>): () => void;
  };
  /** manifest `contributes.tools`로 선언한 tool을 처리한다. 돌려받은 함수로 지운다. 선언에 없는 이름은 호출되지 않는다. */
  tools: {
    handle(name: string, handler: ExtensionToolHandler): () => void;
  };
};

/** entry file이 내는 것. */
export type ExtensionModule = {
  activate(ctx: ExtensionContext): void | Promise<void>;
  deactivate(): void | Promise<void>;
};

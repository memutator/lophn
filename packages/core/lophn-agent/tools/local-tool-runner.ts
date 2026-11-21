// 로컬 tool(.ts/.js/.mjs)을 격리된 자식 Node 프로세스에서 검사(inspect)하거나 실행(run)한다.
// stdin으로 JSON 입력을 받고 stdout으로 JSON 한 줄을 낸다. core/agent-runtime 내부 token이나 Electron env 없이 돈다.
import { pathToFileURL } from "node:url";

const VALID_EFFECTS = new Set(["read", "write", "external"]);
const DESCRIPTION_MAX = 2000;

type ToolModule = {
  description?: unknown;
  inputSchema?: unknown;
  effect?: unknown;
  execute?: unknown;
};

type NormalizedContent =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string };

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateModule(mod: unknown):
  | {
      ok: true;
      description: string;
      inputSchema: Record<string, unknown>;
      effect: "read" | "write" | "external";
      execute: (
        input: unknown,
        ctx: { cwd: string },
      ) => unknown | Promise<unknown>;
    }
  | { ok: false; reason: string } {
  const target = (
    isPlainObject(mod) && "default" in mod
      ? (mod as { default: unknown }).default
      : mod
  ) as ToolModule | undefined;
  if (!isPlainObject(target)) {
    return { ok: false, reason: "default export must be an object" };
  }
  if (
    typeof target.description !== "string" ||
    target.description.trim() === "" ||
    target.description.length > DESCRIPTION_MAX
  ) {
    return {
      ok: false,
      reason: "description must be non-empty text (<= 2000)",
    };
  }
  if (
    !isPlainObject(target.inputSchema) ||
    target.inputSchema.type !== "object"
  ) {
    return {
      ok: false,
      reason: "inputSchema must be a JSON Schema object with type: 'object'",
    };
  }
  const effect = target.effect ?? "external";
  if (typeof effect !== "string" || !VALID_EFFECTS.has(effect)) {
    return { ok: false, reason: "effect must be read, write or external" };
  }
  if (typeof target.execute !== "function") {
    return { ok: false, reason: "execute must be a function" };
  }
  return {
    ok: true,
    description: target.description.trim(),
    inputSchema: target.inputSchema,
    effect: effect as "read" | "write" | "external",
    execute: target.execute as (
      input: unknown,
      ctx: { cwd: string },
    ) => unknown | Promise<unknown>,
  };
}

function normalizeOutput(value: unknown): NormalizedContent[] {
  if (typeof value === "string") {
    return [{ type: "text", text: value }];
  }
  if (Array.isArray(value)) {
    const out: NormalizedContent[] = [];
    for (const item of value) {
      if (!isPlainObject(item)) continue;
      if (item.type === "text" && typeof item.text === "string") {
        out.push({ type: "text", text: item.text });
      } else if (
        item.type === "image" &&
        typeof item.mimeType === "string" &&
        item.mimeType.length > 0 &&
        typeof item.data === "string"
      ) {
        out.push({ type: "image", mimeType: item.mimeType, data: item.data });
      }
    }
    return out;
  }
  if (value === undefined || value === null) {
    return [{ type: "text", text: "" }];
  }
  return [{ type: "text", text: JSON.stringify(value) }];
}

async function main() {
  const mode = process.argv[2];
  const raw = await readStdin();
  const payload = JSON.parse(raw);

  if (mode === "inspect") {
    const files = payload.files as { name: string; path: string }[];
    const tools: {
      name: string;
      path: string;
      description: string;
      inputSchema: Record<string, unknown>;
      effect: "read" | "write" | "external";
    }[] = [];
    const broken: { name: string; path: string; reason: string }[] = [];
    for (const file of files) {
      try {
        const mod = await import(pathToFileURL(file.path).href);
        const checked = validateModule(mod);
        if (!checked.ok) {
          broken.push({
            name: file.name,
            path: file.path,
            reason: checked.reason,
          });
          continue;
        }
        tools.push({
          name: file.name,
          path: file.path,
          description: checked.description,
          inputSchema: checked.inputSchema,
          effect: checked.effect,
        });
      } catch (cause) {
        broken.push({
          name: file.name,
          path: file.path,
          reason: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
    process.stdout.write(JSON.stringify({ tools, broken }));
    return;
  }

  if (mode === "run") {
    const { path, input, cwd } = payload as {
      path: string;
      input: unknown;
      cwd: string;
    };
    try {
      const mod = await import(pathToFileURL(path).href);
      const checked = validateModule(mod);
      if (!checked.ok) {
        process.stdout.write(
          JSON.stringify({ ok: false, message: checked.reason }),
        );
        return;
      }
      const result = await checked.execute(input, { cwd });
      process.stdout.write(
        JSON.stringify({ ok: true, content: normalizeOutput(result) }),
      );
    } catch (cause) {
      process.stdout.write(
        JSON.stringify({
          ok: false,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    }
    return;
  }

  process.stderr.write(`unknown mode: ${String(mode)}\n`);
  process.exitCode = 1;
}

await main();

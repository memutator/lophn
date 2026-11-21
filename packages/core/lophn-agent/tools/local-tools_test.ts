import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  discoverLocalToolFiles,
  loadLocalTools,
  parseLocalToolName,
} from "./local-tools.ts";
import type { ToolContext } from "./tool-context.ts";

const dummyCtx: ToolContext = {
  signal: new AbortController().signal,
} as ToolContext;

test("local tools override by layer order, strip internal LOPHN_ env, and skip broken files", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-local-tools-"));
  const prevSecret = process.env.LOPHN_AGENT_CREDENTIAL;
  process.env.LOPHN_AGENT_CREDENTIAL = "secret-token-must-not-leak";
  try {
    const globalDir = join(root, "global");
    const workspaceDir = join(root, "workspace");
    await mkdir(globalDir, { recursive: true });
    await mkdir(workspaceDir, { recursive: true });

    await writeFile(
      join(globalDir, "echo.ts"),
      `export default {
        description: "Global echo",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
        effect: "read",
        execute(input: { text?: string }) {
          return "global:" + (input.text ?? "");
        },
      };\n`,
    );
    await writeFile(
      join(workspaceDir, "echo.ts"),
      `export default {
        description: "Workspace echo",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
        effect: "read",
        execute(input: { text?: string }, ctx: { cwd: string }) {
          return JSON.stringify({
            text: "ws:" + (input.text ?? ""),
            cwd: ctx.cwd,
            leaked: process.env.LOPHN_AGENT_CREDENTIAL ?? null,
          });
        },
      };\n`,
    );
    await writeFile(join(workspaceDir, "broken.ts"), `export default 123;\n`);
    await writeFile(join(workspaceDir, "_helper.ts"), `export const x = 1;\n`);

    const files = await discoverLocalToolFiles([globalDir, workspaceDir]);
    assert.deepEqual(
      files.map((f) => f.name),
      ["broken", "echo"],
    );

    const tools = await loadLocalTools([globalDir, workspaceDir], workspaceDir);
    assert.equal(tools.length, 1);
    assert.equal(tools[0]!.name, "local__echo");
    assert.equal(tools[0]!.description, "Workspace echo");
    assert.equal(parseLocalToolName(tools[0]!.name), "echo");

    const ran = await tools[0]!.handler!({ text: "hi" }, dummyCtx);
    assert.ok(ran.ok);
    const parsed = JSON.parse(String(ran.value.content)) as {
      text: string;
      cwd: string;
      leaked: string | null;
    };
    assert.equal(parsed.text, "ws:hi");
    assert.equal(parsed.cwd, workspaceDir);
    assert.equal(parsed.leaked, null);
  } finally {
    if (prevSecret === undefined) delete process.env.LOPHN_AGENT_CREDENTIAL;
    else process.env.LOPHN_AGENT_CREDENTIAL = prevSecret;
    await rm(root, { recursive: true, force: true });
  }
});

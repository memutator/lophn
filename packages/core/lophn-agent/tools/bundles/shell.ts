import { runShell } from "../shell/run.ts";
import type { ToolDefinition } from "../registry.ts";
import type { TOOL_INPUTS } from "../../../../protocol/lophn-agent/tool-catalog.ts";
import type { z } from "zod";
import { defineBuiltin } from "./common.ts";

// place의 첫 폴더에서 명령을 돌린다. OS sandbox도 묻기도 없다(Gate를 거치지 않는다).
export const SHELL_TOOLS: readonly ToolDefinition[] = [
  defineBuiltin({
    name: "shell.run",
    description:
      "Run a shell command with /bin/sh in the place's first folder. Environment variables are limited and secrets are not available. timeout_ms defaults to 120000 and is at most 600000. Output is capped at 1 MiB per stream.",
    effect: "read",
    handler: (input, ctx) =>
      runShell(input as z.infer<(typeof TOOL_INPUTS)["shell.run"]>, ctx),
  }),
];

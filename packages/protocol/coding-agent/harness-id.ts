import { z } from "zod";

export const HARNESS_IDS = [
  "claude",
  "codex",
  "opencode",
  "pi",
  "omp",
  "cursor",
  "copilot",
  "kimi",
  "kiro",
  "antigravity",
  "grok",
  "droid",
  "amp",
  "devin",
  "qwen",
  "qoder",
  "hermes",
  "muse",
  "codebuddy",
  "command-code",
  "prime-agent",
  "mimocode",
  "cline",
  "letta",
  "kilo",
] as const;

export const harnessIdSchema = z.enum(HARNESS_IDS);

export type HarnessId = z.infer<typeof harnessIdSchema>;

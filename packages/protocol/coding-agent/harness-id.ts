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

// call 봉투의 options다. 새 coding session을 띄울 때만 뜻이 있고, 빠진 칸은 Settings 기본이다.
export const codingOptionsSchema = z.strictObject({
  harness: harnessIdSchema.optional(),
  model: z.string().min(1).optional(),
});
export type CodingOptions = z.infer<typeof codingOptionsSchema>;

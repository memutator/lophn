// 어떤 tool이 어느 workspace 종류에 있는지는 protocol의 `workspaceToolNames`(lophn-agent/tool-lists.ts)다.

// model에 보이는 tool 순서다. 순서가 바뀌면 같은 재료가 같은 bytes가 아니게 된다.
export const TOOL_ORDER = [
  "file.read",
  "file.write",
  "file.edit",
  "file.glob",
  "file.grep",
  "file.outline",
  "pdf.read",
  "image.read",
  "shell.run",
  "web.search",
  "web.fetch",
  "ask",
  "skill.read",
  "agent.memory",
  "visual.show",
  "lophn",
] as const;

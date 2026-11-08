// `lophn ext call`: 할당받은 shell extension의 tool을 부른다. harness agent가 lophn runtime의 `ext__<id>__<tool>` tool 대신 쓰는 길이다.
// Gate 판정(할당했는가, 켜진 extension인가)은 route가 하므로 harness agent도 lophn runtime과 같은 자격·판정이다.
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import { extensionToolsCall } from "../../protocol/lophn-agent/extension-tools.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { defineCommand } from "./types.ts";

const call = defineCommand({
  name: "ext.call",
  summary: "Call a tool of a shell extension assigned to you",
  description:
    "Call a tool of a shell extension that the person assigned to you. <name> is the tool's full name `ext__<extension id>__<tool>`; " +
    "--input '<json>' is the tool's own input object (the tool's fields go straight into it, so a field named `name` cannot be passed). " +
    "It prints the tool's text; an image result prints as an `[image]` line (it is not written to a file). " +
    "forbidden means the extension is not assigned to you or the tool is gone; unavailable means the shell is not running.",
  // `--input`은 JSON object를 입력에 합치므로 tool의 입력 칸이 이 object에 그대로 들어온다.
  input: z.looseObject({ name: z.string().min(1).max(200) }),
  positional: ["name"],
  effect: "external",
  routes: [extensionToolsCall],
  workspaces: WORKSPACE_KINDS,
  run: async ({ name, ...toolInput }, ctx) => {
    const called = await ctx.core.read(extensionToolsCall, {
      name,
      input: toolInput,
    });
    if (!called.ok) return called;
    const blocks = called.value.content;
    return ok({
      summary: `called ${name}`,
      content: {
        content: blocks.map((block) =>
          block.type === "text"
            ? block
            : { type: "image", mimeType: block.mimeType },
        ),
      },
      text: blocks
        .map((block) => (block.type === "text" ? block.text : "[image]"))
        .join("\n"),
    });
  },
});

export const EXT_COMMANDS = [call];

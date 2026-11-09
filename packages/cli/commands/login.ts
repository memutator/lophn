// `lophn login list`: 저장된 site login의 id·label·origin·username·note와 TOTP 유무를 읽는다.
// 값(password·TOTP seed)은 어디에도 없어서 바깥 글로 감싸지 않는다. 사람이 쓴 metadata다.
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { loginOriginSchema, loginsList } from "../../protocol/secrets/mod.ts";
import { defineCommand } from "./types.ts";

const list = defineCommand({
  name: "login.list",
  summary: "List saved site logins",
  description:
    "List the site logins the person saved: id, label, origin, username, note and whether a TOTP seed is set. Passwords are never shown. Pass --origin (like https://example.com) to list only logins for that exact origin.",
  input: z.strictObject({ origin: loginOriginSchema.optional() }),
  effect: "read",
  routes: [loginsList],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const read = await ctx.core.read(loginsList, input);
    if (!read.ok) return read;
    return ok({
      summary: `${read.value.length} logins`,
      content: { logins: read.value },
      arrayKeys: ["logins"],
    });
  },
});

export const LOGIN_COMMANDS = [list];

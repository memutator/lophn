// `lophn login list`: 저장된 site login의 id·label·origin·username·note·profile과 TOTP 유무를 읽는다. agent는 한 browser profile의 login만 본다.
// `lophn login request`: 사람에게 login 저장이나 값 한 번 넣기를 요청한다.
// 값(password·TOTP seed)은 어디에도 없어서 바깥 글로 감싸지 않는다. 사람이 쓴 metadata다.
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import {
  inputRequestAsk,
  loginRequestModeSchema,
} from "../../protocol/lophn-agent/input-request.ts";
import { loginOriginSchema, loginsList } from "../../protocol/secrets/mod.ts";
import { defineCommand } from "./types.ts";

const list = defineCommand({
  name: "login.list",
  summary: "List saved site logins",
  description:
    "List the site logins the person saved: id, label, origin, username, note, browser profile and whether a TOTP seed is set. Passwords are never shown. " +
    "Only logins of one browser profile are listed: with --tab, the profile of that tab you opened; without it, the profile your agent's tabs open with. A preview or artifact tab holds the default profile's logins, listed only when your agent uses the default profile. `browser act fill-login` fills only logins listed for that tab. " +
    "Pass --origin (like https://example.com) to list only logins for that exact origin.",
  input: z.strictObject({
    origin: loginOriginSchema.optional(),
    tab: idSchema("tab").optional(),
  }),
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

const request = defineCommand({
  name: "login.request",
  summary: "Ask the person to save a site login or type one value",
  description:
    "Ask the person, through a card in the conversation, to type a secret into the input at --ref of a tab you opened. The person sees the page origin measured by the shell (not text you write), clicks Enter, and types in a protected window; the value never reaches you. " +
    "--mode save: the person saves a login (label, username, password, optional TOTP key) for that origin in that tab's browser profile; you get {login: <id>}, then call `browser act fill-login`. --label is the suggested name. " +
    "--mode once: the person types one value (a 2FA code, a one-time key) that is typed into that input and not saved; you get {filled: true}. " +
    "Other results: {cancelled: true} (the person said no, or sent a message instead) and {unattended: true} (no person is here; do not retry, report what remains). One request waits per session; others queue behind it. " +
    "Take the ref from the latest browser snapshot; a stale ref is conflict.",
  input: z.strictObject({
    tab: idSchema("tab"),
    ref: z.string().regex(/^e[1-9][0-9]{0,8}$/),
    mode: loginRequestModeSchema,
    label: z.string().min(1).max(100).optional(),
  }),
  positional: ["tab"],
  effect: "read",
  routes: [inputRequestAsk],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const result = await ctx.core.read(inputRequestAsk, {
      kind: "login",
      ...input,
    });
    if (!result.ok) return result;
    return ok({
      summary:
        "login" in result.value
          ? `saved ${result.value.login}`
          : "filled" in result.value
            ? "filled"
            : "cancelled" in result.value
              ? "cancelled"
              : "unattended",
      content: result.value,
    });
  },
});

export const LOGIN_COMMANDS = [list, request];

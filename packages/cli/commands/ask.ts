// `lophn ask secret`: secret이 들어가는 자리(provider key, custom provider, 앱이 선언한 secret, MCP server의 secret)나 로그인하는
// 자리(구독 provider, 앱 OAuth, MCP OAuth)를 가리켜 사람에게 넣어 달라고, 또는 로그인해 달라고 청한다.
// 값은 보호 입력 창으로만 들어가고 결과에도 없다. 자리의 이름과 목적지는 core가 정의·선언·설정에서 읽어 card에 보인다.
// flag는 slot의 field 이름 그대로다(`--sign-in`은 `sign_in`). 실패한 호출이 비어 있는 자리를 flag로 그대로 찍어 줄 수 있다.
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import {
  inputRequestAsk,
  secretSlotSchema,
} from "../../protocol/lophn-agent/input-request.ts";
import { customProtocolSchema } from "../../protocol/lophn-agent/custom-provider.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { secretNameSchema } from "../../protocol/secrets/secrets.ts";
import { defineCommand } from "./types.ts";

const secret = defineCommand({
  name: "ask.secret",
  summary:
    "Ask the person to enter a secret or to sign in, for a provider, an app or an MCP server",
  description:
    "Ask the person, through a card in the conversation, to enter a secret value in a protected window, or to sign in. The value never reaches you, and you never ask for it in the conversation. You name the place, not the secret; lophn finds the secret name, the target and where the value goes, and the card shows them. Places: " +
    "--provider <key> (home only) is a built-in model provider: openrouter, groq, deepseek, google-gemini (API key); anthropic, openai, xai (API key, or --sign-in for the person's subscription account); google-antigravity (sign-in only). An unknown key is not_found and lists the known keys. A provider that is not connected yet is connected once the key is stored or the sign-in ends. " +
    "--display-name <name> --base-url <https url> --protocol <openai-chat-completions|openai-responses|anthropic-messages> (home only) is a custom provider such as a gateway; the card shows the host, which the person checks before typing the key. " +
    "--app <app id> --secret <name> is an app secret that the app declared as `secret.use` and the person granted; in an app workspace --app is this app, and from home pass it. If the secret is declared with OAuth, the card is a sign-in. " +
    "--mcp <server name> [--part <part>] is an MCP server that already exists in the settings your session can reach (home: global, Home layer and its own definition; project or app: its own definition and this workspace). The card shows the server address. A server with nothing to ask (no secret, stdio) or that does not exist is not_found. When a server has several things to ask for, invalid_input lists the parts to pass in --part (sign_in, client, credential, header:<name>). " +
    "Results: {stored: true} (value entered); {signed_in: true} (sign-in done); {cancelled: true} (the person said no, or sent a message instead); {unattended: true} (no person is here; do not retry, report what remains). An error code carries no secret content: not_found, forbidden (that place is not yours), invalid_input, conflict (for example the OAuth client id of an app is not set, or a provider is already connected the other way). One request waits per session; others queue behind it.",
  input: z.strictObject({
    provider: z.string().min(1).max(64).optional(),
    sign_in: z.boolean().optional(),
    display_name: z.string().min(1).max(100).optional(),
    base_url: z.string().min(1).max(300).optional(),
    protocol: customProtocolSchema.optional(),
    app: idSchema("app").optional(),
    secret: secretNameSchema.optional(),
    mcp: z.string().min(1).max(32).optional(),
    part: z.string().min(1).max(80).optional(),
  }),
  effect: "read",
  routes: [inputRequestAsk],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const app =
      input.app ??
      (ctx.workspace?.kind === "app" ? ctx.workspace.id : undefined);
    const picked = [
      input.provider,
      input.base_url,
      input.secret,
      input.mcp,
    ].filter((one) => one !== undefined);
    const parsed = secretSlotSchema.safeParse(
      input.provider !== undefined
        ? { provider: input.provider, sign_in: input.sign_in }
        : input.base_url !== undefined
          ? {
              display_name: input.display_name,
              base_url: input.base_url,
              protocol: input.protocol,
            }
          : input.secret !== undefined
            ? { app, secret: input.secret }
            : { mcp: input.mcp, part: input.part },
    );
    if (picked.length !== 1 || !parsed.success) {
      return err({
        code: "invalid_input",
        message:
          "Name one place: --provider <key> [--sign-in]; --display-name <name> --base-url <url> --protocol <api>; --secret <name> [--app <app id>]; or --mcp <server> [--part <part>].",
      });
    }
    const result = await ctx.core.read(inputRequestAsk, {
      kind: "secret",
      slot: parsed.data,
    });
    if (!result.ok) return result;
    return ok({
      summary:
        "stored" in result.value
          ? "stored"
          : "signed_in" in result.value
            ? "signed_in"
            : "cancelled" in result.value
              ? "cancelled"
              : "unattended",
      content: result.value,
    });
  },
});

export const ASK_COMMANDS = [secret];

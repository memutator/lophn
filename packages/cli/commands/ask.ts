// `lophn ask secret`: secret이 들어가는 자리(provider key, 앱이 선언한 secret)를 가리켜 사람에게 값을 넣어 달라고 청한다.
// 값은 보호 입력 창으로만 들어가고 결과에도 없다. 자리의 이름과 목적지는 core가 정의·선언에서 읽어 card에 보인다.
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import { inputRequestAsk } from "../../protocol/lophn-agent/input-request.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { secretNameSchema } from "../../protocol/secrets/secrets.ts";
import { defineCommand } from "./types.ts";

const secret = defineCommand({
  name: "ask.secret",
  summary: "Ask the person to enter a provider key or an app secret",
  description:
    "Ask the person, through a card in the conversation, to enter a secret value in a protected window. The value never reaches you, and you never ask for it in the conversation. You name the place, not the secret: " +
    "--provider <definition key> (from home only) asks for the API key of a model provider (keys are listed by `providers/definitions`, like openrouter or anthropic); if that provider is not connected yet, it is connected once the key is stored. " +
    "--name <secret> asks for an app secret the app declared as `secret.use` and the person granted; in an app workspace it is this app, from home pass --app <app id>. " +
    "The card shows where the value will be sent (the provider endpoint, or the app's declared network destinations), read by lophn from the definition or declaration. " +
    "Results: {stored: true}; {cancelled: true} (the person said no, or sent a message instead); {unattended: true} (no person is here; do not retry, report what remains). An unknown place is not_found; an OAuth secret or a sign-in provider is invalid_input (the person signs in from the app's Access tab or Settings > Providers). One request waits per session; others queue behind it.",
  input: z.strictObject({
    provider: z.string().min(1).max(64).optional(),
    name: secretNameSchema.optional(),
    app: idSchema("app").optional(),
  }),
  effect: "read",
  routes: [inputRequestAsk],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const app =
      input.app ??
      (ctx.workspace?.kind === "app" ? ctx.workspace.id : undefined);
    const slot =
      input.provider !== undefined && input.name === undefined
        ? { provider: input.provider }
        : input.name !== undefined &&
            input.provider === undefined &&
            app !== undefined
          ? { app, secret: input.name }
          : undefined;
    if (slot === undefined) {
      return err({
        code: "invalid_input",
        message:
          "Pass either --provider <definition key>, or --name <secret> (with --app <app id> outside an app workspace).",
      });
    }
    const result = await ctx.core.read(inputRequestAsk, {
      kind: "secret",
      slot,
    });
    if (!result.ok) return result;
    return ok({
      summary:
        "stored" in result.value
          ? "stored"
          : "cancelled" in result.value
            ? "cancelled"
            : "unattended",
      content: result.value,
    });
  },
});

export const ASK_COMMANDS = [secret];

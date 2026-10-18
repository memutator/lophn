import { assertEquals } from "@std/assert";
import { trustKeys } from "./trust.ts";

// 엉뚱한 화면에 Enter를 넣으면 사람의 권한 물음에 답해 버린다.
Deno.test("trustKeys picks Yes only on the folder trust screen", () => {
  const trust = `Accessing workspace: /tmp/lophn-eval/app

Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team).

❯ 1. No, exit
  2. Yes, I trust this folder

Enter to confirm · Esc to cancel`;
  const prompt = `╭──────────────────╮
│ > Try "fix lint errors"
╰──────────────────╯
  ? for shortcuts
Do you want to proceed?
❯ 1. Yes
  2. No`;
  assertEquals(trustKeys(trust), ["\x1b[B", "\r"]);
  assertEquals(trustKeys(prompt), null);
});

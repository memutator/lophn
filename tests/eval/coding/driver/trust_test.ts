import { assertEquals } from "@std/assert";
import { trustKeys } from "./trust.ts";

// 엉뚱한 화면에 Enter를 넣으면 사람의 권한 물음에 답해 버린다.
Deno.test("trustKeys picks Yes only on the folder trust screen", () => {
  // 첫 진짜 run의 tail. plain()을 거치면 공백이 없다.
  const trust = `
────────────────────────────────────────────────────────────────────────────────
Accessingworkspace:

/tmp/lophn-eval/lophn-e2e-bd454300a2b24901/work/calendar

Quicksafetycheck:Isthisaprojectyoucreatedoroneyoutrust?(Likeyour
owncode,awell-knownopensourceproject,orworkfromyourteam).Ifnot,
takeamomenttoreviewwhat'sinthisfolderfirst.

ClaudeCode'llbeabletoread,edit,andexecutefileshere.

Securityguide

❯No,exit
Yes,Itrustthisfolder

Entertoconfirm·Esctocancel
`;
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

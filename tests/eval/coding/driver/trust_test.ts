import { assertEquals } from "@std/assert";
import { trustCursor } from "./trust.ts";

// 커서가 No, exit에 있을 때 Enter를 넣으면 Claude Code가 끝난다. 다시 그려진 화면의 마지막 선택 줄로 판단해야 한다.
Deno.test("trustCursor follows the latest selection line of the folder trust screen", () => {
  // calendar-mvp run의 tail. 아래 화살표로 Yes에 갔다가, 다시 그려진 화면에서 No로 돌아갔다.
  const head = `
Quicksafetycheck:Isthisaprojectyoucreatedoroneyoutrust?(Likeyour
owncode,awell-knownopensourceproject,orworkfromyourteam).

Securityguide

❯No,exit
Yes,Itrustthisfolder

Entertoconfirm·Esctocancel`;
  const down = `${head}
 No, exit❯Yes, I trust this folder`;
  const redrawn = `${down}
❯No, exit Yes, I trust this folder
`;
  const prompt = `╭──────────────────╮
│ > Try "fix lint errors"
╰──────────────────╯
Do you want to proceed?
❯ 1. Yes
  2. No`;
  assertEquals(trustCursor(head), "no");
  assertEquals(trustCursor(down), "yes");
  assertEquals(trustCursor(redrawn), "no");
  assertEquals(trustCursor(prompt), null);
});

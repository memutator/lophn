import { assert, assertEquals } from "@std/assert";
import { blueprintSdkNames, definesName, importsPackage } from "./reuse.ts";

Deno.test("sdk_dependencies에서 template 밖 이름을 가려낼 수 있다", () => {
  const text = `export default makeBlueprint({
    name: "앱",
    sdk_dependencies: [
      { name: "@lophn/blueprint", version: "1.0.0" },
      { name: "@me/notify-kit", version: "1.0.0" },
    ],
  });`;
  assertEquals(blueprintSdkNames(text), ["@lophn/blueprint", "@me/notify-kit"]);
});

Deno.test("의존 선언 줄과 주석·문자열은 import가 아니고 import 꼴은 import다", () => {
  const name = "@me/x";
  const table: [string, boolean][] = [
    [`{ name: "@me/x", version: "1.0.0" },`, false],
    [`// import { a } from "@me/x";`, false],
    [` * from "@me/x"`, false],
    [`const s = 'from "@me/x"';`, false],
    [`import { a } from "@me/y";`, false],
    [`import { a } from "@me/xy";`, false],
    [`import { a } from "@me/x";`, true],
    [`import { a } from "@me/x/sub";`, true],
    [`} from "@me/x";`, true],
    [`import "@me/x";`, true],
    [`const m = await import("@me/x");`, true],
  ];
  for (const [line, want] of table) {
    assert(importsPackage(line, name) === want, line);
  }
});

Deno.test("export 이름을 다시 정의한 줄만 정의다: import는 정의가 아니다", () => {
  const table: [string, boolean][] = [
    [`import { sendNotice } from "@me/x";`, false],
    [`  sendNotice(a);`, false],
    [`export function sendNotice(a) {`, true],
    [`export async function sendNotice(a) {`, true],
    [`function* sendNotice() {`, true],
    [`const sendNotice = () => 1;`, true],
    [`export class sendNotice {}`, true],
    [`export type sendNotice = string;`, true],
    [`function sendNoticeAll() {}`, false],
  ];
  for (const [line, want] of table) {
    assert(definesName(line, "sendNotice") === want, line);
  }
});

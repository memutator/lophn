// en catalog에서 placeholder 종류를 뽑아 src/wording/placeholders.ts를 만든다.
// 실행: deno task wording [--check]. `--check`는 파일이 catalog와 같은지만 본다(tests/wording_test.ts).
import { render } from "@lophn/wording/generate";
import { en } from "../src/wording/en.ts";

const target = new URL("../src/wording/placeholders.ts", import.meta.url);
const next = render(en, "deno task wording");

if (Deno.args.includes("--check")) {
  const current = await Deno.readTextFile(target);
  if (current !== next) {
    console.error(
      "placeholders.ts가 en catalog와 다르다. deno task wording을 돌린다.",
    );
    Deno.exit(1);
  }
} else {
  await Deno.writeTextFile(target, next);
}

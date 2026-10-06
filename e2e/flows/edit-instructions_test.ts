// lophn-agent slice flow E2E: edit-instructions(docs/flows/edit-instructions.md). 실제 shell(headless)·core·
// documents worker를 임시 LOPHN_HOME으로 띄우고 전역 [Instructions] 편집기를 연다(settings 화면이 아직 없어
// 개발 시작 자리 `LOPHN_SHELL_START=instructions:global`로 같은 진입을 연다).
// - 1: 파일이 없으면 빈 편집 초안만 보이고 아무 파일도 만들지 않는다. 경로·version 식별자는 화면에 없다.
// - 2: 사람이 쓰고 편집을 끝내면(CommandOrControl+S) data root의 LOPHN.md가 생기고 같은 문서 화면이 된다.
// - 3: 연 뒤 바깥에서 파일이 바뀌면 저장은 충돌로 멈추고 바깥 글을 덮지 않는다.
// `LOPHN_SHELL_SHOT_DIR`을 주면 각 단계의 headless 화면을 그 폴더에 남긴다.
import { assert, assertEquals } from "@std/assert";

import { e2eEnabled } from "../harness.ts";
import { type FlowShell, openFlowShell, removeHome } from "../flow-support.ts";

async function shot(flow: FlowShell, name: string): Promise<void> {
  const dir = Deno.env.get("LOPHN_SHELL_SHOT_DIR");
  if (!dir) return;
  const settled = `${dir}/window-1-settled.png`;
  const stamp = () =>
    Deno.stat(settled).then((info) => info.mtime?.getTime() ?? 0, () => 0);
  const before = await stamp();
  await flow.evaluate(
    `(() => { document.activeElement?.blur?.(); return true; })()`,
  );
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && await stamp() <= before) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await Deno.copyFile(settled, `${dir}/${name}.png`);
}

const INSERT = (selector: string, text: string) =>
  `(() => {
    const content = document.querySelector(${JSON.stringify(selector)});
    content.focus();
    const range = document.createRange();
    range.selectNodeContents(content);
    range.collapse(false);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return document.execCommand("insertText", false, ${JSON.stringify(text)});
  })()`;

const CTRL_S = (selector: string) =>
  `(() => { document.querySelector(${
    JSON.stringify(selector)
  }).dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true })); return true; })()`;

Deno.test({
  name:
    "shell/editor#R17 shell/editor#R2 shell/editor#R15 flow edit-instructions: 파일이 없으면 빈 초안 → 첫 저장이 LOPHN.md를 만들고 같은 문서 화면 → 바깥 변경은 충돌",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const flow = await openFlowShell({ start: "instructions:global" });
    const file = `${flow.home}/LOPHN.md`;
    try {
      await t.step(
        "shell/editor#R17 shell/editor#R2: 1 파일이 없으면 빈 편집 초안만 보이고 파일을 만들지 않으며 경로·식별자는 숨긴다",
        async () => {
          await flow.until(
            `document.querySelector("[data-instructions-view='draft']") !== null`,
            "빈 지침 초안이 열리지 않았다",
          );
          assertEquals(
            await flow.text("[data-document-title]"),
            "Global instructions",
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-instructions-draft]").getAttribute("data-instructions-draft")`,
            ),
            "draft",
          );
          assertEquals(
            await Deno.stat(file).then(() => true, () => false),
            false,
          );
          const text = String(
            await flow.evaluate(`document.body.innerText`),
          );
          for (const hidden of ["LOPHN.md", "ver_", "doc_", flow.home]) {
            assert(!text.includes(hidden), `${hidden}가 화면에 보인다`);
          }
          await shot(flow, "instructions-empty");
        },
      );

      await t.step(
        "shell/editor#R17 shell/editor#R2 shell/editor#R12: 2 사람이 쓰고 편집을 끝내면 data root에 LOPHN.md가 생기고 같은 문서 화면이 된다",
        async () => {
          assertEquals(
            await flow.evaluate(
              INSERT(
                "[data-instructions-view='draft'] .cm-content",
                "# Instructions\n\nAlways answer briefly.\n",
              ),
            ),
            true,
          );
          // 고치기만으로는 파일이 없다. 저장 버튼도 없다.
          assertEquals(await flow.count("[data-save]"), 0);
          assertEquals(
            await Deno.stat(file).then(() => true, () => false),
            false,
          );
          await shot(flow, "instructions-draft");
          await flow.evaluate(CTRL_S("[data-instructions-view='draft']"));
          await flow.until(
            `document.querySelector("[data-instructions-view='document']") !== null`,
            "저장한 지침이 문서 화면으로 바뀌지 않았다",
          );
          assertEquals(
            await Deno.readTextFile(file),
            "# Instructions\n\nAlways answer briefly.\n",
          );
          assertEquals(
            await flow.text("[data-document-title]"),
            "Global instructions",
          );
          const text = String(
            await flow.evaluate(`document.body.innerText`),
          );
          for (const hidden of ["LOPHN.md", "ver_", "doc_", flow.home]) {
            assert(!text.includes(hidden), `${hidden}가 화면에 보인다`);
          }
          await shot(flow, "instructions-saved");
        },
      );

      await t.step(
        "shell/editor#R17 shell/editor#R15: 3 연 뒤 바깥에서 바뀐 파일은 저장을 충돌로 멈추고 바깥 글을 덮지 않는다",
        async () => {
          await flow.click("[data-edit-toggle]");
          await flow.until(
            `document.querySelector("[data-document-view='edit'] .cm-content") !== null`,
            "편집으로 바뀌지 않았다",
          );
          assertEquals(
            await flow.evaluate(
              INSERT("[data-document-view='edit'] .cm-content", "Mine.\n"),
            ),
            true,
          );
          const outside = "# Instructions\n\nEdited elsewhere.\n";
          await Deno.writeTextFile(file, outside);
          await flow.evaluate(CTRL_S("[data-document-view='edit']"));
          await flow.until(
            `document.querySelector("[data-notice='conflict']") !== null`,
            "충돌 안내가 보이지 않았다",
          );
          assertEquals(await Deno.readTextFile(file), outside);
          await shot(flow, "instructions-conflict");
          // 해결 화면에서 바깥 글을 고르면 안내가 사라지고 파일은 그대로다(창을 닫을 수 있다).
          await flow.click("[data-notice-compare]");
          await flow.until(
            `document.querySelector("[data-conflict-view]") !== null`,
            "해결 화면이 열리지 않았다",
          );
          await shot(flow, "instructions-resolve");
          await flow.click("[data-conflict-theirs]");
          await flow.until(
            `document.querySelector("[data-notice='conflict']") === null`,
            "충돌 안내가 사라지지 않았다",
          );
          assertEquals(await Deno.readTextFile(file), outside);
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
    }
  },
});

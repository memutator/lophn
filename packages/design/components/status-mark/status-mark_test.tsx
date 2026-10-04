import { assert, assertEquals } from "@std/assert";
import { type StatusTone, tokens } from "../../tokens.ts";
import { DiffMark, StatusMark } from "./status-mark.tsx";
import { one, render, style } from "../testing.ts";

const tones = Object.keys(tokens.status) as StatusTone[];

Deno.test("shell/design-system#R2: 상태는 색을 빼도 token의 아이콘 모양과 글로 구별한다", () => {
  using view = render(
    <div>
      {tones.map((tone) => <StatusMark key={tone} tone={tone} label={tone} />)}
    </div>,
  );
  const marks = [...view.container.querySelectorAll("[data-tone]")];
  const shapes = marks.map((mark) => {
    const tone = mark.getAttribute("data-tone") as StatusTone;
    const icon = one(mark, "svg");
    assert(
      icon.classList.contains(`lucide-${tokens.status[tone].icon}`),
      `${tone} icon`,
    );
    assertEquals(mark.textContent, tone);
    return icon.getAttribute("class");
  });
  assertEquals(new Set(shapes).size, tones.length);
});

Deno.test("shell/design-system#R2: 상태 라벨은 중립색이고 표지만 상태색이다", () => {
  using view = render(<StatusMark tone="critical" label="Stopped" />);
  const label = one(view.container, "span > span");
  assertEquals(style(label).color, tokens.color.text.secondary.light);
  assertEquals(
    style(one(view.container, "svg")).color,
    tokens.status.critical.marker.light,
  );
});

Deno.test("shell/design-system#R2: diff 추가·삭제는 색 없이 +/− 기호로 읽는다", () => {
  using view = render(
    <div>
      <DiffMark kind="add" />
      <DiffMark kind="delete" />
    </div>,
  );
  const signs = [...view.container.querySelectorAll("[data-diff]")].map((
    sign,
  ) => sign.textContent);
  assertEquals(signs, ["+", "−"]);
});

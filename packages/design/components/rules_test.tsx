// 여러 컴포넌트를 한 화면처럼 같이 그려 크기·기준선·금지 표현을 함께 본다.
import { assert, assertEquals } from "@std/assert";
import { FolderOpen, Trash2 } from "lucide-react";
import { tokens } from "../tokens.ts";
import {
  AuthorMark,
  Button,
  Checkbox,
  type ControlSize,
  DiffMark,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Kbd,
  Select,
  Skeleton,
  StaleNote,
  StatusMark,
  Switch,
  Tab,
  TabList,
  Tabs,
  Textarea,
} from "./mod.ts";
import { one, render, style } from "./testing.ts";

const options = [{ value: "a", label: "Alpha" }];

function row(size: ControlSize) {
  return (
    <div data-row={size}>
      <Button size={size}>Save</Button>
      <IconButton size={size} icon={Trash2} label="Remove" />
      <Field label="Name">
        <Input size={size} />
      </Field>
      <Field label="Sort">
        <Select size={size} options={options} defaultValue="a" />
      </Field>
      <Tabs defaultValue="a">
        <TabList>
          <Tab size={size} value="a">Alpha</Tab>
        </TabList>
      </Tabs>
    </div>
  );
}

Deno.test("shell/design-system#R26: 같은 크기의 버튼·입력·선택·탭은 높이·글자·기준선 상자가 같다", () => {
  using view = render(
    <div>
      {row("sm")}
      {row("md")}
      {row("lg")}
    </div>,
  );
  const heights = { sm: "28px", md: "32px", lg: "36px" };
  for (const size of ["sm", "md", "lg"] as const) {
    const controls = [
      ...one(view.container, `[data-row=${size}]`).querySelectorAll(
        "button, input",
      ),
    ];
    assertEquals(controls.length, 5);
    for (const control of controls) {
      const computed = style(control);
      const name = `${size} ${control.tagName} ${control.className}`;
      assertEquals(computed.height, heights[size], name);
      assertEquals(computed.boxSizing, "border-box", name);
      assertEquals(computed.fontSize, "14px", name);
      assertEquals(computed.lineHeight, "22px", name);
      // 높이만이 아니라 위아래 border·padding이 대칭이어야 글자 상자가 같은 기준선에 놓인다.
      assertEquals(computed.borderTopWidth, computed.borderBottomWidth, name);
      assertEquals(computed.paddingTop, computed.paddingBottom, name);
    }
    const tab = style(one(view.container, `[data-row=${size}] [role=tab]`));
    assertEquals(tab.paddingLeft, { sm: "8px", md: "12px", lg: "14px" }[size]);
  }
});

function everything() {
  return (
    <div>
      {row("md")}
      <Field label="Notes" help="Optional." error="Too long.">
        <Textarea />
      </Field>
      <Checkbox label="Include archived" defaultChecked />
      <Switch label="Open at login" defaultChecked />
      <Kbd keys={["Ctrl", "K"]} />
      <Tabs defaultValue="a">
        <TabList>
          <Tab value="a">Alpha</Tab>
          <Tab value="b">Beta</Tab>
        </TabList>
      </Tabs>
      <Skeleton shape="line" lines={2} />
      <EmptyState
        icon={FolderOpen}
        message="No projects yet."
        action={{ label: "Add project", onSelect: () => {} }}
      />
      <ErrorState target="Projects" onRetry={() => {}} />
      <StaleNote updatedAt={new Date(0)} now={new Date(3_600_000)} />
      <AuthorMark author="Operator" />
      <StatusMark tone="good" label="Running" />
      <DiffMark kind="add" />
    </div>
  );
}

Deno.test("shell/design-system#R6: 그린 컴포넌트에 그림자·그라데이션·대문자·700 굵기·emoji·제목이 없다", () => {
  using view = render(everything());
  for (const element of view.container.querySelectorAll("*")) {
    const computed = style(element);
    const name = `${element.tagName} ${element.getAttribute("class")}`;
    assert(["", "none"].includes(computed.boxShadow), `shadow on ${name}`);
    assert(
      ["", "none", "initial"].includes(computed.backgroundImage),
      `background image ${computed.backgroundImage} on ${name}`,
    );
    assert(computed.textTransform !== "uppercase", `uppercase on ${name}`);
    const keyword: Record<string, number> = { "": 400, normal: 400, bold: 700 };
    const weight = keyword[computed.fontWeight] ?? Number(computed.fontWeight);
    assert(
      weight <= tokens.font.weight.semibold,
      `weight ${weight} on ${name}`,
    );
  }
  assertEquals(view.container.querySelectorAll("h1,h2,h3,h4,h5,h6").length, 0);
  assert(!/\p{Extended_Pictographic}/u.test(view.container.textContent ?? ""));
});

Deno.test("shell/design-system#R43: 모든 아이콘은 Lucide 선 1.5와 14·16·20px만 쓴다", () => {
  using view = render(everything());
  const icons = [...view.container.querySelectorAll("svg")];
  assert(icons.length > 5);
  for (const icon of icons) {
    assert(icon.classList.contains("lucide"), icon.getAttribute("class")!);
    assertEquals(icon.getAttribute("stroke-width"), "1.5");
    assert(["14", "16", "20"].includes(icon.getAttribute("width")!));
  }
});

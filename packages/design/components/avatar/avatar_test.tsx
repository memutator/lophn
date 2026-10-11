import { assertEquals } from "@std/assert";
import { Avatar } from "./avatar.tsx";
import { one, render } from "../testing.ts";

Deno.test("shell/desktop#R40 [agent-I20]: icon profile은 icon id와 svg 하나로 그리고 기본 크기는 md다", () => {
  using view = render(<Avatar profile={{ kind: "icon", icon: "contexts" }} />);
  const avatar = one(view.container, "[data-avatar]");
  assertEquals(avatar.dataset.kind, "icon");
  assertEquals(avatar.dataset.icon, "contexts");
  assertEquals(avatar.dataset.size, "md");
  assertEquals(avatar.querySelectorAll("svg").length, 1);
  assertEquals(avatar.querySelectorAll("img").length, 0);
});

Deno.test("shell/desktop#R40 [agent-I20]: 올린 이미지는 img 하나이고 주소가 그대로 간다", () => {
  using view = render(
    <Avatar
      profile={{ kind: "image", src: "blob:avatar-eval-analyst" }}
      size="lg"
    />,
  );
  const avatar = one(view.container, "[data-avatar]");
  assertEquals(avatar.dataset.kind, "image");
  assertEquals(avatar.dataset.size, "lg");
  const image = avatar.querySelectorAll("img");
  assertEquals(image.length, 1);
  assertEquals(image[0].getAttribute("src"), "blob:avatar-eval-analyst");
  assertEquals(avatar.querySelectorAll("svg").length, 0);
});

Deno.test("shell/desktop#R40 [agent-I20]: 이니셜은 글자를 그대로 보이고 크기는 sm·md·lg다", () => {
  const sizes = ["sm", "md", "lg"] as const;
  for (const size of sizes) {
    using view = render(
      <Avatar profile={{ kind: "initial", text: "EA" }} size={size} />,
    );
    const avatar = one(view.container, "[data-avatar]");
    assertEquals(avatar.dataset.kind, "initial");
    assertEquals(avatar.dataset.size, size);
    assertEquals(avatar.textContent, "EA");
    assertEquals(avatar.querySelectorAll("svg, img").length, 0);
  }
});

Deno.test("shell/desktop#R40 [agent-I20]: label이 있으면 이름 붙은 img이고 없으면 장식으로 숨긴다", () => {
  {
    using view = render(
      <Avatar
        profile={{ kind: "icon", icon: "search" }}
        label="Eval analyst"
      />,
    );
    const avatar = one(view.container, "[data-avatar]");
    assertEquals(avatar.getAttribute("role"), "img");
    assertEquals(avatar.getAttribute("aria-label"), "Eval analyst");
    assertEquals(avatar.getAttribute("aria-hidden"), null);
  }
  {
    using view = render(<Avatar profile={{ kind: "icon", icon: "search" }} />);
    const avatar = one(view.container, "[data-avatar]");
    assertEquals(avatar.getAttribute("aria-hidden"), "true");
    assertEquals(avatar.getAttribute("role"), null);
    assertEquals(avatar.getAttribute("aria-label"), null);
  }
});

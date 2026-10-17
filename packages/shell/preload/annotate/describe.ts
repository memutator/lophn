/// <reference lib="dom" />
// 고른 요소를 말로 옮기는 순수 함수들. DOM 객체를 인자로 받는다.

const NAME_MAX = 120;
const TEXT_MAX = 200;

const TAG_ROLES: Record<string, string> = {
  a: "link",
  button: "button",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  img: "img",
  li: "listitem",
  ul: "list",
  ol: "list",
  nav: "navigation",
  table: "table",
  tr: "row",
  td: "cell",
  th: "columnheader",
  select: "combobox",
  textarea: "textbox",
  dialog: "dialog",
};

const INPUT_ROLES: Record<string, string> = {
  checkbox: "checkbox",
  radio: "radio",
  button: "button",
  submit: "button",
  range: "slider",
};

const clean = (value: string | null | undefined, max: number) => {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text === "" ? null : text.slice(0, max);
};

export function roleOf(el: Element): string | null {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === "input") {
    return INPUT_ROLES[el.getAttribute("type") ?? "text"] ?? "textbox";
  }
  return TAG_ROLES[tag] ?? null;
}

export function nameOf(el: Element): string | null {
  const labelledby = el.getAttribute("aria-labelledby");
  const labelled = labelledby
    ?.split(/\s+/)
    .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
    .join(" ");
  const control = el as Element & { labels?: NodeListOf<HTMLLabelElement> };
  const linked = control.labels?.[0]?.textContent;
  return clean(el.getAttribute("aria-label"), NAME_MAX) ??
    clean(labelled, NAME_MAX) ??
    clean(el.getAttribute("alt"), NAME_MAX) ??
    clean(linked, NAME_MAX) ??
    clean(el.getAttribute("title"), NAME_MAX) ??
    clean(el.textContent, NAME_MAX);
}

/** 보이는 글. 자기 글이 없으면 가까운 윗 요소의 글을 쓴다. */
export function textOf(el: Element): string | null {
  let node: Element | null = el;
  for (let i = 0; node !== null && i < 3; i++, node = node.parentElement) {
    const text = clean(
      (node as HTMLElement).innerText ?? node.textContent,
      TEXT_MAX,
    );
    if (text !== null) return text;
  }
  return null;
}

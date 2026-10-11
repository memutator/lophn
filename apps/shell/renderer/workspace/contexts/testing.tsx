// context 화면 시험이 같이 쓰는 도우미. 시험 파일이 아니므로 시험 runner가 등록하지 않는다.
import { act } from "react";

/** "2 hours ago" 같은 상대 시각을 정하는 시험의 지금. */
export const NOW = new Date("2026-10-12T09:00:00.000Z");

/** 글자를 공백 하나로 모으고 `·` 둘레 공백을 하나로 맞춘 뒤 앞뒤를 자른다. */
export function norm(node: Element | null | undefined): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").replace(
    /\s*·\s*/g,
    " · ",
  )
    .trim();
}

export function all(root: ParentNode, selector: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(selector)];
}

/** 글자가 정확히 name인 단추. */
export function buttonNamed(
  root: ParentNode,
  name: string,
): HTMLElement | null {
  return all(root, "button").find((button) => norm(button) === name) ?? null;
}

/** 글자가 정확히 name인 단추 모두. */
export function buttonsNamed(root: ParentNode, name: string): HTMLElement[] {
  return all(root, "button").filter((button) => norm(button) === name);
}

/** Radix 탭은 mousedown으로 고른다. */
export function activate(tab: Element): void {
  act(() => {
    tab.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
  });
}

/** 입력 칸에 글자를 쓴다. */
export function typeInto(input: Element, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** label 글자로 입력 칸을 찾는다(label[for] 또는 label 안). */
export function fieldLabeled(root: ParentNode, label: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLLabelElement>("label")].find((
    item,
  ) => norm(item) === label);
  if (!found) throw new Error(`no label ${label}`);
  const target = found.htmlFor
    ? root.querySelector<HTMLElement>(`#${CSS.escape(found.htmlFor)}`)
    : found.querySelector<HTMLElement>("input,textarea,button,select");
  if (!target) throw new Error(`label ${label} has no field`);
  return target;
}

/** 사람이 마우스로 누르는 순서(mousedown → mouseup → click)대로 이벤트를 보낸다. */
export function pick(target: Element): void {
  act(() => {
    for (const type of ["mousedown", "mouseup", "click"]) {
      target.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }),
      );
    }
  });
}

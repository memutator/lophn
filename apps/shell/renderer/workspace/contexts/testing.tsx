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

/** 입력 칸(input·textarea)에 글자를 쓴다. */
export function typeInto(input: Element, value: string): void {
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
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

/**
 * 읽기가 이어 붙은 화면(effect가 읽고, 읽은 뒤 그려진 자식이 또 읽는다)이 끝나길 기다린다. 읽기는
 * 작업 틈에서 끝나는데, 그 틈에는 열린 act가 없어 "not wrapped in act" 경고가 난다. 기다리는 동안만
 * act 환경을 끄고(Testing Library의 waitFor와 같은 방법) React가 스스로 그리게 둔 뒤, act로 남은 일을 비운다.
 */
export async function settleReads(): Promise<void> {
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const before = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    for (let round = 0; round < 6; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    env.IS_REACT_ACT_ENVIRONMENT = before;
  }
  await act(async () => {});
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

// gallery의 한 장면을 열린 모양으로 고정하는 손. 실제 대화 화면은 열고 닫는 상태를 스스로 쥐므로, 뜬 뒤에 사람이 하는 것처럼
// 단추를 누르고 글을 쳐서 그 상태로 데려간다. 단계마다 요소가 나타나기를 기다리고, 끝내 안 나타나면 그 단계에서 멈춘다.
import { useEffect } from "react";

/** 한 단계. 할 일을 했으면 true, 요소가 아직 없으면 false다. */
export type DemoStep = () => boolean;

const EVERY_MS = 50;
const GIVE_UP = 80;

/** aria-label이나 글이 같은 첫 단추를 누른다. */
export function press(match: string | RegExp, within?: string): DemoStep {
  return () => {
    const scope = within === undefined
      ? document
      : document.querySelector(within);
    if (scope === null) return false;
    const found = [...scope.querySelectorAll<HTMLElement>("button")].find(
      (button) => {
        const text = button.getAttribute("aria-label") ??
          button.textContent?.trim() ?? "";
        return typeof match === "string" ? text === match : match.test(text);
      },
    );
    if (found === undefined) return false;
    found.click();
    return true;
  };
}

/** selector에 맞는 n번째 요소를 누른다. */
export function pressAt(selector: string, index = 0): DemoStep {
  return () => {
    const found = document.querySelectorAll<HTMLElement>(selector)[index];
    if (found === undefined) return false;
    found.click();
    return true;
  };
}

function setValue(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const proto = field instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** selector의 입력칸에 글을 친다. enter가 참이면 Enter까지 누른다. */
export function typeInto(
  selector: string,
  value: string,
  enter = false,
): DemoStep {
  return () => {
    const field = document.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >(selector);
    if (field === null) return false;
    setValue(field, value);
    if (enter) {
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    }
    return true;
  };
}

/** 단계를 차례로 한다. 한 단계가 GIVE_UP번 안에 안 되면 멈춘다. */
export function useDemo(steps: readonly DemoStep[], key: string): void {
  useEffect(() => {
    let index = 0;
    let tries = 0;
    const timer = setInterval(() => {
      if (index >= steps.length) return clearInterval(timer);
      tries += 1;
      if (steps[index]!()) {
        index += 1;
        tries = 0;
      } else if (tries > GIVE_UP) clearInterval(timer);
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, [key]);
}

/** agent header의 session switcher를 연다. */
export const openSwitcher: DemoStep = pressAt(
  "[data-agent-header] button[aria-label]",
);

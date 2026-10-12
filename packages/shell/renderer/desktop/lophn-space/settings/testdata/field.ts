// design Field의 label 글로 입력칸을 찾는다(label의 htmlFor가 가리키는 element).
export function fieldInput(root: ParentNode, label: string): HTMLElement {
  for (const element of root.querySelectorAll("label")) {
    if (element.textContent === label) {
      const target = element.ownerDocument.getElementById(element.htmlFor);
      if (target) return target;
    }
  }
  throw new Error(`no field labelled ${label}`);
}

/** 보이는 글이 정확히 같은 단추. */
export function buttonText(root: ParentNode, text: string): HTMLButtonElement {
  for (const button of root.querySelectorAll("button")) {
    if (button.textContent === text) return button;
  }
  throw new Error(`no button with text ${text}`);
}

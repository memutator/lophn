import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@lophn/ui/tokens.css";
import "@lophn/ui/base.css";
import "./chrome.css";

// 문구는 넣지 않는다. 화면 문구는 message key로만 쓴다(design/i18n).
// 아직 화면이 없는 entry는 className 문자열만 넘긴다.
export function mount(node: ReactNode): void {
  const root = document.getElementById("root");
  if (!root) return;
  createRoot(root).render(
    typeof node === "string" ? <div className={node} /> : node,
  );
}

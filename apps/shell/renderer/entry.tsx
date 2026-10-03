import { createRoot } from "react-dom/client";

// 문구는 넣지 않는다. 화면 문구는 wording key로만 쓴다(shell/wording).
export function mount(stylesheet: string): void {
  const root = document.getElementById("root");
  if (!root) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = stylesheet;
  document.head.append(link);
  createRoot(root).render(<div className="root" />);
}

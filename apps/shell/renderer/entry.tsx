import { createRoot } from "react-dom/client";

// 문구는 넣지 않는다. 화면 문구는 wording key로만 쓴다(shell/wording).
export function mount(className: string): void {
  const root = document.getElementById("root");
  if (!root) return;
  createRoot(root).render(<div className={className} />);
}

// lophn wireframes gallery의 entry. 같은 bundle이 두 모양으로 뜬다.
// - 기본: 목록과 page(제목·badge·설명·frame·이전/다음).
// - `?frame=<page id>`: gallery가 frame(iframe)에 넣는 화면 하나. iframe이라서 화면은 고정 크기의
//   창처럼 자기 viewport를 갖는다(100vh·fixed 배치·창 폭 규칙이 그대로 맞는다).
import { createRoot } from "react-dom/client";
import "@lophn/design/tokens.css";
import "@lophn/design/base.css";

import { FramePage, Gallery } from "./gallery.tsx";

const params = new URLSearchParams(location.search);
const theme = params.get("theme");
if (theme === "light" || theme === "dark") {
  document.documentElement.dataset.theme = theme;
}
const frame = params.get("frame");
if (frame !== null) {
  // 화면 root는 position:absolute; inset:0이라 viewport를 채운다. Radix modal(Select 등)이 열리면 scroll lock이
  // body에 `position: relative !important`를 걸어 기준이 body로 바뀌는데, body 높이가 0이면 화면이 접혀 비어 보인다.
  const { documentElement: html, body } = document;
  html.style.overflow = "hidden";
  html.style.height = "100%";
  body.style.height = "100%";
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    frame === null ? <Gallery /> : <FramePage id={frame} />,
  );
}

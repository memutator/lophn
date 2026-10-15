// CodeMirror widget·gutter는 React 밖 DOM이라 Lucide 아이콘을 같은 path로 직접 그린다.
// path는 lucide 1.51.0의 image-off와 같고 선은 icon.stroke token이다.
import { tokens } from "@lophn/design";

const SVG = "http://www.w3.org/2000/svg";

export const IMAGE_OFF = [
  "M2 2l20 20",
  "M10.41 10.41a2 2 0 1 1-2.83-2.83",
  "M13.5 13.5 6 21",
  "M18 12l3 3",
  "M3.59 3.59A1.99 1.99 0 0 0 3 5v14a2 2 0 0 0 2 2h14c.55 0 1.052-.22 1.41-.59",
  "M21 15V5a2 2 0 0 0-2-2H9",
];

export function svgIcon(paths: readonly string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(tokens.icon.stroke));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "cm-lp-icon");
  for (const d of paths) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

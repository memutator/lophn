// App Engineer에게 들어가는 사람 메시지를 만든다. 묶음의 annotation을 번호 순서로 이어 붙이고,
// 이미지는 그 annotation 블록 바로 뒤에 붙는다. 순수 함수다.
import type { Annotation } from "../../../protocol/apps/annotation.ts";
import { renderTag } from "../../lophn-agent/prompt-assembly/input-tags.ts";

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

function elementText(element: Annotation["element"]): string | undefined {
  const parts = [
    element.role,
    element.name === null ? null : `"${element.name}"`,
    element.text === null || element.text === element.name
      ? null
      : `text "${element.text}"`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? undefined : parts.join(" ");
}

function blockOf(annotation: Annotation): string {
  const { rect } = annotation;
  const lines: [string, string | undefined][] = [
    ["Note", annotation.note === "" ? "(none)" : annotation.note],
    ["Component", annotation.component ?? undefined],
    ["Element", elementText(annotation.element)],
    [
      "Area",
      `x=${percent(rect.x_ratio)} y=${Math.round(rect.y_px)}px w=${
        percent(rect.width_ratio)
      } h=${Math.round(rect.height_px)}px`,
    ],
    [
      "Screenshot",
      annotation.screenshot === null ? "not captured." : undefined,
    ],
  ];
  const body = lines.flatMap(([label, value]) =>
    value === undefined ? [] : [`${label}: ${value}`]
  ).join("\n");
  return renderTag("annotation", {
    n: annotation.n,
    kind: annotation.kind,
    app: annotation.app,
    release: annotation.release,
    view: annotation.view.screen,
  }, body);
}

function imageLine(annotation: Annotation): string {
  const target = annotation.kind === "element" ? "element" : "area";
  return `[image: Annotation ${annotation.n}. The selected ${target} is outlined in blue and marked ${annotation.n}.]`;
}

export function renderAnnotationMessage(annotations: readonly Annotation[]): {
  text: string;
  images: { hash: string; size_bytes: number; media_type: "image/png" }[];
} {
  const sorted = [...annotations].sort((a, b) => a.n - b.n);
  const images = sorted.flatMap((annotation) =>
    annotation.screenshot === null ? [] : [{
      hash: annotation.screenshot.hash,
      size_bytes: annotation.screenshot.size_bytes,
      media_type: "image/png" as const,
    }]
  );
  const text = sorted.flatMap((annotation) =>
    annotation.screenshot === null
      ? [blockOf(annotation)]
      : [blockOf(annotation), imageLine(annotation)]
  ).join("\n");
  return { text, images };
}

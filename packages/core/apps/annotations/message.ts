// 받는 쪽 agent에게 들어가는 사람 메시지를 만든다. 묶음의 annotation을 번호 순서로 이어 붙인다.
// 이미지는 싣지 않고 image.read로 열 ref를 적는다. 순수 함수다.
import type { Annotation } from "../../../protocol/apps/annotation.ts";
import { renderTag } from "../../../protocol/lophn-agent/input-tags.ts";

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
    [
      "Preview",
      annotation.preview_bundle === null
        ? undefined
        : `bundle ${annotation.preview_bundle}, fixture data (not the live app)`,
    ],
    ["Component", annotation.component ?? undefined],
    ["Element", elementText(annotation.element)],
    [
      "Area",
      `x=${percent(rect.x_ratio)} y=${Math.round(rect.y_px)}px w=${percent(
        rect.width_ratio,
      )} h=${Math.round(rect.height_px)}px`,
    ],
    [
      "Screenshot",
      annotation.screenshot === null
        ? "not captured."
        : `open with image.read path "annotation:${annotation.id}". The selected ${
            annotation.kind === "element" ? "element" : "area"
          } is outlined in blue and marked ${annotation.n}.`,
    ],
  ];
  const body = lines
    .flatMap(([label, value]) =>
      value === undefined ? [] : [`${label}: ${value}`],
    )
    .join("\n");
  const { target } = annotation;
  const workspace =
    target.kind === "app"
      ? {
          app: target.app,
          release: annotation.release ?? undefined,
          preview: annotation.preview_bundle ?? undefined,
          view: annotation.view.screen ?? undefined,
        }
      : {
          project: target.kind === "file" ? target.project : undefined,
          artifact: target.kind === "artifact" ? target.name : undefined,
          view: annotation.view.path,
        };
  return renderTag(
    "annotation",
    {
      n: annotation.n,
      kind: annotation.kind,
      ...workspace,
    },
    body,
  );
}

export function renderAnnotationMessage(
  annotations: readonly Annotation[],
): string {
  return [...annotations]
    .sort((a, b) => a.n - b.n)
    .map(blockOf)
    .join("\n");
}

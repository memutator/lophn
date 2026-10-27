import { refText, type VersionRef } from "../types.ts";

type Change = { from: VersionRef; to: VersionRef };

// 다른 것을 시험하는 trial에 돈을 쓰지 않게 spec의 from이 바뀌지 않았으면 막는다.
// to의 n은 짐작이라 다르면 알리기만 하고, 다른 component가 같이 바뀌었으면 mixed로 알린다.
export function checkChange(
  change: Change,
  changed: Change[],
):
  | { ok: false; message: string }
  | {
      ok: true;
      warnings: string[];
      mixed: Change[];
    } {
  const main = changed.find(
    (c) =>
      c.from.kind === change.from.kind &&
      c.from.name === change.from.name &&
      c.from.n === change.from.n,
  );
  if (main === undefined) {
    return {
      ok: false,
      message: `variant가 spec의 ${refText(
        change.from,
      )} -> @${change.to.n}가 아니다. ${
        changed.length === 0
          ? "기준과 variant의 버전이 같다"
          : `바뀐 것: ${changed
              .map((c) => `${refText(c.from)} -> @${c.to.n}`)
              .join(", ")}`
      }`,
    };
  }
  const warnings =
    main.to.n === change.to.n
      ? []
      : [`spec의 to는 @${change.to.n}인데 variant는 @${main.to.n}이다`];
  return { ok: true, warnings, mixed: changed.filter((c) => c !== main) };
}

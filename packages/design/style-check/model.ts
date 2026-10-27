import postcss, { type Node } from "postcss";
import valueParser from "postcss-value-parser";
import { tokenNames } from "../generated/vars.ts";
import { tokens } from "../tokens.ts";

export interface StyleIssue {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
}

const KNOWN_TOKENS = new Set<string>(tokenNames);
const LENGTH_UNITS = new Set([
  "px",
  "rem",
  "em",
  "pt",
  "pc",
  "cm",
  "mm",
  "in",
  "q",
  "ex",
  "ch",
  "cap",
  "ic",
  "lh",
  "rlh",
  "rex",
  "rch",
  "rcap",
  "ric",
  "vw",
  "vh",
  "vi",
  "vb",
  "vmin",
  "vmax",
  "svw",
  "svh",
  "svi",
  "svb",
  "svmin",
  "svmax",
  "lvw",
  "lvh",
  "lvi",
  "lvb",
  "lvmin",
  "lvmax",
  "dvw",
  "dvh",
  "dvi",
  "dvb",
  "dvmin",
  "dvmax",
  "cqw",
  "cqh",
  "cqi",
  "cqb",
  "cqmin",
  "cqmax",
]);
const COLOR_FUNCTIONS = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
  "color-mix",
  "light-dark",
  "device-cmyk",
]);
const NAMED_COLORS = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(
    " ",
  ),
);
const SYSTEM_COLORS = new Set([
  "accentcolor",
  "accentcolortext",
  "activetext",
  "buttonborder",
  "buttonface",
  "buttontext",
  "canvas",
  "canvastext",
  "field",
  "fieldtext",
  "graytext",
  "highlight",
  "highlighttext",
  "linktext",
  "mark",
  "marktext",
  "selecteditem",
  "selecteditemtext",
  "visitedtext",
]);
const BREAKPOINTS = new Set<number>(Object.values(tokens.breakpoint));

export function checkStyles(css: string, file: string): StyleIssue[] {
  const issues: StyleIssue[] = [];
  const path = file.replaceAll("\\", "/").replace(/^\.\//, "");
  const definition = path === "packages/design/generated/tokens.css";
  const base = path === "packages/design/base.css";
  const report = (node: Node, reason: string) => {
    issues.push({ file, line: node.source?.start?.line ?? 1, reason });
  };
  let root;
  try {
    root = postcss.parse(css, { from: file });
  } catch (error) {
    const line =
      typeof error === "object" && error !== null && "line" in error
        ? Number(error.line)
        : 1;
    return [{ file, line, reason: "invalid_input: CSS parse failed" }];
  }
  const inspect = (value: string, node: Node, prop?: string, media = false) => {
    const parsed = valueParser(value);
    parsed.walk((item) => {
      if (item.type === "function") {
        const fn = item.value.toLowerCase();
        if (fn === "url") return false;
        if (fn === "var") {
          const first = item.nodes.find(
            (child) => child.type !== "space" && child.type !== "comment",
          );
          if (
            !first ||
            first.type !== "word" ||
            (!KNOWN_TOKENS.has(first.value) &&
              !first.value.startsWith("--radix-"))
          ) {
            report(node, `invalid_input: unknown token ${first?.value ?? ""}`);
          }
        } else if (!definition && COLOR_FUNCTIONS.has(fn)) {
          report(node, `invalid_input: raw color function ${item.value}()`);
        }
      }
      if (item.type !== "word" || definition) return;
      const word = item.value.toLowerCase();
      if (
        /^#[\da-f]+$/i.test(word) ||
        NAMED_COLORS.has(word) ||
        SYSTEM_COLORS.has(word)
      ) {
        report(node, `invalid_input: raw color ${item.value}`);
      }
      const unit = valueParser.unit(word);
      if (unit) {
        if (unit.unit === "ms" || unit.unit === "s") {
          report(node, `invalid_input: raw time ${item.value}`);
        } else if (
          LENGTH_UNITS.has(unit.unit) &&
          (media || Number(unit.number) !== 0)
        ) {
          if (
            media &&
            unit.unit === "px" &&
            BREAKPOINTS.has(Number(unit.number))
          )
            return;
          // 1px도 border.width token을 써야 테두리 override와 스타일 검사가 같은 규칙을 따른다.
          report(
            node,
            `invalid_input: ${
              media ? "unknown breakpoint" : "raw length"
            } ${item.value}`,
          );
        } else if (
          (prop === "font-weight" || prop === "z-index") &&
          unit.unit === ""
        ) {
          report(node, `invalid_input: raw ${prop} ${item.value}`);
        }
      }
    });
  };
  root.walkDecls((decl) => {
    const prop = decl.prop.toLowerCase();
    const parent = decl.parent;
    if (
      base &&
      parent?.type === "atrule" &&
      "name" in parent &&
      parent.name.toLowerCase() === "font-face" &&
      ["src", "font-display", "font-weight"].includes(prop)
    )
      return;
    inspect(decl.value, decl, prop);
  });
  root.walkAtRules((rule) => {
    if (rule.name.toLowerCase() === "media") {
      inspect(rule.params, rule, undefined, true);
    }
  });
  return issues;
}

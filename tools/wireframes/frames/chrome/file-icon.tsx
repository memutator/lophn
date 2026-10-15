// 파일 tree와 탭의 파일 종류 아이콘. @iconify-json/catppuccin(Catppuccin Icons, MIT)을 쓴다. 가는 선의 차분한 색이다.
import icons from "@iconify-json/catppuccin/icons.json" with {
  type: "json",
};

interface IconSet {
  readonly icons: Readonly<
    Record<string, { body: string; width?: number; height?: number }>
  >;
  readonly aliases?: Readonly<Record<string, { parent: string }>>;
  readonly width?: number;
  readonly height?: number;
}

const SET = icons as IconSet;

const BY_EXTENSION: Readonly<Record<string, string>> = {
  md: "markdown",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  ts: "typescript",
  tsx: "typescript-react",
  js: "javascript",
  jsx: "javascript-react",
  py: "python",
  sh: "bash",
  toml: "toml",
  csv: "csv",
  txt: "text",
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "svg",
  lock: "lock",
};

const BY_FOLDER: Readonly<Record<string, string>> = {
  docs: "folder-docs",
  src: "folder-src",
  assets: "folder-assets",
  reports: "folder-docs",
  eval: "folder-tests",
  scenarios: "folder-tests",
  experiments: "folder-tests",
  rubrics: "folder-config",
  findings: "folder-docs",
  loop: "folder-src",
};

// 아이콘 색은 Catppuccin Macchiato(어두운 바탕용)다. 밝은 바탕에서는 안 보여서, 색을 theme 변수로 바꾸고
// chrome.css가 light에는 Latte, dark에는 Macchiato 값을 준다.
const PALETTE: Readonly<Record<string, string>> = {
  "#cad3f5": "text",
  "#8aadf4": "blue",
  "#eed49f": "yellow",
  "#a6da95": "green",
  "#8087a2": "overlay1",
  "#f5a97f": "peach",
  "#ed8796": "red",
  "#c6a0f6": "mauve",
  "#91d7e3": "sky",
  "#7dc4e4": "sapphire",
  "#f5bde6": "pink",
  "#8bd5ca": "teal",
  "#ee99a0": "maroon",
  "#b7bdf8": "lavender",
  "#f4dbd6": "rosewater",
  "#f0c6c6": "flamingo",
};

function themed(body: string): string {
  return body.replace(
    /<([a-zA-Z]+)([^>]*?)(\/?)>/g,
    (tag, name, attrs, end) => {
      const styles: string[] = [];
      const rest = attrs.replace(
        /\s(fill|stroke)="(#[0-9a-fA-F]{3,6})"/g,
        (whole: string, key: string, color: string) => {
          const token = PALETTE[color.toLowerCase()];
          if (token === undefined) return whole;
          styles.push(`${key}:var(--ctp-${token})`);
          return "";
        },
      );
      if (styles.length === 0) return tag;
      return `<${name}${rest} style="${styles.join(";")}"${end}>`;
    },
  );
}

function svgOf(name: string): string | undefined {
  const own = SET.icons[name] ?? SET.icons[SET.aliases?.[name]?.parent ?? ""];
  if (own === undefined) return undefined;
  const width = own.width ?? SET.width ?? 16;
  const height = own.height ?? SET.height ?? 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">${
    themed(own.body)
  }</svg>`;
}

/** 파일 이름이나 폴더 이름으로 아이콘 이름을 고른다. 모르는 것은 기본 파일·폴더 아이콘이다. */
export function fileIconName(
  name: string,
  folder = false,
  open = false,
): string {
  if (folder) {
    const base = BY_FOLDER[name.toLowerCase()] ?? "folder";
    return open ? `${base}-open` : base;
  }
  const lower = name.toLowerCase();
  if (lower === "lophn.md" || lower === "readme.md") return "readme";
  const extension = lower.includes(".")
    ? lower.slice(lower.lastIndexOf(".") + 1)
    : "";
  return BY_EXTENSION[extension] ?? "file";
}

export function FileIcon(
  { name, folder = false, open = false, size = 16 }: {
    name: string;
    folder?: boolean;
    open?: boolean;
    size?: number;
  },
) {
  const svg = svgOf(fileIconName(name, folder, open)) ??
    svgOf(folder ? "folder" : "file") ?? "";
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        flex: "none",
        width: size,
        height: size,
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

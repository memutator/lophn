// 템플릿에서 새 앱 폴더를 만든다(apps/sdk#R33). 파일을 그대로 복사하고 앱 이름·제목만 채운다. 개발용
// import map은 이 장치의 설치 SDK 위치를 담으므로 앱 source가 아니라 `.lophn/`(ignore)에 둔다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { TemplateFailure, TemplateFile } from "./files.ts";
import { devImportMap } from "./import-map.ts";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEXT = /\.(?:ts|tsx|json|md|html|css|sql|txt)$|(?:^|\/)\.gitignore$/;

export const DEV_IMPORT_MAP_PATH = ".lophn/import-map.json";

export type ScaffoldInput = {
  files: readonly TemplateFile[];
  // 없거나 빈 폴더여야 한다.
  dir: string;
  // 앱 이름(slug).
  app: string;
  // 사람이 읽는 제목. 없으면 slug에서 만든다.
  title?: string;
  // 설치 SDK 폴더(`<home>/sdk`). 있으면 개발용 import map을 쓴다.
  sdkRoot?: string;
};

export type ScaffoldResult = {
  files: string[];
  devImportMap: string | null;
};

function invalid(message: string): Result<never, TemplateFailure> {
  return err({ code: "invalid_input", message });
}

function titleOf(app: string): string {
  const words = app.split("-").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  );
}

// 자리 표시 `{{TITLE}}`·`{{APP}}`는 formatter가 안쪽 공백을 넣어도 같다. 코드의 따옴표 친 `"{{TITLE}}"`은 JSON
// 문자열로, html은 escape해서, 그 밖은 그대로 채운다.
function fill(path: string, text: string, app: string, title: string): string {
  return text
    .replace(/"\{\{\s*TITLE\s*\}\}"/g, () => JSON.stringify(title))
    .replace(
      /\{\{\s*TITLE\s*\}\}/g,
      () => path.endsWith(".html") ? escapeHtml(title) : title,
    )
    .replace(/\{\{\s*APP\s*\}\}/g, () => app);
}

async function isEmpty(dir: string): Promise<boolean> {
  try {
    for await (const _ of Deno.readDir(dir)) return false;
    return true;
  } catch (thrown) {
    if (thrown instanceof Deno.errors.NotFound) return true;
    throw thrown;
  }
}

export async function scaffoldApp(
  input: ScaffoldInput,
): Promise<Result<ScaffoldResult, TemplateFailure>> {
  if (!SLUG.test(input.app)) {
    return invalid("app must be a slug (a-z, 0-9, -)");
  }
  const title = (input.title ?? titleOf(input.app)).trim();
  if (title === "" || /[\r\n]/.test(title) || title.length > 80) {
    return invalid("title must be one line of at most 80 characters");
  }
  if (!await isEmpty(input.dir)) {
    return err({ code: "invalid_input", message: "directory is not empty" });
  }
  const written: string[] = [];
  try {
    for (const file of input.files) {
      const target = `${input.dir}/${file.path}`;
      const slash = target.lastIndexOf("/");
      await Deno.mkdir(target.slice(0, slash), { recursive: true });
      const bytes = TEXT.test(file.path)
        ? new TextEncoder().encode(
          fill(
            file.path,
            new TextDecoder().decode(file.bytes),
            input.app,
            title,
          ),
        )
        : file.bytes;
      await Deno.writeFile(target, bytes);
      written.push(file.path);
    }
    let devMap: string | null = null;
    if (input.sdkRoot !== undefined) {
      const config = input.files.find((file) => file.path === "deno.json");
      const imports = (JSON.parse(
        new TextDecoder().decode(config?.bytes ?? new Uint8Array()),
      ) as { imports?: Record<string, string> }).imports ?? {};
      await Deno.mkdir(`${input.dir}/.lophn`, { recursive: true });
      await Deno.writeTextFile(
        `${input.dir}/${DEV_IMPORT_MAP_PATH}`,
        JSON.stringify(
          devImportMap(imports, input.sdkRoot, input.dir),
          null,
          2,
        ) +
          "\n",
      );
      devMap = DEV_IMPORT_MAP_PATH;
    }
    return ok({ files: written.sort(), devImportMap: devMap });
  } catch (thrown) {
    return err({
      code: "unavailable",
      message: `app could not be written: ${
        thrown instanceof Error ? thrown.message : thrown
      }`,
    });
  }
}

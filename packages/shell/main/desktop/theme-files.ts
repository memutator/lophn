// 사람과 agent가 쓴 theme file(`<data root>/themes/<id>.json`)을 읽고 폴더를 지켜본다. 검사와 상속은
// design의 loadThemes가 하고, 여기는 file을 모으고 너무 큰 file을 거른다.
import { watch as fsWatch } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  type BrokenTheme,
  loadThemes,
  type ThemeFile,
  type Themes,
} from "../../../design/themes.ts";

// theme file은 색 백 개 남짓이다. 큰 file을 읽어 모든 문서의 CSS로 만들지 않는다.
const FILE_MAX = 256 * 1024;
const WATCH_DEBOUNCE_MS = 150;

export interface ThemeFolderFs {
  mkdir(path: string): Promise<unknown>;
  readdir(path: string): Promise<string[]>;
  size(path: string): Promise<number>;
  readFile(path: string): Promise<string>;
  watch(path: string, onEvent: () => void): { close(): void };
}

const nodeFs: ThemeFolderFs = {
  mkdir: (path) => mkdir(path, { recursive: true }),
  readdir: (path) => readdir(path),
  size: async (path) => (await stat(path)).size,
  readFile: (path) => readFile(path, "utf8"),
  watch: (path, onEvent) => fsWatch(path, { recursive: false }, onEvent),
};

export interface ThemeFolder {
  readonly path: string;
  /** 내장 theme과 file theme. 폴더를 읽지 못하면 내장 theme만이다. */
  read(): Promise<Themes>;
  /** 폴더가 바뀌면 부른다(잠깐 모아서 한 번). 끄는 함수를 돌려준다. */
  watch(onChange: () => void): () => void;
}

export function themeFolder(
  dataRoot: string,
  fs: ThemeFolderFs = nodeFs,
): ThemeFolder {
  const path = join(dataRoot, "themes");
  return {
    path,
    async read() {
      const files: ThemeFile[] = [];
      const tooLarge: BrokenTheme[] = [];
      try {
        await fs.mkdir(path);
        for (const name of await fs.readdir(path)) {
          if (!name.endsWith(".json")) continue;
          const id = name.slice(0, -".json".length);
          const file = join(path, name);
          if ((await fs.size(file)) > FILE_MAX) {
            tooLarge.push({ id, reason: "too_large" });
            continue;
          }
          files.push({ id, text: await fs.readFile(file) });
        }
      } catch {
        return loadThemes([]);
      }
      const themes = loadThemes(files);
      return { list: themes.list, broken: [...themes.broken, ...tooLarge] };
    },
    watch(onChange) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let watcher: { close(): void } | undefined;
      let stopped = false;
      const fire = () => {
        clearTimeout(timer);
        timer = setTimeout(onChange, WATCH_DEBOUNCE_MS);
      };
      void fs.mkdir(path).then(
        () => {
          if (stopped) return;
          try {
            watcher = fs.watch(path, fire);
          } catch {
            // 지켜보지 못해도 Settings를 열 때 다시 읽는다.
          }
        },
        () => {},
      );
      return () => {
        stopped = true;
        clearTimeout(timer);
        watcher?.close();
      };
    },
  };
}

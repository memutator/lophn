// 화면 build가 불러오는 file이 staging 안(realpath 기준)에 있는지 본다. staging 밖의 file(lophn repo의
// node_modules 등)이 화면에 묶이지 않게 한다. file 내용은 오류에 싣지 않는다.
import { realpath } from "node:fs/promises";
import { isAbsolute, sep } from "node:path";
import type * as esbuild from "esbuild";

export function stagingGuard(root: string): esbuild.Plugin {
  return {
    name: "staging-only",
    setup(build) {
      build.onLoad({ filter: /.*/, namespace: "file" }, async (args) => {
        if (!isAbsolute(args.path)) return undefined;
        let real: string;
        try {
          real = await realpath(args.path);
        } catch {
          return { errors: [{ text: "import is outside the app build area" }] };
        }
        return real === root || real.startsWith(`${root}${sep}`)
          ? undefined
          : { errors: [{ text: "import is outside the app build area" }] };
      });
    },
  };
}

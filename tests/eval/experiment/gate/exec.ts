import { denoGit } from "../../versions/mod.ts";
import type { GateDeps } from "./mod.ts";

export function defaultGateDeps(
  base: Pick<GateDeps, "validateFixtures" | "dryRun" | "catalogRoot">,
  checkout: string,
): GateDeps {
  return {
    ...base,
    async run(cmd, cwd, timeoutMs) {
      const out = await new Deno.Command(cmd[0], {
        args: cmd.slice(1),
        cwd,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
        signal: AbortSignal.timeout(timeoutMs),
      }).output();
      const dec = new TextDecoder();
      return {
        code: out.code,
        output: dec.decode(out.stdout) + dec.decode(out.stderr),
      };
    },
    git: denoGit(checkout),
    readText: (path) => Deno.readTextFile(path),
    async listFiles(dir) {
      const names: string[] = [];
      for await (const e of Deno.readDir(dir)) if (e.isFile) names.push(e.name);
      return names;
    },
    now: () => Date.now(),
  };
}

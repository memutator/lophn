// 파일 시스템과 subprocess를 인자로 받는다. test가 가짜를 넣는다.
export type RunOutput = { code: number; stdout: string; stderr: string };

export type VariantIo = {
  realPath(path: string): Promise<string>;
  /** git이 그 폴더의 최상위라고 답한 경로. git checkout이 아니면 null */
  gitToplevel(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  /** 폴더이고 안에 뭐가 하나라도 있다. */
  nonEmpty(path: string): Promise<boolean>;
  run(
    cmd: string[],
    cwd: string,
    env?: Record<string, string>,
  ): Promise<RunOutput>;
};

export const denoIo: VariantIo = {
  realPath: (path) => Deno.realPath(path),
  async gitToplevel(path) {
    const out = await denoIo.run(
      ["git", "-C", path, "rev-parse", "--show-toplevel"],
      path,
    ).catch(() => null);
    return out === null || out.code !== 0 ? null : out.stdout.trim();
  },
  async exists(path) {
    try {
      await Deno.lstat(path);
      return true;
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return false;
      throw e;
    }
  },
  async nonEmpty(path) {
    try {
      for await (const _ of Deno.readDir(path)) return true;
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
    return false;
  },
  async run(cmd, cwd, env) {
    const out = await new Deno.Command(cmd[0], {
      args: cmd.slice(1),
      cwd,
      env,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const text = new TextDecoder();
    return {
      code: out.code,
      stdout: text.decode(out.stdout),
      stderr: text.decode(out.stderr),
    };
  },
};

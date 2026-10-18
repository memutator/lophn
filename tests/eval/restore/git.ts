// 사람의 git 설정(서명, hook, 이름)을 읽지 않는다. `tests/support/app/source.ts`의 createAppSource와 같은 설정이다.
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

export async function gitBytes(
  cwd: string,
  ...args: string[]
): Promise<Uint8Array> {
  const out = await new Deno.Command("git", {
    args: [
      "-c",
      "user.name=eval",
      "-c",
      "user.email=eval@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    cwd,
    env: GIT_ENV,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    throw new Error(
      `git ${args.join(" ")}: ${new TextDecoder().decode(out.stderr)}`,
    );
  }
  return out.stdout;
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  return new TextDecoder().decode(await gitBytes(cwd, ...args)).trim();
}

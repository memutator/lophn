import type { Git } from "../../versions/mod.ts";

const lines = (text: string) => text.split("\n").filter((l) => l !== "");

// tools/check.ts와 같은 규칙이다. git의 cwd가 variant라 branch의 commit과 working tree의 변경이 같이 잡힌다.
export async function changedFiles(git: Git, base?: string): Promise<string[]> {
  let rev = base;
  if (rev === undefined) {
    // main이 없는 checkout은 HEAD와 비교한다(tools/check.ts와 같다).
    rev = await git(["merge-base", "HEAD", "main"]).then(
      (out) => lines(out)[0] ?? "HEAD",
      () => "HEAD",
    );
  }
  const files = [
    ...lines(await git(["diff", "--name-only", rev])),
    ...lines(await git(["ls-files", "-o", "--exclude-standard"])),
  ];
  return [...new Set(files)].filter(
    (f) => !f.split("/").includes("node_modules"),
  );
}

import type { CodingCommand } from "../../types.ts";

// 한 줄: `<ISO 시각>\t<arg1>\t<arg2>\t<arg3>`. hook 호출(`hook claude Stop`)도 같은 file에 적힌다.
export function parseCommandLog(text: string): CodingCommand[] {
  const commands: CodingCommand[] = [];
  for (const line of text.split("\n")) {
    const [at, arg1, arg2 = ""] = line.split("\t");
    if (!at || !arg1 || arg1 === "hook") continue;
    const name = arg2 === "" || arg2.startsWith("-") ? arg1 : `${arg1} ${arg2}`;
    commands.push({ at, name });
  }
  return commands.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export function countHook(text: string, event: string): number {
  let n = 0;
  for (const line of text.split("\n")) {
    const [, arg1, arg2, arg3] = line.split("\t");
    if (arg1 === "hook" && arg2 === "claude" && arg3 === event) n++;
  }
  return n;
}

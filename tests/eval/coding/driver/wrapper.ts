// `lophn` wrapper. agent와 hook이 부르는 lophn 명령을 지정한 checkout의 CLI로 보내고, 호출 시각을 기록 file에 적는다.
// 기록 형식(`<ISO 시각>\t<arg1>\t<arg2>\t<arg3>`)은 ec-metrics가 읽는 약속이다.

// 이 checkout. 터미널 host와 요청 처리 코드(`packages/shell/...`)는 늘 이 checkout의 것을 쓴다.
export const CHECKOUT = new URL("../../../../", import.meta.url).pathname
  .replace(/\/$/, "");

const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

export function wrapperScript(input: { deno: string; main: string }): string {
  return `#!/bin/sh
if [ -n "$LOPHN_EVAL_COMMAND_LOG" ]; then
  printf '%s\\t%s\\t%s\\t%s\\n' "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" "$1" "$2" "$3" >> "$LOPHN_EVAL_COMMAND_LOG"
fi
exec ${quote(input.deno)} run --allow-all --no-prompt ${quote(input.main)} "$@"
`;
}

// 내용이 같으면 다시 쓰지 않는다. 경로를 돌려준다.
export async function ensureWrapper(
  binDir: string,
  root: string,
): Promise<string> {
  const path = `${binDir}/lophn`;
  const text = wrapperScript({
    deno: Deno.execPath(),
    main: `${root}/packages/coding-agent/cli/main.ts`,
  });
  await Deno.mkdir(binDir, { recursive: true });
  const current = await Deno.readTextFile(path).catch(() => null);
  if (current !== text) await Deno.writeTextFile(path, text);
  await Deno.chmod(path, 0o755);
  return path;
}

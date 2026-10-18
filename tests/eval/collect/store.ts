// 전체 기록은 `<dir>/<run>/trial-<trial>.json`에 둔다. runner가 dir를 `.dev-data/eval`로 준다.
export async function writeFullRecord(
  dir: string,
  run: string,
  trial: number,
  value: unknown,
): Promise<string> {
  const folder = `${dir}/${run}`;
  await Deno.mkdir(folder, { recursive: true });
  const path = `${folder}/trial-${trial}.json`;
  await Deno.writeTextFile(path, JSON.stringify(value, null, 2) + "\n");
  return path;
}

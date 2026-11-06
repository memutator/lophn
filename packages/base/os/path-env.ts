// PATH에 폴더를 앞에 더한 새 값. 이미 들어 있으면 undefined. Windows는 이름이 `Path`일 수 있어 env에 있는 이름 그대로 돌려준다
// (다른 대소문자 이름을 더하면 둘이 공존해 어느 쪽이 쓰일지 모른다). `folder`는 호출한 쪽이 구한다(base는 node:path를 쓰지 않는다).
export function prependPath(
  env: Readonly<Record<string, string | undefined>>,
  folder: string,
  platform: string,
): { name: string; value: string } | undefined {
  const win = platform === "win32";
  const name =
    (win
      ? Object.keys(env).find((key) => key.toLowerCase() === "path")
      : "PATH") ?? "PATH";
  const current = env[name] ?? "";
  const separator = win ? ";" : ":";
  const same = (a: string) =>
    win ? a.toLowerCase() === folder.toLowerCase() : a === folder;
  if (current.split(separator).some(same)) return undefined;
  return {
    name,
    value: current === "" ? folder : `${folder}${separator}${current}`,
  };
}

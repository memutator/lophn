// Windows는 `.cmd`·`.bat`을 cmd.exe로만 띄운다(Node는 shell 없이 띄우기를 막는다). 인자를 그냥 이으면 JSON 같은 값의
// 따옴표가 깨진다. cross-spawn과 같은 규칙이다: 인자마다 MSVCRT 규칙으로 따옴표를 씌우고 cmd 메타문자를 `^`로 escape한다.
// launcher가 `%*`로 인자를 다시 넘기므로 인자의 escape는 두 번이다(이 cmd.exe가 한 번, launcher 줄이 한 번 푼다).
// 다만 메타문자·공백·구분자가 없는 단순 토큰은 그대로 둔다: `^^^"arg^^^"`로 감싸면 배치 파일의 `%~1` 검사가 깨진다.
// 돌려준 값은 `windowsVerbatimArguments: true`로 띄운다.
const META = /([()\][%!^"`<>&|;,=*? ])/g;
const SAFE_ARG = /^[A-Za-z0-9._:/\\-]+$/;

function quoted(arg: string): string {
  if (arg.length > 0 && SAFE_ARG.test(arg)) return arg;
  // 따옴표 앞 backslash는 두 배로 하고 따옴표를 escape한다. 끝 backslash도 닫는 따옴표 앞이라 두 배다.
  const body = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
  return `"${body}"`.replace(META, "^$1").replace(META, "^$1");
}

export function cmdShimCommand(
  comspec: string,
  file: string,
  args: readonly string[],
): { command: string; args: string[] } {
  const line = [file.replace(META, "^$1"), ...args.map(quoted)].join(" ");
  return { command: comspec, args: ["/d", "/s", "/c", `"${line}"`] };
}

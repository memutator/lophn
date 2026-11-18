// page host가 물러나며 desktop 앱을 다시 띄울 인자와 env. data root는 page host 자신의 것(그 lock을 쥔 root)만 쓴다.
// 누른 시작의 argv는 Chromium이 switch를 다시 늘어놓아 `--home` 값이 떨어질 수 있고, 그 env의 LOPHN_HOME은 다른 root일 수 있다.
// 그래서 누른 시작에서는 화면 값만 가져온다. Electron을 import하지 않는다(test가 돈다).

// 화면 세션의 값이다. Wayland socket은 XDG_RUNTIME_DIR 아래에 있다.
const DISPLAY_ENV_NAMES = [
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "XDG_SESSION_TYPE",
  "XDG_CURRENT_DESKTOP",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
];

/** 누른 시작에 display가 없으면 desktop 앱이 설 수 없어 undefined다. */
export function relaunchOf(input: {
  dataRoot: string;
  /** 개발이면 build한 shell entry. 설치본은 undefined다. */
  entry: string | undefined;
  /** page host 자신의 env. sandbox 규칙을 본다. */
  own: Record<string, string | undefined>;
  /** 누른 시작이 lock 요청에 실어 보낸 env. */
  clicked: Record<string, string | undefined> | undefined;
}): { args: string[]; env: Record<string, string> } | undefined {
  const { clicked } = input;
  if (!clicked?.DISPLAY && !clicked?.WAYLAND_DISPLAY) return undefined;
  const env: Record<string, string> = { LOPHN_HOME: input.dataRoot };
  for (const name of DISPLAY_ENV_NAMES) {
    const value = clicked[name];
    if (value !== undefined) env[name] = value;
  }
  const dev = input.entry !== undefined;
  return {
    args: [
      // core의 shell-launcher와 같은 규칙: 개발이고 ELECTRON_NO_SANDBOX=1이면 sandbox를 끈다.
      ...(dev && input.own.ELECTRON_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
      ...(dev ? [input.entry!] : []),
      "--home",
      input.dataRoot,
    ],
    env,
  };
}

// 사람 터미널의 shell에 끼우는 시작 층. 사용자의 startup file을 login shell처럼 모두 읽은 뒤에
// `codex`·`opencode`·`kilo`·`cline` 함수를 정의해, 사람이 친 명령이 공유 background server가 아니라
// 그 탭의 private server로 돈다. `claude`·`codex`·`opencode` 함수는 첫 인자가 `gui`일 때만 `lophn gui <harness>`로
// 가고(CLI 화면 대신 lophn 창), 그 밖의 인자는 원래 명령에 그대로 넘긴다.
//
// 왜: Codex(0.156+)와 OpenCode(2.x)는 TUI를 사용자당 하나인 background server에 붙이고 turn과 hook(plugin)을
// 그 server에서 돌린다. server는 처음 뜰 때의 env를 그대로 쓰므로(Codex `app-server-daemon/README.md`:
// "Shared clients use the environment inherited when the daemon started") hook이 이 탭의
// `LPN_TERMINAL_HOOK`이 아닌 옛 값을 본다. `--no-daemon`(Codex), `--standalone`(OpenCode)을 붙이면 TUI가
// 자기 server를 띄워 hook이 탭의 env를 물려받는다. 함수 모양은 orca(`src/shared/codex-shell-function.ts`)를
// 따랐다. Kilo는 env `KILO_NO_DAEMON=1`, Cline은 env `CLINE_SESSION_BACKEND_MODE=local`이 같은 일을 한다.
//
// 이 file들은 앱이 켜질 때 per-run 폴더에 쓴다(`$BROWSER` shim과 같은 이유로, packaged의 asar 안 file은
// 외부 shell이 읽지 못한다). 폴더 경로는 env `LPN_SHELL_INIT`으로 터미널에 준다. LOPHN_* env는 터미널에서
// 지워지므로 쓰지 않는다.

export const SHELL_INIT_ENV = "LPN_SHELL_INIT";
// zsh의 원래 ZDOTDIR. 비어 있으면 사용자가 ZDOTDIR을 두지 않은 것이다.
const USER_ZDOTDIR_ENV = "LPN_USER_ZDOTDIR";

type ShellLaunch = { args: string[]; env: Record<string, string> };

/**
 * login shell 실행에 시작 층을 끼운다. 모르는 shell(sh, dash, nu 등)이나 폴더가 없으면 그대로 둔다.
 * `env`는 shell이 받을 최종 env이고 돌려주는 env는 더할 값만이다.
 */
export function integrateShell(
  file: string,
  args: string[],
  env: Readonly<Record<string, string | undefined>>,
): ShellLaunch {
  const dir = env[SHELL_INIT_ENV];
  const unchanged = { args, env: {} };
  if (dir === undefined || dir === "") return unchanged;
  const name = file.slice(file.lastIndexOf("/") + 1);
  switch (name) {
    // bash는 -l이면 --init-file을 무시하고 profile을 읽는다. -l 없이 --init-file로 띄우고 profile 순서는
    // bash.sh가 따라 한다(VS Code shell integration과 같은 방식).
    case "bash":
      return { args: ["--init-file", `${dir}/bash.sh`], env: {} };
    // ZDOTDIR을 우리 폴더로 줘 .zshenv만 먼저 읽히게 하고, 그 안에서 바로 사용자 값으로 돌려준다.
    case "zsh":
      return {
        args,
        env: {
          ZDOTDIR: `${dir}/zsh`,
          [USER_ZDOTDIR_ENV]: env.ZDOTDIR ?? "",
        },
      };
    // --init-command는 config.fish 뒤에 돈다.
    case "fish":
      return {
        args: [
          ...args,
          "--init-command",
          `source ${fishQuote(`${dir}/fish.fish`)}`,
        ],
        env: {},
      };
    default:
      return unchanged;
  }
}

function fishQuote(text: string): string {
  return `'${text.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

// bash가 -l로 뜰 때 읽는 순서(man bash INVOCATION)를 따른다. login_shell option은 읽기 전용이라 켜지 못한다.
const BASH_INIT = `# lophn shell integration: login bash처럼 profile을 읽은 뒤 함수를 정의한다.
if [ -f /etc/profile ]; then . /etc/profile; fi
if [ -f "$HOME/.bash_profile" ]; then
  . "$HOME/.bash_profile"
elif [ -f "$HOME/.bash_login" ]; then
  . "$HOME/.bash_login"
elif [ -f "$HOME/.profile" ]; then
  . "$HOME/.profile"
fi
. "$${SHELL_INIT_ENV}/functions.sh"
`;

// ZDOTDIR을 먼저 사용자 값으로 돌려, 이후 .zprofile·.zshrc·.zlogin은 원래 자리에서 읽힌다. 함수는 첫
// prompt 직전에 정의한다. PATH가 보통 .zprofile·.zshrc에서 완성돼서 그 전에는 codex를 찾지 못한다.
const ZSH_ENV = `# lophn shell integration
if [[ -n "\${${USER_ZDOTDIR_ENV}-}" ]]; then
  export ZDOTDIR="$${USER_ZDOTDIR_ENV}"
else
  unset ZDOTDIR
fi
unset ${USER_ZDOTDIR_ENV}
__lophn_init() {
  emulate -L zsh
  precmd_functions=(\${precmd_functions:#__lophn_init})
  . "$${SHELL_INIT_ENV}/functions.sh"
  unfunction __lophn_init
}
precmd_functions+=(__lophn_init)
if [[ -r "\${ZDOTDIR:-$HOME}/.zshenv" ]]; then
  . "\${ZDOTDIR:-$HOME}/.zshenv"
fi
`;

// claude·codex·opencode·kilo·cline이 사용자의 alias나 function이면 정의하지 않는다(실행 파일일 때만 감싼다).
// codex·opencode는 호출마다 --help로 flag 지원을 본다. 옛 버전은 모르는 flag에 오류로 끝난다.
// kilo·cline은 env라 모르는 판이 무시한다. 공유 daemon을 다루는 subcommand(kilo daemon·console, cline hub)에는
// 붙이지 않는다.
const FUNCTIONS = `# lophn shell integration (bash, zsh 공용)
__lophn_external() {
  if [ -n "\${ZSH_VERSION-}" ]; then
    local __kind
    __kind="$(whence -w "$1" 2>/dev/null)"
    [ "\${__kind##*: }" = command ]
  else
    [ "$(type -t "$1" 2>/dev/null)" = file ]
  fi
}

if __lophn_external claude; then
  function claude {
    if [ "\${1-}" = gui ]; then
      shift
      command __LOPHN_CLI__ gui claude "$@"
      return
    fi
    command claude "$@"
  }
fi

if __lophn_external codex; then
  function codex {
    if [ "\${1-}" = gui ]; then
      shift
      command __LOPHN_CLI__ gui codex "$@"
      return
    fi
    local __arg __flag=1
    for __arg in "$@"; do
      case "$__arg" in
        --no-daemon|agents|queue|--remote|--remote=*) __flag=0 ;;
      esac
    done
    if [ "$__flag" = 1 ]; then
      case "$(command codex --help 2>/dev/null </dev/null)" in
        *--no-daemon*) set -- --no-daemon "$@" ;;
      esac
    fi
    command codex "$@"
  }
fi

if __lophn_external opencode; then
  function opencode {
    if [ "\${1-}" = gui ]; then
      shift
      command __LOPHN_CLI__ gui opencode "$@"
      return
    fi
    local __arg __first=""
    for __arg in "$@"; do
      case "$__arg" in
        --standalone|--server|--server=*|-h|--help|-v|--version|--completions|--completions=*)
          command opencode "$@"; return ;;
      esac
    done
    case "\${1-}" in
      run|mini) __first="$1" ;;
      acp|api|auth|debug|mcp|models|pair|plugin|reload|serve|service|session|stats|uninstall|update|upgrade)
        command opencode "$@"; return ;;
    esac
    case "$(command opencode --help 2>/dev/null </dev/null)" in
      *--standalone*)
        if [ -n "$__first" ]; then
          shift
          set -- "$__first" --standalone "$@"
        else
          set -- --standalone "$@"
        fi ;;
    esac
    command opencode "$@"
  }
fi

if __lophn_external kilo; then
  function kilo {
    case "\${1-}" in
      daemon|console) command kilo "$@" ;;
      *) KILO_NO_DAEMON=1 command kilo "$@" ;;
    esac
  }
fi

if __lophn_external cline; then
  function cline {
    case "\${1-}" in
      hub) command cline "$@" ;;
      *) CLINE_SESSION_BACKEND_MODE=local command cline "$@" ;;
    esac
  }
fi

unset -f __lophn_external
`;

const FISH = `# lophn shell integration
set -l __lophn_kind (type -t claude 2>/dev/null)
if test "$__lophn_kind" = file
  function claude
    if test "$argv[1]" = gui
      set -e argv[1]
      command __LOPHN_CLI__ gui claude $argv
      return
    end
    command claude $argv
  end
end

set __lophn_kind (type -t codex 2>/dev/null)
if test "$__lophn_kind" = file
  function codex
    if test "$argv[1]" = gui
      set -e argv[1]
      command __LOPHN_CLI__ gui codex $argv
      return
    end
    if not string match -qr -- '^(agents|queue|--remote|--no-daemon|--remote=.*)$' $argv
      and command codex --help 2>/dev/null </dev/null | string match -q -- '*--no-daemon*'
      set argv --no-daemon $argv
    end
    command codex $argv
  end
end

set __lophn_kind (type -t opencode 2>/dev/null)
if test "$__lophn_kind" = file
  function opencode
    if test "$argv[1]" = gui
      set -e argv[1]
      command __LOPHN_CLI__ gui opencode $argv
      return
    end
    if string match -qr -- '^(--standalone|--server|--server=.*|-h|--help|-v|--version|--completions|--completions=.*)$' $argv
      command opencode $argv
      return
    end
    if contains -- "$argv[1]" acp api auth debug mcp models pair plugin reload serve service session stats uninstall update upgrade
      command opencode $argv
      return
    end
    if command opencode --help 2>/dev/null </dev/null | string match -q -- '*--standalone*'
      if contains -- "$argv[1]" run mini
        set -l first $argv[1]
        set -e argv[1]
        set argv $first --standalone $argv
      else
        set argv --standalone $argv
      end
    end
    command opencode $argv
  end
end

set __lophn_kind (type -t kilo 2>/dev/null)
if test "$__lophn_kind" = file
  function kilo
    if contains -- "$argv[1]" daemon console
      command kilo $argv
      return
    end
    set -lx KILO_NO_DAEMON 1
    command kilo $argv
  end
end

set __lophn_kind (type -t cline 2>/dev/null)
if test "$__lophn_kind" = file
  function cline
    if test "$argv[1]" = hub
      command cline $argv
      return
    end
    set -lx CLINE_SESSION_BACKEND_MODE local
    command cline $argv
  end
end
set -e __lophn_kind
`;

type ShellInitFs = {
  mkdir(path: string): void; // recursive
  write(path: string, text: string): void; // 0600
};

const CLI_TOKEN = "__LOPHN_CLI__";

function shQuote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

/**
 * 시작 층 file을 쓰고 그 폴더를 돌려준다. `cli`는 `gui` 함수가 부를 lophn 명령이다(설치본은 `lophn`, 개발은 launcher의
 * 절대 경로). 터미널 env에서는 LOPHN_* 가 지워져 shell이 스스로 찾지 못하므로 shell main이 아는 값을 넣는다.
 */
export function writeShellInit(
  fs: ShellInitFs,
  runDir: string,
  cli: string,
): string {
  const dir = `${runDir}/shell-init`;
  fs.mkdir(`${dir}/zsh`);
  fs.write(`${dir}/bash.sh`, BASH_INIT);
  fs.write(`${dir}/zsh/.zshenv`, ZSH_ENV);
  fs.write(`${dir}/fish.fish`, FISH.replaceAll(CLI_TOKEN, fishQuote(cli)));
  fs.write(
    `${dir}/functions.sh`,
    FUNCTIONS.replaceAll(CLI_TOKEN, shQuote(cli)),
  );
  return dir;
}

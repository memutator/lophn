// 사람 터미널의 shell에 끼우는 시작 층. 사용자의 startup file을 login shell처럼 모두 읽은 뒤에
// `codex`·`opencode`·`kilo`·`cline` 함수를 정의해, 사람이 친 명령이 공유 background server가 아니라
// 그 탭의 private server로 돈다. `claude`·`codex`·`opencode`·`omp`·`agy` 함수는 첫 인자가 `gui`일 때만 그 탭의 hook socket으로
// 탭을 GUI로 바꿔 달라는 요청(`lophn hook <harness> lophn-gui`)을 보내고, 그 밖의 인자는 원래 명령에 그대로 넘긴다.
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

import { win32 } from "node:path";

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
  exists: (path: string) => boolean,
): ShellLaunch {
  const dir = env[SHELL_INIT_ENV];
  const unchanged = { args, env: {} };
  if (dir === undefined || dir === "") return unchanged;
  // Windows는 `\`와 `/`를 섞어 쓰고 file 이름의 대소문자도 가리지 않는다.
  const cut = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
  const name = file.slice(cut + 1).toLowerCase();
  switch (name) {
    // bash는 -l이면 --init-file을 무시하고 profile을 읽는다. -l 없이 --init-file로 띄우고 profile 순서는
    // bash.sh가 따라 한다(VS Code shell integration과 같은 방식).
    // init file이 없으면 bash는 오류 없이 rc를 하나도 읽지 않고, zsh도 빈 ZDOTDIR에서 사용자 rc를 건너뛴다.
    // 폴더는 tmp 정리 등으로 사라질 수 있으니 그때는 함수 없이 원래 login shell로 띄운다.
    case "bash":
      if (!exists(`${dir}/bash.sh`)) return unchanged;
      return { args: ["--init-file", `${dir}/bash.sh`], env: {} };
    // ZDOTDIR을 우리 폴더로 줘 .zshenv만 먼저 읽히게 하고, 그 안에서 바로 사용자 값으로 돌려준다.
    case "zsh":
      if (!exists(`${dir}/zsh/.zshenv`)) return unchanged;
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
    // PowerShell 7·5.1은 profile을 모두 읽은 뒤 `-Command`를 돈다. 정책을 우회하지 않고 사용자 profile은 그대로 둔다.
    case "pwsh.exe":
    case "powershell.exe": {
      // PowerShell single-quoted literal: 작은따옴표는 겹쳐 쓴다.
      const init = `'${win32.join(dir, "functions.ps1").replaceAll("'", "''")}'`;
      return {
        args: [...args, "-NoExit", "-Command", `. ${init}`],
        env: {},
      };
    }
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

__lophn_gui() {
  local __harness="$1" __id=""
  shift
  case "$#" in
    0) ;;
    1) case "$1" in --resume=*) __id="\${1#--resume=}" ;; *) __id="-" ;; esac ;;
    2) if [ "$1" = --resume ]; then __id="$2"; else __id="-"; fi ;;
    *) __id="-" ;;
  esac
  case "$__id" in
    -|*[!A-Za-z0-9._-]*) printf 'usage: %s gui [--resume <id>]\\n' "$__harness" >&2; return 2 ;;
  esac
  if [ "$#" -gt 0 ] && { [ -z "$__id" ] || [ "\${#__id}" -gt 200 ]; }; then
    printf 'usage: %s gui [--resume <id>]\\n' "$__harness" >&2; return 2
  fi
  if [ -n "$__id" ]; then
    printf '{"resume":"%s"}' "$__id"
  else
    printf '{}'
  fi | command __LOPHN_CLI__ hook "$__harness" lophn-gui
}

if __lophn_external claude; then
  function claude {
    if [ "\${1-}" = gui ]; then
      shift
      __lophn_gui claude "$@"
      return
    fi
    command claude "$@"
  }
fi

if __lophn_external omp; then
  function omp {
    if [ "\${1-}" = gui ]; then
      shift
      __lophn_gui omp "$@"
      return
    fi
    command omp "$@"
  }
fi

if __lophn_external agy; then
  function agy {
    if [ "\${1-}" = gui ]; then
      shift
      __lophn_gui antigravity "$@"
      return
    fi
    command agy "$@"
  }
fi

if __lophn_external codex; then
  function codex {
    if [ "\${1-}" = gui ]; then
      shift
      __lophn_gui codex "$@"
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
      __lophn_gui opencode "$@"
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
function __lophn_gui
  set -l harness $argv[1]
  set -l rest $argv
  set -e rest[1]
  set -l id
  if test (count $rest) -eq 0
  else if test (count $rest) -eq 1; and string match -qr -- '^--resume=' $rest[1]
    set id (string replace -- '--resume=' '' $rest[1])
    or set id ''
  else if test (count $rest) -eq 2; and test "$rest[1]" = --resume
    set id $rest[2]
  else
    echo "usage: $harness gui [--resume <id>]" >&2
    return 2
  end
  if test (count $rest) -gt 0; and not string match -qr -- '^[A-Za-z0-9._-]{1,200}$' "$id"
    echo "usage: $harness gui [--resume <id>]" >&2
    return 2
  end
  if test (count $rest) -gt 0
    printf '{"resume":"%s"}' $id | command __LOPHN_CLI__ hook $harness lophn-gui
  else
    printf '{}' | command __LOPHN_CLI__ hook $harness lophn-gui
  end
end

set -l __lophn_kind (type -t claude 2>/dev/null)
if test "$__lophn_kind" = file
  function claude
    if test "$argv[1]" = gui
      set -e argv[1]
      __lophn_gui claude $argv
      return
    end
    command claude $argv
  end
end

set __lophn_kind (type -t omp 2>/dev/null)
if test "$__lophn_kind" = file
  function omp
    if test "$argv[1]" = gui
      set -e argv[1]
      __lophn_gui omp $argv
      return
    end
    command omp $argv
  end
end

set __lophn_kind (type -t agy 2>/dev/null)
if test "$__lophn_kind" = file
  function agy
    if test "$argv[1]" = gui
      set -e argv[1]
      __lophn_gui antigravity $argv
      return
    end
    command agy $argv
  end
end

set __lophn_kind (type -t codex 2>/dev/null)
if test "$__lophn_kind" = file
  function codex
    if test "$argv[1]" = gui
      set -e argv[1]
      __lophn_gui codex $argv
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
      __lophn_gui opencode $argv
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

// PowerShell 7·5.1 시작 층. 사용자의 profile을 모두 읽은 뒤 dot-source되므로 profile·alias·function은 고치지 않고
// 지금 실제 외부 명령으로 잡히는 것만 감싼다. 감싼 경로를 call operator로 불러 자기 함수를 다시 부르지 않는다.
// 경로는 `$global:`에 둔다. `$script:`는 함수를 부른 script의 scope로 풀려서 사용자 .ps1 안에서 부르면 비어 있었다.
// GUI 다섯은 첫 인자가 `gui`일 때만 분기하고, private server wrapper 넷은 bash·zsh·fish의 `FUNCTIONS`와 같은 규칙을 쓴다.
const POWERSHELL = `# lophn shell integration (PowerShell 7·5.1)
function __lophn_native {
  param([string] $Name)
  # 사용자가 alias나 function을 두었으면 그대로 둔다.
  if ($null -ne (Get-Command -Name $Name -CommandType Alias, Function -ErrorAction SilentlyContinue)) {
    return $null
  }
  $found = Get-Command -Name $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $found) {
    return $null
  }
  return $found.Path
}

# gui 요청의 인자 모양은 여기서만 본다. 잘못된 인자는 사용법과 LASTEXITCODE 2다. cwd는 lophn hook이 더한다.
function __lophn_gui {
  param([string] $Harness, [string[]] $Rest)
  $id = $null
  $count = 0
  if ($null -ne $Rest) {
    $count = $Rest.Count
  }
  switch ($count) {
    0 { }
    1 {
      if ($Rest[0] -clike '--resume=*') {
        $id = $Rest[0].Substring(9)
      } else {
        $id = '-'
      }
    }
    2 {
      if ($Rest[0] -ceq '--resume') {
        $id = $Rest[1]
      } else {
        $id = '-'
      }
    }
    default { $id = '-' }
  }
  if ($null -ne $id -and ($id -ceq '-' -or $id -cnotmatch '^[A-Za-z0-9._-]{1,200}$')) {
    [Console]::Error.WriteLine("usage: $Harness gui [--resume <id>]")
    $global:LASTEXITCODE = 2
    return
  }
  if ($null -ne $id) {
    $payload = '{"resume":"' + $id + '"}'
  } else {
    $payload = '{}'
  }
  $payload | & __LOPHN_CLI__ hook $Harness lophn-gui
}

$__lophn_path = __lophn_native 'claude'
if ($null -ne $__lophn_path) {
  $global:__lophn_native_claude = $__lophn_path
  function claude {
    if ($args.Count -gt 0 -and ([string] $args[0]) -ceq 'gui') {
      $rest = @($args | Select-Object -Skip 1)
      __lophn_gui 'claude' $rest
      return
    }
    & $global:__lophn_native_claude @args
  }
}

$__lophn_path = __lophn_native 'omp'
if ($null -ne $__lophn_path) {
  $global:__lophn_native_omp = $__lophn_path
  function omp {
    if ($args.Count -gt 0 -and ([string] $args[0]) -ceq 'gui') {
      $rest = @($args | Select-Object -Skip 1)
      __lophn_gui 'omp' $rest
      return
    }
    & $global:__lophn_native_omp @args
  }
}

$__lophn_path = __lophn_native 'agy'
if ($null -ne $__lophn_path) {
  $global:__lophn_native_agy = $__lophn_path
  function agy {
    if ($args.Count -gt 0 -and ([string] $args[0]) -ceq 'gui') {
      $rest = @($args | Select-Object -Skip 1)
      __lophn_gui 'antigravity' $rest
      return
    }
    & $global:__lophn_native_agy @args
  }
}

# Codex는 --help가 --no-daemon을 알릴 때만 붙인다. shared server가 목적인 명령에는 붙이지 않는다.
$__lophn_path = __lophn_native 'codex'
if ($null -ne $__lophn_path) {
  $global:__lophn_native_codex = $__lophn_path
  function codex {
    if ($args.Count -gt 0 -and ([string] $args[0]) -ceq 'gui') {
      $rest = @($args | Select-Object -Skip 1)
      __lophn_gui 'codex' $rest
      return
    }
    $guarded = $false
    foreach ($arg in $args) {
      $text = [string] $arg
      if ($text -ceq '--no-daemon' -or $text -ceq 'agents' -or $text -ceq 'queue' -or $text -ceq '--remote' -or $text -clike '--remote=*') {
        $guarded = $true
      }
    }
    $nativeArgs = @($args)
    if (-not $guarded) {
      $help = & $global:__lophn_native_codex --help 2>$null
      if ($help -cmatch '--no-daemon') {
        $nativeArgs = @('--no-daemon') + $nativeArgs
      }
    }
    & $global:__lophn_native_codex @nativeArgs
  }
}

# OpenCode는 자기 server·flag·subcommand 예외에서 그대로 부르고, 아니면 run·mini 뒤 또는 TUI 앞에 --standalone을 넣는다.
$__lophn_path = __lophn_native 'opencode'
if ($null -ne $__lophn_path) {
  $global:__lophn_native_opencode = $__lophn_path
  function opencode {
    if ($args.Count -gt 0 -and ([string] $args[0]) -ceq 'gui') {
      $rest = @($args | Select-Object -Skip 1)
      __lophn_gui 'opencode' $rest
      return
    }
    $passthrough = $false
    foreach ($arg in $args) {
      $text = [string] $arg
      if ($text -ceq '--standalone' -or $text -ceq '--server' -or $text -clike '--server=*' -or $text -ceq '-h' -or $text -ceq '--help' -or $text -ceq '-v' -or $text -ceq '--version' -or $text -ceq '--completions' -or $text -clike '--completions=*') {
        $passthrough = $true
      }
    }
    if ($passthrough) {
      & $global:__lophn_native_opencode @args
      return
    }
    $first = ''
    if ($args.Count -gt 0) {
      $first = [string] $args[0]
    }
    if (@('acp', 'api', 'auth', 'debug', 'mcp', 'models', 'pair', 'plugin', 'reload', 'serve', 'service', 'session', 'stats', 'uninstall', 'update', 'upgrade') -ccontains $first) {
      & $global:__lophn_native_opencode @args
      return
    }
    $nativeArgs = @($args)
    $help = & $global:__lophn_native_opencode --help 2>$null
    if ($help -cmatch '--standalone') {
      if ($first -ceq 'run' -or $first -ceq 'mini') {
        $rest = @($args | Select-Object -Skip 1)
        $nativeArgs = @($first, '--standalone') + $rest
      } else {
        $nativeArgs = @('--standalone') + $nativeArgs
      }
    }
    & $global:__lophn_native_opencode @nativeArgs
  }
}

# Kilo와 Cline은 flag가 아니라 env다. 공유 daemon을 다루는 명령에는 env를 두지 않고, 그 밖의 호출 동안만 두었다가
# 원래 값(없으면 없음)으로 돌린다. PowerShell 7은 $null을 ""로 넘겨 SetEnvironmentVariable이 빈 값을 남기므로 없던 값은 지운다.
$__lophn_path = __lophn_native 'kilo'
if ($null -ne $__lophn_path) {
  $global:__lophn_native_kilo = $__lophn_path
  function kilo {
    $first = ''
    if ($args.Count -gt 0) {
      $first = [string] $args[0]
    }
    if ($first -ceq 'daemon' -or $first -ceq 'console') {
      & $global:__lophn_native_kilo @args
      return
    }
    $previous = [Environment]::GetEnvironmentVariable('KILO_NO_DAEMON', 'Process')
    try {
      [Environment]::SetEnvironmentVariable('KILO_NO_DAEMON', '1', 'Process')
      & $global:__lophn_native_kilo @args
    } finally {
      if ($null -eq $previous) {
        Remove-Item -Path Env:KILO_NO_DAEMON -ErrorAction SilentlyContinue
      } else {
        [Environment]::SetEnvironmentVariable('KILO_NO_DAEMON', $previous, 'Process')
      }
    }
  }
}

$__lophn_path = __lophn_native 'cline'
if ($null -ne $__lophn_path) {
  $global:__lophn_native_cline = $__lophn_path
  function cline {
    $first = ''
    if ($args.Count -gt 0) {
      $first = [string] $args[0]
    }
    if ($first -ceq 'hub') {
      & $global:__lophn_native_cline @args
      return
    }
    $previous = [Environment]::GetEnvironmentVariable('CLINE_SESSION_BACKEND_MODE', 'Process')
    try {
      [Environment]::SetEnvironmentVariable('CLINE_SESSION_BACKEND_MODE', 'local', 'Process')
      & $global:__lophn_native_cline @args
    } finally {
      if ($null -eq $previous) {
        Remove-Item -Path Env:CLINE_SESSION_BACKEND_MODE -ErrorAction SilentlyContinue
      } else {
        [Environment]::SetEnvironmentVariable('CLINE_SESSION_BACKEND_MODE', $previous, 'Process')
      }
    }
  }
}

Remove-Item -Path Function:\\__lophn_native -ErrorAction SilentlyContinue
Remove-Variable -Name __lophn_path -ErrorAction SilentlyContinue
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
 * 절대 경로). `lophn hook`은 core를 부르지 않고 그 탭의 hook socket(`LPN_TERMINAL_HOOK`)에만 쓰므로 data root를 넘기지 않는다.
 * `platform`은 main이 넘긴다. POSIX는 기존 shell file을, win32는 `functions.ps1` 하나를 쓴다.
 */
export function writeShellInit(
  fs: ShellInitFs,
  runDir: string,
  cli: string,
  platform: NodeJS.Platform,
): string {
  if (platform === "win32") {
    const dir = win32.join(runDir, "shell-init");
    const quotedCli = `'${cli.replaceAll("'", "''")}'`;
    // 5.1은 BOM 없는 file을 ANSI로 읽어 한글·공백 경로가 깨진다.
    fs.mkdir(dir);
    fs.write(
      win32.join(dir, "functions.ps1"),
      `\uFEFF${POWERSHELL.replaceAll(CLI_TOKEN, quotedCli)}`,
    );
    return dir;
  }
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

// 대화의 shell 코드 블록을 새 터미널에서 실행하는 길. Agent 화면이 host에서 받아 깊은 markdown까지 내린다.
// 없으면(터미널 통로 없음, detached 창) 실행 단추가 없다. `!`로 시작하는 블록은 composer를 shell mode로 채우는 길(`FillShell`)이 따로 있다.
import { createContext, useContext } from "react";

import { terminalCommandSchema } from "../../../../protocol/coding-agent/terminals.ts";

type RunCode = (command: string) => void;

const RunCodeContext = createContext<RunCode | null>(null);

export const RunCodeProvider = RunCodeContext.Provider;

export function useRunCode(): RunCode | null {
  return useContext(RunCodeContext);
}

type FillShell = (text: string) => void;

const FillShellContext = createContext<FillShell | null>(null);

export const FillShellProvider = FillShellContext.Provider;

export function useFillShell(): FillShell | null {
  return useContext(FillShellContext);
}

/** 첫 공백 아닌 글자가 `!`인 블록이다(fence 언어는 따지지 않는다). */
export function shellInput(code: string): boolean {
  return code.trimStart().startsWith("!");
}

const SHELL_LANGUAGES: Record<string, true> = {
  bash: true,
  sh: true,
  zsh: true,
};

/**
 * 실행 단추를 둘 코드인지. fence 언어가 bash·sh·zsh이고, 줄바꿈과 tab 밖의 제어 문자(숨은 escape)가 없고, 빈
 * 글이 아니어야 한다. main도 같은 schema로 다시 거른다.
 */
export function runnable(code: string, language: string | undefined): boolean {
  if (
    language === undefined ||
    SHELL_LANGUAGES[language.toLowerCase()] !== true
  )
    return false;
  return code.trim() !== "" && terminalCommandSchema.safeParse(code).success;
}

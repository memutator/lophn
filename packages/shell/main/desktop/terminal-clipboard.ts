// Electron 44+의 clipboard.readText·writeText는 Promise를 돌려준다. await 없이 IPC 응답 객체에 담으면
// structured clone이 DataCloneError로 실패하고, 예외를 삼키지 않으면 unhandled rejection이 난다.
export interface ClipboardPort {
  readText(): string | Promise<string>;
  writeText(text: string): void | Promise<void>;
}

export async function copyTerminalText(
  clipboard: ClipboardPort,
  text: string,
  headless: boolean,
): Promise<{ ok: true; value: null }> {
  if (!headless) {
    try {
      await clipboard.writeText(text);
    } catch {
      // OS clipboard가 잠겼거나 접근할 수 없어도 호출 자체는 조용히 끝낸다.
    }
  }
  return { ok: true, value: null };
}

export async function pasteTerminalText(
  clipboard: ClipboardPort,
  headless: boolean,
): Promise<{ ok: true; value: string }> {
  if (headless) return { ok: true, value: "" };
  try {
    const value = await clipboard.readText();
    return { ok: true, value: typeof value === "string" ? value : "" };
  } catch {
    return { ok: true, value: "" };
  }
}

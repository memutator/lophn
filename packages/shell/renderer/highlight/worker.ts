// Shiki를 Worker에서 돌린다. grammar는 그 언어의 fence를 처음 볼 때 chunk로 불러온다.
import {
  createCssVariablesTheme,
  createHighlighterCore,
  type ThemedToken,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages } from "shiki/langs";
import type { CodeLine, CodeToken } from "@lophn/ui/reading";
import type { HighlightReply, HighlightRequest } from "./messages.ts";

// css-variables theme가 내는 변수 이름이 design token(`--code-…`)의 이름과 같아 색은 design이 정한다.
const core = createHighlighterCore({
  themes: [
    createCssVariablesTheme({
      name: "lophn",
      variablePrefix: "--code-",
    }),
  ],
  langs: [],
  engine: createJavaScriptRegexEngine({ forgiving: true }),
});

// vscode-textmate FontStyle bit: 1 italic, 2 bold, 4 underline. -1(NotSet)은 style이 없다.
function toToken(token: ThemedToken): CodeToken {
  const fontStyle =
    token.fontStyle !== undefined && token.fontStyle > 0 ? token.fontStyle : 0;
  return {
    text: token.content,
    color: token.color,
    italic: (fontStyle & 1) !== 0,
    bold: (fontStyle & 2) !== 0,
    underline: (fontStyle & 4) !== 0,
  };
}

async function highlight({
  code,
  language,
}: HighlightRequest): Promise<readonly CodeLine[] | null> {
  const lang = language.toLowerCase();
  if (!Object.hasOwn(bundledLanguages, lang)) return null;
  try {
    const highlighter = await core;
    await highlighter.loadLanguage(
      bundledLanguages[lang as keyof typeof bundledLanguages],
    );
    const { tokens } = highlighter.codeToTokens(code, {
      lang,
      theme: "lophn",
    });
    return tokens.map((line) => line.map(toToken));
  } catch {
    return null;
  }
}

self.addEventListener("message", (event: MessageEvent<HighlightRequest>) => {
  const request = event.data;
  void highlight(request).then((lines) => {
    const reply: HighlightReply = { id: request.id, lines };
    self.postMessage(reply);
  });
});

// Shiki를 Worker에서 돌린다. grammar는 그 언어의 fence를 처음 볼 때 chunk로 불러온다.

import type { CodeLine, CodeToken } from "@lophn/ui/reading";
import {
  createCssVariablesTheme,
  createHighlighterCore,
  type GrammarState,
  type ThemedToken,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages } from "shiki/langs";
import {
  advance,
  type Session,
  SLOW_MS,
  type Tokenize,
} from "./incremental.ts";
import { Lru } from "./lru.ts";
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

// block마다 앞 줄의 grammar state를 들고 있다. 한도를 넘으면 오래 안 쓴 block부터 버린다.
const sessions = new Lru<string, Session<GrammarState>>(32);

async function highlight({
  code,
  language,
  key,
  final,
}: HighlightRequest): Promise<readonly CodeLine[] | null> {
  const lang = language.toLowerCase();
  if (!Object.hasOwn(bundledLanguages, lang)) return null;
  try {
    const highlighter = await core;
    await highlighter.loadLanguage(
      bundledLanguages[lang as keyof typeof bundledLanguages],
    );
    const tokenize: Tokenize<GrammarState> = (text, state) => {
      const tokens = highlighter.codeToTokensBase(text, {
        lang,
        theme: "lophn",
        grammarState: state,
        tokenizeTimeLimit: SLOW_MS,
      });
      return {
        lines: tokens.map((line) => line.map(toToken)),
        state: highlighter.getLastGrammarState(tokens),
      };
    };
    const out = advance(sessions.get(key), code, lang, final, tokenize, () =>
      performance.now(),
    );
    sessions.set(key, out.session);
    return out.lines;
  } catch {
    return null;
  }
}

// await 사이에 session을 서로 덮어쓰지 않도록 요청을 한 줄로 처리한다.
let queue: Promise<unknown> = Promise.resolve();

self.addEventListener("message", (event: MessageEvent<HighlightRequest>) => {
  const request = event.data;
  queue = queue
    .then(() => highlight(request))
    .then((lines) => {
      const reply: HighlightReply = { id: request.id, lines };
      self.postMessage(reply);
    });
});

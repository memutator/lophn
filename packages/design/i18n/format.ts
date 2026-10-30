import {
  createIntl,
  createIntlCache,
  IntlErrorCode,
  type IntlShape,
} from "@formatjs/intl";
import { en, type MessageKey } from "./en.ts";

export type { MessageKey } from "./en.ts";

/** ICU 문장의 `{name}`에 넣는 값. */
export type MessageValues = Readonly<Record<string, string | number | Date>>;

export type Translate = (key: MessageKey, values?: MessageValues) => string;

// locale(언어 부분)마다 catalog. 없는 locale과 없는 key는 en 문장으로 보인다.
const CATALOGS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  en,
};

const cache = createIntlCache();
const translators = new Map<string, Translate>();

function catalogOf(locale: string): Readonly<Record<string, string>> {
  const language = locale.split("-")[0] ?? locale;
  return CATALOGS[locale] ?? CATALOGS[language] ?? {};
}

function make(locale: string): Translate {
  const intl: IntlShape = createIntl(
    {
      locale,
      defaultLocale: "en",
      messages: catalogOf(locale),
      // 번역이 없는 key는 en 문장으로 보이는 것이 정상이다. 그 밖의 오류(ICU 문법·값 모자람)만 알린다.
      onError(error) {
        if (error.code !== IntlErrorCode.MISSING_TRANSLATION) {
          console.error(error);
        }
      },
    },
    cache,
  );
  return (key, values) =>
    String(intl.formatMessage({ id: key, defaultMessage: en[key] }, values));
}

/** locale 하나의 `t`. 같은 locale은 같은 함수다. */
export function translator(locale: string): Translate {
  let found = translators.get(locale);
  if (found === undefined) {
    found = make(locale);
    translators.set(locale, found);
  }
  return found;
}

/** lophn 화면의 언어. 앱 view의 `@lophn/app-ui`도 이 값을 받는다(`data-lophn-locale`). */
export const LOPHN_LOCALE = "en";

/** lophn 화면의 `t`. */
export const t: Translate = translator(LOPHN_LOCALE);

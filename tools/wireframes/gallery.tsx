import { useEffect, useRef, useState } from "react";
import { Button } from "@lophn/design/components";

import { pageById, PAGES, PARTS, type WireframePage } from "./pages.ts";
import { SCREENS } from "./frames/screens.tsx";
import styles from "./gallery.module.css";

/** frame의 고정 데스크톱 크기. 좁은 창에서는 이 크기 그대로 줄여서 보인다. */
export const FRAME_WIDTH = 1280;
export const FRAME_HEIGHT = 800;

type Theme = "auto" | "light" | "dark";
const THEME_KEY = "lophn.wireframes.theme";
const THEMES: readonly { value: Theme; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function readTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "auto";
  } catch {
    return "auto";
  }
}

function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      if (theme === "auto") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      // 저장하지 못해도 이번 화면은 그대로 보인다.
    }
  }, [theme]);
  return [theme, setTheme];
}

/** 주소 `#/<id>`의 page id. 목록이면 null이다. */
function useRoute(): string | null {
  const read = () => location.hash.replace(/^#\/?/, "") || null;
  const [id, setId] = useState(read);
  useEffect(() => {
    const listen = () => setId(read());
    addEventListener("hashchange", listen);
    return () => removeEventListener("hashchange", listen);
  }, []);
  return id;
}

export function Gallery() {
  const [theme, setTheme] = useTheme();
  const id = useRoute();
  const page = id === null ? undefined : pageById(id);
  useEffect(() => {
    document.title = page === undefined
      ? "lophn wireframes"
      : `${page.title} · lophn wireframes`;
    scrollTo(0, 0);
  }, [page]);
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <a className={styles.brand} href="#/">lophn wireframes</a>
        <div className={styles.themes} role="group" aria-label="Theme">
          {THEMES.map((item) => (
            <Button
              key={item.value}
              size="sm"
              variant={theme === item.value ? "primary" : "secondary"}
              aria-pressed={theme === item.value}
              onClick={() => setTheme(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </header>
      <div className={styles.body}>
        <Toc current={page} />
        {page === undefined
          ? <Index missing={id} />
          : <PageView page={page} theme={theme} />}
      </div>
    </div>
  );
}

/** "Launcher · empty"는 묶음 "Launcher"의 "empty"다. 가운뎃점이 없으면 제목 그대로 한 줄이다. */
function tocGroups(
  pages: readonly WireframePage[],
): { name: string; pages: { page: WireframePage; label: string }[] }[] {
  const groups: {
    name: string;
    pages: { page: WireframePage; label: string }[];
  }[] = [];
  for (const page of pages) {
    const cut = page.title.indexOf(" · ");
    const name = cut === -1 ? page.title : page.title.slice(0, cut);
    const label = cut === -1 ? page.title : page.title.slice(cut + 3);
    const last = groups.at(-1);
    if (last !== undefined && last.name === name && cut !== -1) {
      last.pages.push({ page, label });
    } else groups.push({ name, pages: [{ page, label }] });
  }
  return groups;
}

// 왼쪽 목차. 묶음마다 page를 늘어놓고 지금 page를 표시한다.
function Toc({ current }: { current: WireframePage | undefined }) {
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({
      block: "nearest",
    });
  }, [current]);
  return (
    <nav ref={nav} className={styles.toc} aria-label="Pages">
      <a
        className={styles.tocHome}
        href="#/"
        aria-current={current === undefined ? "page" : undefined}
      >
        전체 목록
      </a>
      {PARTS.map((part) => (
        <section key={part.id} className={styles.tocPart}>
          <h2 className={styles.tocPartTitle}>{part.title}</h2>
          {tocGroups(PAGES.filter((page) => page.part === part.id)).map((
            group,
            index,
          ) => (
            // 같은 이름의 묶음이 떨어져 있을 수 있어(Project · …) 이름만으로는 key가 겹친다.
            <div key={`${index}:${group.name}`} className={styles.tocGroup}>
              {group.pages.length > 1 || group.pages[0].label !== group.name
                ? <p className={styles.tocGroupName}>{group.name}</p>
                : null}
              <ol className={styles.tocList}>
                {group.pages.map(({ page, label }) => (
                  <li key={page.id}>
                    <a
                      className={styles.tocLink}
                      href={`#/${page.id}`}
                      aria-current={page === current ? "page" : undefined}
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </section>
      ))}
    </nav>
  );
}

function Badges({ page }: { page: WireframePage }) {
  return (
    <ul className={styles.badges}>
      {page.badges.map((badge, index) => (
        <li
          key={badge}
          className={styles.badge}
          data-kind={index === 0 ? page.part : "flow"}
        >
          {badge}
        </li>
      ))}
    </ul>
  );
}

function Index({ missing }: { missing: string | null }) {
  return (
    <main className={styles.index}>
      {missing === null ? null : (
        <p className={styles.missing}>
          “{missing}” page가 없다. 아래 목록에서 고른다.
        </p>
      )}
      {PARTS.map((part) => (
        <section key={part.id} className={styles.part}>
          <h2 className={styles.partTitle}>{part.title}</h2>
          <p className={styles.text}>{part.summary}</p>
          <ol className={styles.cards}>
            {PAGES.filter((page) => page.part === part.id).map((page) => (
              <li key={page.id} className={styles.card}>
                <a className={styles.cardLink} href={`#/${page.id}`}>
                  {page.title}
                </a>
                <Badges page={page} />
                <p className={styles.cardText}>{page.description}</p>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </main>
  );
}

function PageView({ page, theme }: { page: WireframePage; theme: Theme }) {
  const at = PAGES.indexOf(page);
  const previous = PAGES[at - 1];
  const next = PAGES[at + 1];
  const go = (target: WireframePage) => () => {
    location.hash = `#/${target.id}`;
  };
  return (
    <main className={styles.page}>
      <a className={styles.back} href="#/">← 목록</a>
      <h1 className={styles.title}>{page.title}</h1>
      <Badges page={page} />
      <p className={styles.description}>{page.description}</p>
      {page.part === "design"
        ? <div className={styles.inline}>{SCREENS[page.screen]()}</div>
        : <Frame page={page} theme={theme} />}
      <nav className={styles.nav}>
        {previous === undefined
          ? <span />
          : (
            <Button variant="secondary" onClick={go(previous)}>
              ← {previous.title}
            </Button>
          )}
        {next === undefined
          ? <span />
          : (
            <Button variant="secondary" onClick={go(next)}>
              {next.title} →
            </Button>
          )}
      </nav>
    </main>
  );
}

// 고정 크기 iframe을 칸 폭에 맞게 줄인다. 줄여도 안의 화면은 1280x800 창이다.
function Frame({ page, theme }: { page: WireframePage; theme: Theme }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FRAME_WIDTH);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth || FRAME_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // 칸이 1280보다 넓으면 더 넓은 데스크톱으로 그리고, 좁으면 1280 그대로 줄여서 보인다.
  const frameWidth = Math.max(FRAME_WIDTH, width);
  const scale = width / frameWidth;
  // 주소에 query만 써서 같은 경로(하위 경로에 올려도 맞다)의 index.html이 frame 모양으로 뜬다.
  const source = `?frame=${encodeURIComponent(page.id)}${
    theme === "auto" ? "" : `&theme=${theme}`
  }`;
  return (
    <div
      ref={box}
      className={styles.frameBox}
      style={{ height: FRAME_HEIGHT * scale }}
    >
      <iframe
        key={source}
        className={styles.frame}
        title={page.title}
        src={source}
        style={{
          width: frameWidth,
          height: FRAME_HEIGHT,
          transform: `scale(${scale})`,
        }}
      />
    </div>
  );
}

/** `?frame=<id>`로 뜬 문서가 그리는 화면 하나. */
export function FramePage({ id }: { id: string }) {
  const page = pageById(id);
  return page === undefined
    ? <p>unknown page: {id}</p>
    : SCREENS[page.screen]();
}

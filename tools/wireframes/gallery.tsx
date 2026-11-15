import { Button } from "@lophn/ui/primitives";
import { useEffect, useRef, useState } from "react";
import styles from "./gallery.module.css";
import { GROUPS, type Located, locate, pageById } from "./pages/index.ts";
import type { Page } from "./pages/types.ts";

/** frame의 고정 데스크톱 크기. 좁은 창에서는 이 크기 그대로 줄여서 보인다. */
const FRAME_WIDTH = 1280;
const FRAME_HEIGHT = 800;

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
  const located = id === null ? undefined : locate(id);
  const page = located?.page;
  useEffect(() => {
    document.title =
      page === undefined
        ? "lophn wireframes"
        : `${page.title} · lophn wireframes`;
    scrollTo(0, 0);
  }, [page]);
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <a className={styles.brand} href="#/">
          lophn wireframes
        </a>
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
        <Toc current={located} />
        {located === undefined ? (
          <Index missing={id} />
        ) : (
          <PageView located={located} theme={theme} />
        )}
      </div>
    </div>
  );
}

// 왼쪽 목차. 묶음 > 영역 > page이고 지금 page가 있는 영역만 펼친다.
function Toc({ current }: { current: Located | undefined }) {
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
      {GROUPS.map((group) => (
        <section key={group.id} className={styles.tocGroup}>
          <h2 className={styles.tocGroupTitle}>{group.title}</h2>
          {group.areas.map((area) => (
            <details
              key={area.id}
              className={styles.tocArea}
              open={area === current?.area}
            >
              <summary className={styles.tocAreaName}>
                {area.title}
                <span className={styles.tocCount}>{area.pages.length}</span>
              </summary>
              <ol className={styles.tocList}>
                {area.pages.map((page) => (
                  <li key={page.id}>
                    <a
                      className={styles.tocLink}
                      href={`#/${page.id}`}
                      aria-current={page === current?.page ? "page" : undefined}
                    >
                      {page.title}
                    </a>
                  </li>
                ))}
              </ol>
            </details>
          ))}
        </section>
      ))}
    </nav>
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
      {GROUPS.map((group) => (
        <section key={group.id} className={styles.group}>
          <h2 className={styles.groupTitle}>{group.title}</h2>
          <p className={styles.text}>{group.summary}</p>
          <ol className={styles.cards}>
            {group.areas.map((area) => (
              <li key={area.id} className={styles.card}>
                <a className={styles.cardLink} href={`#/${area.pages[0].id}`}>
                  {area.title}
                </a>
                <p className={styles.cardCount}>page {area.pages.length}</p>
                <p className={styles.cardText}>{area.summary}</p>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </main>
  );
}

function PageView({ located, theme }: { located: Located; theme: Theme }) {
  const { group, page } = located;
  // 이전·다음은 같은 묶음 안 순서다.
  const pages = group.areas.flatMap((area) => area.pages);
  const at = pages.indexOf(page);
  const previous = pages[at - 1];
  const next = pages[at + 1];
  const go = (target: Page) => () => {
    location.hash = `#/${target.id}`;
  };
  return (
    <main className={styles.page}>
      <a className={styles.back} href="#/">
        ← 목록
      </a>
      <h1 className={styles.title}>{page.title}</h1>
      <p className={styles.description}>{page.description}</p>
      {group.inline ? (
        <div className={styles.inline}>{page.render()}</div>
      ) : (
        <Frame page={page} theme={theme} />
      )}
      <nav className={styles.nav}>
        {previous === undefined ? (
          <span />
        ) : (
          <Button variant="secondary" onClick={go(previous)}>
            ← {previous.title}
          </Button>
        )}
        {next === undefined ? (
          <span />
        ) : (
          <Button variant="secondary" onClick={go(next)}>
            {next.title} →
          </Button>
        )}
      </nav>
    </main>
  );
}

// 고정 크기 iframe을 칸 폭에 맞게 줄인다. 줄여도 안의 화면은 1280x800 창이다.
function Frame({ page, theme }: { page: Page; theme: Theme }) {
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
  const frameHeight = page.height ?? FRAME_HEIGHT;
  const scale = width / frameWidth;
  // 주소에 query만 써서 같은 경로(하위 경로에 올려도 맞다)의 index.html이 frame 모양으로 뜬다.
  const appearance = new URLSearchParams(location.search).get("appearance");
  const source = `?frame=${encodeURIComponent(page.id)}${
    theme === "auto" ? "" : `&theme=${theme}`
  }${
    appearance === null ? "" : `&appearance=${encodeURIComponent(appearance)}`
  }`;
  return (
    <div
      ref={box}
      className={styles.frameBox}
      style={{ height: frameHeight * scale }}
    >
      <iframe
        key={source}
        className={styles.frame}
        title={page.title}
        src={source}
        style={{
          width: frameWidth,
          height: frameHeight,
          transform: `scale(${scale})`,
        }}
      />
    </div>
  );
}

/** `?frame=<id>`로 뜬 문서가 그리는 화면 하나. */
export function FramePage({ id }: { id: string }) {
  return pageById(id)?.render() ?? <p>unknown page: {id}</p>;
}

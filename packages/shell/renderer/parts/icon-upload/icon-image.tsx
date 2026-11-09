// 앱 icon을 그리는 하나의 자리. src는 data URL(이미지)이거나 `lucide:<이름>`이다. lucide는 선이 현재 글자색을 따라
// theme에 맞는다. lucide 전체는 앱이 lucide icon을 선언했을 때 chunk 하나로 한 번만 읽는다(icon마다 chunk로 나누면
// 번들에 수천 개 파일이 생긴다). 읽는 동안은 같은 크기의 빈 칸이다.
import { tokens } from "@lophn/ui";
import { type ComponentType, useEffect, useState } from "react";
import { lucideComponentOf } from "./lucide-key.ts";

const LUCIDE_PREFIX = "lucide:";

type LucideModule = Record<string, unknown>;

let loaded: LucideModule | undefined;
let loading: Promise<LucideModule> | undefined;

function loadLucide(): Promise<LucideModule> {
  loading ??= import("lucide-react").then((module) => {
    loaded = module as unknown as LucideModule;
    return loaded;
  });
  return loading;
}

/** `lucide:<이름>`이면 이름. 이미지 src이면 null이다. */
export function lucideNameOf(src: string): string | null {
  return src.startsWith(LUCIDE_PREFIX) ? src.slice(LUCIDE_PREFIX.length) : null;
}

type Glyph = ComponentType<Record<string, unknown>>;

// undefined는 읽는 중, null은 이 shell에 없는 이름이다.
function useLucideGlyph(name: string | null): Glyph | null | undefined {
  const [, again] = useState(0);
  useEffect(() => {
    if (name === null || loaded !== undefined) return;
    let live = true;
    void loadLucide().then(() => {
      if (live) again((value) => value + 1);
    });
    return () => {
      live = false;
    };
  }, [name]);
  if (name === null || loaded === undefined) return undefined;
  return (lucideComponentOf(loaded, name) as Glyph | undefined) ?? null;
}

/**
 * 그릴 수 있는 src만 돌려준다. 이 shell의 lucide에 없는 이름이면 undefined라 부르는 쪽이 기본 모양을 쓴다.
 * 읽는 중에는 src 그대로다(IconImage가 빈 칸을 그린다). lucide를 선언한 앱이 없으면 lucide chunk는 읽지 않는다.
 */
export function useDrawableIcon(src: string | undefined): string | undefined {
  const name = src === undefined ? null : lucideNameOf(src);
  return useLucideGlyph(name) === null ? undefined : src;
}

export function IconImage({
  src,
  size,
  className,
}: {
  src: string;
  /** 이미지 칸의 크기(px 또는 CSS 길이). */
  size: number | string;
  className?: string;
}) {
  const lucide = lucideNameOf(src);
  const Glyph = useLucideGlyph(lucide);
  if (lucide === null) {
    return (
      <img className={className} src={src} alt="" width={size} height={size} />
    );
  }
  if (!Glyph) {
    // 읽는 중에도 칸 크기를 지켜 자리가 밀리지 않게 한다.
    return (
      <span
        className={className}
        style={{ display: "inline-block", width: size, height: size }}
        aria-hidden="true"
      />
    );
  }
  return (
    <Glyph
      size={size}
      strokeWidth={tokens.icon.stroke}
      className={className}
      aria-hidden="true"
      focusable="false"
    />
  );
}

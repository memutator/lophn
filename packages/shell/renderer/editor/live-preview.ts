// 편집기의 CodeMirror 쪽: live preview decoration, 찾기 강조, 형식 문제 여백, 편집 keymap.
// inline 표지·숨김·줄 class는 보이는 범위만 계산하는 view plugin이 만든다. 표와
// frontmatter는 줄을 통째로 block widget으로 바꾸므로 state field가 만든다(CodeMirror는
// block decoration을 state에서만 받는다).
import {
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { t } from "@lophn/i18n";

import {
  continueList,
  indentList,
  insertLink,
  outdentList,
  setHeading,
  toggleMark,
  toggleTask,
} from "./commands.ts";
import {
  type Align,
  type Block,
  previewBlocks,
  previewSpans,
  type Span,
} from "./preview.ts";
import { findField } from "./find/find.ts";
import { IMAGE_OFF, svgIcon } from "./svg-icon.ts";

interface LivePreviewOptions {
  /** 그림 src를 이 화면이 불러도 되는 URL로 바꾼다. null이면 실패 모양이다. */
  resolveImage?: (src: string) => string | null;
}

class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const bullet = document.createElement("span");
    bullet.className = "cm-lp-bullet";
    bullet.textContent = "•";
    bullet.setAttribute("aria-hidden", "true");
    return bullet;
  }
}

class TaskWidget extends WidgetType {
  readonly checked: boolean;
  readonly line: number;

  constructor(checked: boolean, line: number) {
    super();
    this.checked = checked;
    this.line = line;
  }
  override eq(other: TaskWidget): boolean {
    return other.checked === this.checked && other.line === this.line;
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-lp-task";
    box.checked = this.checked;
    box.setAttribute(
      "aria-label",
      this.checked
        ? t("document.button.uncheck-task")
        : t("document.button.check-task"),
    );
    box.addEventListener("mousedown", (event) => {
      // 커서를 줄 안으로 옮기지 않고 원문만 바꾼다.
      event.preventDefault();
      if (view.state.readOnly) return;
      const spec = toggleTask(view.state, this.line);
      if (spec) view.dispatch(spec);
    });
    return box;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

class RuleWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const rule = document.createElement("span");
    rule.className = "cm-lp-rule";
    rule.setAttribute("aria-hidden", "true");
    return rule;
  }
}

class LangWidget extends WidgetType {
  readonly name: string;

  constructor(name: string) {
    super();
    this.name = name;
  }
  override eq(other: LangWidget): boolean {
    return other.name === this.name;
  }
  toDOM(): HTMLElement {
    const lang = document.createElement("span");
    lang.className = "cm-lp-lang";
    lang.textContent = this.name;
    return lang;
  }
}

class ImageWidget extends WidgetType {
  readonly src: string | null;
  readonly alt: string;

  constructor(src: string | null, alt: string) {
    super();
    this.src = src;
    this.alt = alt;
  }
  override eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-lp-image";
    // 실패에는 아이콘과 alt를 보인다.
    const fallback = () => {
      wrap.textContent = "";
      wrap.classList.remove("cm-lp-image-loading");
      wrap.classList.add("cm-lp-image-failed");
      wrap.appendChild(svgIcon(IMAGE_OFF));
      const alt = document.createElement("span");
      alt.textContent = this.alt || t("document.label.image");
      wrap.appendChild(alt);
    };
    if (!this.src) {
      fallback();
      return wrap;
    }
    // 불러오는 동안 16:9 skeleton이다.
    wrap.classList.add("cm-lp-image-loading");
    const image = document.createElement("img");
    image.alt = this.alt;
    image.src = this.src;
    image.referrerPolicy = "no-referrer";
    image.addEventListener("load", () =>
      wrap.classList.remove("cm-lp-image-loading"),
    );
    image.addEventListener("error", fallback);
    wrap.appendChild(image);
    return wrap;
  }
}

class TableWidget extends WidgetType {
  readonly rows: string[][];
  readonly align: Align[];
  readonly from: number;

  constructor(rows: string[][], align: Align[], from: number) {
    super();
    this.rows = rows;
    this.align = align;
    this.from = from;
  }
  override eq(other: TableWidget): boolean {
    return (
      other.from === this.from &&
      JSON.stringify(other.rows) === JSON.stringify(this.rows) &&
      other.align.join() === this.align.join()
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-table";
    const table = document.createElement("table");
    this.rows.forEach((row, index) => {
      const tr = document.createElement("tr");
      row.forEach((cell, column) => {
        const td = document.createElement(index === 0 ? "th" : "td");
        td.textContent = cell;
        const align = this.align[column];
        if (align) td.className = `cm-lp-align-${align}`;
        tr.appendChild(td);
      });
      (index === 0
        ? table.createTHead()
        : (table.tBodies[0] ?? table.createTBody())
      ).appendChild(tr);
    });
    wrap.appendChild(table);
    // 그린 표를 누르면 커서가 들어가 원문이 보인다.
    wrap.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return wrap;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

class FrontmatterWidget extends WidgetType {
  readonly fields: [string, string][];
  readonly from: number;

  constructor(fields: [string, string][], from: number) {
    super();
    this.fields = fields;
    this.from = from;
  }
  override eq(other: FrontmatterWidget): boolean {
    return (
      other.from === this.from &&
      JSON.stringify(other.fields) === JSON.stringify(this.fields)
    );
  }
  toDOM(view: EditorView): HTMLElement {
    // key/value 두 열.
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-props";
    const head = document.createElement("div");
    head.className = "cm-lp-props-head";
    head.textContent = t("document.label.properties");
    wrap.appendChild(head);
    const grid = document.createElement("dl");
    for (const [key, value] of this.fields) {
      const term = document.createElement("dt");
      term.textContent = key;
      const detail = document.createElement("dd");
      detail.textContent = value;
      grid.append(term, detail);
    }
    wrap.appendChild(grid);
    wrap.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from + 4 } });
      view.focus();
    });
    return wrap;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

const hidden = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });

function spanDecorations(
  state: EditorState,
  spans: Span[],
  resolveImage: (src: string) => string | null,
): Range<Decoration>[] {
  const doc = state.doc;
  const sameLine = (a: number, b: number) =>
    doc.lineAt(a).number === doc.lineAt(b).number;
  const out: Range<Decoration>[] = [];
  for (const span of spans) {
    switch (span.kind) {
      case "hide":
        // view plugin은 줄바꿈을 넘어 바꾸지 못한다.
        if (span.to > span.from && sameLine(span.from, span.to)) {
          out.push(hidden.range(span.from, span.to));
        }
        break;
      case "mark":
        if (span.to <= span.from) break;
        out.push(
          Decoration.mark({
            class: span.cls,
            attributes: span.href ? { "data-href": span.href } : {},
          }).range(span.from, span.to),
        );
        break;
      case "line":
        out.push(Decoration.line({ class: span.cls }).range(span.from));
        break;
      case "bullet":
        out.push(bullet.range(span.from, span.to));
        break;
      case "task":
        if (sameLine(span.from, span.to)) {
          out.push(
            Decoration.replace({
              widget: new TaskWidget(span.checked, span.line),
            }).range(span.from, span.to),
          );
        }
        break;
      case "rule":
        if (sameLine(span.from, span.to)) {
          out.push(rule.range(span.from, span.to));
        }
        break;
      case "lang":
        out.push(
          Decoration.widget({
            widget: new LangWidget(span.name),
            side: 1,
          }).range(span.at),
        );
        break;
      case "image": {
        const widget = new ImageWidget(resolveImage(span.src), span.alt);
        if (span.replace && sameLine(span.from, span.to)) {
          out.push(Decoration.replace({ widget }).range(span.from, span.to));
        } else if (!span.replace) {
          out.push(Decoration.widget({ widget, side: 1 }).range(span.to));
        }
        break;
      }
    }
  }
  return out;
}

/** 이 화면이 직접 불러도 되는 그림 주소: https와 data 그림뿐이다. */
export function defaultResolveImage(src: string): string | null {
  return /^(https:|data:image\/)/i.test(src) ? src : null;
}

// 편집기에 focus가 있을 때만 커서 자리 원문이 보인다. 막 연 편집기나 찾기 줄로
// 옮긴 편집기는 읽기 화면처럼 보인다.
const setFocused = StateEffect.define<boolean>();
const focusField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setFocused)) return effect.value;
    }
    return value;
  },
});
const focusTracking: Extension = [
  focusField,
  EditorView.focusChangeEffect.of((_state, focusing) =>
    setFocused.of(focusing),
  ),
];

function inlinePreview(resolveImage: (src: string) => string | null) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          update.focusChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state) ||
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(setFocused)),
          )
        ) {
          this.decorations = this.build(update.view);
        }
      }
      build(view: EditorView): DecorationSet {
        const ranges: Range<Decoration>[] = [];
        for (const { from, to } of view.visibleRanges) {
          ranges.push(
            ...spanDecorations(
              view.state,
              previewSpans(view.state, from, to, view.state.field(focusField)),
              resolveImage,
            ),
          );
        }
        return Decoration.set(ranges, true);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

function blockDecorations(state: EditorState): DecorationSet {
  return Decoration.set(
    previewBlocks(state, state.field(focusField)).map((block: Block) =>
      Decoration.replace({
        widget:
          block.kind === "table"
            ? new TableWidget(block.rows, block.align, block.from)
            : new FrontmatterWidget(block.fields, block.from),
        block: true,
      }).range(block.from, block.to),
    ),
    true,
  );
}

const blockPreview = StateField.define<DecorationSet>({
  create: blockDecorations,
  update(value, transaction: Transaction) {
    if (
      transaction.docChanged ||
      transaction.selection ||
      transaction.effects.some((effect) => effect.is(setFocused)) ||
      syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
    )
      return blockDecorations(transaction.state);
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const editingKeymap = keymap.of([
  // Mod-b는 작업대의 sidebar 보이기·숨기기가 먼저 받는다(ipc/keybindings.ts).
  { key: "Mod-Shift-b", run: toggleMark("**") },
  { key: "Mod-i", run: toggleMark("*") },
  { key: "Mod-Shift-x", run: toggleMark("~~") },
  { key: "Mod-Shift-k", run: insertLink },
  ...[0, 1, 2, 3, 4, 5, 6].map((level) => ({
    key: `Mod-Alt-${level}`,
    run: setHeading(level),
  })),
  { key: "Enter", run: continueList },
  { key: "Tab", run: indentList, shift: outdentList },
]);

/** Markdown 편집기가 빈 CodeMirror state에 더하는 것 전부. 읽기 전용과 바꿈 listener는 호출자가 더한다. */
export function livePreview(options: LivePreviewOptions = {}): Extension {
  return [
    history(),
    markdown({ base: markdownLanguage }),
    EditorView.lineWrapping,
    focusTracking,
    inlinePreview(options.resolveImage ?? defaultResolveImage),
    blockPreview,
    findField,
    editingKeymap,
    keymap.of([...defaultKeymap, ...historyKeymap]),
  ];
}

/**
 * from을 to로 바꾸는 가장 작은 바꿈. 같은 앞뒤는 남겨 커서와 scroll이 그 자리에 있다.
 */
export function minimalChange(
  from: string,
  to: string,
): { from: number; to: number; insert: string } | null {
  if (from === to) return null;
  let start = 0;
  const max = Math.min(from.length, to.length);
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) {
    start += 1;
  }
  let tail = 0;
  while (
    tail < max - start &&
    from.charCodeAt(from.length - 1 - tail) ===
      to.charCodeAt(to.length - 1 - tail)
  )
    tail += 1;
  return {
    from: start,
    to: from.length - tail,
    insert: to.slice(start, to.length - tail),
  };
}

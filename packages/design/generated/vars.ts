// generate.ts가 만든다, 손으로 고치지 않는다
export { tokenNames } from "./token-names.ts";
export type { TokenName } from "./token-names.ts";
export const vars = {
  "color": {
    "surface": {
      "floor": "var(--color-surface-floor)",
      "base": "var(--color-surface-base)",
      "subtle": "var(--color-surface-subtle)",
      "muted": "var(--color-surface-muted)",
    },
    "border": {
      "subtle": "var(--color-border-subtle)",
      "base": "var(--color-border-base)",
      "strong": "var(--color-border-strong)",
    },
    "text": {
      "primary": "var(--color-text-primary)",
      "secondary": "var(--color-text-secondary)",
      "muted": "var(--color-text-muted)",
      "disabled": "var(--color-text-disabled)",
    },
    "ink": {
      "background": "var(--color-ink-background)",
      "text": "var(--color-ink-text)",
      "hover": "var(--color-ink-hover)",
    },
    "link": "var(--color-link)",
    "focus": "var(--color-focus)",
    "selection": "var(--color-selection)",
  },
  "status": {
    "good": {
      "marker": "var(--status-good-marker)",
      "text": "var(--status-good-text)",
      "icon": "var(--status-good-icon)",
    },
    "warning": {
      "marker": "var(--status-warning-marker)",
      "text": "var(--status-warning-text)",
      "icon": "var(--status-warning-icon)",
    },
    "serious": {
      "marker": "var(--status-serious-marker)",
      "text": "var(--status-serious-text)",
      "icon": "var(--status-serious-icon)",
    },
    "critical": {
      "marker": "var(--status-critical-marker)",
      "text": "var(--status-critical-text)",
      "icon": "var(--status-critical-icon)",
    },
    "neutral": {
      "marker": "var(--status-neutral-marker)",
      "text": "var(--status-neutral-text)",
      "icon": "var(--status-neutral-icon)",
    },
  },
  "chart": {
    "series": {
      "0": "var(--chart-series-0)",
      "1": "var(--chart-series-1)",
      "2": "var(--chart-series-2)",
      "3": "var(--chart-series-3)",
      "4": "var(--chart-series-4)",
      "5": "var(--chart-series-5)",
      "6": "var(--chart-series-6)",
      "7": "var(--chart-series-7)",
    },
    "other": "var(--chart-other)",
    "line": "var(--chart-line)",
    "gap": "var(--chart-gap)",
    "ring": "var(--chart-ring)",
    "bar": {
      "max": "var(--chart-bar-max)",
      "radius": "var(--chart-bar-radius)",
    },
    "point": "var(--chart-point)",
    "height": "var(--chart-height)",
  },
  "diff": {
    "addLine": "var(--diff-add-line)",
    "addWord": "var(--diff-add-word)",
    "deleteLine": "var(--diff-delete-line)",
    "deleteWord": "var(--diff-delete-word)",
  },
  "font": {
    "sans": "var(--font-sans)",
    "mono": "var(--font-mono)",
    "weight": {
      "regular": "var(--font-weight-regular)",
      "medium": "var(--font-weight-medium)",
      "semibold": "var(--font-weight-semibold)",
    },
    "numeric": "var(--font-numeric)",
  },
  "type": {
    "caption": {
      "size": "var(--type-caption-size)",
      "line": "var(--type-caption-line)",
    },
    "small": {
      "size": "var(--type-small-size)",
      "line": "var(--type-small-line)",
    },
    "body": {
      "size": "var(--type-body-size)",
      "line": "var(--type-body-line)",
    },
    "reading": {
      "size": "var(--type-reading-size)",
      "line": "var(--type-reading-line)",
    },
    "titleSmall": {
      "size": "var(--type-title-small-size)",
      "line": "var(--type-title-small-line)",
    },
    "title": {
      "size": "var(--type-title-size)",
      "line": "var(--type-title-line)",
    },
    "display": {
      "size": "var(--type-display-size)",
      "line": "var(--type-display-line)",
    },
    "tracking": {
      "normal": "var(--type-tracking-normal)",
      "title": "var(--type-tracking-title)",
    },
  },
  "space": {
    "0": "var(--space-0)",
    "1": "var(--space-1)",
    "2": "var(--space-2)",
    "3": "var(--space-3)",
    "4": "var(--space-4)",
    "5": "var(--space-5)",
    "6": "var(--space-6)",
    "7": "var(--space-7)",
    "8": "var(--space-8)",
    "9": "var(--space-9)",
    "10": "var(--space-10)",
    "11": "var(--space-11)",
    "12": "var(--space-12)",
  },
  "radius": {
    "xs": "var(--radius-xs)",
    "sm": "var(--radius-sm)",
    "md": "var(--radius-md)",
    "lg": "var(--radius-lg)",
    "full": "var(--radius-full)",
  },
  "border": {
    "width": "var(--border-width)",
    "focus": {
      "width": "var(--border-focus-width)",
      "offset": "var(--border-focus-offset)",
    },
  },
  "shadow": {
    "popover": "var(--shadow-popover)",
    "dialog": "var(--shadow-dialog)",
  },
  "motion": {
    "duration": {
      "short": "var(--motion-duration-short)",
      "medium": "var(--motion-duration-medium)",
      "long": "var(--motion-duration-long)",
    },
    "ease": "var(--motion-ease)",
    "fade": "var(--motion-fade)",
    "distance": "var(--motion-distance)",
    "pulse": "var(--motion-pulse)",
  },
  "z": {
    "base": "var(--z-base)",
    "sticky": "var(--z-sticky)",
    "shell": "var(--z-shell)",
    "sheet": "var(--z-sheet)",
    "backdrop": "var(--z-backdrop)",
    "dialog": "var(--z-dialog)",
    "palette": "var(--z-palette)",
    "popover": "var(--z-popover)",
    "toast": "var(--z-toast)",
    "tooltip": "var(--z-tooltip)",
  },
  "breakpoint": {
    "sm": "var(--breakpoint-sm)",
    "md": "var(--breakpoint-md)",
    "lg": "var(--breakpoint-lg)",
  },
  "layout": {
    "panePadding": {
      "narrow": "var(--layout-pane-padding-narrow)",
      "wide": "var(--layout-pane-padding-wide)",
    },
    "sidebar": {
      "min": "var(--layout-sidebar-min)",
      "max": "var(--layout-sidebar-max)",
      "collapsed": "var(--layout-sidebar-collapsed)",
    },
    "container": {
      "panel": "var(--layout-container-panel)",
      "card": "var(--layout-container-card)",
    },
  },
  "control": {
    "sm": {
      "height": "var(--control-sm-height)",
      "padX": "var(--control-sm-pad-x)",
      "icon": "var(--control-sm-icon)",
    },
    "md": {
      "height": "var(--control-md-height)",
      "padX": "var(--control-md-pad-x)",
      "icon": "var(--control-md-icon)",
    },
    "lg": {
      "height": "var(--control-lg-height)",
      "padX": "var(--control-lg-pad-x)",
      "icon": "var(--control-lg-icon)",
    },
    "gap": "var(--control-gap)",
  },
  "icon": {
    "size": {
      "small": "var(--icon-size-small)",
      "base": "var(--icon-size-base)",
      "large": "var(--icon-size-large)",
    },
    "stroke": "var(--icon-stroke)",
  },
  "field": {
    "gap": "var(--field-gap)",
  },
  "tab": {
    "indicator": "var(--tab-indicator)",
    "contentGap": "var(--tab-content-gap)",
  },
  "loading": {
    "delay": "var(--loading-delay)",
  },
  "page": {
    "reading": {
      "narrow": "var(--page-reading-narrow)",
      "default": "var(--page-reading-default)",
      "wide": "var(--page-reading-wide)",
    },
    "toc": "var(--page-toc)",
    "dashboard": {
      "max": "var(--page-dashboard-max)",
      "columns": "var(--page-dashboard-columns)",
    },
    "list": "var(--page-list)",
    "form": "var(--page-form)",
    "launcher": "var(--page-launcher)",
    "overview": "var(--page-overview)",
  },
  "editor": {
    "quoteBar": "var(--editor-quote-bar)",
    "check": "var(--editor-check)",
    "find": "var(--editor-find)",
    "gutter": "var(--editor-gutter)",
    "problemList": "var(--editor-problem-list)",
    "stickyHead": "var(--editor-sticky-head)",
    "linkPicker": "var(--editor-link-picker)",
    "notice": "var(--editor-notice)",
  },
  "table": {
    "row": {
      "compact": "var(--table-row-compact)",
      "comfortable": "var(--table-row-comfortable)",
    },
  },
  "tree": {
    "row": "var(--tree-row)",
    "indent": "var(--tree-indent)",
    "marker": "var(--tree-marker)",
    "indentCap": "var(--tree-indent-cap)",
  },
  "stat": {
    "perRow": "var(--stat-per-row)",
  },
  "palette": {
    "item": "var(--palette-item)",
    "width": "var(--palette-width)",
    "top": "var(--palette-top)",
  },
  "tooltip": {
    "delay": "var(--tooltip-delay)",
  },
  "menu": {
    "row": "var(--menu-row)",
  },
  "dialog": {
    "width": {
      "default": "var(--dialog-width-default)",
      "wide": "var(--dialog-width-wide)",
    },
  },
  "toast": {
    "width": "var(--toast-width)",
    "duration": {
      "default": "var(--toast-duration-default)",
      "brief": "var(--toast-duration-brief)",
    },
  },
  "chip": {
    "width": "var(--chip-width)",
  },
  "badge": {
    "size": "var(--badge-size)",
    "font": "var(--badge-font)",
  },
  "tabStrip": {
    "min": "var(--tab-strip-min)",
    "max": "var(--tab-strip-max)",
    "bar": "var(--tab-strip-bar)",
    "hover": "var(--tab-strip-hover)",
  },
  "terminal": {
    "black": "var(--terminal-black)",
    "red": "var(--terminal-red)",
    "green": "var(--terminal-green)",
    "yellow": "var(--terminal-yellow)",
    "blue": "var(--terminal-blue)",
    "magenta": "var(--terminal-magenta)",
    "cyan": "var(--terminal-cyan)",
    "white": "var(--terminal-white)",
    "brightBlack": "var(--terminal-bright-black)",
    "brightRed": "var(--terminal-bright-red)",
    "brightGreen": "var(--terminal-bright-green)",
    "brightYellow": "var(--terminal-bright-yellow)",
    "brightBlue": "var(--terminal-bright-blue)",
    "brightMagenta": "var(--terminal-bright-magenta)",
    "brightCyan": "var(--terminal-bright-cyan)",
    "brightWhite": "var(--terminal-bright-white)",
  },
  "window": {
    "topBar": "var(--window-top-bar)",
    "control": "var(--window-control)",
    "closeHover": "var(--window-close-hover)",
    "closeText": "var(--window-close-text)",
  },
  "fileIcon": {
    "text": "var(--file-icon-text)",
    "blue": "var(--file-icon-blue)",
    "yellow": "var(--file-icon-yellow)",
    "green": "var(--file-icon-green)",
    "overlay1": "var(--file-icon-overlay1)",
    "peach": "var(--file-icon-peach)",
    "red": "var(--file-icon-red)",
    "mauve": "var(--file-icon-mauve)",
    "sky": "var(--file-icon-sky)",
    "sapphire": "var(--file-icon-sapphire)",
    "pink": "var(--file-icon-pink)",
    "teal": "var(--file-icon-teal)",
    "maroon": "var(--file-icon-maroon)",
    "lavender": "var(--file-icon-lavender)",
    "rosewater": "var(--file-icon-rosewater)",
    "flamingo": "var(--file-icon-flamingo)",
  },
  "floating": {
    "surface": "var(--floating-surface)",
    "hover": "var(--floating-hover)",
    "backdrop": "var(--floating-backdrop)",
  },
} as const;
export type TokenVars = typeof vars;

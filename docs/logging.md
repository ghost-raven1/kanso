# CLI diagnostics

Kanso uses the same terminal layout for migration, doctor, SEO and microfrontend checks. Each diagnostic preserves its original code and shows its severity, message and available source location. Fixes, documentation links, remote names and SEO fields appear on separate lines.

```text
Kanso migrate
  12 modules checked, 3 proposed file changes.

  ERROR  [KANSO_PURITY] Cannot infer whether this derived call is pure.
    at src/Profile.tsx:12:3-12:35
    Fix: Put an explicitly pure calculation inside useMemo.

ERROR  1 error, 0 warnings.
INFO  Coverage: complete selected source graph.
  Entries: src/main.tsx.
ERROR  Blocked. No files changed.
```

Locations only include coordinates supplied by the diagnostic. Project-level errors do not invent a line or column. Multiline fixes preserve their line breaks. Diagnostics retain their original order; the summary counts errors and warnings separately.

Interactive terminals use color for severity and a bold command heading. Redirected output, `TERM=dumb` and any set `NO_COLOR` value produce plain text. Color is supplementary: every severity is also written as a word. For example:

```sh
NO_COLOR=1 kanso doctor --root ./my-app
kanso migrate --check > migration.log
```

Use `--json` for automation. Report objects, diagnostic codes and JSON formatting remain unchanged; terminal headings, ANSI colors and summaries are omitted. This applies to `migrate`, `doctor`, `seo check` and `microfrontends sync|check`.

Checks exit with `0` when there are no errors, including reports containing only warnings; `2` means the report contains errors, and `1` means the command could not execute. Execution failures still go to stderr, including when `--json` is supplied. Human-readable text is intended for people; scripts should use the JSON report and exit code.

This formatting is confined to CLI commands. It adds no browser, SSR or production application logging and installs no logging or color dependencies.

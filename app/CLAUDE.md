# app/ - working conventions (Electron + Angular)

Scope: **everything under `app/`**. Imported on 09/08/2026 from the Jingle Machine project
(`D:\Projects\JingleMachine\CLAUDE.md` + `THEMING.md`), because those conventions are the operator's own
and were paid for on a working Angular + ng-zorro + Electron app. The root [CLAUDE.md](../CLAUDE.md) still
governs the repository as a whole; where the two disagree the root wins, **except** for the one exception
stated below (UI language), which the operator decided on 09/08/2026.

Not imported on purpose, and the reason is in the open:
- **`committa` does NOT mean commit + push here.** In Jingle Machine it does; this repository is
  **public** and `master` is its own deploy surface, so the root rule stands: commit only when asked,
  push only when asked.
- **Version bumping** now applies, and the operator tightened it on 09/08/2026: **every publish gets a
  new number**. `npm run deploy:pages` bumps the patch itself (`scripts/version.mjs --bump`), so it
  cannot be forgotten; `minor` marks a completed phase and `major` is only on request. The version lives
  in `package.json` and nowhere else - `src/app/version.ts` is GENERATED from it (prebuild/prestart) so
  the header can show it without pulling the manifest into the bundle. After a deploy, commit the bumped
  `package.json` and `version.ts`: the deploy prints the reminder.

## Where things are

The Angular workspace IS `app/` - there is no `client/` sub-folder (the operator asked for the flat
layout on 09/08/2026, so `app/package.json`, `app/angular.json` and `app/src/` sit at this level).

- `src/app/views/` - one folder per page. `players/` is the consultation table, `hello/` the smoke page.
- `src/app/core/` - `bundle.ts` (reads the export bundle) and `players-store.ts` (the signal store).
- `src/styles/` - `styles.css` is the ONLY entry; `themes/`, `tokens.css`, `ng-zorro.css` are imported by it.
- `scripts/pull-bundle.mjs` + `npm run data:pull` - copies the newest `data/export/<season>/` into
  `public/data/`, which is **gitignored** on `master`: it carries the same paid fantacalcio.it content
  the cache does.
- `scripts/deploy-pages.mjs` + `npm run deploy:pages` - publishes the site to the `gh-pages` branch FROM
  THIS MACHINE, real bundle included (the operator's decision of 09/08/2026, recorded in the root
  `CLAUDE.md`). Never add a CI publisher beside it: a runner has no bundle, so it would republish the
  site without data and wipe the deploy.

**The app reads the BUNDLE, never the database and never the web.** `python -m euroleghe_ingest export`
writes it; `manifest.json` is normative (refuse a `schema_version` you do not know); a view that needs a
table the bundle does not carry gets it added to `export.CONTRACT` in the toolkit, not read around.

## The operator's working preferences

- Wants **free solutions with no credit card**; a paid plan is refused when it can be avoided.
- Wants **simplicity and readability**, the framework's own best practice, **no over-engineering**.
- Trusts a fact **verified online** over one recalled from memory - especially anything that changes with
  time (framework versions, APIs, free tiers).
- **Plans before coding**: alternatives, costs and risks laid out first, without rushing to write code.
- **Beginner on the backend** - explain the concept in elementary terms, with the *why* of the choice.
- **Concise replies**: the point first, no walls of text.
- Values **visual verification** (headless screenshots) whenever UI or styles are touched - and the
  screenshot alone is not the verification, see «Verifying» below.

## Language (the one exception to the root convention)

- **UI strings visible to the user: ITALIAN.** This is the operator's decision of 09/08/2026 and it
  overrides the root rule *for `app/` only*: the assistant is used at an Italian auction table, by him.
- **Code, comments, logs, identifiers: ENGLISH**, exactly as everywhere else in this repository.
- **Markdown docs: ENGLISH** (the root convention; `docs/model/` stays Italian as the knowledge base).
  This is where `app/` differs from Jingle Machine, whose docs are Italian.
- The Tkinter operator panel in `toolkit/` is **not** covered by this exception: its strings stay English.

## Stack

- **Angular standalone** (no NgModule), **signals** for state, **`inject()`** for DI - never constructor
  parameters.
- **ng-zorro-antd** for the UI components. In the template use an ng-zorro component **whenever one
  exists** (`nz-button`, `nz-input`, `nz-select`, `nz-table`, ...), not raw HTML dressed with Tailwind: a
  `<button>` with utility classes looks the same and loses focus, disabled, loading and accessibility.
  New icons are registered in `app.config.ts`; use `<nz-icon nzType="..." />`, **never an emoji as an
  icon**.
- **Tailwind v4** for layout, spacing and typography.
- **Electron** for the desktop shell - not scaffolded yet (09/08/2026). When it is, the Jingle Machine
  shape is the reference: the main process serves the built files and a `BrowserWindow` loads them over
  HTTP, so the renderer keeps fetching same-origin instead of being rewritten around IPC.
- **Always use the framework's most recent recommended patterns**; when in doubt read the official docs
  online rather than answering from memory.

## Code conventions

- **Signals-first.** Shared state lives in a **signal store inside the service** (one source of truth,
  optimistic updates); components read it through `computed`. No repeated `load()` calls. Timers and the
  clock stay imperative by nature.
- Template control flow: **`@if` / `@for` / `@switch`**, not `*ngIf` / `*ngFor` / `*ngSwitch`.
- **A `computed` never WRITES a signal**, and this is not style: Angular throws
  (`throwInvalidWriteToSignalError`), so the computed raises on every read and whatever the template was
  binding is simply not drawn. It cost the whole Fπ histogram on 20/08/2026 - a `computed` that counted
  the bars and set a `piMissing` signal on the way out, invisible to `ng build` and to every unit test,
  because nothing outside a browser ever read it. When one pass has to produce two numbers, return BOTH
  from one `computed` and expose each with its own derivation - and if the counting is domain logic, it
  belongs in `core/` where a test can reach it.
- **`takeUntilDestroyed()`** from `@angular/core/rxjs-interop` for Observable teardown.
- **Clean names**: camelCase, no `_`, `$` or `@` as prefix or suffix. Observables get an explicit name
  (`userStream`, `userQueue`), **never a `$` suffix**.
- **New components: the template is ALWAYS a separate `.html` file** (`templateUrl`), never inline.
- Comments only where they earn their place.

## Component organisation

- **`views/`** - components that own a whole **page/view**. Sub-components specific to one view and not
  reusable elsewhere stay **co-located inside that view's folder**.
- **`ui/`** - global, **reusable** components with selector **`ui-{component}`** (`ui-color-picker`). For
  button-like elements use the idiomatic attribute selector (`button[ui-button]`), which preserves the
  native behaviour (click, disabled, routerLink) the way ng-zorro does with `[nz-button]`.
- **`core/`** - services, guards, providers. No UI.

Before creating a component, answer: is it a page? -> `views/`. Reusable outside the view? -> `ui/`.
Specific to a view but not a page? -> co-located in that view.

## Styles

The full rationale is Jingle Machine's `THEMING.md`; these are the rules that must hold here.

- **Tokens are Tailwind's own native slots** (`--color-*`, `--radius-*`, `--font-*`), declared in the
  **`@theme static`** block of the default theme. `static` is **mandatory**: without it Tailwind drops the
  variables used only by `ng-zorro.scss` and backgrounds turn transparent (a real bug, not a precaution).
  No parallel scale, no `--app-` prefix, no `@theme inline`.
- **One theme = one file**; the default is `@theme static`, extra themes override
  `:root[data-theme="x"]` (specificity 0,2,0, so it beats `:root` deterministically). Theme files are
  `@import`ed **inside** the single `styles.css` entry - not added as separate entries in `angular.json` -
  and `styles.css` must stay a `.css` file.
- **No literal values** (`#45fff3`, `rounded-[20px]`): a token utility or `var(--color-*)`.
- **No custom styling classes** (`.fa-*`, `.jm-*`): style native tags (`input`, `button`, `textarea`),
  their states and attributes (`:hover`, `:checked`, `type="password"`), and the ng-zorro classes
  (`.ant-*`) - all driven by tokens.
- **Cascade layers, and no `!important`.** Declare the order explicitly at the top of `styles.css`:
  `@layer theme, base, ngzorro, components, utilities;` (Tailwind v4 honours it). ng-zorro's precompiled
  CSS goes in `@layer ngzorro`, which **must sit above `base`** or Tailwind's Preflight strips its
  padding, margins and borders and the component layout falls apart. Our `.ant-*` overrides go in
  `@layer components`, so they win without `!important`.
- **No per-component `.scss`.** Layout and utilities inline with Tailwind; ng-zorro overrides in a
  **single global file**, using `var(--color-*)` + `color-mix()`.
- **Z-index is an explicit scale** in `--z-*` aligned to ng-zorro/antd (modal 1000, dropdown 1050,
  tooltip 1070...). Never an arbitrary number: `z-[var(--z-modal)]`.
- **Motion is CSS only.** The `@angular/animations` DSL (`trigger`/`transition`/`animate`) is deprecated
  from Angular 20 - use CSS transitions and keyframes. (Jingle Machine keeps `provideAnimations()`
  "because ng-zorro requires it"; verified here 09/08/2026 and it does NOT: ng-zorro 22.0.1 has no
  `@angular/animations` dependency at all, so the package is not installed and nothing provides it.)
  Micro-interactions (`transition`, `active:scale`), screen transitions via a
  `@keyframes route-enter` on the view host, and always honour `prefers-reduced-motion`.
- **Responsive is mobile-first** with Tailwind's native breakpoints (`sm:`/`md:`/`lg:`), no custom media
  queries where avoidable. View hosts `display:block`, `--control-height` for controls, ng-zorro `nzSize`
  where it helps.
- **Colour carries meaning**: red is for danger, errors, destructive actions and negative amounts. Data,
  deviations and informational labels go neutral - a screen that paints every number red reads as an
  alarm. Amber for non-serious warnings.
- Remember the browser's **autofill** (`:-webkit-autofill`): repaint it with
  `-webkit-box-shadow: 0 0 0 1000px <bg> inset` or a dark theme breaks on the login form.

## Verifying

- **Measure, do not eyeball.** A screenshot shows a rendering; it does not show a WCAG contrast, a 0px
  `<hr>`, or a `color-mix()` pointing at a deleted token (paint gone, build green). Audit the **computed
  values** in the browser (`getComputedStyle`, composing translucent ancestors).
- **Every audit must report how many elements it examined.** A broken audit returns "0 failures" and is
  indistinguishable from a clean page - it has already happened twice.
- What a rectangle cannot measure is verified **functionally**: an enlarged touch target is tested with a
  click 8px above the border, not by reading `getBoundingClientRect()`.
- Before delivering a change: **the production build must pass** (`ng build`) AND **`ng test`**, and for
  anything visible, the page opened in a real browser.
- **A green `ng build` says nothing about the tests, and on 20/08/2026 it hid a suite that would not even
  compile.** `ng build` uses `tsconfig.app.json`, which does not include `*.spec.ts`: a spec with a type
  error type-checks nowhere, and the Angular test builder refuses to BUILD the whole suite over it - so
  one bad line in one spec takes out all 27 files at once and prints no test count. It shipped
  (`projection.spec.ts`, `at(103)` is `number | null`) in a commit whose own message says «build di
  produzione verde», and the consolidation that followed claimed «app 314 test» - a number that cannot
  have come from a run. Two habits: `ng test` is a SEPARATE gate from `ng build`, and a test count is
  quoted from the run that printed it, never from the last time it was true.
- **A dependency that works in dev is NOT proven.** `ng serve` pre-bundles dependencies and synthesises
  the named exports of UMD/CJS libraries; `ng build` does not. A library can work in dev and break only
  in the package, at runtime, under a minified name (`i is not a function`), with TypeScript none the
  wiser. For UMD/CJS dependencies, check the built bundle.
- **Platform-specific bugs are proven by the CI, not guessed at.** Add an inspection step that prints the
  artifact's real state, iterate with a manual workflow run, and tag only once the outcome is verified.

## Errors and diagnostics

- **One message per cause.** A `catch` that answers "microphone unavailable or permission denied" to
  *any* failure cost half a day of investigation on macOS permissions while the real cause was a library
  that would not load. Distinguish by the error's name (`NotAllowedError` != `NotReadableError` != a bug).
- For **unexpected** errors carry `err.message` (truncated) into the message: in a `TypeError` that is
  where the whole information lives.
- **No silent failures.** An `error` state with no UI is indistinguishable from "idle" - that is how a
  broken engine passed for a working one.
- The desktop app has **no DevTools** (`Menu.setApplicationMenu(null)`), so errors have to be visible in
  the UI or there is nothing to debug with.

## Writing things down

- Mark the status of every conclusion: **verified** (with *how* it was verified, and the date) or
  **hypothesis, not yet confirmed**. Never write a presumed cause as if it were demonstrated - that
  mistake cost two build cycles on Jingle Machine.
- When a hypothesis is disproved, **correct the old entry** (strike it out with a pointer to the new one)
  rather than only adding a new one: whoever reads finds the old one first.
- Record the **discarded options and why**: they are worth as much as the solution, and they stop the
  same idea from being proposed again.

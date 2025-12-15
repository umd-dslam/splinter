## Splinter

Splinter is a VS Code extension that finds and categorizes ORM operations in a codebase, following the taxonomy in the paper [Are Database System Researchers Making Correct Assumptions about Transaction Workloads?](https://dl.acm.org/doi/10.1145/3725268). The list of repositories analyzed and the corresponding git commit hash is included in the paper.

- **Supported ORMs**:
  - **TypeORM**: analyzer powered by `@ctring/splinter-eslint` (https://github.com/umd-dslam/splinter-eslint)
  - **Django ORM**: analyzer powered by `splinter-mypy` (https://github.com/umd-dslam/splinter-mypy)
- **Views**: The “Splinter” activity bar contains three views: `Info`, `Recognized`, and `Unknown`.
- **Storage**: Results are saved to `.vscode/<analyzer>-results.json` in your workspace and automatically reloaded on open.

### Installation

1) Install dependencies

```bash
npm install
```

2) Package the extension (produces a `.vsix`)

```bash
npm install @vscode/vsce
npx vsce package
```

3) Install the generated `.vsix` in VS Code (right‑click → “Install Extension VSIX”).

### Requirements

- For TypeScript/TypeORM projects: Node.js with `npx` (the extension runs `@ctring/splinter-eslint`).
- For Python/Django projects: install the Python backend first by following `https://github.com/umd-dslam/splinter-mypy`.

### Usage

1) Open a project containing `.ts` or `.py` files. The extension activates automatically.
2) Language selection defaults to `auto` (counts `.ts` vs `.py` files). Override via setting `splinter.language`.
3) A progress notification appears during analysis. When done, results show in `Info`, `Recognized`, and `Unknown` views.
4) Results are saved to `.vscode/typeorm-results.json` or `.vscode/django-results.json` and are reloaded next time you open the workspace. The `Info` view includes repository URL and commit hash when available (via the built‑in `vscode.git` extension).

### Commands

You can access these from the Command Palette or via view context menus:

- View display
  - `Splinter: Show as flat List`
  - `Splinter: Show as tree`
- Analyze lifecycle
  - `Splinter: Reanalyze` (deletes the saved results file and runs analysis again)
  - `Splinter: Reload from Saved File`
- Curate data
  - `New Entity` (`splinter.entity.add`)
  - `Add Operation` (`splinter.operation.add`)
  - `Add Argument` (`splinter.argument.add`)
  - `Remove` (`splinter.item.remove`) for custom items
  - Move between groups: `Move to Unknown`, `Move to Recognized`
- Annotation and copy
  - `Edit Note`, `Add Tag`, `Clear Note`
  - `Auto annotate` / `Clear auto annotate`
  - `Recognize unknown aggressively` (step through suggestions to move operations)
  - `Copy` (items), `Copy` (info lines)
- Filtering
  - `Filter` / `Clear Filter` in both `Recognized` and `Unknown` views

### Settings

All settings are under `splinter.*` in VS Code settings:

- `splinter.rootDir` (string, default `.`): Root directory to analyze relative to the workspace.
- `splinter.batchSize` (number, default `50`): Batch size for analyzer backend.
- `splinter.language` (string, default `auto`): One of `auto`, `typescript`, `python`.
- `splinter.exclude` (string[]): Glob patterns to exclude (defaults include `node_modules`, build outputs, tests, migrations, VCS folders).

### How it works

- On first run (or after `Reanalyze`), the backend analyzer is invoked:
  - TypeORM: runs `npx @ctring/splinter-eslint` with the configured `rootDir` and `batchSize`.
  - Django: runs the Python analyzer provided by `splinter-mypy`.
- Results are categorized into `Recognized` and `Unknown` entities/operations/arguments.
- You can curate the results (add/move/edit) and save back to the results file.

### Extending to new ORMs

To add a new analyzer:

1) Implement the `Analyzer` interface in `src/analyzer`.
2) Register it in `src/extension.ts` under “Set up the analyzer and views”.
3) Provide auto‑annotation tags if applicable and implement the required commands.
4) The UI will automatically use the shared providers and persist results to `.vscode/<name>-results.json`.

### Development

- Build: `npm run compile`
- Watch: `npm run watch`
- Lint: `npm run lint`
- Test: `npm test`

### Troubleshooting

- If no results appear, check the Output panel “Splinter” for backend logs.
- Ensure required backends are installed (see Requirements above).
- Use `Splinter: Reanalyze` to discard a stale results file.

import * as vscode from "vscode";
import * as path from "path";
import { ORMItem, ORMItemProvider } from "./provider/orm-items";
import { TypeORMAnalyzer } from "./analyzer/typeorm";
import { AnalyzeResult, AnalyzeResultGroup } from "./model";
import { StatisticsProvider } from "./provider/statistics";
import { Analyzer } from "./analyzer/base";
import { GitExtension } from "./@types/git";

function setRepositoryInfo(rootPath: string) {
  const gitExtension = vscode.extensions.getExtension("vscode.git") as
    | vscode.Extension<GitExtension>
    | undefined;

  if (!gitExtension) {
    return undefined;
  }
  const api = gitExtension.exports.getAPI(1);

  api.openRepository(vscode.Uri.file(rootPath)).then(async (repo) => {
    if (repo) {
      const head = repo.state.HEAD;
      if (head) {
        const hash = head.commit ?? "";
        const url = repo.state.remotes[0].fetchUrl ?? "";
        const result = AnalyzeResult.getInstance();
        result.setRepository({ url, hash });
        await result.saveToStorage(rootPath);
      }
    }
  });
}

function runAnalyzer(analyzer: Analyzer, rootPath: string) {
  const config = vscode.workspace.getConfiguration("clue");

  let analyzeResult = AnalyzeResult.getInstance();

  analyzeResult.refreshViews();

  const batchSize = config.get("analyzeBatchSize") as number;

  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
      title: `Analyzing TypeORM in batches of ${batchSize} files`,
    },
    async (progress, cancellation) => {
      if (!(await analyzeResult.loadFromStorage(rootPath))) {
        // If the result is not found, start a new analysis
        const files = await vscode.workspace.findFiles(
          config.get("includeFiles")!.toString(),
          config.get("excludeFiles")!.toString()
        );

        files.sort();

        for (let i = 0; i < files.length; i += batchSize) {
          if (cancellation.isCancellationRequested) {
            break;
          }

          // Update the progress message
          const pathSample = files
            .slice(i, i + batchSize)
            .map((f) => path.relative(rootPath, f.path))
            .join(", ");
          progress.report({
            increment: (batchSize / files.length) * 100,
            message: `[${i + 1}/${files.length}] ${pathSample}`,
          });

          // Do the analysis
          await analyzer.analyze(files.slice(i, i + batchSize), analyzeResult);

          analyzeResult.refreshViews();
        }

        // Finalize any unresolved entities
        await analyzer.finalize(analyzeResult);

        // Save the result to file for future use
        await analyzeResult.saveToStorage(rootPath);
      }

      analyzeResult.refreshViews();
    }
  );
}

export function activate(context: vscode.ExtensionContext) {
  if (!context.storageUri) {
    return;
  }

  const rootPath =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : "";

  /**********************************************************/
  /*             Set up the analyzer and views              */
  /**********************************************************/

  const analyzer = new TypeORMAnalyzer(
    rootPath,
    vscode.workspace.getConfiguration("clue").get("tsconfigRootDir", "")
  );

  let analyzeResult = AnalyzeResult.getInstance();
  analyzeResult.setFileName(analyzer.getSaveFileName());

  setRepositoryInfo(rootPath);

  const statisticsProvider = new StatisticsProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("statistics", statisticsProvider)
  );

  const recognizedProvider = new ORMItemProvider(
    rootPath,
    AnalyzeResultGroup.recognized
  );
  context.subscriptions.push(
    vscode.window.createTreeView("recognized", {
      treeDataProvider: recognizedProvider,
      canSelectMany: true,
      dragAndDropController: recognizedProvider,
    })
  );

  const unknownProvider = new ORMItemProvider(
    rootPath,
    AnalyzeResultGroup.unknown
  );
  context.subscriptions.push(
    vscode.window.createTreeView("unknown", {
      treeDataProvider: unknownProvider,
      canSelectMany: true,
      dragAndDropController: unknownProvider,
    })
  );

  analyzeResult.setRefreshFn(() => {
    statisticsProvider.refresh();
    recognizedProvider.refresh();
    unknownProvider.refresh();
  });

  // Run the initial analysis
  runAnalyzer(analyzer, rootPath);

  /**********************************************************/
  /*                  Register commands                     */
  /**********************************************************/

  vscode.commands.registerCommand("clue.reanalyze", async () => {
    const vscodePath = vscode.Uri.joinPath(
      vscode.Uri.file(rootPath),
      ".vscode"
    );
    const resultPath = vscode.Uri.joinPath(
      vscodePath,
      analyzer.getSaveFileName()
    );

    await vscode.workspace.fs.delete(resultPath);

    analyzeResult.clear();

    runAnalyzer(analyzer, rootPath);
  });

  vscode.commands.registerCommand("clue.entity.add", () => {
    vscode.window
      .showInputBox({
        placeHolder: "Enter the name of the entity to add",
      })
      .then((name) => {
        if (name === undefined) {
          return;
        }

        let result = analyzeResult.getGroup(AnalyzeResultGroup.recognized);

        if (result.has(name)) {
          vscode.window.showErrorMessage(
            `Entity "${name}" already exists in the list of recognized entities`
          );
          return;
        }

        result.set(name, {
          selection: undefined,
          name,
          operations: [],
          note: "",
          isCustom: true,
        });

        analyzeResult.saveToStorage(rootPath);
      });
  });

  vscode.commands.registerCommand("clue.entity.remove", (item: ORMItem) => {
    if (item.type !== "entity") {
      return;
    }

    const entities = analyzeResult.getGroup(AnalyzeResultGroup.recognized);
    let entity = entities.get(item.inner.name);
    if (entity && entity.isCustom) {
      entities.delete(item.inner.name);
    }

    analyzeResult.saveToStorage(rootPath);
  });

  vscode.commands.registerCommand("clue.item.show", (loc: vscode.Location) => {
    vscode.workspace.openTextDocument(loc.uri).then((doc) => {
      vscode.window.showTextDocument(doc).then((editor) => {
        editor.revealRange(loc.range, vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(loc.range.start, loc.range.end);
      });
    });
  });

  vscode.commands.registerCommand(
    "clue.item.addNote",
    (item: ORMItem, allItems: ORMItem[]) => {
      if (!allItems) {
        allItems = [item];
      }

      var placeHolder = `Enter a note for "${item.inner.name}"`;
      var value = item.inner.note;
      if (allItems.length > 1) {
        placeHolder = `Enter a note for ${allItems.length} items`;
        value = "";
      }

      vscode.window
        .showInputBox({
          placeHolder,
          value,
        })
        .then((note) => {
          if (!note) {
            return;
          }
          for (let i of allItems) {
            i.inner.note = note;
          }
          analyzeResult.saveToStorage(rootPath);
        });
    }
  );

  vscode.commands.registerCommand(
    "clue.item.clearNote",
    (item: ORMItem, allItems: ORMItem[]) => {
      if (!allItems) {
        allItems = [item];
      }
      for (let i of allItems) {
        i.inner.note = "";
      }
      analyzeResult.saveToStorage(rootPath);
    }
  );

  vscode.commands.registerCommand(
    "clue.item.copy",
    (_: ORMItem, allItems: ORMItem[]) => {
      import("clipboardy").then((clipboardy) => {
        let combined = allItems.map((i) => i.inner.name).join("\n");
        clipboardy.default.writeSync(combined);
      });
    }
  );
}

export function deactivate() {}

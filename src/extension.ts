import * as vscode from "vscode";
import * as path from "path";
import { ORMItem, ORMItemProvider } from "./provider/orm-items";
import { TypeORMAnalyzer } from "./analyzer/typeorm";
import { AnalyzeResult, AnalyzeResultGroup, Operation } from "./model";
import { Info, InfoProvider } from "./provider/info";
import { Analyzer } from "./analyzer/base";
import { GitExtension } from "./@types/git";
import { Entity, Selection, getCurrentSelection } from "./model";

async function setRepositoryInfo(rootPath: string) {
  const gitExtension = vscode.extensions.getExtension("vscode.git") as
    | vscode.Extension<GitExtension>
    | undefined;

  if (!gitExtension) {
    return undefined;
  }
  const api = gitExtension.exports.getAPI(1);

  const repo = await api.openRepository(vscode.Uri.file(rootPath));
  if (!repo) {
    return;
  }
  const head = repo.state.HEAD;
  if (!head) {
    return;
  }
  const hash = head.commit ?? "";
  const url = repo.state.remotes[0].fetchUrl ?? "";
  const result = AnalyzeResult.getInstance();
  result.setRepository({ url, hash });
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
        await setRepositoryInfo(rootPath);

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

  const infoProvider = new InfoProvider();
  context.subscriptions.push(
    vscode.window.createTreeView("info", {
      treeDataProvider: infoProvider,
      canSelectMany: true,
    })
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
    infoProvider.refresh();
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

  vscode.commands.registerCommand("clue.entity.add", async () => {
    const name = await vscode.window.showInputBox({
      placeHolder: "Enter the name of the entity to add",
    });

    if (name === undefined) {
      return;
    }

    const setSelection = await vscode.window.showQuickPick(["no", "yes"], {
      canPickMany: false,
      ignoreFocusOut: true,
      placeHolder: "Set the current selection for the entity?",
    });

    const entities = analyzeResult.getGroup(AnalyzeResultGroup.recognized);

    if (entities.has(name)) {
      vscode.window.showErrorMessage(
        `Entity "${name}" already exists in the list of recognized entities`
      );
      return;
    }

    entities.set(name, {
      selection:
        setSelection === "yes" ? getCurrentSelection(rootPath) : undefined,
      name,
      operations: [],
      note: "",
      isCustom: true,
    });

    analyzeResult.saveToStorage(rootPath);
  });

  const moveEntity = async (
    item: ORMItem,
    from: AnalyzeResultGroup,
    to: AnalyzeResultGroup
  ) => {
    if (item.type !== "entity") {
      return;
    }
    const fromEntities = analyzeResult.getGroup(from);
    const toEntities = analyzeResult.getGroup(to);
    let entity = fromEntities.get(item.inner.name);
    if (entity) {
      fromEntities.delete(entity.name);
      toEntities.set(entity.name, entity);
    }
    analyzeResult.saveToStorage(rootPath);
  };

  vscode.commands.registerCommand(
    "clue.entity.moveToUnknown",
    (item: ORMItem) => {
      moveEntity(
        item,
        AnalyzeResultGroup.recognized,
        AnalyzeResultGroup.unknown
      );
    }
  );

  vscode.commands.registerCommand(
    "clue.entity.moveToRecognized",
    (item: ORMItem) => {
      moveEntity(
        item,
        AnalyzeResultGroup.unknown,
        AnalyzeResultGroup.recognized
      );
    }
  );

  vscode.commands.registerCommand(
    "clue.operation.add",
    async (item: ORMItem) => {
      if (item.type !== "entity") {
        return;
      }
      const name = await vscode.window.showInputBox({
        placeHolder: "Enter the name of the operation to add",
      });

      if (name === undefined) {
        return;
      }

      const type = await vscode.window.showQuickPick(
        ["read", "write", "other", "transaction"],
        {
          canPickMany: false,
          ignoreFocusOut: true,
          placeHolder: "Select the type of the operation",
        }
      );

      if (type === undefined) {
        return;
      }

      const setSelection = await vscode.window.showQuickPick(["no", "yes"], {
        canPickMany: false,
        ignoreFocusOut: true,
        placeHolder: "Set the current selection for the operation?",
      });

      const entity = item.inner as Entity;
      entity.operations.push({
        selection:
          setSelection === "yes" ? getCurrentSelection(rootPath) : undefined,
        name,
        arguments: [],
        type: type as "read" | "write" | "other" | "transaction",
        note: "",
        isCustom: true,
      });

      analyzeResult.saveToStorage(rootPath);
    }
  );

  vscode.commands.registerCommand(
    "clue.argument.add",
    async (item: ORMItem) => {
      if (item.type !== "operation") {
        return;
      }
      const name = await vscode.window.showInputBox({
        placeHolder: "Enter the name of the argument to add",
      });

      if (name === undefined) {
        return;
      }

      const setSelection = await vscode.window.showQuickPick(["no", "yes"], {
        canPickMany: false,
        ignoreFocusOut: true,
        placeHolder: "Set the current selection for the argument?",
      });

      const operation = item.inner as Operation;
      operation.arguments.push({
        selection:
          setSelection === "yes" ? getCurrentSelection(rootPath) : undefined,
        name,
        note: "",
        isCustom: true,
      });

      analyzeResult.saveToStorage(rootPath);
    }
  );

  vscode.commands.registerCommand("clue.item.remove", (item: ORMItem) => {
    if (!item.inner.isCustom) {
      return;
    }
    const entities = analyzeResult.getGroup(AnalyzeResultGroup.recognized);
    switch (item.type) {
      case "entity": {
        const entity = entities.get(item.inner.name);
        if (entity && entity.isCustom) {
          entities.delete(item.inner.name);
        }
        break;
      }
      case "operation": {
        const entity = entities.get(item.parent!.inner.name);
        if (entity) {
          entity.operations.splice(item.idInParent, 1);
        }
        break;
      }
      case "argument": {
        const entity = entities.get(item.parent!.parent!.inner.name);
        if (entity) {
          const operation = entity.operations[item.parent!.idInParent];
          operation.arguments.splice(item.idInParent, 1);
        }
        break;
      }
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
    (selectedItem: ORMItem, selectedItems: ORMItem[]) => {
      if (!selectedItems) {
        selectedItems = [selectedItem];
      }

      var placeHolder = `Enter a note for "${selectedItem.inner.name}"`;
      var value = selectedItem.inner.note;
      if (selectedItems.length > 1) {
        placeHolder = `Enter a note for ${selectedItems.length} items`;
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
          for (let i of selectedItems) {
            i.inner.note = note;
          }
          analyzeResult.saveToStorage(rootPath);
        });
    }
  );

  vscode.commands.registerCommand(
    "clue.item.clearNote",
    (selectedItem: ORMItem, selectedItems: ORMItem[]) => {
      if (!selectedItems) {
        selectedItems = [selectedItem];
      }
      for (let i of selectedItems) {
        i.inner.note = "";
      }
      analyzeResult.saveToStorage(rootPath);
    }
  );

  vscode.commands.registerCommand(
    "clue.item.copy",
    (selectedItem: ORMItem, selectedItems: ORMItem[]) => {
      if (!selectedItems) {
        selectedItems = [selectedItem];
      }
      import("clipboardy").then((clipboardy) => {
        let combined = selectedItems.map((i) => i.inner.name).join("\n");
        clipboardy.default.writeSync(combined);
      });
    }
  );

  vscode.commands.registerCommand(
    "clue.info.copy",
    (selectedInfoLine: Info, selectedInfoLines: Info[]) => {
      if (!selectedInfoLines) {
        selectedInfoLines = [selectedInfoLine];
      }
      import("clipboardy").then((clipboardy) => {
        let combined = selectedInfoLines
          .map((i) => `${i.name}: ${i.value}`)
          .join("\n");
        clipboardy.default.writeSync(combined);
      });
    }
  );
}

export function deactivate() {}

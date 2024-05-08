import vscode, { OutputChannel } from "vscode";
import fs from "fs";
import glob from 'glob';
import { ORMItem, ORMItemProvider } from "./provider/orm-items";
import { TypeORMAnalyzer } from "./analyzer/typeorm";
import { DjangoAnalyzer } from "./analyzer/django";
import { AnalyzeResult, AnalyzeResultGroup, Operation, appendNote } from "./model";
import { Info, InfoProvider } from "./provider/info";
import { Analyzer } from "./analyzer/base";
import { GitExtension } from "./@types/git";
import { Entity, getCurrentSelection, TAGS } from "./model";

// Sets the git hash and repository URL in the result
async function setRepositoryInfo(workspacePath: vscode.Uri) {
  const gitExtension = vscode.extensions.getExtension("vscode.git") as
    | vscode.Extension<GitExtension>
    | undefined;

  if (!gitExtension) {
    return;
  }
  const api = gitExtension.exports.getAPI(1);

  const repo = await api.openRepository(workspacePath);
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

function runAnalyzer(analyzer: Analyzer, workspacePath: vscode.Uri, outputChannel: OutputChannel) {
  const config = vscode.workspace.getConfiguration("splinter");

  let analyzeResult = AnalyzeResult.getInstance();

  analyzeResult.refreshViews();

  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
      title: `Analyzing ${analyzer.getName()} project`,
    },
    async (progress, cancel) => {
      analyzeResult.clear();

      if (!(await analyzeResult.loadFromStorage())) {
        // If the result is not found, start a new analysis
        await setRepositoryInfo(workspacePath);

        // Set up the cancellation
        cancel.onCancellationRequested(() => {
          analyzer.cancel();
        });

        // Do the analysis
        let ok = await analyzer.analyze((msg) => progress.report({ message: msg }), outputChannel);
        if (ok) {
          // Save the result 
          await analyzeResult.saveToStorage();
        } else {
          vscode.window.showErrorMessage("Failed to analyze the project.");
        }
      }

      analyzeResult.refreshViews();
    }
  );
}

export function activate(context: vscode.ExtensionContext) {
  if (!context.storageUri) {
    return;
  }

  const workspacePath = vscode.Uri.parse(
    vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : "");

  const outputChannel = vscode.window.createOutputChannel("Splinter");

  /**********************************************************/
  /*             Set up the analyzer and views              */
  /**********************************************************/

  let language = vscode.workspace.getConfiguration("splinter").get("language") as string;
  if (language === "auto") {
    // Try to detect the language by counting the number of file types: *.ts and *.py

    const tsCount = glob.sync('**/**.ts', { cwd: workspacePath.fsPath }).length;
    const pyCount = glob.sync('**/**.py', { cwd: workspacePath.fsPath }).length;

    if (tsCount + pyCount === 0) {
      vscode.window.showErrorMessage("No TypeScript or Python files found in the project.");
      return;
    }

    if (tsCount > pyCount) {
      language = "typescript";
    } else {
      language = "python";
    }
  }

  let analyzeResult = AnalyzeResult.getInstance();

  let analyzer: Analyzer | null = null;
  switch (language) {
    case "python":
      analyzer = new DjangoAnalyzer(
        workspacePath,
        analyzeResult,
      );
      break;

    case "typescript":
    default:
      analyzer = new TypeORMAnalyzer(
        workspacePath,
        analyzeResult,
      );
      break;
  }

  const vscodePath = vscode.Uri.joinPath(workspacePath, ".vscode");
  if (!fs.existsSync(vscodePath.fsPath)) {
    fs.mkdirSync(vscodePath.fsPath);
  }
  const resultPath = vscode.Uri.joinPath(
    vscodePath,
    `${analyzer.getName()}-results.json`
  );
  analyzeResult.setResultPath(resultPath.fsPath);

  const infoProvider = new InfoProvider();
  context.subscriptions.push(
    vscode.window.createTreeView("info", {
      treeDataProvider: infoProvider,
      canSelectMany: true,
    })
  );

  const recognizedProvider = new ORMItemProvider(
    workspacePath,
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
    workspacePath,
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
  runAnalyzer(analyzer, workspacePath, outputChannel);

  /**********************************************************/
  /*                  Register commands                     */
  /**********************************************************/

  vscode.commands.registerCommand("splinter.reanalyze", async () => {
    const resultPath = vscode.Uri.joinPath(
      vscode.Uri.joinPath(workspacePath, ".vscode"),
      `${analyzer!.getName()}-results.json`
    );

    if (fs.existsSync(resultPath.fsPath)) {
      await vscode.workspace.fs.delete(resultPath);
    }

    analyzeResult.clear();

    runAnalyzer(analyzer!, workspacePath, outputChannel);
  });

  vscode.commands.registerCommand("splinter.reload", async () => {
    analyzeResult.clear();
    await analyzeResult.loadFromStorage();
    analyzeResult.refreshViews();
  });

  vscode.commands.registerCommand("splinter.entity.add", async () => {
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
        setSelection === "yes" ? getCurrentSelection(workspacePath) : undefined,
      name,
      operations: [],
      note: "",
      isCustom: true,
    });

    analyzeResult.saveToStorage();
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
    analyzeResult.saveToStorage();
  };

  vscode.commands.registerCommand(
    "splinter.entity.moveToUnknown",
    (item: ORMItem, items: ORMItem[]) => {
      if (!items) {
        items = [item];
      }
      for (let item of items) {
        moveEntity(
          item,
          AnalyzeResultGroup.recognized,
          AnalyzeResultGroup.unknown
        );
      }
    }
  );

  vscode.commands.registerCommand(
    "splinter.entity.moveToRecognized",
    (item: ORMItem, items: ORMItem[]) => {
      if (!items) {
        items = [item];
      }
      for (let item of items) {
        moveEntity(
          item,
          AnalyzeResultGroup.unknown,
          AnalyzeResultGroup.recognized
        );
      }
    }
  );

  vscode.commands.registerCommand(
    "splinter.operation.add",
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
          setSelection === "yes" ? getCurrentSelection(workspacePath) : undefined,
        name,
        arguments: [],
        type: type as "read" | "write" | "other" | "transaction",
        note: "",
        isCustom: true,
      });

      analyzeResult.saveToStorage();
    }
  );

  vscode.commands.registerCommand(
    "splinter.argument.add",
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
          setSelection === "yes" ? getCurrentSelection(workspacePath) : undefined,
        name,
        note: "",
        isCustom: true,
      });

      analyzeResult.saveToStorage();
    }
  );

  vscode.commands.registerCommand("splinter.item.remove", (item: ORMItem) => {
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

    analyzeResult.saveToStorage();
  });

  vscode.commands.registerCommand(
    "splinter.item.show",
    (loc: vscode.Location) => {
      vscode.workspace.openTextDocument(loc.uri).then((doc) => {
        vscode.window.showTextDocument(doc).then((editor) => {
          editor.revealRange(loc.range, vscode.TextEditorRevealType.InCenter);
          editor.selection = new vscode.Selection(
            loc.range.start,
            loc.range.end
          );
        });
      });
    }
  );

  vscode.commands.registerCommand(
    "splinter.item.editNote",
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
          analyzeResult.saveToStorage();
        });
    }
  );

  vscode.commands.registerCommand(
    "splinter.item.addTag",
    async (selectedItem: ORMItem, selectedItems: ORMItem[]) => {
      if (!selectedItems) {
        selectedItems = [selectedItem];
      }

      let placeHolder = "Append note";
      if (selectedItems.length > 1) {
        placeHolder = `Append note to ${selectedItems.length} items`;
      }

      const note = await vscode.window
        .showQuickPick(
          TAGS,
          {
            canPickMany: false,
            placeHolder,
          });

      if (note) {
        for (let i of selectedItems) {
          i.inner.note = appendNote(i.inner.note, note);
        }
        analyzeResult.saveToStorage();
      }
    }
  );

  vscode.commands.registerCommand(
    "splinter.item.clearNote",
    (selectedItem: ORMItem, selectedItems: ORMItem[]) => {
      if (!selectedItems) {
        selectedItems = [selectedItem];
      }
      for (let i of selectedItems) {
        i.inner.note = "";
      }
      analyzeResult.saveToStorage();
    }
  );

  vscode.commands.registerCommand(
    "splinter.item.copy",
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
    "splinter.info.copy",
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

  vscode.commands.registerCommand(
    "splinter.autoAnnotate",
    async () => {
      const tag = await vscode.window.showQuickPick(analyzer!.supportedAutoAnnotateTags(), {
        canPickMany: false,
        placeHolder: "Select the tag to auto-annotate",
      });

      if (tag) {
        analyzer!.autoAnnotate(tag);
        await analyzeResult.saveToStorage();
        analyzeResult.refreshViews();
      }
    }
  );
}

export function deactivate() { }

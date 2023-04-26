import * as vscode from "vscode";
import { EntityOperationProvider } from "./provider/entity-operation";
import {
  analyze as analyzeTypeORM,
  loadResultFromStorage,
  saveResultToStorage,
} from "./analyzer/typeorm";
import { AnalyzeResult, Entity, Operation } from "./model";
import path = require("path");
import { StatisticsProvider } from "./provider/statistics";

let analyzeResult: AnalyzeResult = new AnalyzeResult();

export function activate(context: vscode.ExtensionContext) {
  if (!context.storageUri) {
    return;
  }

  const rootPath =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : "";

  const recognizedProvider = new EntityOperationProvider(
    rootPath,
    analyzeResult.getEntities()
  );

  const unknownProvider = new EntityOperationProvider(
    rootPath,
    analyzeResult.getUnknowns()
  );

  const statisticsProvider = new StatisticsProvider(analyzeResult);

  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      cancellable: false,
      title: "Analyzing TypeORM",
    },
    async (progress) => {
      let result = await loadResultFromStorage(rootPath);
      if (result === undefined) {
        result = await analyzeTypeORM(rootPath);
        await saveResultToStorage(rootPath, result);
      }

      progress.report({ increment: 100, message: "Done" });

      analyzeResult.extend(result);

      recognizedProvider.refresh();
      unknownProvider.refresh();
      statisticsProvider.refresh();
    }
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("statistics", statisticsProvider)
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("recognized", recognizedProvider)
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("unknown", unknownProvider)
  );

  vscode.commands.registerCommand("item.show", (loc: vscode.Location) => {
    vscode.workspace.openTextDocument(loc.uri).then((doc) => {
      vscode.window.showTextDocument(doc).then((editor) => {
        editor.revealRange(loc.range, vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(loc.range.start, loc.range.end);
      });
    });
  });

  vscode.commands.registerCommand(
    "item.addNote",
    (item: Entity | Operation) => {
      vscode.window.showInputBox({ value: item.note }).then((note) => {
        if (note !== undefined) {
          item.note = note;
          saveResultToStorage(rootPath, analyzeResult);
        }
        recognizedProvider.updateItem(item);
        unknownProvider.updateItem(item);
      });
    }
  );
}

export function deactivate() {}

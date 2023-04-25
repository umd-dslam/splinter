import * as vscode from "vscode";
import { EntityOperationProvider } from "./provider/entity-operation";
import {
  analyze as analyzeTypeORM,
  loadResultFromStorage,
  saveResultToStorage,
} from "./analyzer/typeorm";
import { Entity, Operation } from "./model";
import path = require("path");
import { StatisticsProvider } from "./provider/statistics";

export function activate(context: vscode.ExtensionContext) {
  if (!context.storageUri) {
    return;
  }

  const rootPath =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : "";

  let promisedResult = (async () => {
    let result = await loadResultFromStorage(rootPath);
    if (result === undefined) {
      result = await analyzeTypeORM(rootPath);
      await saveResultToStorage(rootPath, result);
    }
    return result;
  })();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "statistics",
      new StatisticsProvider(promisedResult)
    )
  );

  const recognizedProvider = new EntityOperationProvider(
    rootPath,
    promisedResult.then((result) => result.entities)
  );
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("recognized", recognizedProvider)
  );

  const unknownProvider = new EntityOperationProvider(
    rootPath,
    promisedResult.then((result) => result.unknowns)
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
          promisedResult.then((result) => {
            saveResultToStorage(rootPath, result);
          });
        }
        recognizedProvider.updateEntity(item);
        unknownProvider.updateEntity(item);
      });
    }
  );
}

export function deactivate() {}

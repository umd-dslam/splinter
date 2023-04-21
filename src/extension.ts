import * as vscode from "vscode";
import { EntityOperationProvider } from "./provider/entity-operation";
import { analyze as analyzeTypeORM } from "./analyzer/typeorm";

export function activate(context: vscode.ExtensionContext) {
  const rootPath =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : "";

  Promise.resolve(analyzeTypeORM(rootPath)).then((result) => {
    if (typeof result === "string") {
      console.log(result);
    } else {
      context.subscriptions.push(
        vscode.window.registerTreeDataProvider(
          "recognized",
          new EntityOperationProvider(rootPath, result.entities)
        )
      );

      context.subscriptions.push(
        vscode.window.registerTreeDataProvider(
          "unknown",
          new EntityOperationProvider(rootPath, result.unknowns)
        )
      );
    }
  });

  vscode.commands.registerCommand("item.show", (loc: vscode.Location) => {
    vscode.workspace.openTextDocument(loc.uri).then((doc) => {
      vscode.window.showTextDocument(doc).then((editor) => {
        editor.revealRange(loc.range, vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(loc.range.start, loc.range.end);
      });
    });
  });
}

export function deactivate() {}

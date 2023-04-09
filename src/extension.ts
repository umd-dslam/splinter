import * as vscode from "vscode";
import { SchemaProvider } from "./provider/schema";
import { analyze as analyzeTypeORM } from "./analyzer/typeorm";

export function activate(context: vscode.ExtensionContext) {
  const rootPath =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : "";

  Promise.resolve(analyzeTypeORM(rootPath)).then((results) => {
    context.subscriptions.push(
      vscode.window.registerTreeDataProvider(
        "schema",
        new SchemaProvider(results)
      )
    );
  });

  vscode.commands.registerCommand("item.show", (loc: vscode.Location) => {
    vscode.workspace.openTextDocument(loc.uri).then((doc) => {
      vscode.window.showTextDocument(doc).then((editor) => {
        editor.revealRange(loc.range, vscode.TextEditorRevealType.InCenter);
      });
    });
  });
}

export function deactivate() {}

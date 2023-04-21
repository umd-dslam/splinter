import * as vscode from "vscode";
import { Unsure } from "../model";

export class UnsureProvider implements vscode.TreeDataProvider<Unsure> {
  constructor(private unsure: Unsure[]) {}

  getTreeItem(element: Unsure): vscode.TreeItem {
    var item = new vscode.TreeItem(
      element.name,
      vscode.TreeItemCollapsibleState.None
    );

    item.command = {
      command: "item.show",
      title: "Show",
      arguments: [element.loc],
    };

    return item;
  }

  getChildren(element?: Unsure): Thenable<Unsure[]> {
    if (element) {
      return Promise.resolve([]);
    }
    return Promise.resolve(this.unsure);
  }
}

import * as vscode from "vscode";
import { Entity, Operation } from "../model";

export class RecognizedProvider
  implements vscode.TreeDataProvider<Entity | Operation>
{
  constructor(private entities: Map<string, Entity>) {}

  getTreeItem(element: Entity | Operation): vscode.TreeItem {
    var item = new vscode.TreeItem(
      element.name,
      element instanceof Entity && element.operations.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    item.command = {
      command: "item.show",
      title: "Show",
      arguments: [element.loc],
    };

    return item;
  }

  getChildren(element?: Entity | Operation): Thenable<Entity[] | Operation[]> {
    if (element) {
      if (element instanceof Entity) {
        return Promise.resolve(element.operations);
      }
      return Promise.resolve([]);
    }
    return Promise.resolve(Array.from(this.entities.values()));
  }
}

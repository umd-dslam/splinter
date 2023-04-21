import * as vscode from "vscode";
import { Entity, Operation } from "../model";

export class EntityOperationProvider
  implements vscode.TreeDataProvider<Entity | Operation>
{
  constructor(
    private rootPath: string,
    private entities: Map<string, Entity>
  ) {}

  getTreeItem(element: Entity | Operation): vscode.TreeItem {
    var item = new vscode.TreeItem(
      element.name,
      element instanceof Entity && element.operations.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    item.description = element.loc.uri.path.replace(this.rootPath + "/", "");

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

    const sortedEntities = Array.from(this.entities.values()).sort((a, b) =>
      a.name < b.name ? -1 : 1
    );

    return Promise.resolve(sortedEntities);
  }
}

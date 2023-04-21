import * as vscode from "vscode";
import { Entity, Operation } from "../model";

export class EntityOperationProvider
  implements vscode.TreeDataProvider<Entity | Operation>
{
  constructor(
    private rootPath: string,
    private entities: Map<string, Entity>
  ) {}

  isEntity(element: Entity | Operation): element is Entity {
    return (element as Entity).operations !== undefined;
  }

  getTreeItem(element: Entity | Operation): vscode.TreeItem {
    var item = new vscode.TreeItem(
      element.name,
      this.isEntity(element) && element.operations.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    item.description = element.selection.filePath.replace(
      this.rootPath + "/",
      ""
    );

    item.command = {
      command: "item.show",
      title: "Show",
      arguments: [
        new vscode.Location(
          vscode.Uri.file(element.selection.filePath),
          new vscode.Range(
            element.selection.fromLine,
            element.selection.fromColumn,
            element.selection.toLine,
            element.selection.toColumn
          )
        ),
      ],
    };

    return item;
  }

  getChildren(element?: Entity | Operation): Thenable<Entity[] | Operation[]> {
    if (element) {
      if (this.isEntity(element)) {
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

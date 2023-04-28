import * as vscode from "vscode";
import { Entity, Operation, countOperationTypes } from "../model";
import * as path from "path";
import { Refreshable } from "./refreshable";

export class EntityOperationProvider
  implements vscode.TreeDataProvider<Entity | Operation>, Refreshable
{
  constructor(
    private rootPath: string,
    private entities: Map<string, Entity>
  ) {}

  isEntity(element: Entity | Operation): element is Entity {
    return (element as Entity).operations !== undefined;
  }

  getTreeItem(element: Entity | Operation): vscode.TreeItem {
    let relativePath = element.selection
      ? path.relative(this.rootPath, element.selection.filePath)
      : "";
    let item = new vscode.TreeItem(element.name);
    if (this.isEntity(element)) {
      item.collapsibleState =
        element.operations.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;
      item.description = Object.entries(countOperationTypes(element.operations))
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([type, count]) => `${type}: ${count}`)
        .join(" | ");
    } else {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.description = element.type;
    }
    if (element.note) {
      if (item.description) {
        item.description += " | ";
      }
      item.description += `note: ${element.note}`;
    }

    item.tooltip = `${relativePath}\nnote: ${element.note}`;

    if (element.selection) {
      item.command = {
        command: "clue.item.show",
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
    }

    return item;
  }

  async getChildren(
    element?: Entity | Operation
  ): Promise<Entity[] | Operation[]> {
    if (element) {
      if (this.isEntity(element)) {
        return element.operations.sort((a, b) => (a.type < b.type ? -1 : 1));
      }
      return [];
    }

    return Array.from(this.entities.values()).sort((a, b) =>
      a.name < b.name ? -1 : 1
    );
  }

  private _onDidChangeTreeData: vscode.EventEmitter<
    Entity | Operation | undefined | null | void
  > = new vscode.EventEmitter<Entity | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    Entity | Operation | undefined | null | void
  > = this._onDidChangeTreeData.event;

  updateItem(entity: Entity | Operation): void {
    this._onDidChangeTreeData.fire(entity);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(null);
  }
}

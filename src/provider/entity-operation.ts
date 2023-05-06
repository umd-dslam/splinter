import * as vscode from "vscode";
import { Entity, Operation, groupOperationTypes, isEntity } from "../model";
import * as path from "path";

export type EntityOperation = {
  inner: Entity | Operation;
  parent: Entity;
  isRecognized: boolean;
};

export class EntityOperationProvider
  implements vscode.TreeDataProvider<EntityOperation>
{
  constructor(
    private rootPath: string,
    private entities: Map<string, Entity>,
    private isRecognized: boolean
  ) {}

  getTreeItem(element: EntityOperation): vscode.TreeItem {
    let inner = element.inner;
    let relativePath = inner.selection
      ? path.relative(this.rootPath, inner.selection.filePath)
      : "";
    let item = new vscode.TreeItem(inner.name);

    if (isEntity(inner)) {
      item.collapsibleState =
        inner.operations.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;
      item.description = Object.entries(groupOperationTypes(inner.operations))
        .map(([type, ids]) => [type, ids.size])
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([type, count]) => `${type}: ${count}`)
        .join(" | ");
      item.iconPath = new vscode.ThemeIcon("table");
      if (inner.isCustom) {
        item.contextValue = "customEntity";
      }
    } else {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.description = inner.type;
      item.iconPath = new vscode.ThemeIcon("symbol-method");
      item.contextValue = "operation";
    }
    if (inner.note) {
      if (item.description) {
        item.description += " | ";
      }
      item.description += `note: ${inner.note}`;
    }

    item.tooltip = `${relativePath}\nnote: ${inner.note}`;

    if (inner.selection) {
      item.command = {
        command: "clue.item.show",
        title: "Show",
        arguments: [
          new vscode.Location(
            vscode.Uri.file(inner.selection.filePath),
            new vscode.Range(
              inner.selection.fromLine,
              inner.selection.fromColumn,
              inner.selection.toLine,
              inner.selection.toColumn
            )
          ),
        ],
      };
    }

    return item;
  }

  async getChildren(element?: EntityOperation): Promise<EntityOperation[]> {
    if (element) {
      const entity = element.inner;
      if (isEntity(entity)) {
        return entity.operations
          .sort((a, b) => (a.type < b.type ? -1 : 1))
          .map((operation) => ({
            inner: operation,
            parent: entity,
            isRecognized: this.isRecognized,
          }));
      }
      return [];
    }

    return Array.from(this.entities.values())
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .map((entity) => ({
        inner: entity,
        parent: entity,
        isRecognized: this.isRecognized,
      }));
  }

  private _onDidChangeTreeData: vscode.EventEmitter<
    EntityOperation | undefined | null | void
  > = new vscode.EventEmitter<EntityOperation | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    EntityOperation | undefined | null | void
  > = this._onDidChangeTreeData.event;

  updateItem(item: EntityOperation): void {
    this._onDidChangeTreeData.fire(item);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(null);
  }
}

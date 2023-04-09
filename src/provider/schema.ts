import * as vscode from "vscode";
import { Entity } from "../model/entity";

export class SchemaProvider implements vscode.TreeDataProvider<Entity> {
  constructor(private entities: Entity[]) {}

  getTreeItem(element: Entity): vscode.TreeItem {
    return new vscode.TreeItem(
      element.name,
      vscode.TreeItemCollapsibleState.None
    );
  }

  getChildren(element?: Entity): Thenable<Entity[]> {
    if (element) {
      return Promise.resolve([]);
    }
    return Promise.resolve(this.entities);
  }
}

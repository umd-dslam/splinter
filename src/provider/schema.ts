import * as vscode from "vscode";
import { Entity } from "../model";

export class SchemaProvider implements vscode.TreeDataProvider<Entity> {
  constructor(private entities: Entity[]) {}

  getTreeItem(element: Entity): vscode.TreeItem {
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

  getChildren(element?: Entity): Thenable<Entity[]> {
    if (element) {
      return Promise.resolve([]);
    }
    return Promise.resolve(this.entities);
  }
}

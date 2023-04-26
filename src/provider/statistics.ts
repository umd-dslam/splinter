import * as vscode from "vscode";
import { AnalyzeResult, countOperationTypes } from "../model";

type Statistics = {
  name: string;
  value: number;
  children: Statistics[];
};

export class StatisticsProvider implements vscode.TreeDataProvider<Statistics> {
  constructor(private result: AnalyzeResult) {}

  getTreeItem(element: Statistics): vscode.TreeItem {
    var item = new vscode.TreeItem(
      element.name,
      element.children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );
    item.description = element.value.toString();
    item.tooltip = `${element.name}: ${item.description}`;

    return item;
  }

  async getChildren(element?: Statistics): Promise<Statistics[]> {
    if (element) {
      return element.children;
    }

    // Accumulate the count per operation type across all entities.
    let operationTypeCounts = {} as { [key: string]: number };
    for (const entity of this.result.getEntities().values()) {
      operationTypeCounts = countOperationTypes(
        entity.operations,
        operationTypeCounts
      );
    }

    return [
      {
        name: "entities",
        value: this.result.getEntities().size,
        children: Object.entries(operationTypeCounts).map(([type, count]) => {
          return {
            name: type,
            value: count,
            children: [],
          };
        }),
      },
    ];
  }

  private _onDidChangeTreeData: vscode.EventEmitter<void> =
    new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData: vscode.Event<void> =
    this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
}

import * as vscode from "vscode";
import {
  AnalyzeResult,
  AnalyzeResultGroup,
  groupOperationTypes,
} from "../model";

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
    let operationTypeCounts = {} as { [key: string]: Set<string> };
    for (const entity of this.result
      .getGroup(AnalyzeResultGroup.recognized)
      .values()) {
      operationTypeCounts = groupOperationTypes(
        entity.operations,
        operationTypeCounts
      );
    }

    return [
      {
        name: "entities",
        value: this.result.getGroup(AnalyzeResultGroup.recognized).size,
        children: Object.entries(operationTypeCounts).map(([type, ids]) => {
          return {
            name: type,
            value: ids.size,
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

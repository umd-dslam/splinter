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

    let stats: Statistics[] = [];

    for (const group of [
      AnalyzeResultGroup.recognized,
      AnalyzeResultGroup.unknown,
    ]) {
      // Accumulate the count per operation type across all entities.
      let operationTypeCounts = {} as { [key: string]: Set<string> };
      for (const entity of this.result.getGroup(group).values()) {
        operationTypeCounts = groupOperationTypes(
          entity.operations,
          operationTypeCounts
        );
      }

      // Combine the entity count with operation type counts.
      let children = [
        {
          name: "entities",
          value: this.result.getGroup(group).size,
          children: [],
        },
      ];

      children.push(
        ...Object.entries(operationTypeCounts).map(([type, ids]) => {
          return {
            name: type,
            value: ids.size,
            children: [],
          };
        })
      );

      // Add the group to the stats.
      stats.push({
        name: group,
        value: this.result.getGroup(group).size,
        children,
      });
    }

    return stats;
  }

  private _onDidChangeTreeData: vscode.EventEmitter<void> =
    new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData: vscode.Event<void> =
    this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
}

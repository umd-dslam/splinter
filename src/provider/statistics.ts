import * as vscode from "vscode";
import { AnalyzeResult, countOperationTypes } from "../model";

type Statistics = {
  name: string;
  value: number;
  children: Statistics[];
};

export class StatisticsProvider implements vscode.TreeDataProvider<Statistics> {
  constructor(private result: Thenable<AnalyzeResult>) {}

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

    const result = await this.result;

    let operationTypeCounts = {} as { [key: string]: number };
    for (const entity of result.entities.values()) {
      operationTypeCounts = countOperationTypes(
        entity.operations,
        operationTypeCounts
      );
    }

    return [
      {
        name: "entities",
        value: result.entities.size,
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
}

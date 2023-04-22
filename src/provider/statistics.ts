import * as vscode from "vscode";
import { AnalyzeResult } from "../model";

type Statistics = {
  name: string,
  value: number,
  children: Statistics[],
};

export class StatisticsProvider
  implements vscode.TreeDataProvider<Statistics>
{
  constructor(
    private rootPath: string,
    private result: Thenable<AnalyzeResult>
  ) { }

  getTreeItem(element: Statistics): vscode.TreeItem {
    var item = new vscode.TreeItem(
      element.name,
      element.children.length > 0 ?
        vscode.TreeItemCollapsibleState.Expanded :
        vscode.TreeItemCollapsibleState.None
    );
    item.description = element.value.toString();
    item.tooltip = `${element.name}: ${item.description}`

    return item;
  }

  async getChildren(
    element?: Statistics
  ): Promise<Statistics[]> {
    if (element) {
      return element.children;
    }

    const result = await this.result;

    let entityReads = 0, entityWrites = 0;
    for (const entity of result.entities.values()) {
      for (const operation of entity.operations) {
        switch (operation.type) {
          case "read":
            entityReads++;
            break;
          case "write":
            entityWrites++;
            break;
          case "other":
            break;
        }
      }
    }

    return [{
      name: "entities",
      value: result.entities.size,
      children: [
        {
          name: "reads",
          value: entityReads,
          children: []
        },
        {
          name: "writes",
          value: entityWrites,
          children: []
        }
      ]
    }];

  }
}

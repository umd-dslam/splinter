import * as vscode from "vscode";
import {
  AnalyzeResult,
  AnalyzeResultGroup,
  groupOperationTypes,
  countTags,
} from "../model";

export type Info = {
  name: string;
  value?: string;
  children: Info[];
};

export class InfoProvider implements vscode.TreeDataProvider<Info> {
  constructor() {}

  getTreeItem(element: Info): vscode.TreeItem {
    var item = new vscode.TreeItem(
      element.name,
      element.children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );
    item.description = element.value?.toString();
    item.tooltip = `${element.name}: ${item.description}`;

    return item;
  }

  async getChildren(element?: Info): Promise<Info[]> {
    if (element) {
      return element.children;
    }
    let result = AnalyzeResult.getInstance();
    return [
      {
        name: "Repository",
        children: [
          {
            name: "url",
            value: result.getRepository()?.url ?? "",
            children: [],
          },
          {
            name: "hash",
            value: result.getRepository()?.hash ?? "",
            children: [],
          },
        ],
      },
      {
        name: "Statistics",
        children: this.getStats(),
      },
    ];
  }

  private getStats(): Info[] {
    let stats: Info[] = [];
    let result = AnalyzeResult.getInstance();

    for (const group of [
      AnalyzeResultGroup.recognized,
      AnalyzeResultGroup.unknown,
    ]) {
      const entities = [...result.getGroup(group).values()];
      // Accumulate the count per operation type across all entities.
      let operationTypeCounts = {} as { [key: string]: Set<string> };
      for (const entity of entities) {
        operationTypeCounts = groupOperationTypes(
          entity.operations,
          operationTypeCounts
        );
      }

      // Combine the entity count with operation type counts.
      let children: Info[] = [
        {
          name: "entities",
          value: [...entities]
            .filter((entity) => {
              return (
                !entity.note.includes("!entity") && !entity.name.match(/\[.+\]/)
              );
            })
            .length.toString(),
          children: [],
        },
      ];

      children.push(
        ...Object.entries(operationTypeCounts).map(([type, ids]) => {
          return {
            name: type,
            value: ids.size.toString(),
            children: [],
          };
        })
      );

      children.push({
        name: "tags",
        children: [...countTags(entities).entries()].map(([tag, count]) => {
          return {
            name: tag,
            value: count.toString(),
            children: [],
          };
        }),
      });

      // Add the group to the stats.
      stats.push({
        name: group,
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

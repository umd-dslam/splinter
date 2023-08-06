import * as vscode from "vscode";
import {
  AnalyzeResult,
  AnalyzeResultGroup,
  Entity,
  Operation,
  Argument,
  groupOperationTypes,
} from "../model";
import * as path from "path";
import * as pluralize from "pluralize";

export type ORMItem = {
  type: "entity" | "operation" | "argument";
  inner: Entity | Operation | Argument;
  parent?: ORMItem;
  idInParent: number;
  resultGroup: AnalyzeResultGroup;
};

type DragAndDropDataType = {
  resultGroup: AnalyzeResultGroup;
  items: { name: string; parentName: string; idInParent: number }[];
};

function computeCDA(item: ORMItem): number | null {
  if (item.type !== "entity") {
    return null;
  }
  let entity = item.inner as Entity;
  let cda: Set<string> = new Set();
  for (const operation of entity.operations) {
    if (operation.arguments.length > 0) {
      cda.add(
        operation.arguments
          .map((arg) => arg.name)
          .sort()
          .join(",")
      );
    }
  }
  return cda.size;
}

export class ORMItemProvider
  implements
    vscode.TreeDataProvider<ORMItem>,
    vscode.TreeDragAndDropController<ORMItem>
{
  constructor(
    private rootPath: string,
    private resultGroup: AnalyzeResultGroup
  ) {}

  getTreeItem(item: ORMItem): vscode.TreeItem {
    let relativePath = item.inner.selection
      ? path.relative(this.rootPath, item.inner.selection.filePath)
      : "";
    let treeItem = new vscode.TreeItem(item.inner.name);

    let description: string[] = [];
    let tooltip: string[] = [relativePath];
    let contextValue: string[] = [];

    if (item.inner.selection) {
      description.push(`line: ${item.inner.selection.fromLine + 1}`);
    }

    if (item.type === "entity") {
      let inner = item.inner as Entity;
      // Determine tree state
      treeItem.collapsibleState =
        inner.operations.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;
      // Compute description
      description.push(
        ...Object.entries(groupOperationTypes(inner.operations))
          .map(([type, ids]) => [type, ids.size])
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([type, count]) => `${type}: ${count}`)
      );
      description.push(`cda: ${computeCDA(item)}`);
      // Select icon
      treeItem.iconPath = new vscode.ThemeIcon("table");
      // Add context values
      contextValue.push("entity");
    } else if (item.type === "operation") {
      let inner = item.inner as Operation;

      // Determine tree state
      treeItem.collapsibleState =
        inner.arguments.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;
      // Compute description
      description.push(inner.type);
      // Select icon
      treeItem.iconPath = new vscode.ThemeIcon("symbol-method");
      // Add context value
      contextValue.push("operation");
    } else if (item.type === "argument") {
      // Determine tree state
      treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
      // Select icon
      treeItem.iconPath = new vscode.ThemeIcon("symbol-variable");
      // Add context value
      contextValue.push("argument");
    }

    if (item.inner.isCustom) {
      contextValue.push("custom");
    }

    if (item.inner.note) {
      description.push(`note: ${item.inner.note}`);
      tooltip.push(item.inner.note);
      contextValue.push("hasNote");
    }

    treeItem.description = description.join(" | ");
    treeItem.tooltip = tooltip.join("\n");
    treeItem.contextValue = contextValue.join(" ");

    if (item.inner.selection) {
      treeItem.command = {
        command: "clue.item.show",
        title: "Show",
        arguments: [
          new vscode.Location(
            vscode.Uri.joinPath(
              vscode.Uri.parse(this.rootPath),
              item.inner.selection.filePath
            ),
            new vscode.Range(
              item.inner.selection.fromLine,
              item.inner.selection.fromColumn,
              item.inner.selection.toLine,
              item.inner.selection.toColumn
            )
          ),
        ],
      };
    }

    return treeItem;
  }

  async getChildren(item?: ORMItem): Promise<ORMItem[]> {
    if (item) {
      if (item.type === "entity") {
        let inner = item.inner as Entity;
        return inner.operations
          .sort((a, b) => (a.type < b.type ? -1 : 1))
          .map((operation, index) => ({
            type: "operation",
            inner: operation,
            parent: item,
            idInParent: index,
            resultGroup: this.resultGroup,
          }));
      } else if (item.type === "operation") {
        let inner = item.inner as Operation;
        return inner.arguments
          .sort((a, b) => (a.name < b.name ? -1 : 1))
          .map((argument, index) => ({
            type: "argument",
            inner: argument,
            parent: item,
            idInParent: index,
            resultGroup: this.resultGroup,
          }));
      }
      return [];
    }

    var entities = AnalyzeResult.getInstance().getGroup(this.resultGroup);

    return Array.from(entities.values())
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .map((entity) => ({
        type: "entity",
        inner: entity,
        idInParent: -1,
        resultGroup: this.resultGroup,
      }));
  }

  private _onDidChangeTreeData: vscode.EventEmitter<
    ORMItem | undefined | null | void
  > = new vscode.EventEmitter<ORMItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    ORMItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  updateItem(item: ORMItem): void {
    this._onDidChangeTreeData.fire(item);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(null);
  }

  dropMimeTypes = ["application/vnd.code.tree.entity-operation"];
  dragMimeTypes = ["application/vnd.code.tree.entity-operation"];

  async handleDrag(
    items: ORMItem[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    const data: DragAndDropDataType = {
      resultGroup: this.resultGroup,
      items: items
        // Only allow operations to be dragged
        .filter((item) => item.type === "operation")
        .map((item) => ({
          name: item.inner.name,
          parentName: item.parent!.inner.name,
          idInParent: item.idInParent,
        })),
    };

    dataTransfer.set(
      "application/vnd.code.tree.entity-operation",
      new vscode.DataTransferItem(JSON.stringify(data))
    );
  }

  async handleDrop(
    target: ORMItem | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    let data = dataTransfer.get("application/vnd.code.tree.entity-operation");

    // Can only drop on entities
    if (!data || !target || target.type !== "entity") {
      return;
    }

    let parsed = JSON.parse(data.value) as DragAndDropDataType;
    if (parsed.items.length === 0) {
      return;
    }

    // Show confirmation dialog
    let items = parsed.items;
    let detail = items
      .map((item) => `${item.name} [${item.parentName}]`)
      .join("\n");
    let confirm = await vscode.window.showInformationMessage(
      `Move ${pluralize("operations", items.length, true)} to ${
        target.inner.name
      }?`,
      { modal: true, detail },
      "Move"
    );

    // Cancel if user didn't confirm
    if (confirm !== "Move") {
      return;
    }

    let analyzeResult = AnalyzeResult.getInstance();
    let srcGroup = analyzeResult.getGroup(parsed.resultGroup);
    let deletedItems: [number, Entity][] = [];
    let targetEntity = target.inner as Entity;
    for (const movedItem of items) {
      // Look up the source entity
      let srcEntity = srcGroup.get(movedItem.parentName);
      if (!srcEntity || srcEntity === target.inner) {
        continue;
      }
      // Get the operation
      let operation = srcEntity.operations[movedItem.idInParent];
      if (!operation) {
        continue;
      }
      // Push the operation to the target entity
      targetEntity.operations.push(operation);
      // Save the index and source entity for deletion later
      deletedItems.push([movedItem.idInParent, srcEntity]);
    }

    // Sort by index in descending order before deleting to avoid index shift
    for (const [index, entity] of deletedItems.sort(([a], [b]) => b - a)) {
      entity.operations.splice(index, 1);
    }

    await analyzeResult.saveToStorage(this.rootPath);
  }
}

import * as vscode from "vscode";
import {
  AnalyzeResult,
  AnalyzeResultGroup,
  Entity,
  Operation,
  groupOperationTypes,
  isEntity,
} from "../model";
import * as path from "path";
import * as pluralize from "pluralize";

export type EntityOperation = {
  inner: Entity | Operation;
  parent: Entity;
  idInParent: number;
  resultGroup: AnalyzeResultGroup;
};

type DragAndDropDataType = {
  resultGroup: AnalyzeResultGroup;
  items: { name: string; parentName: string; idInParent: number }[];
};

export class EntityOperationProvider
  implements
    vscode.TreeDataProvider<EntityOperation>,
    vscode.TreeDragAndDropController<EntityOperation>
{
  constructor(
    private rootPath: string,
    private resultGroup: AnalyzeResultGroup
  ) {}

  getTreeItem(element: EntityOperation): vscode.TreeItem {
    let inner = element.inner;
    let relativePath = inner.selection
      ? path.relative(this.rootPath, inner.selection.filePath)
      : "";
    let item = new vscode.TreeItem(inner.name);

    let description: string[] = [];
    let tooltip: string[] = [relativePath];
    let contextValue: string[] = [];

    if (inner.selection) {
      description.push(`line: ${inner.selection.fromLine}`);
    }

    if (isEntity(inner)) {
      item.collapsibleState =
        inner.operations.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;
      description.push(
        ...Object.entries(groupOperationTypes(inner.operations))
          .map(([type, ids]) => [type, ids.size])
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([type, count]) => `${type}: ${count}`)
      );
      item.iconPath = new vscode.ThemeIcon("table");
      if (inner.isCustom) {
        contextValue.push("customEntity");
      }
    } else {
      description.push(inner.type);
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.iconPath = new vscode.ThemeIcon("symbol-method");
    }

    if (inner.note) {
      description.push(`note: ${inner.note}`);
      tooltip.push(inner.note);
      contextValue.push("hasNote");
    }

    item.description = description.join(" | ");
    item.tooltip = tooltip.join("\n");
    item.contextValue = contextValue.join(" ");

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
          .map((operation, index) => ({
            inner: operation,
            parent: entity,
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
        inner: entity,
        parent: entity,
        idInParent: -1,
        resultGroup: this.resultGroup,
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

  dropMimeTypes = ["application/vnd.code.tree.entity-operation"];
  dragMimeTypes = ["application/vnd.code.tree.entity-operation"];

  async handleDrag(
    items: EntityOperation[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    const data: DragAndDropDataType = {
      resultGroup: this.resultGroup,
      items: items
        .filter((item) => !isEntity(item.inner))
        .map((item) => ({
          name: item.inner.name,
          parentName: item.parent.name,
          idInParent: item.idInParent,
        })),
    };

    dataTransfer.set(
      "application/vnd.code.tree.entity-operation",
      new vscode.DataTransferItem(JSON.stringify(data))
    );
  }

  async handleDrop(
    target: EntityOperation | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    let data = dataTransfer.get("application/vnd.code.tree.entity-operation");
    if (!data || !target || !isEntity(target.inner)) {
      return;
    }

    let parsed = JSON.parse(data.value) as DragAndDropDataType;
    if (parsed.items.length === 0) {
      return;
    }

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

    if (confirm !== "Move") {
      return;
    }

    let analyzeResult = AnalyzeResult.getInstance();
    let srcGroup = analyzeResult.getGroup(parsed.resultGroup);
    let deletedItems: [number, Entity][] = [];
    for (const movedItem of items) {
      let srcEntity = srcGroup.get(movedItem.parentName);
      if (!srcEntity || srcEntity === target.inner) {
        continue;
      }
      let operation = srcEntity.operations[movedItem.idInParent];
      if (!operation) {
        continue;
      }
      target.inner.operations.push(operation);
      deletedItems.push([movedItem.idInParent, srcEntity]);
    }

    // Sort by index in descending order before deleting to avoid index shift
    for (const [index, entity] of deletedItems.sort(([a], [b]) => b - a)) {
      entity.operations.splice(index, 1);
    }

    await analyzeResult.saveToStorage(this.rootPath);
  }
}

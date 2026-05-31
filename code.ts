/// <reference types="@figma/plugin-typings" />

interface VariantValue {
  value: string;
  newValue: string;
}

interface VariantProperty {
  name: string;
  newName: string;
  propertyKey: string; // Figma内部キー（#付きの場合もある）
  propertyType: "VARIANT" | "BOOLEAN" | "TEXT" | "INSTANCE_SWAP";
  variantOptions?: VariantValue[]; // VARIANTタイプの選択肢
  defaultValue?: string | boolean; // BOOLEAN, TEXTタイプのデフォルト値
}

interface ComponentInfo {
  id: string;
  name: string;
  newName: string;
  type: string;
  variantProperties?: VariantProperty[];
}

// キャメルケースか判定する関数
function isCamelCase(str: string): boolean {
  return /^[a-z][a-zA-Z0-9]*$/.test(str);
}

// パスカルケースか判定する関数
function isPascalCase(str: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(str);
}

// キャメルケースに変換する関数
function toCamelCase(str: string): string {
  // 既にキャメルケースの場合はそのまま返す
  if (isCamelCase(str)) {
    return str;
  }

  // スペース、ハイフン、アンダースコアで分割
  const words = str.split(/[\s-_]+/);
  if (words.length === 0) return str;

  // 最初の単語は小文字、残りは先頭大文字
  return (
    words[0].toLowerCase() +
    words
      .slice(1)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join("")
  );
}

// パスカルケースに変換する関数
function toPascalCase(str: string): string {
  // 既にパスカルケースの場合はそのまま返す
  if (isPascalCase(str)) {
    return str;
  }

  // スペース、ハイフン、アンダースコアで分割
  const words = str.split(/[\s-_]+/);
  if (words.length === 0) return str;

  // すべての単語の先頭を大文字に
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

// ページ内のコンポーネントセットを取得する関数
function getComponents(): ComponentInfo[] {
  const components: ComponentInfo[] = [];

  // currentPage内のすべてのノードを検索（コンポーネントセットのみ）
  const nodes = figma.currentPage.findAll((node) => {
    return node.type === "COMPONENT_SET";
  });

  nodes.forEach((node) => {
    const componentSet = node as ComponentSetNode;

    const componentInfo: ComponentInfo = {
      id: componentSet.id,
      name: componentSet.name,
      newName: toPascalCase(componentSet.name),
      type: componentSet.type,
    };

    // バリアントプロパティの定義を取得（すべてのタイプを含む）
    const variantProperties: VariantProperty[] = [];
    const propertyDefs = componentSet.componentPropertyDefinitions;

    for (const [propKey, propDef] of Object.entries(propertyDefs)) {
      // プロパティの表示名を取得
      // TEXT、BOOLEAN、INSTANCE_SWAPタイプは "プロパティ名#ID" 形式なので、#の前を抽出
      let propName = propKey;
      if (propKey.includes("#")) {
        propName = propKey.split("#")[0];
      }

      let variantOptions: VariantValue[] | undefined = undefined;
      let defaultValue: string | boolean | undefined = undefined;

      if (propDef.type === "VARIANT") {
        // VARIANTタイプ: 複数の選択肢を持つ
        variantOptions = (propDef.variantOptions || []).map((value) => ({
          value: value,
          newValue: toCamelCase(value),
        }));
      } else if (propDef.type === "BOOLEAN") {
        // BOOLEANタイプ: True/Falseのデフォルト値
        defaultValue = propDef.defaultValue || false;
      } else if (propDef.type === "TEXT") {
        // TEXTタイプ: デフォルト値
        defaultValue = propDef.defaultValue || "";
      } else if (propDef.type === "INSTANCE_SWAP") {
        // INSTANCE_SWAPタイプ: 値は設定しない（プロパティ名のみ）
      }

      variantProperties.push({
        name: propName,
        newName: toCamelCase(propName),
        propertyKey: propKey, // 内部キーを保持
        propertyType: propDef.type as
          | "VARIANT"
          | "BOOLEAN"
          | "TEXT"
          | "INSTANCE_SWAP", // プロパティタイプを保持
        variantOptions: variantOptions,
        defaultValue: defaultValue,
      });
    }

    componentInfo.variantProperties = variantProperties;

    components.push(componentInfo);
  });

  return components;
}

// 初期化処理を非同期で実行
async function initialize() {
  // documentchangeイベントを使用する前に全ページをロード
  await figma.loadAllPagesAsync();

  // UIを表示（postMessageを使う前に必要）
  figma.showUI(__html__, { width: 500, height: 600 });

  // プラグイン起動時にコンポーネント一覧を送信
  const componentList = getComponents();
  figma.ui.postMessage({
    type: "component-list",
    components: componentList,
  });

  // ページ内の変更を監視
  figma.on("documentchange", (event) => {
    // コンポーネントセットに関連する変更があったか確認
    let hasRelevantChange = false;

    for (const change of event.documentChanges) {
      // ノードの作成、削除を検知
      if (change.type === "CREATE" || change.type === "DELETE") {
        if (change.node && change.node.type === "COMPONENT_SET") {
          hasRelevantChange = true;
          break;
        }
      }
      // プロパティの変更を検知
      else if (change.type === "PROPERTY_CHANGE") {
        // コンポーネントセットまたはその子コンポーネントの変更を検知
        if (change.node) {
          if (change.node.type === "COMPONENT_SET") {
            hasRelevantChange = true;
            break;
          }
          // 子コンポーネント（COMPONENT）の変更も検知
          // RemovedNodeにはparentプロパティがないため、型ガードを追加
          if (
            change.node.type === "COMPONENT" &&
            "parent" in change.node &&
            change.node.parent &&
            change.node.parent.type === "COMPONENT_SET"
          ) {
            hasRelevantChange = true;
            break;
          }
        }
      }
    }

    // 関連する変更があった場合、コンポーネント一覧を更新
    if (hasRelevantChange) {
      const componentList = getComponents();
      figma.ui.postMessage({
        type: "component-list",
        components: componentList,
      });
    }
  });
}

// 初期化を実行
initialize();

// コンポーネントセット名を変更する関数
function renameComponentSetName(
  componentSet: ComponentSetNode,
  newName: string,
): void {
  componentSet.name = newName;
}

// プロパティ名を変更する関数（VARIANTタイプのみ対応）
function renamePropertyName(
  componentSet: ComponentSetNode,
  propertyKey: string,
  oldName: string,
  newName: string,
): boolean {
  // プロパティ定義を取得
  const propertyDef = componentSet.componentPropertyDefinitions[propertyKey];

  if (propertyDef && propertyDef.type === "VARIANT") {
    // VARIANTタイプ: 子コンポーネントの名前を変更
    componentSet.children.forEach((child) => {
      if (child.type === "COMPONENT") {
        const component = child;
        // "Prop1=Val1, Prop2=Val2" 形式の名前を解析して変更
        const nameParts = component.name.split(",").map((s) => s.trim());
        const newNameParts = nameParts.map((part) => {
          const [key, value] = part.split("=").map((s) => s.trim());
          if (key === oldName) {
            return `${newName}=${value}`;
          }
          return part;
        });
        component.name = newNameParts.join(", ");
      }
    });
    return true;
  }
  // BOOLEAN, TEXT, INSTANCE_SWAPタイプのプロパティ名変更はFigmaの内部実装上、安全に実行できません
  return false;
}

// プロパティ値を変更する関数（VARIANTタイプのみ対応）
function renamePropertyValue(
  componentSet: ComponentSetNode,
  propertyName: string,
  oldValue: string,
  newValue: string,
): void {
  // 該当する子コンポーネントの名前を変更
  componentSet.children.forEach((child) => {
    if (child.type === "COMPONENT") {
      const component = child;
      // "Prop1=Val1, Prop2=Val2" 形式の名前を解析して変更
      const nameParts = component.name.split(",").map((s) => s.trim());
      const newNameParts = nameParts.map((part) => {
        const [key, value] = part.split("=").map((s) => s.trim());
        if (key === propertyName && value === oldValue) {
          return `${key}=${newValue}`;
        }
        return part;
      });
      component.name = newNameParts.join(", ");
    }
  });
}

// UIからのメッセージを処理
figma.ui.onmessage = async (msg) => {
  if (msg.type === "refresh") {
    // コンポーネント一覧を再取得して送信
    const componentList = getComponents();
    figma.ui.postMessage({
      type: "component-list",
      components: componentList,
    });
  } else if (msg.type === "select-component") {
    // コンポーネントを選択
    const node = await figma.getNodeByIdAsync(msg.id);
    if (node) {
      figma.currentPage.selection = [node as SceneNode];
      figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
    }
  } else if (msg.type === "rename-component-set") {
    // コンポーネントセット名を変更
    const node = await figma.getNodeByIdAsync(msg.id);
    if (node && node.type === "COMPONENT_SET") {
      renameComponentSetName(node, msg.newName);
      // 更新されたコンポーネント一覧を送信
      const componentList = getComponents();
      figma.ui.postMessage({
        type: "component-list",
        components: componentList,
      });
    }
  } else if (msg.type === "rename-property") {
    // バリアントプロパティ名を変更（VARIANTタイプのみ対応）
    const node = await figma.getNodeByIdAsync(msg.componentSetId);
    if (node && node.type === "COMPONENT_SET") {
      renamePropertyName(node, msg.propertyKey, msg.oldName, msg.newName);
      // 更新されたコンポーネント一覧を送信
      const componentList = getComponents();
      figma.ui.postMessage({
        type: "component-list",
        components: componentList,
      });
    }
  } else if (msg.type === "rename-property-value") {
    // バリアントプロパティの値を変更
    const node = await figma.getNodeByIdAsync(msg.componentSetId);
    if (node && node.type === "COMPONENT_SET") {
      renamePropertyValue(node, msg.propertyName, msg.oldValue, msg.newValue);
      // 更新されたコンポーネント一覧を送信
      const componentList = getComponents();
      figma.ui.postMessage({
        type: "component-list",
        components: componentList,
      });
    }
  } else if (msg.type === "rename-all") {
    // 一括リネーム - 個別処理関数を使用
    const componentSets = new Map<string, any[]>();

    // アイテムをコンポーネントセットごとにグループ化
    msg.renameItems.forEach((item: any) => {
      if (!componentSets.has(item.componentSetId)) {
        componentSets.set(item.componentSetId, []);
      }
      componentSets.get(item.componentSetId)!.push(item);
    });

    // 各コンポーネントセットを処理
    for (const [componentSetId, items] of componentSets) {
      const node = await figma.getNodeByIdAsync(componentSetId);
      if (!node || node.type !== "COMPONENT_SET") continue;

      const componentSet = node;

      // 変更内容をマップに整理（プロパティ名と値の変更を同時に適用するため）
      const valueChanges = new Map<string, Map<string, string>>(); // propertyName -> oldValue -> newValue
      const propertyNameChanges = new Map<string, string>(); // oldName -> newName
      let newComponentSetName: string | null = null;

      items.forEach((item: any) => {
        if (item.type === "component-set") {
          newComponentSetName = item.newName;
        } else if (item.type === "property") {
          propertyNameChanges.set(item.oldName, item.newName);
        } else if (item.type === "value") {
          if (!valueChanges.has(item.propertyName)) {
            valueChanges.set(item.propertyName, new Map());
          }
          valueChanges
            .get(item.propertyName)!
            .set(item.oldValue, item.newValue);
        }
      });

      // コンポーネントセット名を変更
      if (newComponentSetName) {
        renameComponentSetName(componentSet, newComponentSetName);
      }

      // VARIANTタイプのプロパティ：子コンポーネントの名前を一度に変更
      // （プロパティ名と値の変更を同時に適用）
      componentSet.children.forEach((child) => {
        if (child.type === "COMPONENT") {
          const component = child;
          const nameParts = component.name.split(",").map((s) => s.trim());

          // すべての変更を一度に適用
          const newNameParts = nameParts.map((part) => {
            const [key, value] = part.split("=").map((s) => s.trim());

            // 1. 値を変更（元のプロパティ名を使用）
            let newValue = value;
            if (valueChanges.has(key) && valueChanges.get(key)!.has(value)) {
              newValue = valueChanges.get(key)!.get(value)!;
            }

            // 2. プロパティ名を変更
            let newKey = key;
            if (propertyNameChanges.has(key)) {
              newKey = propertyNameChanges.get(key)!;
            }

            return `${newKey}=${newValue}`;
          });

          component.name = newNameParts.join(", ");
        }
      });
    }

    // 更新されたコンポーネント一覧を送信
    const componentList = getComponents();
    figma.ui.postMessage({
      type: "component-list",
      components: componentList,
    });
  } else if (msg.type === "close") {
    figma.closePlugin();
  }
};

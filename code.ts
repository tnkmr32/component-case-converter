/// <reference types="@figma/plugin-typings" />

interface VariantValue {
  value: string;
  newValue: string;
}

interface VariantProperty {
  name: string;
  newName: string;
  values: VariantValue[];
}

interface VariantInfo {
  id: string;
  name: string;
  properties: Record<string, string>;
}

interface ComponentInfo {
  id: string;
  name: string;
  newName: string;
  type: string;
  variantProperties?: VariantProperty[];
  variants?: VariantInfo[];
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

    // バリアントプロパティの定義を取得
    const variantProperties: VariantProperty[] = [];
    const propertyDefs = componentSet.componentPropertyDefinitions;

    for (const [propName, propDef] of Object.entries(propertyDefs)) {
      if (propDef.type === "VARIANT") {
        const values: VariantValue[] = (propDef.variantOptions || []).map(
          (value) => ({
            value: value,
            newValue: toCamelCase(value),
          }),
        );

        variantProperties.push({
          name: propName,
          newName: toCamelCase(propName),
          values: values,
        });
      }
    }

    componentInfo.variantProperties = variantProperties;

    // 各バリアント（子コンポーネント）の情報を取得
    const variants: VariantInfo[] = [];
    componentSet.children.forEach((child) => {
      if (child.type === "COMPONENT") {
        const component = child as ComponentNode;

        // バリアントの名前からプロパティを解析
        // 名前の形式: "Property1=Value1, Property2=Value2"
        const properties: Record<string, string> = {};
        const nameParts = component.name.split(",").map((s) => s.trim());

        nameParts.forEach((part) => {
          const [key, value] = part.split("=").map((s) => s.trim());
          if (key && value) {
            properties[key] = value;
          }
        });

        variants.push({
          id: component.id,
          name: component.name,
          properties,
        });
      }
    });

    componentInfo.variants = variants;

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
      node.name = msg.newName;
      // 更新されたコンポーネント一覧を送信
      const componentList = getComponents();
      figma.ui.postMessage({
        type: "component-list",
        components: componentList,
      });
    }
  } else if (msg.type === "rename-property") {
    // バリアントプロパティ名を変更
    const node = await figma.getNodeByIdAsync(msg.componentSetId);
    if (node && node.type === "COMPONENT_SET") {
      const componentSet = node as ComponentSetNode;

      // すべての子コンポーネントの名前を変更
      componentSet.children.forEach((child) => {
        if (child.type === "COMPONENT") {
          const component = child as ComponentNode;
          // "Prop1=Val1, Prop2=Val2" 形式の名前を解析して変更
          const nameParts = component.name.split(",").map((s) => s.trim());
          const newNameParts = nameParts.map((part) => {
            const [key, value] = part.split("=").map((s) => s.trim());
            if (key === msg.oldName) {
              return `${msg.newName}=${value}`;
            }
            return part;
          });
          component.name = newNameParts.join(", ");
        }
      });

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
      const componentSet = node as ComponentSetNode;

      // 該当する子コンポーネントの名前を変更
      componentSet.children.forEach((child) => {
        if (child.type === "COMPONENT") {
          const component = child as ComponentNode;
          // "Prop1=Val1, Prop2=Val2" 形式の名前を解析して変更
          const nameParts = component.name.split(",").map((s) => s.trim());
          const newNameParts = nameParts.map((part) => {
            const [key, value] = part.split("=").map((s) => s.trim());
            if (key === msg.propertyName && value === msg.oldValue) {
              return `${key}=${msg.newValue}`;
            }
            return part;
          });
          component.name = newNameParts.join(", ");
        }
      });

      // 更新されたコンポーネント一覧を送信
      const componentList = getComponents();
      figma.ui.postMessage({
        type: "component-list",
        components: componentList,
      });
    }
  } else if (msg.type === "rename-all") {
    // 一括リネーム - コンポーネントセットごとにグループ化して処理
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

      const componentSet = node as ComponentSetNode;

      // 変更内容をマップに整理
      const valueChanges = new Map<string, Map<string, string>>(); // propertyName -> oldValue -> newValue
      const propertyNameChanges = new Map<string, string>(); // oldName -> newName
      let newComponentSetName: string | null = null;

      items.forEach((item: any) => {
        if (item.type === "value") {
          if (!valueChanges.has(item.propertyName)) {
            valueChanges.set(item.propertyName, new Map());
          }
          valueChanges
            .get(item.propertyName)!
            .set(item.oldValue, item.newValue);
        } else if (item.type === "property") {
          propertyNameChanges.set(item.oldName, item.newName);
        } else if (item.type === "component-set") {
          newComponentSetName = item.newName;
        }
      });

      // 各子コンポーネントの名前を一度に変更
      componentSet.children.forEach((child) => {
        if (child.type === "COMPONENT") {
          const component = child as ComponentNode;
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

      // コンポーネントセット名を変更
      if (newComponentSetName) {
        componentSet.name = newComponentSetName;
      }
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

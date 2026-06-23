// code.ts — Skeleton Generator (Ghost Frames principle)
//
// Конвертирует ЛЮБОЙ выделенный Frame/Instance/Group в Skeleton Loading State
// 1:1 по структуре. Без компонентов, переменных и зависимостей от ДС.
//
// РОЛИ-ЦВЕТА:
//   Surface  #1F1F1F — крупные объекты: карточки, контейнеры, кнопки (заливка)
//   Content  #292929 — внутренние элементы: текст, иконки, аватары, детали
//   Stroke   #333333 — обводки инпутов, кнопок, границ контейнеров
//
// ГЕОМЕТРИЯ:
//   Высоты блоков/карточек и расстояния между элементами сохраняются 1:1.
//   Абстрагируются по форме только TEXT и ICON.
//
// TEXT (#292929, cornerRadius=16, ширина = fill относительно родителя):
//   Large  (Accent-1/2/3, Heading-1/2):      Desktop h=16 / Mobile h=12
//   Small  (Accent-4, Heading-3/4, Body-1…):  Desktop h=12 / Mobile h=8
//   Paragraph (Body-2, Label-1/2, Button-*):
//     1 строка → как Small
//     2 строки → [100% Small] + gap + [58% Small]
//     3+ строк → [100%] + gap + [100%] + gap + [58%×58% ≈ 33.64%]
//     gap: Desktop=4 / Mobile=2
//
// ICON (#292929, cornerRadius=999 → круг): размер снапится к компонентным
//   значениям 32/24/20/16/12, центрируется в исходном footprint.

figma.showUI(__html__, { width: 320, height: 460 });

// ============================================================
// HELPERS
// ============================================================

function hex(h: string): RGB {
  const v = parseInt(h.replace("#", ""), 16);
  return {
    r: ((v >> 16) & 255) / 255,
    g: ((v >> 8) & 255) / 255,
    b: (v & 255) / 255,
  };
}

const C_SURFACE = hex("#1F1F1F");
const C_CONTENT = hex("#292929");
const C_STROKE  = hex("#333333");

type Platform = "Desktop" | "Mobile";
type TextKind = "Large" | "Small" | "Paragraph";

const ICON_SIZES = [12, 16, 20, 24, 32];
const ICON_SCALE_MAX = 32;

function hasVisibleFill(node: SceneNode): boolean {
  if (!("fills" in node) || !Array.isArray(node.fills)) return false;
  return (node.fills as Paint[]).some((f) => f.visible !== false && f.type !== "IMAGE");
}

function hasStroke(node: SceneNode): boolean {
  return "strokes" in node &&
    Array.isArray((node as GeometryMixin).strokes) &&
    (node as GeometryMixin).strokes.length > 0;
}

// Stroke #333333, толщина сохраняется из исходника (иначе 1px).
function applyStroke(target: FrameNode | RectangleNode, source: SceneNode) {
  target.strokes = [{ type: "SOLID", color: C_STROKE }];
  const w = "strokeWeight" in source && typeof source.strokeWeight === "number"
    ? source.strokeWeight
    : 1;
  target.strokeWeight = w > 0 ? w : 1;
}

function snapIconSize(actual: number): number {
  let best = ICON_SIZES[0];
  let bestDiff = Math.abs(actual - best);
  for (const s of ICON_SIZES) {
    const d = Math.abs(actual - s);
    if (d < bestDiff) { bestDiff = d; best = s; }
  }
  return best;
}

// ============================================================
// PLATFORM
// ============================================================

function detectPlatform(rootWidth: number): Platform {
  return rootWidth <= 480 ? "Mobile" : "Desktop";
}

// ============================================================
// ICON — круг стандартного размера, центрированный в footprint исходника
// ============================================================

function buildIconCircle(srcW: number, srcH: number): SceneNode {
  const w = Math.max(srcW, 0.01);
  const h = Math.max(srcH, 0.01);
  const size = snapIconSize(Math.max(w, h));

  const circle = figma.createRectangle();
  circle.name = "Skeleton/Content/Icon";
  circle.resize(size, size);
  circle.cornerRadius = 999;
  circle.fills = [{ type: "SOLID", color: C_CONTENT }];

  // Если снапнутый размер совпал с исходным — обёртка не нужна.
  if (Math.abs(size - w) < 0.5 && Math.abs(size - h) < 0.5) {
    return circle;
  }

  // Иначе оборачиваем в прозрачный фрейм размером с исходник,
  // чтобы сохранить footprint (расстояния между элементами) и центрировать круг.
  const frame = figma.createFrame();
  frame.name = "Skeleton/Content/Icon";
  frame.resize(w, h);
  frame.fills = [];
  frame.clipsContent = false;
  frame.appendChild(circle);
  circle.x = (w - size) / 2;
  circle.y = (h - size) / 2;
  return frame;
}

// Контейнер иконочного масштаба (≤32, без собственного фона, без текста
// внутри) — это иконка-инстанс/группа: сворачиваем в один круг, не рекурсим.
function isIconScaleContainer(node: SceneNode): boolean {
  if (!("children" in node) || (node as ChildrenMixin).children.length === 0) return false;
  if (Math.max(node.width, node.height) > ICON_SCALE_MAX) return false;
  if (hasVisibleFill(node)) return false; // есть фон → это чип/кнопка, не голая иконка
  const texts = (node as ChildrenMixin).findAll((n) => n.type === "TEXT");
  return texts.length === 0;
}

// ============================================================
// TEXT
// ============================================================

const LARGE_KEYWORDS     = ["Accent-1", "Accent-2", "Accent-3", "Heading-1", "Heading-2"];
const SMALL_KEYWORDS     = ["Accent-4", "Heading-3", "Heading-4", "Body-1 Bold", "Body-1"];
const PARAGRAPH_KEYWORDS = ["Body-2", "Label-1", "Label-2", "Button-L", "Button-M", "Button-S"];

function classifyByStyleName(name: string): TextKind | null {
  if (LARGE_KEYWORDS.some((k) => name.includes(k)))     return "Large";
  if (SMALL_KEYWORDS.some((k) => name.includes(k)))     return "Small";
  if (PARAGRAPH_KEYWORDS.some((k) => name.includes(k))) return "Paragraph";
  return null;
}

async function getTextKind(node: TextNode): Promise<TextKind> {
  const styleId = node.textStyleId;
  if (typeof styleId === "string" && styleId) {
    const style = await figma.getStyleByIdAsync(styleId);
    if (style) {
      const kind = classifyByStyleName(style.name);
      if (kind) return kind;
    }
  }
  const fontSize = typeof node.fontSize === "number" ? node.fontSize : 14;
  return fontSize >= 20 ? "Large" : "Small";
}

function smallBarH(platform: Platform): number {
  return platform === "Desktop" ? 12 : 8;
}
function largeBarH(platform: Platform): number {
  return platform === "Desktop" ? 16 : 12;
}
function barGap(platform: Platform): number {
  return platform === "Desktop" ? 4 : 2;
}

function countLines(node: TextNode): number {
  const fontSize = typeof node.fontSize === "number" ? node.fontSize : 14;
  let lhPx = fontSize * 1.3;
  const lh = node.lineHeight as LineHeight;
  if (typeof lh === "object" && "unit" in lh) {
    if (lh.unit === "PIXELS") lhPx = lh.value;
    else if (lh.unit === "PERCENT") lhPx = fontSize * (lh.value / 100);
  }
  return Math.max(1, Math.round(node.height / lhPx));
}

async function buildText(node: TextNode, platform: Platform): Promise<SceneNode> {
  const kind = await getTextKind(node);
  const w = Math.max(node.width, 0.01);
  const fill: SolidPaint = { type: "SOLID", color: C_CONTENT };

  // Large / Small — одна полоса
  if (kind === "Large" || kind === "Small") {
    const bh = kind === "Large" ? largeBarH(platform) : smallBarH(platform);
    const rect = figma.createRectangle();
    rect.name = `Skeleton/Content/Text-${kind}`;
    rect.resize(w, bh);
    rect.cornerRadius = 16;
    rect.fills = [fill];
    return rect;
  }

  // Paragraph — по числу строк
  const lines = countLines(node);
  const bh = smallBarH(platform);
  const gap = barGap(platform);

  if (lines <= 1) {
    const rect = figma.createRectangle();
    rect.name = "Skeleton/Content/Text-Paragraph-1L";
    rect.resize(w, bh);
    rect.cornerRadius = 16;
    rect.fills = [fill];
    return rect;
  }

  const barCount = Math.min(lines, 3);
  const totalH = barCount * bh + (barCount - 1) * gap;

  const frame = figma.createFrame();
  frame.name = `Skeleton/Content/Text-Paragraph-${barCount}L`;
  frame.resize(w, Math.max(totalH, 0.01));
  frame.fills = [];
  frame.clipsContent = false;

  for (let i = 0; i < barCount; i++) {
    const bar = figma.createRectangle();
    bar.name = "Skeleton/Content/Line";
    let barW: number;
    if (barCount === 2) {
      barW = i === 1 ? w * 0.58 : w;
    } else {
      barW = i === 2 ? w * 0.58 * 0.58 : w;
    }
    bar.resize(Math.max(barW, 0.01), bh);
    bar.cornerRadius = 16;
    bar.fills = [fill];
    frame.appendChild(bar);
    bar.x = 0;
    bar.y = i * (bh + gap);
  }
  return frame;
}

// ============================================================
// BUILDER — листовой узел
// ============================================================

async function buildLeaf(node: SceneNode, platform: Platform): Promise<SceneNode> {
  if (node.type === "TEXT") {
    return buildText(node as TextNode, platform);
  }

  const w = Math.max(node.width, 0.01);
  const h = Math.max(node.height, 0.01);

  // VECTOR/STAR/LINE → иконка-круг (снап к стандартному размеру)
  if (node.type === "VECTOR" || node.type === "STAR" || node.type === "LINE") {
    return buildIconCircle(node.width, node.height);
  }

  // ELLIPSE → крупный = аватар (точный размер), мелкий = иконка (снап)
  if (node.type === "ELLIPSE") {
    if (Math.max(w, h) > ICON_SCALE_MAX) {
      const rect = figma.createRectangle();
      rect.name = "Skeleton/Content/Avatar";
      rect.resize(w, h);
      rect.cornerRadius = 999;
      rect.fills = [{ type: "SOLID", color: C_CONTENT }];
      return rect;
    }
    return buildIconCircle(node.width, node.height);
  }

  // RECTANGLE / прочий лист — размер 1:1.
  // Surface (1F1F1F) если у исходника есть видимая заливка (это карточка/кнопка/инпут как лист).
  // Content (292929) если заливки нет (разделитель, линия, мелкая деталь).
  const rect = figma.createRectangle();
  rect.resize(w, h);
  const isSurface = hasVisibleFill(node);
  rect.name = isSurface ? "Skeleton/Surface" : "Skeleton/Content/Detail";
  rect.fills = [{ type: "SOLID", color: isSurface ? C_SURFACE : C_CONTENT }];
  if ("cornerRadius" in node && typeof node.cornerRadius === "number") {
    rect.cornerRadius = node.cornerRadius;
  }
  if (hasStroke(node)) applyStroke(rect, node);
  return rect;
}

// ============================================================
// RECURSION — Ghost Frames
// ============================================================

async function build(node: SceneNode, platform: Platform): Promise<SceneNode> {
  // Иконка-контейнер → один круг (footprint сохраняется)
  if (isIconScaleContainer(node)) {
    return buildIconCircle(node.width, node.height);
  }

  if (!("children" in node) || (node as FrameNode).children.length === 0) {
    return buildLeaf(node, platform);
  }

  const src = node as FrameNode | InstanceNode | GroupNode;

  // Контейнер → Frame того же размера. Кнопка/карточка = контейнер с фоном
  // → заливка Surface. Чистые layout-обёртки остаются прозрачными.
  const frame = figma.createFrame();
  frame.resize(Math.max(src.width, 0.01), Math.max(src.height, 0.01));

  if (hasVisibleFill(node)) {
    frame.fills = [{ type: "SOLID", color: C_SURFACE }];
    frame.name = "Skeleton/Surface/Container";
  } else {
    frame.fills = [];
    frame.name = "Skeleton/Container";
  }

  if ("cornerRadius" in src && typeof src.cornerRadius === "number") {
    frame.cornerRadius = src.cornerRadius;
  }
  if (hasStroke(node)) applyStroke(frame, node);
  frame.clipsContent = "clipsContent" in src ? src.clipsContent : true;

  for (const child of src.children) {
    const built = await build(child, platform);
    frame.appendChild(built);
    // child.x/.y уже относительны родителю — копируем (расстояния 1:1).
    built.x = child.x;
    built.y = child.y;
  }

  return frame;
}

// ============================================================
// ENTRY POINT
// ============================================================

figma.ui.onmessage = async (msg) => {
  if (msg.type !== "generate") return;

  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    figma.notify("Выдели Frame/Instance/Group для конвертации в Skeleton");
    return;
  }

  const placed: SceneNode[] = [];

  for (const source of selection) {
    const platform = detectPlatform(source.width);
    const root = await build(source, platform);
    figma.currentPage.appendChild(root);
    const box = source.absoluteBoundingBox;
    if (box) {
      root.x = box.x + box.width + 80;
      root.y = box.y;
    } else {
      root.x = source.x + source.width + 80;
      root.y = source.y;
    }
    placed.push(root);
  }

  figma.currentPage.selection = placed;
  figma.viewport.scrollAndZoomIntoView(placed);
  figma.notify(`Skeleton создан: ${placed.length} объект(ов)`);
};

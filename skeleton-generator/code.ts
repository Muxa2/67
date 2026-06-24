// code.ts — Skeleton Generator (Ghost Frames principle)
//
// Конвертирует ЛЮБОЙ выделенный Frame/Instance/Group в Skeleton Loading State.
// Без компонентов, переменных и зависимостей от дизайн-системы.
//
// ЛОГИКА:
//   Контейнеры (Frame/Instance/Group с дочерними элементами):
//     — сохраняют оригинальный фон (background primary, secondary и т.д.)
//     — IMAGE-заливки заменяются на Content #292929
//   Листья:
//     — TEXT          → серые полосы #292929 по спецификации
//     — VECTOR/ICON   → круг #292929 (снап к 12/16/20/24/32)
//     — ELLIPSE крупная → аватар-круг #292929
//     — RECTANGLE/прочие → оригинальный фон; IMAGE → #292929
//   Скрытые слои (visible=false) → пропускаются полностью.
//   Все размеры и отступы сохраняются 1:1 с исходным макетом.
//
// TEXT (#292929, cornerRadius=16):
//   Large  (Accent-1/2/3, Heading-1/2):       Desktop h=16 / Mobile h=12
//   Small  (Accent-4, Heading-3/4, Body-1…):   Desktop h=12 / Mobile h=8
//   Paragraph (Body-2, Label-1/2, Button-*):
//     1 строка → как Small
//     2 строки → [100%] + gap + [58%]
//     3+ строк  → [100%] + gap + [100%] + gap + [~34%]
//     gap: Desktop=4 / Mobile=2
//
// ICON (#292929, cornerRadius=999): снап к 12/16/20/24/32, центр в footprint исходника.
// STROKE: #333333, толщина из исходника.

figma.showUI(__html__, { width: 320, height: 460 });

// ============================================================
// HELPERS
// ============================================================

function hex(h: string): RGB {
  const v = parseInt(h.replace("#", ""), 16);
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}

const C_CONTENT = hex("#292929");
const C_STROKE  = hex("#333333");

type Platform = "Desktop" | "Mobile";
type TextKind  = "Large" | "Small" | "Paragraph";

const ICON_SIZES     = [12, 16, 20, 24, 32];
const ICON_SCALE_MAX = 32;

function hasVisibleFill(node: SceneNode): boolean {
  if (!("fills" in node) || !Array.isArray(node.fills)) return false;
  return (node.fills as Paint[]).some((f) => f.visible !== false);
}

function hasStroke(node: SceneNode): boolean {
  return (
    "strokes" in node &&
    Array.isArray((node as GeometryMixin).strokes) &&
    (node as GeometryMixin).strokes.length > 0
  );
}

function applyStroke(target: FrameNode | RectangleNode, source: SceneNode) {
  target.strokes = [{ type: "SOLID", color: C_STROKE }];
  const w =
    "strokeWeight" in source && typeof source.strokeWeight === "number"
      ? source.strokeWeight
      : 1;
  target.strokeWeight = w > 0 ? w : 1;
}

// Копирует заливки из исходника: IMAGE-заливки → Content #292929 (картинки не копируем).
function copyFills(node: SceneNode): Paint[] {
  if (!("fills" in node) || !Array.isArray(node.fills)) return [];
  return (node.fills as Paint[])
    .filter((f) => f.visible !== false)
    .map((f): Paint =>
      f.type === "IMAGE" ? { type: "SOLID", color: C_CONTENT } : f,
    );
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
// ICON
// ============================================================

function buildIconCircle(srcW: number, srcH: number): SceneNode {
  const w    = Math.max(srcW, 0.01);
  const h    = Math.max(srcH, 0.01);
  const size = snapIconSize(Math.max(w, h));

  const circle = figma.createRectangle();
  circle.name         = "Skeleton/Content/Icon";
  circle.resize(size, size);
  circle.cornerRadius = 999;
  circle.fills        = [{ type: "SOLID", color: C_CONTENT }];

  if (Math.abs(size - w) < 0.5 && Math.abs(size - h) < 0.5) return circle;

  const frame = figma.createFrame();
  frame.name         = "Skeleton/Content/Icon";
  frame.resize(w, h);
  frame.fills        = [];
  frame.clipsContent = false;
  frame.appendChild(circle);
  circle.x = (w - size) / 2;
  circle.y = (h - size) / 2;
  return frame;
}

function isIconScaleContainer(node: SceneNode): boolean {
  if (!("children" in node) || (node as ChildrenMixin).children.length === 0) return false;
  if (Math.max(node.width, node.height) > ICON_SCALE_MAX) return false;
  if (hasVisibleFill(node)) return false;
  return (node as ChildrenMixin).findAll((n) => n.type === "TEXT").length === 0;
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

function smallBarH(p: Platform): number { return p === "Desktop" ? 12 : 8; }
function largeBarH(p: Platform): number { return p === "Desktop" ? 16 : 12; }
function barGap(p: Platform):    number { return p === "Desktop" ? 4  : 2;  }

function countLines(node: TextNode): number {
  const fontSize = typeof node.fontSize === "number" ? node.fontSize : 14;
  let lhPx = fontSize * 1.3;
  const lh = node.lineHeight as LineHeight;
  if (typeof lh === "object" && "unit" in lh) {
    if (lh.unit === "PIXELS")       lhPx = lh.value;
    else if (lh.unit === "PERCENT") lhPx = fontSize * (lh.value / 100);
  }
  return Math.max(1, Math.round(node.height / lhPx));
}

async function buildText(node: TextNode, platform: Platform): Promise<SceneNode> {
  const kind = await getTextKind(node);
  const w    = Math.max(node.width, 0.01);
  const fill: SolidPaint = { type: "SOLID", color: C_CONTENT };

  if (kind === "Large" || kind === "Small") {
    const bh   = kind === "Large" ? largeBarH(platform) : smallBarH(platform);
    const rect = figma.createRectangle();
    rect.name         = `Skeleton/Content/Text-${kind}`;
    rect.resize(w, bh);
    rect.cornerRadius = 16;
    rect.fills        = [fill];
    return rect;
  }

  const lines    = countLines(node);
  const bh       = smallBarH(platform);
  const gap      = barGap(platform);

  if (lines <= 1) {
    const rect = figma.createRectangle();
    rect.name         = "Skeleton/Content/Text-Paragraph-1L";
    rect.resize(w, bh);
    rect.cornerRadius = 16;
    rect.fills        = [fill];
    return rect;
  }

  const barCount = Math.min(lines, 3);
  const totalH   = barCount * bh + (barCount - 1) * gap;
  const frame    = figma.createFrame();
  frame.name         = `Skeleton/Content/Text-Paragraph-${barCount}L`;
  frame.resize(w, Math.max(totalH, 0.01));
  frame.fills        = [];
  frame.clipsContent = false;

  for (let i = 0; i < barCount; i++) {
    const bar  = figma.createRectangle();
    bar.name   = "Skeleton/Content/Line";
    const barW = barCount === 2
      ? (i === 1 ? w * 0.58 : w)
      : (i === 2 ? w * 0.58 * 0.58 : w);
    bar.resize(Math.max(barW, 0.01), bh);
    bar.cornerRadius = 16;
    bar.fills        = [fill];
    frame.appendChild(bar);
    bar.x = 0;
    bar.y = i * (bh + gap);
  }
  return frame;
}

// ============================================================
// LEAF
// ============================================================

async function buildLeaf(node: SceneNode, platform: Platform): Promise<SceneNode> {
  if (node.type === "TEXT") return buildText(node as TextNode, platform);

  const w = Math.max(node.width, 0.01);
  const h = Math.max(node.height, 0.01);

  if (node.type === "VECTOR" || node.type === "STAR" || node.type === "LINE") {
    return buildIconCircle(node.width, node.height);
  }

  if (node.type === "ELLIPSE") {
    if (Math.max(w, h) > ICON_SCALE_MAX) {
      const rect         = figma.createRectangle();
      rect.name          = "Skeleton/Content/Avatar";
      rect.resize(w, h);
      rect.cornerRadius  = 999;
      rect.fills         = [{ type: "SOLID", color: C_CONTENT }];
      return rect;
    }
    return buildIconCircle(node.width, node.height);
  }

  // RECTANGLE и прочие листья — сохраняем оригинальный фон.
  // IMAGE-заливки → Content #292929 (картинку не отображаем).
  const rect  = figma.createRectangle();
  rect.resize(w, h);
  const fills = copyFills(node);
  if (fills.length === 0) {
    rect.name  = "Skeleton/Content/Detail";
    rect.fills = [{ type: "SOLID", color: C_CONTENT }];
  } else {
    rect.name  = "Skeleton/Surface";
    rect.fills = fills;
  }
  if ("cornerRadius" in node && typeof node.cornerRadius === "number") {
    rect.cornerRadius = node.cornerRadius;
  }
  if (hasStroke(node)) applyStroke(rect, node);
  return rect;
}

// ============================================================
// RECURSION — Ghost Frames
// ============================================================

async function build(node: SceneNode, platform: Platform): Promise<SceneNode | null> {
  // Скрытые слои полностью пропускаются
  if (node.visible === false) return null;

  if (isIconScaleContainer(node)) return buildIconCircle(node.width, node.height);

  if (!("children" in node) || (node as ChildrenMixin).children.length === 0) {
    return buildLeaf(node, platform);
  }

  const src = node as FrameNode | InstanceNode | GroupNode | ComponentNode;

  const frame = figma.createFrame();
  frame.resize(Math.max(src.width, 0.01), Math.max(src.height, 0.01));

  // Контейнеры сохраняют оригинальный фон (background primary/secondary и т.д.)
  const fills = copyFills(node);
  frame.fills = fills;
  frame.name  = fills.length > 0 ? "Skeleton/Surface/Container" : "Skeleton/Container";

  if ("cornerRadius" in src && typeof src.cornerRadius === "number") {
    frame.cornerRadius = src.cornerRadius;
  }
  if (hasStroke(node)) applyStroke(frame, node);
  frame.clipsContent = "clipsContent" in src ? src.clipsContent : true;

  for (const child of src.children) {
    if (child.visible === false) continue; // скрытые дочерние слои пропускаем

    const built = await build(child, platform);
    if (built === null) continue;

    frame.appendChild(built);
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
    const root     = await build(source, platform);
    if (!root) continue;

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

figma.showUI(__html__, { width: 320, height: 460 });

function hex(h: string): RGB {
  const v = parseInt(h.replace("#", ""), 16);
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}

const C_SURFACE = hex("#1F1F1F");
const C_CONTENT = hex("#292929");
const C_STROKE  = hex("#333333");

type Platform = "Desktop" | "Mobile";
type TextKind  = "Large" | "Small" | "Paragraph";

const ICON_SIZES     = [12, 16, 20, 24, 32];
const ICON_SCALE_MAX = 32;

// ============================================================
// NAME MATCHING
// ============================================================

const NAME_DIVIDER        = ["divider", "дивайдер", "separator", "dividers"];
const NAME_LOGO_BADGE     = ["logo badge", "logo-badge", "logobadge"];
const NAME_PAY_METHOD     = ["pay method logo", "pay-method-logo", "payment logo", "pay method"];
const NAME_BUTTON         = ["button"];
const NAME_STATUS_BLOCK   = ["status-block", "status block", "statusblock"];
const NAME_LOGO           = ["logo"];
const NAME_STORIES        = ["stories"];
const NAME_LINK           = ["link"];
const NAME_BADGE          = ["badge"];
const NAME_AVATARS        = ["avatars"];
const NAME_CAT_BTN_SLIDER = ["category button slider"];
const NAME_PLAY_WIN       = ["play & win", "play&win", "play and win"];

function nameIs(node: SceneNode, keywords: string[]): boolean {
  const n = node.name.toLowerCase();
  return keywords.some((k) => n.includes(k));
}

function isAbsolutePos(node: SceneNode): boolean {
  return "layoutPositioning" in node && (node as any).layoutPositioning === "ABSOLUTE";
}

function isImageNode(node: SceneNode): boolean {
  if (!("fills" in node) || !Array.isArray(node.fills)) return false;
  const visible = (node.fills as Paint[]).filter((f) => f.visible !== false);
  return visible.length > 0 && visible.every((f) => f.type === "IMAGE");
}

// ============================================================
// FILL HELPERS
// ============================================================

const FILL_STYLE_REPLACE = ["yellow", "red", "purple"];

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
  const w = "strokeWeight" in source && typeof source.strokeWeight === "number" ? source.strokeWeight : 1;
  target.strokeWeight = w > 0 ? w : 1;
}

async function fillColorNeedsReplacement(node: SceneNode): Promise<boolean> {
  if (!("fillStyleId" in node)) return false;
  const id = (node as MinimalFillsMixin).fillStyleId;
  if (typeof id !== "string" || !id) return false;
  const style = await figma.getStyleByIdAsync(id);
  if (!style) return false;
  return FILL_STYLE_REPLACE.some((k) => style.name.toLowerCase().includes(k));
}

async function copyFills(node: SceneNode): Promise<Paint[]> {
  if (!("fills" in node) || !Array.isArray(node.fills)) return [];
  const replaceColor = await fillColorNeedsReplacement(node);
  return (node.fills as Paint[])
    .filter((f) => f.visible !== false)
    .map((f): Paint => {
      if (replaceColor) return { type: "SOLID", color: C_CONTENT };
      if (f.type === "IMAGE") return { type: "SOLID", color: C_CONTENT };
      return f;
    });
}

function copyFillsVerbatim(node: SceneNode): Paint[] {
  if (!("fills" in node) || !Array.isArray(node.fills)) return [];
  return (node.fills as Paint[]).filter((f) => f.visible !== false);
}

// ============================================================
// AUTO LAYOUT
// ============================================================

function applyAutoLayout(frame: FrameNode, src: SceneNode): boolean {
  if (!("layoutMode" in src) || (src as FrameNode).layoutMode === "NONE") return false;
  const s = src as FrameNode;
  frame.layoutMode            = s.layoutMode;
  frame.primaryAxisSizingMode = "FIXED";
  frame.counterAxisSizingMode = "FIXED";
  if (typeof s.itemSpacing    === "number") frame.itemSpacing    = s.itemSpacing;
  if (typeof s.paddingLeft    === "number") frame.paddingLeft    = s.paddingLeft;
  if (typeof s.paddingRight   === "number") frame.paddingRight   = s.paddingRight;
  if (typeof s.paddingTop     === "number") frame.paddingTop     = s.paddingTop;
  if (typeof s.paddingBottom  === "number") frame.paddingBottom  = s.paddingBottom;
  if (s.primaryAxisAlignItems) frame.primaryAxisAlignItems = s.primaryAxisAlignItems;
  if (s.counterAxisAlignItems) frame.counterAxisAlignItems = s.counterAxisAlignItems;
  try { if ((s as any).layoutWrap) (frame as any).layoutWrap = (s as any).layoutWrap; } catch (_) {}
  return true;
}

function applyChildLayoutSizing(built: SceneNode, srcChild: SceneNode): void {
  try {
    const s = srcChild as any;
    const b = built as any;
    if (srcChild.type === "TEXT") {
      if ("layoutSizingHorizontal" in s) b.layoutSizingHorizontal = s.layoutSizingHorizontal;
      else b.layoutSizingHorizontal = "FILL";
      if ("layoutSizingVertical" in s) b.layoutSizingVertical = s.layoutSizingVertical;
      return;
    }
    if ("layoutSizingHorizontal" in s) b.layoutSizingHorizontal = s.layoutSizingHorizontal;
    if ("layoutSizingVertical"   in s) b.layoutSizingVertical   = s.layoutSizingVertical;
    if ("layoutAlign" in s) b.layoutAlign = s.layoutAlign;
    if ("layoutGrow"  in s && typeof s.layoutGrow === "number") b.layoutGrow = s.layoutGrow;
  } catch (_) {}
}

// ============================================================
// SNAP ICON
// ============================================================

function snapIconSize(actual: number): number {
  let best = ICON_SIZES[0], bestDiff = Math.abs(actual - best);
  for (const s of ICON_SIZES) {
    const d = Math.abs(actual - s);
    if (d < bestDiff) { bestDiff = d; best = s; }
  }
  return best;
}

function detectPlatform(rootWidth: number): Platform {
  return rootWidth <= 480 ? "Mobile" : "Desktop";
}

// ============================================================
// SPECIAL BUILDERS
// ============================================================

function buildDivider(node: SceneNode): RectangleNode {
  const rect = figma.createRectangle();
  rect.name   = node.name;
  rect.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
  rect.fills  = copyFillsVerbatim(node);
  if ("cornerRadius" in node && typeof node.cornerRadius === "number") rect.cornerRadius = node.cornerRadius;
  if (hasStroke(node)) {
    rect.strokes      = (node as GeometryMixin).strokes.slice() as Paint[];
    rect.strokeWeight = ("strokeWeight" in node ? node.strokeWeight as number : 1) || 1;
  }
  return rect;
}

function buildLogoBadge(node: SceneNode): FrameNode {
  const frame = figma.createFrame();
  frame.name         = node.name;
  frame.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
  frame.fills        = [];
  frame.strokes      = [{ type: "SOLID", color: C_STROKE }];
  frame.strokeWeight = 1;
  if ("cornerRadius" in node && typeof node.cornerRadius === "number") frame.cornerRadius = node.cornerRadius;
  frame.clipsContent = false;
  return frame;
}

function buildPayMethod(node: SceneNode): FrameNode {
  const frame = figma.createFrame();
  frame.name         = node.name;
  frame.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
  frame.fills        = [{ type: "SOLID", color: C_SURFACE }];
  if ("cornerRadius" in node && typeof node.cornerRadius === "number") frame.cornerRadius = node.cornerRadius;
  frame.clipsContent = false;
  return frame;
}

async function buildButtonContent(node: SceneNode, platform: Platform): Promise<SceneNode | null> {
  if (node.visible === false) return null;
  if (isAbsolutePos(node)) return null;
  if (node.type === "TEXT") return buildText(node as TextNode, platform);
  if (node.type === "VECTOR" || node.type === "STAR" || node.type === "LINE")
    return buildIconCircle(node.width, node.height, node.name);
  if (node.type === "ELLIPSE" || isIconScaleContainer(node))
    return buildIconCircle(node.width, node.height, node.name);
  if ("children" in node && (node as ChildrenMixin).children.length > 0) {
    const frame = figma.createFrame();
    frame.name         = node.name;
    frame.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
    frame.fills        = [];
    frame.clipsContent = "clipsContent" in node ? (node as FrameNode).clipsContent : false;
    const hasAL = applyAutoLayout(frame, node);
    for (const child of (node as ChildrenMixin).children) {
      if (child.visible === false || isAbsolutePos(child)) continue;
      const built = await buildButtonContent(child, platform);
      if (!built) continue;
      frame.appendChild(built);
      if (hasAL) applyChildLayoutSizing(built, child);
      else { built.x = child.x; built.y = child.y; }
    }
    return frame;
  }
  const rect = figma.createRectangle();
  rect.name         = node.name;
  rect.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
  rect.fills        = [{ type: "SOLID", color: C_CONTENT }];
  if ("cornerRadius" in node && typeof node.cornerRadius === "number") rect.cornerRadius = node.cornerRadius;
  return rect;
}

async function buildButton(node: SceneNode, platform: Platform): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name         = node.name;
  frame.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
  frame.fills        = [{ type: "SOLID", color: C_SURFACE }];
  if ("cornerRadius" in node && typeof node.cornerRadius === "number") frame.cornerRadius = node.cornerRadius;
  if (hasStroke(node)) applyStroke(frame, node);
  frame.clipsContent = "clipsContent" in node ? (node as FrameNode).clipsContent : true;
  const hasAL = applyAutoLayout(frame, node);
  if ("children" in node) {
    for (const child of (node as ChildrenMixin).children) {
      if (child.visible === false || isAbsolutePos(child)) continue;
      const built = await buildButtonContent(child, platform);
      if (!built) continue;
      frame.appendChild(built);
      if (hasAL) applyChildLayoutSizing(built, child);
      else { built.x = child.x; built.y = child.y; }
    }
  }
  return frame;
}

function buildStatusBlock(node: SceneNode): RectangleNode {
  const rect = figma.createRectangle();
  rect.name         = node.name;
  rect.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
  rect.fills        = [{ type: "SOLID", color: C_CONTENT }];
  rect.cornerRadius = 999;
  return rect;
}

function buildLogo(node: SceneNode): RectangleNode {
  const rect = figma.createRectangle();
  rect.name         = node.name;
  rect.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
  rect.fills        = [{ type: "SOLID", color: C_CONTENT }];
  rect.cornerRadius = 16;
  return rect;
}

// ============================================================
// ICON
// ============================================================

function buildIconCircle(srcW: number, srcH: number, name?: string): SceneNode {
  const w    = Math.max(srcW, 0.01);
  const h    = Math.max(srcH, 0.01);
  const size = snapIconSize(Math.max(w, h));
  const lbl  = name || "Icon";

  const circle = figma.createRectangle();
  circle.name         = lbl;
  circle.resize(size, size);
  circle.cornerRadius = 999;
  circle.fills        = [{ type: "SOLID", color: C_CONTENT }];

  if (Math.abs(size - w) < 0.5 && Math.abs(size - h) < 0.5) return circle;

  const frame = figma.createFrame();
  frame.name         = lbl;
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

async function getTextInfo(node: TextNode): Promise<{ kind: TextKind; styleName: string }> {
  const styleId = node.textStyleId;
  if (typeof styleId === "string" && styleId) {
    const style = await figma.getStyleByIdAsync(styleId);
    if (style) {
      const kind = classifyByStyleName(style.name);
      return { kind: kind || (typeof node.fontSize === "number" && node.fontSize >= 20 ? "Large" : "Small"), styleName: style.name };
    }
  }
  const fontSize = typeof node.fontSize === "number" ? node.fontSize : 14;
  return { kind: fontSize >= 20 ? "Large" : "Small", styleName: "" };
}

function smallBarH(p: Platform): number { return p === "Desktop" ? 12 : 8; }
function largeBarH(p: Platform): number { return p === "Desktop" ? 16 : 12; }
function barGap(p: Platform):    number { return p === "Desktop" ? 4  : 2; }

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
  const { kind, styleName } = await getTextInfo(node);
  let w = Math.max(node.width, 0.01);
  const fill: SolidPaint = { type: "SOLID", color: C_CONTENT };

  // Heading-2: fixed size (Desktop 204×16, Mobile 106×16)
  if (kind === "Large" && styleName.includes("Heading-2")) {
    const rect = figma.createRectangle();
    rect.name         = node.name;
    rect.resize(platform === "Desktop" ? 204 : 106, 16);
    rect.cornerRadius = 16;
    rect.fills        = [fill];
    return rect;
  }

  if (kind === "Large" || kind === "Small") {
    const bh   = kind === "Large" ? largeBarH(platform) : smallBarH(platform);
    const rect = figma.createRectangle();
    rect.name         = node.name;
    rect.resize(w, bh);
    rect.cornerRadius = 16;
    rect.fills        = [fill];
    return rect;
  }

  const lines = countLines(node);
  const bh    = smallBarH(platform);
  const gap   = barGap(platform);

  if (lines <= 1) {
    const rect = figma.createRectangle();
    rect.name         = node.name;
    rect.resize(w, bh);
    rect.cornerRadius = 16;
    rect.fills        = [fill];
    return rect;
  }

  const barCount = Math.min(lines, 3);
  const totalH   = barCount * bh + (barCount - 1) * gap;
  const frame    = figma.createFrame();
  frame.name         = node.name;
  frame.resize(w, Math.max(totalH, 0.01));
  frame.fills        = [];
  frame.clipsContent = false;

  for (let i = 0; i < barCount; i++) {
    const bar  = figma.createRectangle();
    bar.name   = node.name;
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

  if (node.type === "VECTOR" || node.type === "STAR" || node.type === "LINE")
    return buildIconCircle(node.width, node.height, node.name);

  if (node.type === "ELLIPSE") {
    if (Math.max(w, h) > ICON_SCALE_MAX) {
      const rect        = figma.createRectangle();
      rect.name         = node.name;
      rect.resize(w, h);
      rect.cornerRadius = 999;
      rect.fills        = [{ type: "SOLID", color: C_CONTENT }];
      return rect;
    }
    return buildIconCircle(node.width, node.height, node.name);
  }

  const rect  = figma.createRectangle();
  rect.name   = node.name;
  rect.resize(w, h);
  const fills = await copyFills(node);
  if (fills.length === 0) {
    rect.fills = [{ type: "SOLID", color: C_CONTENT }];
  } else {
    rect.fills = fills;
  }
  if ("cornerRadius" in node && typeof node.cornerRadius === "number") rect.cornerRadius = node.cornerRadius;
  if (hasStroke(node)) applyStroke(rect, node);
  return rect;
}

// ============================================================
// STORIES
// ============================================================

function hasStackOn(node: SceneNode): boolean {
  const n = node.name.toLowerCase();
  if (n.includes("stack=on") || n.includes("stack on")) return true;
  if ("componentProperties" in node && (node as InstanceNode).componentProperties) {
    for (const key of Object.keys((node as InstanceNode).componentProperties)) {
      if (key.toLowerCase().includes("stack")) {
        const prop = (node as InstanceNode).componentProperties[key];
        if (prop && typeof prop.value === "string" && prop.value.toLowerCase() === "on") return true;
      }
    }
  }
  return false;
}

function buildStoriesStackOn(node: SceneNode): FrameNode {
  const w   = Math.max(node.width, 0.01);
  const h   = Math.max(node.height, 0.01);
  const off = 6;
  const cr  = "cornerRadius" in node && typeof node.cornerRadius === "number" ? node.cornerRadius : 0;

  const outer = figma.createFrame();
  outer.name         = node.name;
  outer.resize(w + off * 2, h);
  outer.fills        = [];
  outer.clipsContent = false;

  for (let i = 2; i >= 1; i--) {
    const layer = figma.createRectangle();
    layer.name         = node.name;
    layer.resize(w, h);
    layer.fills        = [{ type: "SOLID", color: C_CONTENT }];
    layer.cornerRadius = cr;
    layer.x            = off * i;
    layer.y            = 0;
    outer.appendChild(layer);
  }

  const main = figma.createRectangle();
  main.name         = node.name;
  main.resize(w, h);
  main.fills        = [{ type: "SOLID", color: C_SURFACE }];
  main.cornerRadius = cr;
  main.x            = 0;
  main.y            = 0;
  outer.appendChild(main);
  return outer;
}

async function buildStoriesStackOff(node: SceneNode, platform: Platform): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name         = node.name;
  frame.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
  frame.fills        = [];
  frame.strokes      = [{ type: "SOLID", color: C_STROKE }];
  frame.strokeWeight = 1;
  if ("cornerRadius" in node && typeof node.cornerRadius === "number") frame.cornerRadius = node.cornerRadius;
  frame.clipsContent = "clipsContent" in node ? (node as FrameNode).clipsContent : true;
  const hasAL = applyAutoLayout(frame, node);

  if ("children" in node) {
    for (const child of (node as ChildrenMixin).children) {
      if (child.visible === false || isAbsolutePos(child)) continue;
      const built = await build(child, platform);
      if (!built) continue;
      frame.appendChild(built);
      if (hasAL) applyChildLayoutSizing(built, child);
      else { built.x = child.x; built.y = child.y; }
    }
  }
  return frame;
}

// ============================================================
// AVATARS
// ============================================================

function buildAvatars(node: SceneNode): RectangleNode {
  const rect = figma.createRectangle();
  rect.name         = node.name;
  rect.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
  rect.fills        = [{ type: "SOLID", color: C_CONTENT }];
  rect.strokes      = [{ type: "SOLID", color: C_STROKE }];
  rect.strokeWeight = 1;
  rect.cornerRadius = 999;
  return rect;
}

// ============================================================
// LINK — text only, no icons
// ============================================================

async function buildLink(node: SceneNode, platform: Platform): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name         = node.name;
  frame.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
  frame.fills        = [];
  if ("cornerRadius" in node && typeof node.cornerRadius === "number") frame.cornerRadius = node.cornerRadius;
  frame.clipsContent = "clipsContent" in node ? (node as FrameNode).clipsContent : true;
  const hasAL = applyAutoLayout(frame, node);

  if ("children" in node) {
    for (const child of (node as ChildrenMixin).children) {
      if (child.visible === false || isAbsolutePos(child)) continue;
      if (child.type !== "TEXT") continue;
      const built = await buildText(child as TextNode, platform);
      if (!built) continue;
      frame.appendChild(built);
      if (hasAL) applyChildLayoutSizing(built, child);
      else { built.x = child.x; built.y = child.y; }
    }
  }
  return frame;
}

// ============================================================
// CATEGORY BUTTON SLIDER
// ============================================================

function isRandomGame(node: SceneNode): boolean {
  const n = node.name.toLowerCase();
  if (n.includes("random game") || n.includes("random")) return true;
  if ("componentProperties" in node && (node as InstanceNode).componentProperties) {
    for (const key of Object.keys((node as InstanceNode).componentProperties)) {
      const prop = (node as InstanceNode).componentProperties[key];
      if (prop && typeof prop.value === "string" && prop.value.toLowerCase().includes("random")) return true;
    }
  }
  return false;
}

async function buildCatBtnSlider(node: SceneNode, platform: Platform): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name         = node.name;
  frame.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
  frame.fills        = isRandomGame(node) ? [{ type: "SOLID", color: C_SURFACE }] : [];
  if ("cornerRadius" in node && typeof node.cornerRadius === "number") frame.cornerRadius = node.cornerRadius;
  frame.clipsContent = "clipsContent" in node ? (node as FrameNode).clipsContent : true;
  const hasAL = applyAutoLayout(frame, node);

  if ("children" in node) {
    for (const child of (node as ChildrenMixin).children) {
      if (child.visible === false || isAbsolutePos(child)) continue;
      const isText = child.type === "TEXT";
      const isIcon = child.type === "VECTOR" || child.type === "STAR" || child.type === "LINE"
                  || child.type === "ELLIPSE" || isIconScaleContainer(child);
      if (!isText && !isIcon) continue;
      const built: SceneNode = isText
        ? await buildText(child as TextNode, platform)
        : buildIconCircle(child.width, child.height, child.name);
      frame.appendChild(built);
      if (hasAL) applyChildLayoutSizing(built, child);
      else { built.x = child.x; built.y = child.y; }
    }
  }
  return frame;
}

// ============================================================
// RECURSION — Ghost Frames
// ============================================================

async function build(node: SceneNode, platform: Platform): Promise<SceneNode | null> {
  if (node.visible === false) return null;
  if (isAbsolutePos(node)) return null;
  if (isImageNode(node)) return null;
  if (nameIs(node, NAME_BADGE)) return null;
  if (nameIs(node, NAME_AVATARS))        return buildAvatars(node);

  if (nameIs(node, NAME_DIVIDER))        return buildDivider(node);
  if (nameIs(node, NAME_STATUS_BLOCK))   return buildStatusBlock(node);
  if (nameIs(node, NAME_LOGO_BADGE))     return buildLogoBadge(node);
  if (nameIs(node, NAME_PAY_METHOD))     return buildPayMethod(node);
  if (nameIs(node, NAME_LOGO))           return buildLogo(node);
  if (nameIs(node, NAME_BUTTON))         return buildButton(node, platform);
  if (nameIs(node, NAME_LINK))           return buildLink(node, platform);
  if (nameIs(node, NAME_STORIES))        return hasStackOn(node) ? buildStoriesStackOn(node) : buildStoriesStackOff(node, platform);
  if (nameIs(node, NAME_CAT_BTN_SLIDER)) return buildCatBtnSlider(node, platform);

  if (isIconScaleContainer(node)) return buildIconCircle(node.width, node.height, node.name);

  if (!("children" in node) || (node as ChildrenMixin).children.length === 0) {
    return buildLeaf(node, platform);
  }

  const src = node as FrameNode | InstanceNode | GroupNode | ComponentNode;

  const frame = figma.createFrame();
  frame.resize(Math.max(src.width, 0.01), Math.max(src.height, 0.01));
  frame.name = src.name;

  const fills = await copyFills(node);
  frame.fills = fills;

  if ("cornerRadius" in src && typeof src.cornerRadius === "number") frame.cornerRadius = src.cornerRadius;
  if (hasStroke(node) || nameIs(node, NAME_PLAY_WIN)) applyStroke(frame, node);
  frame.clipsContent = "clipsContent" in src ? src.clipsContent : true;

  const hasAL = applyAutoLayout(frame, src);

  for (const child of src.children) {
    if (child.visible === false || isAbsolutePos(child)) continue;
    const built = await build(child, platform);
    if (built === null) continue;
    frame.appendChild(built);
    if (hasAL) applyChildLayoutSizing(built, child);
    else { built.x = child.x; built.y = child.y; }
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
    if (box) { root.x = box.x + box.width + 80; root.y = box.y; }
    else      { root.x = source.x + source.width + 80; root.y = source.y; }
    placed.push(root);
  }

  figma.currentPage.selection = placed;
  figma.viewport.scrollAndZoomIntoView(placed);
  figma.notify(`Skeleton создан: ${placed.length} объект(ов)`);
};

"use strict";
figma.showUI(__html__, { width: 320, height: 460 });

function hex(h) {
    const v = parseInt(h.replace("#", ""), 16);
    return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}
const C_SURFACE = hex("#1F1F1F");
const C_CONTENT = hex("#292929");
const C_STROKE  = hex("#333333");

const ICON_SIZES     = [12, 16, 20, 24, 32];
const ICON_SCALE_MAX = 32;

// ---------- NAME MATCHING ----------
// Совпадение имени узла (регистронезависимо) с одним из ключевых слов.
function nameIs(node, keywords) {
    const n = node.name.toLowerCase();
    return keywords.some((k) => n.includes(k));
}
const NAME_DIVIDER      = ["divider", "дивайдер", "separator", "dividers"];
const NAME_LOGO_BADGE   = ["logo badge", "logo-badge", "logobadge"];
const NAME_PAY_METHOD   = ["pay method logo", "pay-method-logo", "payment logo", "pay method"];
const NAME_BUTTON       = ["button"];
const NAME_STATUS_BLOCK    = ["status-block", "status block", "statusblock"];
const NAME_LOGO            = ["logo"];
const NAME_STORIES         = ["stories"];
const NAME_BANNER_BLOCK    = ["banner-block"];
const NAME_CAT_BTN_SLIDER  = ["category button slider"];
const NAME_PLAY_WIN        = ["play & win", "play&win", "play and win"];

// Цвета-стили, заливки которых заменяются на Content #292929.
const FILL_STYLE_REPLACE = ["yellow", "red", "purple"];

// ---------- FILL HELPERS ----------
function hasVisibleFill(node) {
    if (!("fills" in node) || !Array.isArray(node.fills)) return false;
    return node.fills.some((f) => f.visible !== false);
}
function hasStroke(node) {
    return "strokes" in node && Array.isArray(node.strokes) && node.strokes.length > 0;
}
function applyStroke(target, source) {
    target.strokes = [{ type: "SOLID", color: C_STROKE }];
    const w = "strokeWeight" in source && typeof source.strokeWeight === "number" ? source.strokeWeight : 1;
    target.strokeWeight = w > 0 ? w : 1;
}

// Проверяет fillStyleId узла: если стиль называется yellow/red/purple → заменить на #292929.
async function fillColorNeedsReplacement(node) {
    if (!("fillStyleId" in node)) return false;
    const id = node.fillStyleId;
    if (typeof id !== "string" || !id) return false;
    const style = await figma.getStyleByIdAsync(id);
    if (!style) return false;
    const name = style.name.toLowerCase();
    return FILL_STYLE_REPLACE.some((k) => name.includes(k));
}

// Копирует заливки: IMAGE → #292929. Если цвет-стиль из списка замены → #292929.
async function copyFills(node) {
    if (!("fills" in node) || !Array.isArray(node.fills)) return [];
    const replaceColor = await fillColorNeedsReplacement(node);
    return node.fills
        .filter((f) => f.visible !== false)
        .map((f) => {
            if (replaceColor) return { type: "SOLID", color: C_CONTENT };
            if (f.type === "IMAGE") return { type: "SOLID", color: C_CONTENT };
            return f;
        });
}

// Копирует заливки БЕЗ замены (для divider — сохранить оригинал полностью).
function copyFillsVerbatim(node) {
    if (!("fills" in node) || !Array.isArray(node.fills)) return [];
    return node.fills.filter((f) => f.visible !== false);
}

// ---------- SNAP ICON ----------
function snapIconSize(actual) {
    let best = ICON_SIZES[0];
    let bestDiff = Math.abs(actual - best);
    for (const s of ICON_SIZES) {
        const d = Math.abs(actual - s);
        if (d < bestDiff) { bestDiff = d; best = s; }
    }
    return best;
}

function detectPlatform(rootWidth) {
    return rootWidth <= 480 ? "Mobile" : "Desktop";
}

// ---------- SPECIAL BUILDERS ----------

// Divider: сохраняем оригинальный вид полностью.
function buildDivider(node) {
    const w = Math.max(node.width, 0.01);
    const h = Math.max(node.height, 0.01);
    const rect = figma.createRectangle();
    rect.name   = node.name;
    rect.resize(w, h);
    rect.fills  = copyFillsVerbatim(node);
    if ("cornerRadius" in node && typeof node.cornerRadius === "number") {
        rect.cornerRadius = node.cornerRadius;
    }
    if (hasStroke(node)) {
        rect.strokes      = node.strokes.slice();
        rect.strokeWeight = node.strokeWeight || 1;
    }
    return rect;
}

// Logo badge: пустой фрейм только с обводкой #333333, без контента.
function buildLogoBadge(node) {
    const frame = figma.createFrame();
    frame.name         = "Skeleton/Logo Badge";
    frame.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
    frame.fills        = [];
    frame.strokes      = [{ type: "SOLID", color: C_STROKE }];
    frame.strokeWeight = 1;
    if ("cornerRadius" in node && typeof node.cornerRadius === "number") {
        frame.cornerRadius = node.cornerRadius;
    }
    frame.clipsContent = false;
    return frame;
}

// Pay method logo: заливка #1F1F1F, без контента внутри.
function buildPayMethod(node) {
    const frame = figma.createFrame();
    frame.name         = "Skeleton/Pay Method";
    frame.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
    frame.fills        = [{ type: "SOLID", color: C_SURFACE }];
    if ("cornerRadius" in node && typeof node.cornerRadius === "number") {
        frame.cornerRadius = node.cornerRadius;
    }
    frame.clipsContent = false;
    return frame;
}

// Button: заливка #1F1F1F, скругление из исходника; всё содержимое → #292929 (рекурсии нет).
async function buildButton(node, platform) {
    const frame = figma.createFrame();
    frame.name         = "Skeleton/Button";
    frame.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
    frame.fills        = [{ type: "SOLID", color: C_SURFACE }];
    if ("cornerRadius" in node && typeof node.cornerRadius === "number") {
        frame.cornerRadius = node.cornerRadius;
    }
    if (hasStroke(node)) applyStroke(frame, node);
    frame.clipsContent = "clipsContent" in node ? node.clipsContent : true;

    if ("children" in node) {
        for (const child of node.children) {
            if (child.visible === false) continue;
            const built = await buildButtonContent(child, platform);
            if (!built) continue;
            frame.appendChild(built);
            built.x = child.x;
            built.y = child.y;
        }
    }
    return frame;
}

// Содержимое кнопки: TEXT→полоса #292929, ICON→круг #292929, прочее→rect #292929.
async function buildButtonContent(node, platform) {
    if (node.visible === false) return null;
    if (node.type === "TEXT") return buildText(node, platform);
    if (node.type === "VECTOR" || node.type === "STAR" || node.type === "LINE") {
        return buildIconCircle(node.width, node.height);
    }
    if (node.type === "ELLIPSE" || isIconScaleContainer(node)) {
        return buildIconCircle(node.width, node.height);
    }
    // Любой другой узел → прозрачный контейнер #292929 того же размера
    if ("children" in node && node.children.length > 0) {
        const frame = figma.createFrame();
        frame.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
        frame.fills        = [];
        frame.clipsContent = false;
        for (const child of node.children) {
            if (child.visible === false) continue;
            const built = await buildButtonContent(child, platform);
            if (!built) continue;
            frame.appendChild(built);
            built.x = child.x;
            built.y = child.y;
        }
        return frame;
    }
    const rect = figma.createRectangle();
    rect.name         = "Skeleton/Content/Detail";
    rect.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
    rect.fills        = [{ type: "SOLID", color: C_CONTENT }];
    if ("cornerRadius" in node && typeof node.cornerRadius === "number") {
        rect.cornerRadius = node.cornerRadius;
    }
    return rect;
}

// Status-block: один прямоугольник #292929, cornerRadius=999, без вложенностей.
function buildStatusBlock(node) {
    const rect = figma.createRectangle();
    rect.name         = "Skeleton/Status Block";
    rect.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
    rect.fills        = [{ type: "SOLID", color: C_CONTENT }];
    rect.cornerRadius = 999;
    return rect;
}

// Logo: прямоугольник #292929, размеры исходника, cornerRadius=16.
function buildLogo(node) {
    const rect = figma.createRectangle();
    rect.name         = "Skeleton/Logo";
    rect.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
    rect.fills        = [{ type: "SOLID", color: C_CONTENT }];
    rect.cornerRadius = 16;
    return rect;
}

// ---------- ICON ----------
function buildIconCircle(srcW, srcH) {
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

function isIconScaleContainer(node) {
    if (!("children" in node) || node.children.length === 0) return false;
    if (Math.max(node.width, node.height) > ICON_SCALE_MAX) return false;
    if (hasVisibleFill(node)) return false;
    return node.findAll((n) => n.type === "TEXT").length === 0;
}

// ---------- TEXT ----------
const LARGE_KEYWORDS     = ["Accent-1", "Accent-2", "Accent-3", "Heading-1", "Heading-2"];
const SMALL_KEYWORDS     = ["Accent-4", "Heading-3", "Heading-4", "Body-1 Bold", "Body-1"];
const PARAGRAPH_KEYWORDS = ["Body-2", "Label-1", "Label-2", "Button-L", "Button-M", "Button-S"];

function classifyByStyleName(name) {
    if (LARGE_KEYWORDS.some((k) => name.includes(k)))     return "Large";
    if (SMALL_KEYWORDS.some((k) => name.includes(k)))     return "Small";
    if (PARAGRAPH_KEYWORDS.some((k) => name.includes(k))) return "Paragraph";
    return null;
}
async function getTextKind(node) {
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
function smallBarH(p) { return p === "Desktop" ? 12 : 8; }
function largeBarH(p) { return p === "Desktop" ? 16 : 12; }
function barGap(p)    { return p === "Desktop" ? 4  : 2; }

function countLines(node) {
    const fontSize = typeof node.fontSize === "number" ? node.fontSize : 14;
    let lhPx = fontSize * 1.3;
    const lh = node.lineHeight;
    if (typeof lh === "object" && "unit" in lh) {
        if (lh.unit === "PIXELS")       lhPx = lh.value;
        else if (lh.unit === "PERCENT") lhPx = fontSize * (lh.value / 100);
    }
    return Math.max(1, Math.round(node.height / lhPx));
}

async function buildText(node, platform) {
    const kind = await getTextKind(node);
    const w    = Math.max(node.width, 0.01);
    const fill = { type: "SOLID", color: C_CONTENT };

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

// ---------- LEAF ----------
async function buildLeaf(node, platform) {
    if (node.type === "TEXT") return buildText(node, platform);

    const w = Math.max(node.width, 0.01);
    const h = Math.max(node.height, 0.01);

    if (node.type === "VECTOR" || node.type === "STAR" || node.type === "LINE") {
        return buildIconCircle(node.width, node.height);
    }

    if (node.type === "ELLIPSE") {
        if (Math.max(w, h) > ICON_SCALE_MAX) {
            const rect        = figma.createRectangle();
            rect.name         = "Skeleton/Content/Avatar";
            rect.resize(w, h);
            rect.cornerRadius = 999;
            rect.fills        = [{ type: "SOLID", color: C_CONTENT }];
            return rect;
        }
        return buildIconCircle(node.width, node.height);
    }

    const rect  = figma.createRectangle();
    rect.resize(w, h);
    const fills = await copyFills(node);
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

// Stories: detect Stack=on via componentProperties or name.
function hasStackOn(node) {
    const n = node.name.toLowerCase();
    if (n.includes("stack=on") || n.includes("stack on")) return true;
    if ("componentProperties" in node && node.componentProperties) {
        for (const key of Object.keys(node.componentProperties)) {
            if (key.toLowerCase().includes("stack")) {
                const prop = node.componentProperties[key];
                if (prop && typeof prop.value === "string" && prop.value.toLowerCase() === "on") return true;
            }
        }
    }
    return false;
}

// Stories Stack=on: main card #1F1F1F + 2 offset layers #292929 behind (peeking at right).
function buildStoriesStackOn(node) {
    const w   = Math.max(node.width, 0.01);
    const h   = Math.max(node.height, 0.01);
    const off = 6; // px offset per layer
    const cr  = "cornerRadius" in node && typeof node.cornerRadius === "number" ? node.cornerRadius : 0;

    const outer = figma.createFrame();
    outer.name         = "Skeleton/Stories/Stack";
    outer.resize(w + off * 2, h);
    outer.fills        = [];
    outer.clipsContent = false;

    // Stack layers (behind, appended first → rendered below main)
    for (let i = 2; i >= 1; i--) {
        const layer = figma.createRectangle();
        layer.name         = "Skeleton/Stories/Layer";
        layer.resize(w, h);
        layer.fills        = [{ type: "SOLID", color: C_CONTENT }];
        layer.cornerRadius = cr;
        layer.x            = off * i;
        layer.y            = 0;
        outer.appendChild(layer);
    }

    // Main card (front)
    const main = figma.createRectangle();
    main.name         = "Skeleton/Stories/Main";
    main.resize(w, h);
    main.fills        = [{ type: "SOLID", color: C_SURFACE }];
    main.cornerRadius = cr;
    main.x            = 0;
    main.y            = 0;
    outer.appendChild(main);

    return outer;
}

// Stories Stack=off: stroke #333333, no fill, recurse children normally.
async function buildStoriesStackOff(node, platform) {
    const frame = figma.createFrame();
    frame.name         = "Skeleton/Stories";
    frame.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
    frame.fills        = [];
    frame.strokes      = [{ type: "SOLID", color: C_STROKE }];
    frame.strokeWeight = 1;
    if ("cornerRadius" in node && typeof node.cornerRadius === "number") {
        frame.cornerRadius = node.cornerRadius;
    }
    frame.clipsContent = "clipsContent" in node ? node.clipsContent : true;

    if ("children" in node) {
        for (const child of node.children) {
            if (child.visible === false) continue;
            const built = await build(child, platform);
            if (!built) continue;
            frame.appendChild(built);
            built.x = child.x;
            built.y = child.y;
        }
    }
    return frame;
}

// Category Button Slider (all variants): no fill, only icon + text → #292929.
async function buildCatBtnSlider(node, platform) {
    const frame = figma.createFrame();
    frame.name         = "Skeleton/Category Button Slider";
    frame.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
    frame.fills        = [];
    if ("cornerRadius" in node && typeof node.cornerRadius === "number") {
        frame.cornerRadius = node.cornerRadius;
    }
    frame.clipsContent = "clipsContent" in node ? node.clipsContent : true;

    if ("children" in node) {
        for (const child of node.children) {
            if (child.visible === false) continue;
            const isText = child.type === "TEXT";
            const isIcon = child.type === "VECTOR" || child.type === "STAR" || child.type === "LINE"
                        || child.type === "ELLIPSE" || isIconScaleContainer(child);
            if (!isText && !isIcon) continue;
            const built = isText ? await buildText(child, platform) : buildIconCircle(child.width, child.height);
            if (!built) continue;
            frame.appendChild(built);
            built.x = child.x;
            built.y = child.y;
        }
    }
    return frame;
}

// ---------- RECURSION ----------
async function build(node, platform) {
    if (node.visible === false) return null;

    // --- Специальные компоненты по имени (порядок важен: более специфичные — первыми) ---
    if (nameIs(node, NAME_DIVIDER))      return buildDivider(node);
    if (nameIs(node, NAME_STATUS_BLOCK)) return buildStatusBlock(node);
    if (nameIs(node, NAME_LOGO_BADGE))   return buildLogoBadge(node);
    if (nameIs(node, NAME_PAY_METHOD))   return buildPayMethod(node);
    if (nameIs(node, NAME_LOGO))          return buildLogo(node);
    if (nameIs(node, NAME_BUTTON))        return buildButton(node, platform);
    if (nameIs(node, NAME_STORIES))       return hasStackOn(node) ? buildStoriesStackOn(node) : buildStoriesStackOff(node, platform);
    if (nameIs(node, NAME_CAT_BTN_SLIDER)) return buildCatBtnSlider(node, platform);

    if (isIconScaleContainer(node)) return buildIconCircle(node.width, node.height);

    if (!("children" in node) || node.children.length === 0) {
        return buildLeaf(node, platform);
    }

    const src   = node;
    const frame = figma.createFrame();
    frame.resize(Math.max(src.width, 0.01), Math.max(src.height, 0.01));

    const fills = await copyFills(node);
    frame.fills = fills;
    frame.name  = fills.length > 0 ? "Skeleton/Surface/Container" : "Skeleton/Container";

    if ("cornerRadius" in src && typeof src.cornerRadius === "number") {
        frame.cornerRadius = src.cornerRadius;
    }
    if (hasStroke(node) || nameIs(node, NAME_BANNER_BLOCK) || nameIs(node, NAME_PLAY_WIN)) {
        applyStroke(frame, node);
    }
    frame.clipsContent = "clipsContent" in src ? src.clipsContent : true;

    for (const child of src.children) {
        if (child.visible === false) continue;

        const built = await build(child, platform);
        if (built === null) continue;

        frame.appendChild(built);
        built.x = child.x;
        built.y = child.y;
    }
    return frame;
}

// ---------- ENTRY ----------
figma.ui.onmessage = async (msg) => {
    if (msg.type !== "generate") return;

    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
        figma.notify("Выдели Frame/Instance/Group для конвертации в Skeleton");
        return;
    }

    const placed = [];
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

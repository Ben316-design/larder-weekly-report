import fs from "node:fs/promises";
import JSZip from "jszip";

const builtInFormats = new Map([
  [0, "General"], [1, "0"], [2, "0.00"], [3, "#,##0"], [4, "#,##0.00"],
  [9, "0%"], [10, "0.00%"], [11, "0.00E+00"], [12, "# ?/?"], [13, "# ??/??"],
  [14, "m/d/yy"], [49, "@"],
]);

function decodeXml(value = "") {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function attribute(attributes, name) {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1];
}

function hexColour(value) {
  const compact = plainText(value).replace(/^#/, "").slice(-6);
  return /^[0-9a-f]{6}$/i.test(compact) ? `#${compact.toUpperCase()}` : "";
}

function plainText(value) {
  return value == null ? "" : String(value).trim();
}

function tintColour(hex, tint) {
  if (!Number.isFinite(tint) || tint === 0) return hex;
  const rgb = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  let hue = 0;
  let saturation = 0;
  let lightness = (max + min) / 2;
  if (max !== min) {
    const delta = max - min;
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === rgb[0]) hue = (rgb[1] - rgb[2]) / delta + (rgb[1] < rgb[2] ? 6 : 0);
    else if (max === rgb[1]) hue = (rgb[2] - rgb[0]) / delta + 2;
    else hue = (rgb[0] - rgb[1]) / delta + 4;
    hue /= 6;
  }
  lightness = tint < 0 ? lightness * (1 + tint) : lightness + (1 - lightness) * tint;
  const channel = (shift) => {
    if (saturation === 0) return lightness;
    const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
    const p = 2 * lightness - q;
    let point = hue + shift;
    if (point < 0) point += 1;
    if (point > 1) point -= 1;
    if (point < 1 / 6) return p + (q - p) * 6 * point;
    if (point < 1 / 2) return q;
    if (point < 2 / 3) return p + (q - p) * (2 / 3 - point) * 6;
    return p;
  };
  return `#${[channel(1 / 3), channel(0), channel(-1 / 3)]
    .map((value) => Math.round(value * 255).toString(16).padStart(2, "0"))
    .join("").toUpperCase()}`;
}

function themeColours(themeXml = "") {
  const scheme = /<a:clrScheme\b[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(themeXml)?.[1] || "";
  const names = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  return names.map((name) => {
    const body = new RegExp(`<a:${name}\\b[^>]*>([\\s\\S]*?)<\\/a:${name}>`).exec(scheme)?.[1] || "";
    return hexColour(/(?:<a:srgbClr\b[^>]*\bval="([^"]+)"|<a:sysClr\b[^>]*\blastClr="([^"]+)")/.exec(body)?.[1] || /<a:sysClr\b[^>]*\blastClr="([^"]+)"/.exec(body)?.[1]);
  });
}

function colourFromAttributes(attributes, colours) {
  const direct = hexColour(attribute(attributes, "rgb"));
  if (direct) return direct;
  const theme = Number(attribute(attributes, "theme"));
  const base = Number.isInteger(theme) ? colours[theme] : "";
  return base ? tintColour(base, Number(attribute(attributes, "tint"))) : "";
}

export function excelColumn(column) {
  let result = "";
  let remainder = column;
  while (remainder > 0) {
    const digit = (remainder - 1) % 26;
    result = String.fromCharCode(65 + digit) + result;
    remainder = Math.floor((remainder - 1) / 26);
  }
  return result;
}

export function formatAt(numberFormats, rowIndex, columnIndex) {
  return numberFormats.get(`${excelColumn(columnIndex + 1)}${rowIndex + 1}`) || "";
}

function elementBodies(xml, element) {
  return [...xml.matchAll(new RegExp(`<${element}\\b[^>]*>([\\s\\S]*?)<\\/${element}>`, "g"))].map((match) => match[1]);
}

function fillColour(fillBody, colours) {
  const pattern = /<patternFill\b([^>]*)>([\s\S]*?)<\/patternFill>/.exec(fillBody);
  if (!pattern || attribute(pattern[1], "patternType") !== "solid") return "";
  const foreground = /<fgColor\b([^>]*)\/?\s*>/.exec(pattern[2])?.[1] || "";
  return colourFromAttributes(foreground, colours);
}

function fontStyle(fontBody, colours) {
  const fontColour = /<color\b([^>]*)\/?\s*>/.exec(fontBody)?.[1] || "";
  return {
    color: colourFromAttributes(fontColour, colours),
    bold: /<b(?:\s[^>]*)?\/?\s*>/.test(fontBody),
  };
}

export function styleAt(cellStyles, rowIndex, columnIndex) {
  return cellStyles.get(`${excelColumn(columnIndex + 1)}${rowIndex + 1}`) || {};
}

export async function readExcelCellStyles(workbookPath, worksheetPath = "xl/worksheets/sheet1.xml") {
  const zip = await JSZip.loadAsync(await fs.readFile(workbookPath));
  const stylesXml = await zip.file("xl/styles.xml")?.async("string");
  const sheetXml = await zip.file(worksheetPath)?.async("string");
  if (!stylesXml || !sheetXml) throw new Error("The workbook does not contain the report styles needed for display formatting.");
  const colours = themeColours(await zip.file("xl/theme/theme1.xml")?.async("string"));

  const customFormats = new Map();
  for (const match of stylesXml.matchAll(/<numFmt\b([^>]*)\/>/g)) {
    const id = Number(attribute(match[1], "numFmtId"));
    const code = attribute(match[1], "formatCode");
    if (Number.isFinite(id) && code) customFormats.set(id, decodeXml(code));
  }

  const fillsContent = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(stylesXml)?.[1] || "";
  const fills = elementBodies(fillsContent, "fill").map((body) => fillColour(body, colours));
  const fontsContent = /<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(stylesXml)?.[1] || "";
  const fonts = elementBodies(fontsContent, "font").map((body) => fontStyle(body, colours));
  const xfsContent = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] || "";
  const styleByIndex = [...xfsContent.matchAll(/<xf\b([^>]*)\/?>(?:<\/xf>)?/g)].map((match) => {
    const id = Number(attribute(match[1], "numFmtId"));
    const fillId = Number(attribute(match[1], "fillId") || 0);
    const fontId = Number(attribute(match[1], "fontId") || 0);
    return {
      numberFormat: customFormats.get(id) || builtInFormats.get(id) || "General",
      fill: fills[fillId] || "",
      color: fonts[fontId]?.color || "",
      bold: Boolean(fonts[fontId]?.bold),
    };
  });

  const cellStyles = new Map();
  for (const match of sheetXml.matchAll(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)) {
    const reference = attribute(match[1], "r");
    const styleIndex = Number(attribute(match[1], "s") || 0);
    if (reference) cellStyles.set(reference, styleByIndex[styleIndex] || { numberFormat: "General" });
  }
  return cellStyles;
}

export async function readExcelNumberFormats(workbookPath, worksheetPath = "xl/worksheets/sheet1.xml") {
  const cellStyles = await readExcelCellStyles(workbookPath, worksheetPath);
  const formats = new Map();
  for (const [reference, style] of cellStyles) formats.set(reference, style.numberFormat || "General");
  return formats;
}

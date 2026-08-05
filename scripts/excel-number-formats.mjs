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

export async function readExcelNumberFormats(workbookPath, worksheetPath = "xl/worksheets/sheet1.xml") {
  const zip = await JSZip.loadAsync(await fs.readFile(workbookPath));
  const stylesXml = await zip.file("xl/styles.xml")?.async("string");
  const sheetXml = await zip.file(worksheetPath)?.async("string");
  if (!stylesXml || !sheetXml) throw new Error("The workbook does not contain the report styles needed for display formatting.");

  const customFormats = new Map();
  for (const match of stylesXml.matchAll(/<numFmt\b([^>]*)\/>/g)) {
    const id = Number(attribute(match[1], "numFmtId"));
    const code = attribute(match[1], "formatCode");
    if (Number.isFinite(id) && code) customFormats.set(id, decodeXml(code));
  }

  const xfsContent = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] || "";
  const formatByStyle = [...xfsContent.matchAll(/<xf\b([^>]*)\/?>(?:<\/xf>)?/g)].map((match) => {
    const id = Number(attribute(match[1], "numFmtId"));
    return customFormats.get(id) || builtInFormats.get(id) || "General";
  });

  const formats = new Map();
  for (const match of sheetXml.matchAll(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)) {
    const reference = attribute(match[1], "r");
    const styleIndex = Number(attribute(match[1], "s") || 0);
    if (reference) formats.set(reference, formatByStyle[styleIndex] || "General");
  }
  return formats;
}

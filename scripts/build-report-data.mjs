import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbookPath = "./data/weekly-report.xlsx";
const outputPath = "./data/report-data.json";

const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const sheet = workbook.worksheets.getItemAt(0);
const cells = sheet.getRange("A1:O284").values;

const text = (value) => (value == null ? "" : String(value).trim());
const dateFromExcel = (value) => {
  if (typeof value !== "number") return value;
  const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
  return date.toISOString().slice(0, 10);
};

const excelColumn = (column) => {
  let result = "";
  let remainder = column;
  while (remainder > 0) {
    const digit = (remainder - 1) % 26;
    result = String.fromCharCode(65 + digit) + result;
    remainder = Math.floor((remainder - 1) / 26);
  }
  return result;
};

async function numberFormatsFor({ dataStart, dataEnd, columns }) {
  const range = `B${dataStart + 1}:${excelColumn(columns)}${dataEnd + 1}`;
  const inspected = await workbook.inspect({
    kind: "computedStyle",
    sheetId: sheet.name,
    range,
    maxChars: 120000,
  });
  const formats = new Map();
  for (const line of inspected.ndjson.split(/\r?\n/)) {
    if (!line) continue;
    const entry = JSON.parse(line);
    if (entry.kind === "computedStyle" && entry.for) formats.set(entry.for, entry.style?.numberFormat || "");
  }
  return Array.from({ length: dataEnd - dataStart + 1 }, (_, rowOffset) => Array.from(
    { length: columns - 1 },
    (_, columnOffset) => formats.get(`${excelColumn(columnOffset + 2)}${dataStart + rowOffset + 1}`) || "",
  ));
}

async function section({ id, label, accent, titleRow, groupRow, headerRow, dataStart, dataEnd, columns }) {
  let activeGroup = "";
  const headers = Array.from({ length: columns }, (_, index) => {
    const groupCell = text(cells[groupRow][index]);
    if (groupCell) activeGroup = groupCell;
    const labelCell = text(cells[headerRow][index]);
    return {
      label: labelCell || activeGroup || `Column ${index + 1}`,
      group: activeGroup,
    };
  });

  const numberFormats = await numberFormatsFor({ dataStart, dataEnd, columns });
  return {
    id,
    label,
    accent,
    title: text(cells[titleRow][0]) || label,
    headers,
    rows: cells.slice(dataStart, dataEnd + 1).map((row, index) => ({
      week: dateFromExcel(row[0]),
      values: row.slice(1, columns),
      numberFormats: numberFormats[index],
    })),
  };
}

const sectionLayouts = [
  { id: "sales", label: "Sales", accent: "orange", titleRow: 40, groupRow: 41, headerRow: 42, dataStart: 43, dataEnd: 55, columns: 11 },
  { id: "covers", label: "Covers summary", accent: "green", titleRow: 59, groupRow: 60, headerRow: 61, dataStart: 62, dataEnd: 74, columns: 14 },
  { id: "lunch", label: "Lunch covers", accent: "lime", titleRow: 78, groupRow: 79, headerRow: 80, dataStart: 81, dataEnd: 93, columns: 12 },
  { id: "dinner", label: "Dinner covers", accent: "blue", titleRow: 97, groupRow: 98, headerRow: 99, dataStart: 100, dataEnd: 112, columns: 12 },
  { id: "sph", label: "Spend per head", accent: "peach", titleRow: 116, groupRow: 117, headerRow: 118, dataStart: 119, dataEnd: 131, columns: 8 },
  { id: "bookings", label: "Future bookings", accent: "peach", titleRow: 135, groupRow: 136, headerRow: 137, dataStart: 138, dataEnd: 150, columns: 8 },
  { id: "overall-gp", label: "Overall GP", accent: "peach", titleRow: 154, groupRow: 155, headerRow: 156, dataStart: 157, dataEnd: 169, columns: 10 },
  { id: "food-gp", label: "Food GP", accent: "lavender", titleRow: 173, groupRow: 174, headerRow: 175, dataStart: 176, dataEnd: 188, columns: 11 },
  { id: "drink-gp", label: "Drink GP", accent: "royal", titleRow: 192, groupRow: 193, headerRow: 194, dataStart: 195, dataEnd: 207, columns: 11 },
  { id: "wages", label: "Total wages", accent: "burnt", titleRow: 211, groupRow: 212, headerRow: 213, dataStart: 214, dataEnd: 226, columns: 10 },
  { id: "foh", label: "Front of house", accent: "sky", titleRow: 230, groupRow: 231, headerRow: 232, dataStart: 233, dataEnd: 245, columns: 11 },
  { id: "chefs", label: "Chefs", accent: "lilac", titleRow: 249, groupRow: 250, headerRow: 251, dataStart: 252, dataEnd: 264, columns: 10 },
  { id: "cleaners", label: "KPI / cleaners", accent: "lime", titleRow: 268, groupRow: 269, headerRow: 270, dataStart: 271, dataEnd: 283, columns: 10 },
];

const sections = [];
for (const layout of sectionLayouts) sections.push(await section(layout));

const normaliseTrend = (value) => text(value).replace(/^[\u25B2\u25BC\u2191\u2193\s]+/u, "");
const card = (id, label, value, trend) => {
  const cleanTrend = normaliseTrend(trend);
  return {
    id,
    label,
    value,
    trend: cleanTrend,
    tone: cleanTrend.toLowerCase().startsWith("up") ? "positive" : cleanTrend.toLowerCase().startsWith("down") ? "negative" : "neutral",
    detail: "Current published report",
  };
};
const data = {
  reportTitle: text(cells[0][0]),
  selectedWeek: dateFromExcel(cells[1][13]),
  overview: [
    card("sales-inc", "Total sales inc. VAT", cells[5][0], cells[15][0]),
    card("overall-gp", "Overall GP", cells[5][4], cells[7][4]),
    card("food-gp", "Food GP", cells[5][8], cells[7][8]),
    card("drink-gp", "Drink GP", cells[5][12], cells[7][12]),
    card("sales-ex", "Total sales ex. VAT", cells[13][0], cells[15][0]),
    card("covers", "Total covers", cells[13][4], cells[15][4]),
    card("sph", "Spend per head inc. VAT", cells[13][8], cells[15][8]),
    card("bookings", "Future bookings", cells[13][12], cells[15][12]),
    card("wages", "Wages as % of sales", cells[21][0], cells[23][0]),
    card("foh", "FOH wages as % of sales", cells[21][4], cells[23][4]),
    card("chefs", "Chefs wages as % of sales", cells[21][8], cells[23][8]),
  ],
  sections,
};

await fs.mkdir("./data", { recursive: true });
const serializedData = JSON.stringify(data, null, 2);
await fs.writeFile(outputPath, serializedData, "utf8");
await fs.writeFile("./report-data.js", `window.LARDER_REPORT_DATA = ${serializedData};\n`, "utf8");
console.log(`Wrote ${outputPath} with ${sections.length} report sections.`);

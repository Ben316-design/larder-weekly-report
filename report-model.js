function plainText(value) {
  return value == null ? "" : String(value).trim();
}

function isIsoWeek(value) {
  const text = plainText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function addDays(week, days) {
  const date = new Date(`${week}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function decodeCellReference(reference) {
  const match = plainText(reference).toUpperCase().match(/^\$?([A-Z]{1,3})\$?(\d+)$/);
  if (!match) return null;
  const column = [...match[1]].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
  return { column, row: Number(match[2]) - 1 };
}

function referencedCells(formula) {
  return plainText(formula).toUpperCase().match(/\$?[A-Z]{1,3}\$?\d+/g) || [];
}

function trendFromValue(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  if (Math.abs(value) < 0.0005) return "Same as Last Year";
  const direction = value > 0 ? "▲ Up" : "▼ Down";
  return `${direction} ${Math.abs(value).toLocaleString("en-GB", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 })} vs Last Year`;
}

function resolveOverviewValue(formula, resolveCell, resolving = new Set()) {
  const expression = plainText(formula).replace(/^=/, "").replace(/\s+/g, "");
  const directCell = decodeCellReference(expression);
  if (directCell) return resolveCell(expression, resolving);
  const operation = expression.match(/^(.+?)([*/+-])(-?\d+(?:\.\d+)?)$/);
  if (!operation) return null;
  const left = resolveOverviewValue(`=${operation[1]}`, resolveCell, resolving);
  const right = Number(operation[3]);
  if (typeof left !== "number" || !Number.isFinite(left) || !Number.isFinite(right)) return null;
  if (operation[2] === "*") return left * right;
  if (operation[2] === "/") return right === 0 ? null : left / right;
  if (operation[2] === "+") return left + right;
  return left - right;
}

function valueForReportCell(model, report, reference, resolving = new Set()) {
  const location = decodeCellReference(reference);
  if (!location) return null;
  const overviewCell = model.overview?.find((card) => card.valueCell === reference.replace(/\$/g, "").toUpperCase());
  if (overviewCell) {
    const key = `overview:${overviewCell.valueCell}`;
    if (resolving.has(key)) return null;
    resolving.add(key);
    const value = resolveOverviewValue(overviewCell.valueFormula, (nextReference) => valueForReportCell(model, report, nextReference, resolving), resolving);
    resolving.delete(key);
    return value;
  }
  const sectionIndex = model.sections.findIndex((section) => location.row >= section.dataStart && location.row < section.dataStart + 13);
  if (sectionIndex < 0) return null;
  const section = report.sections[sectionIndex];
  const row = section?.rows[location.row - model.sections[sectionIndex].dataStart];
  if (!row) return null;
  return location.column === 0 ? row.week : row.values[location.column - 1] ?? null;
}

function overviewForReport(model, report) {
  return (model.overview || []).map((card) => {
    const calculatedValue = resolveOverviewValue(card.valueFormula, (reference, resolving) => valueForReportCell(model, report, reference, resolving));
    const value = calculatedValue ?? card.staticValue ?? null;
    const trendReference = referencedCells(card.trendFormula)[0];
    const trendValue = trendReference ? valueForReportCell(model, report, trendReference) : null;
    return {
      id: card.id,
      label: card.label,
      value,
      numberFormat: card.numberFormat || "",
      trend: trendFromValue(trendValue) || card.staticTrend || "",
      lowerIsBetter: Boolean(card.lowerIsBetter),
      sectionId: card.sectionId || "",
      detail: "Selected report",
    };
  });
}

function calculationTermValue(term, values) {
  if (term?.type === "number") return term.value;
  if (term?.type === "row") return values[term.column - 1];
  return null;
}

function calculatedValue(calculation, values) {
  if (!calculation) return null;
  const left = calculationTermValue(calculation.left, values);
  const right = calculationTermValue(calculation.right, values);
  if (typeof left !== "number" || !Number.isFinite(left) || typeof right !== "number" || !Number.isFinite(right)) return null;
  if (calculation.operator === "+") return left + right;
  if (calculation.operator === "-") return left - right;
  if (calculation.operator === "*") return left * right;
  return calculation.operator === "/" && right !== 0 ? left / right : null;
}

export function isMasterReportModel(model) {
  return Boolean(
    model
    && model.type === "larder-master-report"
    && isIsoWeek(model.currentWeek)
    && Array.isArray(model.availableWeeks)
    && Array.isArray(model.sections)
    && model.sections.length
    && model.sources
    && typeof model.sources === "object",
  );
}

export function reportForWeek(model, requestedWeek = "") {
  if (!isMasterReportModel(model)) return null;
  const selectedWeek = isIsoWeek(requestedWeek) && model.availableWeeks.includes(requestedWeek)
    ? requestedWeek
    : model.currentWeek;
  const weeks = Array.from({ length: 13 }, (_, index) => addDays(selectedWeek, (index - 12) * 7));
  const sections = model.sections.map((definition) => ({
    id: definition.id,
    label: definition.label,
    accent: definition.accent,
    title: definition.title,
    headers: definition.headers,
    columnStyles: definition.columnStyles,
    rows: weeks.map((week) => {
      const columns = definition.sourceColumns
        || definition.sourceFields.map((field) => ({ source: definition.source, field }));
      const values = columns.map(({ source, field }) => {
        if (!field) return null;
        const sourceRow = model.sources?.[source]?.[week] || null;
        return sourceRow && Object.prototype.hasOwnProperty.call(sourceRow, field) ? sourceRow[field] : "Not found";
      });
      columns.forEach(({ calculation }, index) => {
        const value = calculatedValue(calculation, values);
        if (value !== null) values[index] = value;
      });
      return {
        week,
        values,
        numberFormats: definition.numberFormats,
      };
    }),
  }));
  const baseReport = {
    reportTitle: model.reportTitle || "LARDER LICHFIELD | WEEKLY PERFORMANCE REPORT",
    selectedWeek,
    overview: [],
    sections,
  };
  return { ...baseReport, overview: overviewForReport(model, baseReport) };
}

export function allowedWeeksForAccess(model, dateAccess) {
  if (!isMasterReportModel(model)) return [];
  const access = dateAccess || { scope: "current" };
  if (access.scope === "all") return model.availableWeeks;
  if (access.scope === "range" && isIsoWeek(access.start) && isIsoWeek(access.end)) {
    return model.availableWeeks.filter((week) => week >= access.start && week <= access.end);
  }
  return model.availableWeeks.includes(model.currentWeek) ? [model.currentWeek] : [];
}

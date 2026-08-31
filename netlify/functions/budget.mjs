import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { getStore } from "@netlify/blobs";
import { getAccessProfile, hasRecentReauthentication } from "./access.mjs";

const budgetPrefix = "budget:";
const maxPayloadBytes = 150_000;

function budgetStore() {
  return getStore({ name: "larder-budget", consistency: "strong" });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeText(value, maximum = 180) {
  return String(value || "").trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maximum);
}

function validFinancialYear(value) {
  const year = safeText(value, 7);
  const match = /^(\d{4})\/(\d{2})$/.exec(year);
  if (!match) return "";
  const start = Number(match[1]);
  return Number.isFinite(start) && String((start + 1) % 100).padStart(2, "0") === match[2] ? year : "";
}

function expectedMonths(financialYear) {
  const start = Number(financialYear.slice(0, 4));
  return [5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4].map((month, index) => {
    const year = index < 8 ? start : start + 1;
    return `${year}-${String(month).padStart(2, "0")}`;
  });
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function requiredNumber(value) {
  const number = finiteNumber(value);
  if (number === null) throw new Error("The budget contains an invalid financial value.");
  return number;
}

function cleanAnnual(value) {
  const annual = value && typeof value === "object" ? value : {};
  const sales = requiredNumber(annual.sales);
  const grossProfit = requiredNumber(annual.grossProfit);
  const labour = requiredNumber(annual.labour);
  const operatingProfit = requiredNumber(annual.operatingProfit);
  const operatingCosts = finiteNumber(annual.operatingCosts);
  const overallGpPercent = finiteNumber(annual.overallGpPercent);
  const labourPercent = finiteNumber(annual.labourPercent);
  return {
    sales,
    grossProfit,
    labour,
    operatingProfit,
    operatingCosts: operatingCosts ?? grossProfit - operatingProfit,
    overallGpPercent: overallGpPercent ?? (sales ? grossProfit / sales : 0),
    labourPercent: labourPercent ?? (sales ? labour / sales : 0),
  };
}

function cleanPriorActual(value) {
  if (!value || typeof value !== "object") return null;
  try {
    return cleanAnnual(value);
  } catch {
    return null;
  }
}

function cleanBudget(value, sourceName) {
  const input = value && typeof value === "object" ? value : {};
  const financialYear = validFinancialYear(input.financialYear);
  if (!financialYear) throw new Error("The budget needs a valid financial year.");
  const expected = expectedMonths(financialYear);
  const months = Array.isArray(input.months) ? input.months : [];
  if (months.length !== expected.length) throw new Error("The budget needs all 12 monthly values.");
  const cleanedMonths = months.map((month, index) => {
    const source = month && typeof month === "object" ? month : {};
    if (safeText(source.month, 7) !== expected[index]) throw new Error("The budget months must run from May to April.");
    return {
      month: expected[index],
      label: safeText(source.label, 24) || new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(Number(expected[index].slice(0, 4)), Number(expected[index].slice(5, 7)) - 1, 1))),
      sales: requiredNumber(source.sales),
      grossProfit: requiredNumber(source.grossProfit),
      labour: requiredNumber(source.labour),
      operatingProfit: requiredNumber(source.operatingProfit),
    };
  });
  const sourceSheet = safeText(String(input.sourceLabel || "").split("·").at(-1), 100);
  const filename = safeText(sourceName, 140) || "Budget workbook";
  return {
    financialYear,
    periodLabel: safeText(input.periodLabel, 80) || "May – April",
    sourceLabel: sourceSheet ? `${filename} · ${sourceSheet}` : filename,
    priorActual: cleanPriorActual(input.priorActual),
    annual: cleanAnnual(input.annual),
    months: cleanedMonths,
  };
}

function cleanAssumptions(value, financialYear) {
  const input = value && typeof value === "object" ? value : {};
  const validMonths = new Set(expectedMonths(financialYear));
  const cleaned = {};
  for (const [month, assumptions] of Object.entries(input)) {
    if (!validMonths.has(month) || !assumptions || typeof assumptions !== "object") continue;
    const coversPerWeek = finiteNumber(assumptions.coversPerWeek);
    const spendPerHead = finiteNumber(assumptions.spendPerHead);
    const entry = {};
    if (coversPerWeek !== null && coversPerWeek >= 0) entry.coversPerWeek = coversPerWeek;
    if (spendPerHead !== null && spendPerHead > 0) entry.spendPerHead = spendPerHead;
    if (Object.keys(entry).length) cleaned[month] = entry;
  }
  return cleaned;
}

function recordKey(financialYear) {
  return `${budgetPrefix}${financialYear}`;
}

async function requireBudgetManager(request, { requireRecentPassword = false } = {}) {
  const user = await getUser();
  if (!user) return { error: json({ error: "Please sign in." }, 401) };
  const access = await getAccessProfile(user);
  if (!access.enabled || !access.canManageUsers) return { error: json({ error: "Only Owners and Admins can access the shared budget." }, 403) };
  if (requireRecentPassword && access.role === "owner" && !(await hasRecentReauthentication(user.id))) {
    return { error: json({ error: "Confirm your account password before changing the shared budget." }, 428) };
  }
  return { user, access };
}

function responseRecord(record) {
  return {
    budget: record.budget,
    assumptions: record.assumptions || {},
    updatedAt: record.updatedAt,
    version: record.version,
  };
}

export default async function budget(request) {
  if (request.method === "GET") {
    const manager = await requireBudgetManager(request);
    if (manager.error) return manager.error;
    const financialYear = validFinancialYear(new URL(request.url).searchParams.get("year"));
    if (!financialYear) return json({ error: "Choose a financial year." }, 400);
    const record = await budgetStore().get(recordKey(financialYear), { type: "json" });
    if (!record?.budget) return json({ error: "No shared budget has been uploaded for this financial year." }, 404);
    return json(responseRecord(record));
  }

  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ error: "This update must come from the Larder Information Hub." }, 403);
  }
  const manager = await requireBudgetManager(request, { requireRecentPassword: true });
  if (manager.error) return manager.error;
  const body = await request.json().catch(() => ({}));

  if (body.action === "save-budget") {
    let budget;
    try {
      budget = cleanBudget(body.budget, body.sourceName);
    } catch (error) {
      return json({ error: error.message || "The budget could not be read." }, 400);
    }
    const record = {
      budget,
      assumptions: {},
      updatedAt: new Date().toISOString(),
      version: crypto.randomUUID(),
    };
    const serialised = JSON.stringify(record);
    if (Buffer.byteLength(serialised, "utf8") > maxPayloadBytes) return json({ error: "The extracted budget is too large to save." }, 413);
    await budgetStore().setJSON(recordKey(budget.financialYear), record);
    return json(responseRecord(record));
  }

  if (body.action === "save-assumptions") {
    const financialYear = validFinancialYear(body.financialYear);
    if (!financialYear) return json({ error: "Choose a valid financial year." }, 400);
    const current = await budgetStore().get(recordKey(financialYear), { type: "json" });
    if (!current?.budget) return json({ error: "Upload the budget before saving sales-plan changes." }, 404);
    const record = {
      ...current,
      assumptions: cleanAssumptions(body.assumptions, financialYear),
      updatedAt: new Date().toISOString(),
      version: crypto.randomUUID(),
    };
    await budgetStore().setJSON(recordKey(financialYear), record);
    return json(responseRecord(record));
  }

  return json({ error: "Invalid budget action." }, 400);
}

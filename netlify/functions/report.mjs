import { admin, getUser, verifyRequestOrigin } from "@netlify/identity";
import { getStore } from "@netlify/blobs";
import { getAccessProfile, hasRecentReauthentication, publicAccessProfile } from "./access.mjs";

const reportKey = "current-report";
const maxPayloadBytes = 1_000_000;

function reportStore() {
  return getStore({ name: "larder-weekly-report", consistency: "strong" });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function validReport(payload) {
  const report = payload?.report;
  return Boolean(report?.selectedWeek && Array.isArray(report.sections) && report.sections.length && Array.isArray(report.overview));
}

function filterReport(report, access) {
  if (access.role === "admin" || access.role === "owner") return report;
  const view = access.view;
  const sections = report.sections.flatMap((section) => {
    if (!access.sections.includes(section.id)) return [];
    const selection = view?.sections?.[section.id];
    if (view && !selection?.enabled) return [];
    const allowedHeaders = section.headers.map((header, index) => ({ header, index }))
      .filter(({ header, index }) => index === 0 || !view || selection.fields.includes("*") || selection.fields.includes(header.id) || selection.fields.includes(String(index)));
    if (allowedHeaders.length < 2) return [];
    const valueIndexes = allowedHeaders.slice(1).map(({ index }) => index - 1);
    return [{
      ...section,
      headers: allowedHeaders.map(({ header }) => header),
      columnStyles: valueIndexes.map((index) => section.columnStyles?.[index]),
      rows: section.rows.map((row) => ({
        ...row,
        values: valueIndexes.map((index) => row.values[index]),
        numberFormats: valueIndexes.map((index) => row.numberFormats?.[index]),
      })),
    }];
  });
  const overview = report.overview.filter((card) => {
    if (view) return view.overview?.enabled !== false && (view.overview.cards.includes("*") || view.overview.cards.includes(card.id));
    const sectionId = card.id === "sales-inc" || card.id === "sales-ex" ? "sales" : card.id;
    return access.sections.includes(sectionId);
  });
  return { ...report, overview, sections };
}

export default async function report(request) {
  const user = await getUser();
  if (!user) return json({ error: "Please sign in to view this report." }, 401);
  const access = await getAccessProfile(user);
  if (!access.enabled) return json({ error: "Your report access has been disabled." }, 403);

  if (request.method === "GET") {
    const previewUserId = new URL(request.url).searchParams.get("preview");
    let reportAccess = access;
    let preview = null;
    if (previewUserId) {
      if (!access.canManageUsers) return json({ error: "You do not have permission to preview other reports." }, 403);
      let previewUser;
      try {
        previewUser = await admin.getUser(previewUserId);
      } catch {
        return json({ error: "That user could not be found." }, 404);
      }
      const previewAccess = await getAccessProfile(previewUser);
      if (access.role === "owner" && previewAccess.role !== "viewer") return json({ error: "Owners can only preview Viewer reports." }, 403);
      reportAccess = previewAccess;
      preview = { id: previewUser.id, name: previewUser.name || previewUser.email || "this user", email: previewUser.email || "" };
    }
    const savedReport = await reportStore().get(reportKey, { type: "json" });
    if (!savedReport) return json({ error: "No shared report has been published yet." }, 404);
    return json({ ...savedReport, report: filterReport(savedReport.report, reportAccess), access: publicAccessProfile(reportAccess), preview });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ error: "This update must come from the Larder report app." }, 403);
  }
  if (!access.canPublish) return json({ error: "You do not have permission to publish the weekly report." }, 403);
  if (access.role === "owner" && !(await hasRecentReauthentication(user.id))) return json({ error: "Confirm your account password before publishing the report." }, 428);

  let submittedReport;
  try {
    submittedReport = await request.json();
  } catch {
    return json({ error: "The uploaded report could not be read." }, 400);
  }
  if (!validReport(submittedReport)) return json({ error: "This file does not contain a complete weekly report." }, 400);

  const serialised = JSON.stringify(submittedReport);
  if (Buffer.byteLength(serialised, "utf8") > maxPayloadBytes) return json({ error: "This report is too large to publish." }, 413);

  const publishedReport = {
    report: submittedReport.report,
    sourceName: String(submittedReport.sourceName || "Weekly report").slice(0, 180),
    updatedAt: new Date().toISOString(),
    version: crypto.randomUUID(),
  };
  await reportStore().setJSON(reportKey, publishedReport);
  return json({ ...publishedReport, report: filterReport(publishedReport.report, access), access: publicAccessProfile(access) });
}

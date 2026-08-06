import { timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

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

function requestComesFromThisSite(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function hasValidUpdateKey(request) {
  const expected = process.env.REPORT_UPDATE_KEY;
  const received = request.headers.get("x-report-update-key") || "";
  if (!expected) return null;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

export default async function report(request) {
  if (request.method === "GET") {
    const savedReport = await reportStore().get(reportKey, { type: "json" });
    return savedReport ? json(savedReport) : json({ error: "No shared report has been published yet." }, 404);
  }

  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!requestComesFromThisSite(request)) return json({ error: "This update must come from the Larder report app." }, 403);

  const isAuthorised = hasValidUpdateKey(request);
  if (isAuthorised === null) return json({ error: "Shared updates have not been configured yet." }, 503);
  if (!isAuthorised) return json({ error: "The update password is not correct." }, 401);

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
  return json(publishedReport);
}

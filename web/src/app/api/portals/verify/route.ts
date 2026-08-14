import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Orchestrates the core's verify-portals.mjs (#1016) — the SAME ATS-slug
// validator the CLI uses. Catches the silent 404s that quietly drop a company
// from every future scan (= lost offers). We parse its console output; we do NOT
// reimplement the validation.
const STATUS: Record<string, "live" | "empty" | "broken" | "skipped"> = {
  "✅": "live",
  "🟡": "empty",
  "❌": "broken",
  "➖": "skipped",
};

export async function GET(req: Request) {
  const root = careerOpsRoot();
  const verifyPortals = rootScript("verify-portals");
  if (!fs.existsSync(verifyPortals)) {
    return Response.json({ available: false, configured: false, companies: [] });
  }
  if (!fs.existsSync(path.join(root, "portals.yml"))) {
    return Response.json({ available: true, configured: false, companies: [] });
  }

  const url = new URL(req.url);
  const forceRefresh = url.searchParams.get("refresh") === "true";
  const healthJsonPath = path.join(root, "data", "portal-health.json");

  if (!forceRefresh && fs.existsSync(healthJsonPath)) {
    try {
      const cachedRaw = fs.readFileSync(healthJsonPath, "utf-8");
      const cached = JSON.parse(cachedRaw);
      if (Array.isArray(cached?.results)) {
        const companies = cached.results.map((r: { name: string; status: string; ats?: string; slug?: string; provider?: string; jobCount?: number; partial?: boolean; reason?: string; suggested?: { ats: string; slug: string } }) => {
          const source = r.ats ? `${r.ats}/${r.slug}` : (r.provider || '?');
          let detail = '';
          if (r.status === 'live') {
            detail = r.partial ? `${source} (first page live)` : `${source} (${r.jobCount} live)`;
          } else if (r.status === 'empty') {
            detail = `${source} (live but empty)`;
          } else if (r.status === 'missing') {
            detail = `${source} (unresolved) — ${r.reason || 'unresolved'}`;
            if (r.suggested) detail += ` → try ${r.suggested.ats}/${r.suggested.slug}`;
          } else {
            detail = r.reason || '';
          }
          const mappedStatus = r.status === 'missing' ? 'broken' : (STATUS[r.status] || r.status);
          return { name: r.name, status: mappedStatus, detail };
        });
        return Response.json({ available: true, configured: true, companies, cachedAt: cached.updatedAt });
      }
    } catch { /* fallback to live exec */ }
  }

  const stdout = await new Promise<string>((resolve) => {
    execFile(
      "node",
      [verifyPortals],
      { cwd: root, timeout: 110_000, maxBuffer: 4 * 1024 * 1024 },
      (_e, out, err) => resolve((out || "") + (err || "")),
    );
  });

  const companies: { name: string; status: string; detail: string }[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^\s*(✅|🟡|❌|➖)\s+(.+?)\s+—\s+(.*)$/);
    if (m) companies.push({ name: m[2].trim(), status: STATUS[m[1]] ?? "unknown", detail: m[3].trim() });
  }
  return Response.json({ available: true, configured: true, companies });
}

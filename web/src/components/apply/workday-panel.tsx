"use client";

import { useState, useEffect, useCallback } from "react";
import { KeyRound, Eye, EyeOff, Clipboard, ClipboardCheck, ExternalLink, Plus, Trash2, ChevronDown, ChevronUp, Building2 } from "lucide-react";

// Workday uses isolated company tenants so each employer requires its own
// sign-in. This panel stores per-company email + password in localStorage
// (client only, never sent to any server) for instant copy-paste at the
// Workday login screen. Supports Google-suggested passwords per company.

const STORE_KEY = "career-ops:workday-credentials";

type WorkdayCred = {
  id: string;
  company: string;
  email: string;
  password: string;
  tenant: string;
  updatedAt: string;
};

function loadCreds(): WorkdayCred[] {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch { return []; }
}
function saveCreds(creds: WorkdayCred[]): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(creds));
}
function tenantFromUrl(url: string): string {
  try { return new URL(url).hostname.split(".")[0]; } catch { return ""; }
}
function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  }, [text]);
  return (
    <button onClick={copy} title={`Copy ${label}`} className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-surface px-2 py-1 text-xs text-muted transition-colors hover:border-brand/40 hover:text-brand">
      {copied ? <ClipboardCheck className="size-3 text-emerald-500" /> : <Clipboard className="size-3" />}
      {copied ? "Copied!" : `Copy ${label}`}
    </button>
  );
}

function PasswordField({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-mono text-sm">{revealed ? value : "•".repeat(Math.min(value.length, 18))}</span>
      <button onClick={() => setRevealed(r => !r)} title={revealed ? "Hide" : "Reveal"} className="text-faint transition-colors hover:text-foreground">
        {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </span>
  );
}

function CredCard({ cred, onDelete }: { cred: WorkdayCred; onDelete: () => void }) {
  return (
    <div className="rounded-xl border border-border/60 bg-surface/60 p-3.5 backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Building2 className="size-3.5 text-muted" />
          {cred.company || cred.tenant}
        </span>
        <button onClick={onDelete} title="Remove" className="text-faint transition-colors hover:text-red-500"><Trash2 className="size-3.5" /></button>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">Email</span>
          <span className="flex items-center gap-1.5"><span className="font-mono text-sm">{cred.email}</span><CopyButton text={cred.email} label="email" /></span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">Password</span>
          <span className="flex items-center gap-1.5"><PasswordField value={cred.password} /><CopyButton text={cred.password} label="password" /></span>
        </div>
      </div>
      <div className="mt-1 text-right text-[10px] text-faint">saved {new Date(cred.updatedAt).toLocaleDateString()}</div>
    </div>
  );
}

function AddCredForm({ defaultTenant, defaultCompany, onSave, onCancel }: { defaultTenant: string; defaultCompany: string; onSave: (c: WorkdayCred) => void; onCancel: () => void }) {
  const [company, setCompany] = useState(defaultCompany);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [revealPw, setRevealPw] = useState(false);
  const valid = email.trim() && password.trim();
  const handleSave = () => { if (!valid) return; onSave({ id: uid(), company: company.trim() || defaultTenant, email: email.trim(), password: password.trim(), tenant: defaultTenant, updatedAt: new Date().toISOString() }); };
  const ic = "w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm outline-none transition focus:border-brand/60 focus:ring-2 focus:ring-brand/20";
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-brand/30 bg-brand-soft/40 p-3.5 backdrop-blur-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-brand">Save Workday credentials</div>
      <div className="space-y-2">
        <input value={company} onChange={e => setCompany(e.target.value)} placeholder="Company name (e.g. Thermo Fisher)" className={ic} />
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email you signed up with" className={ic} />
        <div className="relative">
          <input type={revealPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Workday password (Google-suggested ok)" className={`${ic} pr-9`} />
          <button onClick={() => setRevealPw(r => !r)} className="absolute right-2.5 top-2.5 text-faint hover:text-foreground" tabIndex={-1}>
            {revealPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={!valid} className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground transition hover:bg-brand-200 disabled:opacity-40">Save credentials</button>
        <button onClick={onCancel} className="rounded-full border border-border px-4 py-1.5 text-sm text-muted transition hover:text-foreground">Cancel</button>
      </div>
    </div>
  );
}

export function WorkdayPanel({ url, company }: { url: string; company?: string }) {
  const tenant = tenantFromUrl(url);
  const [creds, setCreds] = useState<WorkdayCred[]>([]);
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { setCreds(loadCreds()); }, []);
  const tenantCreds = creds.filter(c => c.tenant === tenant);
  const hasTenantMatch = tenantCreds.length > 0;
  const displayCreds = hasTenantMatch ? tenantCreds : showAll ? creds : [];
  const handleSave = (c: WorkdayCred) => { const next = [...creds, c]; saveCreds(next); setCreds(next); setAdding(false); };
  const handleDelete = (id: string) => { const next = creds.filter(c => c.id !== id); saveCreds(next); setCreds(next); };
  return (
    <div className="mt-4 max-w-2xl rounded-xl border border-amber-500/40 bg-amber-500/8 px-4 py-4">
      <div className="flex items-start gap-2.5">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Workday requires a separate account for each company</p>
          <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-400/80">Save your credentials here so you can copy them instantly — Google-suggested passwords are fully supported.</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-amber-400">
          Open Workday <ExternalLink className="size-3.5" />
        </a>
        <button onClick={() => setAdding(a => !a)} className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 px-4 py-1.5 text-sm font-medium text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-400">
          <Plus className="size-3.5" /> Save credentials
        </button>
      </div>
      {adding && <AddCredForm defaultTenant={tenant} defaultCompany={company || ""} onSave={handleSave} onCancel={() => setAdding(false)} />}
      {displayCreds.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700/70 dark:text-amber-400/70">{hasTenantMatch ? `Saved for ${company || tenant}` : "All saved Workday accounts"}</div>
          {displayCreds.map(c => <CredCard key={c.id} cred={c} onDelete={() => handleDelete(c.id)} />)}
        </div>
      )}
      {!hasTenantMatch && creds.length > 0 && !showAll && (
        <button onClick={() => setShowAll(true)} className="mt-3 flex items-center gap-1 text-xs text-amber-700/70 hover:text-amber-700 dark:text-amber-400/70">
          <ChevronDown className="size-3.5" /> Show {creds.length} saved account{creds.length !== 1 ? "s" : ""} for other companies
        </button>
      )}
      {showAll && creds.length > 0 && (
        <button onClick={() => setShowAll(false)} className="mt-1 flex items-center gap-1 text-xs text-amber-700/70 hover:text-amber-700 dark:text-amber-400/70">
          <ChevronUp className="size-3.5" /> Hide
        </button>
      )}
      {!adding && creds.length === 0 && (
        <p className="mt-3 text-xs text-amber-700/60 dark:text-amber-400/60">No credentials saved yet. Click "Save credentials" after you sign up — next time, your email and password are one click away.</p>
      )}
    </div>
  );
}

export function isWorkdayUrl(url: string): boolean {
  try { const h = new URL(url).hostname.toLowerCase(); return h.endsWith("myworkdayjobs.com") || h.endsWith("myworkday.com"); } catch { return false; }
}

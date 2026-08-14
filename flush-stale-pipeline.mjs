#!/usr/bin/env node

/**
 * flush-stale-pipeline.mjs — Pipeline backlog cleanup script.
 * 
 * Flushes entries from data/pipeline.md that are:
 *   1. Older than 60 days (or posted before the age threshold).
 *   2. Senior/Staff/Principal/Lead/Director/Engineer II roles (YOE > 2 years).
 *   3. Non-software/non-dev domains (Tax, Analyst, Customer Success, Audit, Advisory, Legal, HR, Support).
 *   4. US/EU local-only roles with no India/Remote eligibility.
 *   5. Already applied / present in data/applications.md.
 *   6. Duplicate requisitions for the same company + title + location.
 * 
 * Usage:
 *   node flush-stale-pipeline.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINE_PATH = join(__dirname, 'data', 'pipeline.md');
const APPLICATIONS_PATH = join(__dirname, 'data', 'applications.md');

const isDryRun = process.argv.includes('--dry-run');

if (!existsSync(PIPELINE_PATH)) {
  console.error(`Pipeline file not found at ${PIPELINE_PATH}`);
  process.exit(1);
}

const pipelineContent = readFileSync(PIPELINE_PATH, 'utf-8');
const appsContent = existsSync(APPLICATIONS_PATH) ? readFileSync(APPLICATIONS_PATH, 'utf-8') : '';

// Extract all applied URLs from applications.md
const appliedUrls = new Set();
for (const line of appsContent.split('\n')) {
  const match = line.match(/https?:\/\/[^\s|)]+/g);
  if (match) {
    for (const url of match) appliedUrls.add(url.toLowerCase().trim());
  }
}

const YOE_EXCLUDE_RE = /(?:[3-9]|\d{2})\+?\s*(?:-\s*(?:[4-9]|\d{2}))?\s*(?:years?|yrs?|yoe)|(?:3|4|5|6|7|8|9|10)\s*-\s*\d+\s*(?:years?|yrs?|yoe)|(?:3-5|3-6|4-6|5-8|3-4|4-5|5-10|6-10)\s*(?:years?|yrs?|yoe)|(?:3|4|5|6|7|8|9|10)\s*\+\s*years?/i;

const SENIOR_TIER_RE = /\b(senior|sr|sr\.|staff|principal|lead|manager|director|head of|vp|architect|lmts|smts|pmts|l3|l4|l5|l6|e3|e4|e5|e6|m1|m2)\b|\b(engineer|developer|associate|level|swe|sde|backend|frontend|fullstack)\s+(?:iii|iv|v|vi|3|4|5|6|ii|2)\b|-(?:senior|sr|iii|iv|v|3|4|5)-|\b(?:iii|iv|v|vi)\b/i;

const MUST_BE_TECH_RE = /\b(software|developer|backend|frontend|fullstack|full-stack|full stack|web|python|node|react|ai|genai|llm|machine learning|ml|devops|cloud|data engineer|rust|c\+\+|golang|go|platform engineer|app engineer|technical|technology|systems? admin)\b/i;

const NON_DEV_DOMAINS = [
  'tax', 'private client', 'wealth management', 'finance', 'accounting', 'audit', 'assurance', 'compliance',
  'customer success', 'customer support', 'account manager', 'program manager', 'product manager', 'project manager', 'project coordinator',
  'it analyst', 'it support', 'helpdesk', 'desktop support', 'service desk', 'technical support', 'qa analyst', 'business analyst',
  'recruiter', 'talent acquisition', 'hr associate', 'human resources', 'marketing', 'sales', 'business development',
  'operations associate', 'legal', 'paralegal', 'underwriter', 'insurance', 'claims', 'consultant',
  'digital customer success', 'supply chain', 'commercial associate', 'transaction services', 'risk managed services',
  'sap ', 'sap_', 'sap-', 'indirect tax', 'idt', 'trs', 'guidewire', 'technologist', 'firearms', 'retail', 'recovery',
  'seasonal', 'warehouse', 'freight', 'store associate', 'cashier', 'custodial', 'driver', 'nurse', 'medical',
  'management trainee', 'teller', 'banker', 'pharmacy', 'merchandiser', 'supervisor', 'customer care', 'call center', 'branch manager'
];

const LOCAL_NON_INDIA_REGIONS = [
  'washington, dc', 'san francisco', 'new york', 'kraków', 'warszawa',
  'zürich', 'london', 'munich', 'paris', 'toronto', 'calgary', 'manchester',
  'stockholm', 'belgrade', 'wrocław', 'gdańsk', 'wellington', 'sydney',
  'seoul', 'tokyo', 'madrid', 'berlin', 'chicago', 'denver', 'seattle'
];

const INDIA_REMOTE_KEYWORDS = [
  'india', 'bangalore', 'bengaluru', 'pune', 'mumbai', 'hyderabad', 'chennai',
  'gurgaon', 'gurugram', 'noida', 'delhi', 'kolkata', 'remote', 'anywhere', 'global', 'worldwide'
];

const now = new Date('2026-08-13');
const CUTOFF_DAYS = 60;
const cutoffMs = now.getTime() - (CUTOFF_DAYS * 24 * 60 * 60 * 1000);

let totalEntries = 0;
let keptCount = 0;
let droppedAlreadyApplied = 0;
let droppedStaleDate = 0;
let droppedSenior = 0;
let droppedLocation = 0;
let droppedNonDev = 0;
let droppedNoTechKw = 0;
let droppedDuplicates = 0;
let droppedProcessedStrikethrough = 0;

const newLines = [];
const seenCompanyTitleLoc = new Set();

for (const line of pipelineContent.split('\n')) {
  const trimmed = line.trim();

  // Preserve title and markdown instructions
  if (!trimmed.startsWith('- [')) {
    newLines.push(line);
    continue;
  }

  totalEntries++;

  // Strikethrough processed items `- [x] ~~...~~`
  if (trimmed.startsWith('- [x]') || trimmed.startsWith('- [X]')) {
    droppedProcessedStrikethrough++;
    continue;
  }

  const parts = trimmed.split('|').map(p => p.trim());
  const rawUrlMatch = trimmed.match(/https?:\/\/[^\s|]+/);
  const url = rawUrlMatch ? rawUrlMatch[0].toLowerCase().trim() : '';

  // 1. Check if already applied
  if (url && appliedUrls.has(url)) {
    droppedAlreadyApplied++;
    continue;
  }

  const company = (parts[1] || '').toLowerCase();
  const role = (parts[2] || '').toLowerCase();
  const fullLineLower = trimmed.toLowerCase();

  // 2. Check non-dev domains
  if (NON_DEV_DOMAINS.some(t => role.includes(t) || fullLineLower.includes(t))) {
    droppedNonDev++;
    continue;
  }

  // 3. Check Seniority / Level 2 / YOE > 2 years
  if (SENIOR_TIER_RE.test(fullLineLower) || YOE_EXCLUDE_RE.test(fullLineLower)) {
    droppedSenior++;
    continue;
  }

  // 4. Check explicit Software/Developer/AI tech keyword requirement
  if (!MUST_BE_TECH_RE.test(role) && !MUST_BE_TECH_RE.test(company)) {
    droppedNoTechKw++;
    continue;
  }

  // 5. Check posting date
  const postedMatch = trimmed.match(/posted:\s*(\d{4}-\d{2}-\d{2})/);
  if (postedMatch) {
    const postedDate = new Date(postedMatch[1]);
    if (!isNaN(postedDate.getTime()) && postedDate.getTime() < cutoffMs) {
      droppedStaleDate++;
      continue;
    }
  }

  // 6. Check location
  const locationText = (parts[3] || '').toLowerCase();
  if (locationText) {
    const hasIndiaRemote = INDIA_REMOTE_KEYWORDS.some(k => locationText.includes(k));
    const hasNonIndiaLocal = LOCAL_NON_INDIA_REGIONS.some(k => locationText.includes(k));

    if (hasNonIndiaLocal && !hasIndiaRemote) {
      droppedLocation++;
      continue;
    }
  }

  // 7. Check duplicate Company + Normalized Title + Location
  const normRole = role
    .replace(/_[0-9a-z]+-?[0-9]*$/i, '')
    .replace(/\s*__\s*.*/, '')
    .replace(/\s*–\s*.*/, '')
    .replace(/\s*-\s*(gurgaon|bangalore|bengaluru|chennai|mumbai|pune|hyderabad|delhi|noida|india).*/i, '')
    .trim();
  const dupKey = company + '::' + normRole + '::' + locationText;
  if (seenCompanyTitleLoc.has(dupKey)) {
    droppedDuplicates++;
    continue;
  }
  seenCompanyTitleLoc.add(dupKey);

  // Kept item!
  keptCount++;
  newLines.push(line);
}

console.log('=== Pipeline Cleanup Summary ===');
console.log(`Total original pipeline entries: ${totalEntries}`);
console.log(`- Dropped (Already Applied): ${droppedAlreadyApplied}`);
console.log(`- Dropped (Strikethrough [x]): ${droppedProcessedStrikethrough}`);
console.log(`- Dropped (Stale > ${CUTOFF_DAYS} days): ${droppedStaleDate}`);
console.log(`- Dropped (Senior/Staff/L2/>2 YOE): ${droppedSenior}`);
console.log(`- Dropped (Non-dev domain: Tax, Support, Analyst, Success, Audit): ${droppedNonDev}`);
console.log(`- Dropped (No explicit Software/Developer/AI tech keyword): ${droppedNoTechKw}`);
console.log(`- Dropped (Non-India/Local EU/US): ${droppedLocation}`);
console.log(`- Dropped (Duplicate Company+Title+Location reqs): ${droppedDuplicates}`);
console.log(`================================`);
console.log(`Kept clean, 0-2 YOE software/AI roles: ${keptCount}`);

if (!isDryRun) {
  const cleanedText = newLines.join('\n').replace(/\n{3,}/g, '\n\n');
  writeFileSync(PIPELINE_PATH, cleanedText, 'utf-8');
  console.log(`\n✅ Saved updated data/pipeline.md (${keptCount} entries left).`);
} else {
  console.log('\n[DRY RUN] No files were modified.');
}

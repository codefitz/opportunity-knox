import { load } from 'cheerio';
import { cleanJobUrl } from './url-cleaner.mjs';

const MAX_DESCRIPTION = 200_000;
const MAX_FIELD = 10_000;
const JOB_TYPES = new Set(['jobposting']);
const DATE = /^(\d{4}-\d{2}-\d{2})(?:$|T)/;
const CLEANUP = 'script,style,noscript,template,nav,footer,header,aside,[role="navigation"],[role="banner"],[role="contentinfo"],[hidden],[aria-hidden="true"],.cookie-banner,.cookie-consent,#cookie-banner,#onetrust-banner-sdk,[data-testid="cookie-banner"],.share-buttons,.social-share';
const DESCRIPTION_SELECTORS = [
  '[itemprop="description"]', '[data-testid="job-description"]', '[data-test-id="job-description"]',
  '[data-test="job-description"]', '[data-testid*="job-description"]', '[data-testid*="jobDescription"]',
  '[data-automation-id="jobPostingDescription"]', '[data-automation="jobDescription"]',
  '#jobDescriptionText', '#job-description', '#job-detail .content', '.job-description', '.jobs-description', '.show-more-less-html__markup',
  '.jobs-description-content', '.description__text', '[class*="job-description"]', '[class*="jobDescription"]',
  '.career-detail', '.job-detail', '.single-job-listing', '.entry-content',
  'article', 'main', '[role="main"]',
];
const genericTitle = /^(?:jobs?|careers?(?:\s+at\b.*)?|job\s+search|search\s+(?:jobs|results)|open\s+(?:positions|roles)|job\s+opportunities|vacancies|find\s+(?:a\s+)?job)(?:\s*[|–—-].*)?$/i;
const jobSignals = /\b(?:responsibilit(?:y|ies)|requirements?|qualifications?|experience|skills?|salary|benefits|employment|apply|applicants?|candidates?)\b|\b(?:about\s+(?:the\s+)?(?:role|job)|you\s+will|we\s+are\s+looking|what\s+you|join\s+(?:our|the))\b/gi;
const SALARY_PATTERN = /(?:(?:[£$€]|(?:GBP|USD|EUR)\s*)\s*\d[\d,]*(?:\.\d+)?(?:\s*k\b)?|\b\d{2,3}k\s*(?:per\s+(?:annum|year)|a\s+year)\b)(?:\s*(?:-|–|—|to)\s*(?:[£$€]|(?:GBP|USD|EUR)\s*)?\s*\d[\d,]*(?:\.\d+)?(?:\s*k\b)?)?(?:\s*(?:a|per|\/)\s*(?:year|annum|yr|month|mo|week|wk|day|hour|hr))?/i;
const APPLICANT_PATTERN = /\b((?:over\s+|more\s+than\s+|be\s+among\s+the\s+first\s+)?(?:\d+[\d,]*\+?\s+)?applicants?)\b/i;

export function detectWorkMode(text) {
  if (!text || typeof text !== 'string') return '';
  const clean = text.trim();
  if (/\b(?:fully\s+remote|remote\s+first|100%\s+remote|remote|work\s+from\s+home|telecommute|wfh)\b/i.test(clean) && !/\b(?:not\s+remote|no\s+remote|non-remote)\b/i.test(clean)) {
    if (/\bhybrid\b/i.test(clean)) return 'Hybrid';
    return 'Remote';
  }
  if (/\b(?:hybrid|flexible\s+(?:remote|office)|partially\s+remote)\b/i.test(clean)) {
    return 'Hybrid';
  }
  if (/\b(?:on-?site|in-?office|office\s+based|site\s+based)\b/i.test(clean)) {
    return 'On-site';
  }
  return '';
}

export class JobPageParseError extends Error {
  constructor(message, status = 422, code = 'JOB_PAGE_UNREADABLE') {
    super(message); this.name = 'JobPageParseError'; this.status = status; this.code = code;
  }
}
function unreadable(message, code) { throw new JobPageParseError(message, 422, code); }

/**
 * Detect whether an HTML document looks like a client-side JavaScript shell / SPA
 * where main content is rendered dynamically in the browser rather than server-side.
 */
export function isJavaScriptShell(html) {
  if (typeof html !== 'string') return false;
  // If it's very large, it likely has substantive static content
  if (html.length > 500_000) return false;
  const $ = load(html);
  
  // Explicit noscript warning or message
  const noscriptText = $('noscript').text().toLowerCase();
  if (/(?:you need to enable javascript|javascript is required|enable javascript to run this app|requires javascript)/i.test(noscriptText)) {
    return true;
  }

  // Classic SPA root mounts with little or no static inner text
  const rootSelectors = ['#root', '#app', '#__next', '#__nuxt', '#app-root', '#application', '[data-reactroot]', 'workday-app'];
  for (const sel of rootSelectors) {
    const el = $(sel);
    if (el.length > 0) {
      const text = plain(el.text());
      if (text.length < 150) return true;
    }
  }

  // Check overall body text length excluding scripts/styles
  const bodyClone = $('body').clone();
  bodyClone.find('script,style,noscript,svg').remove();
  const bodyText = plain(bodyClone.text());
  const scriptCount = $('script[src]').length;

  // If there are external script bundles and almost no visible body text (< 200 chars)
  if (scriptCount >= 1 && bodyText.length < 200) {
    return true;
  }

  return false;
}

function normaliseText(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/\0/g, '')
    .split('\n').map(line => line.replace(/[\t\f\v ]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}
function decodedText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  let text = String(value);
  for (let pass = 0; pass < 2; pass++) {
    const $ = load(text);
    $(CLEANUP).remove();
    $('br').replaceWith('\n');
    $('li').each((_, element) => { $(element).prepend('• ').append('\n'); });
    $('p,div,section,article,h1,h2,h3,h4,h5,h6,ul,ol,blockquote').each((_, element) => $(element).append('\n\n'));
    const next = normaliseText($.root().text());
    // Some publishers HTML-escape the entire structured description. Parse its
    // decoded markup once more, while leaving ordinary comparison symbols alone.
    if (pass === 0 && /&(?:lt|gt|amp);|<\/?(?:p|div|li|ul|ol|br|h[1-6]|section)\b/i.test(next) && next !== text) { text = next; continue; }
    return next;
  }
  return normaliseText(text);
}
function plain(value) { return decodedText(value).replace(/\s+/g, ' ').trim(); }
function values(value) { return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]; }
function unique(items) { return [...new Set(items.filter(Boolean))]; }
function typeName(value) { return typeof value === 'string' ? value.toLowerCase().split(/[/#]/).pop() : ''; }
function isJob(value) { return value && typeof value === 'object' && values(value['@type']).some(type => JOB_TYPES.has(typeName(type))); }
function safeUrl(value, base) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4000) return '';
  try { const parsed = new URL(value, base); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : ''; } catch { return ''; }
}
function matchUrl(value, base) {
  const str = safeUrl(value, base); if (!str) return '';
  return cleanJobUrl(str);
}
function actualDate(value, warnings) {
  const input = typeof value === 'string' ? value.trim() : ''; const match = input.match(DATE);
  if (!match) { if (input) warnings.push('The published application deadline was not a recognised date; enter it manually.'); return ''; }
  const day = match[1]; const parsed = new Date(day);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) { warnings.push('The published application deadline was invalid; enter it manually.'); return ''; }
  return day;
}
function parseDateIso(value) {
  const input = typeof value === 'string' ? value.trim() : '';
  const match = input.match(DATE);
  if (!match) return '';
  const day = match[1];
  const parsed = new Date(day);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return '';
  return day;
}
function graphData($, warnings) {
  const all = []; const index = new Map(); let count = 0;
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (++count > 25_000) throw new JobPageParseError('The page contains too much structured data to read safely.', 413, 'JOB_PAGE_TOO_LARGE');
    if (Array.isArray(value)) { for (const child of value) visit(child); return; }
    all.push(value);
    if (typeof value['@id'] === 'string') index.set(value['@id'], { ...(index.get(value['@id']) || {}), ...value });
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
  }
  $('script').each((_, element) => {
    const type = ($(element).attr('type') || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/ld+json') return;
    let input = $(element).html()?.trim() || ''; if (!input) return;
    input = input.replace(/^<!--\s*/, '').replace(/\s*-->$/, '');
    try { visit(JSON.parse(input)); } catch (error) {
      if (error instanceof JobPageParseError) throw error;
      warnings.push('Some page details could not be read; check the extracted details.');
    }
  });
  function deref(input, seen = new Set()) {
    if (typeof input === 'string' && index.has(input)) {
      if (seen.has(input)) return index.get(input);
      return deref(index.get(input), new Set([...seen, input]));
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
    const id = input['@id'];
    if (typeof id === 'string' && index.has(id) && !seen.has(id)) return { ...deref(index.get(id), new Set([...seen, id])), ...input };
    return input;
  }
  return { jobs: all.filter(isJob).map(item => deref(item)), deref };
}
function organisationName(value, deref) {
  return unique(values(value).map(item => {
    const org = deref(item);
    return typeof org === 'string' ? plain(org) : org && typeof org === 'object' ? plain(org.name || org.legalName) : '';
  })).join('; ');
}
function locationName(value, deref) {
  return unique(values(value).map(item => {
    const place = deref(item); if (typeof place === 'string') return plain(place); if (!place || typeof place !== 'object') return '';
    const address = deref(place.address) || place;
    if (typeof address === 'string') return unique([plain(place.name), plain(address)]).join(', ');
    if (!address || typeof address !== 'object') return plain(place.name);
    const country = deref(address.addressCountry);
    return unique([plain(place.name), plain(address.streetAddress), plain(address.addressLocality), plain(address.addressRegion), plain(address.postalCode), typeof country === 'object' ? plain(country?.name) : plain(country)]).join(', ');
  })).join('; ');
}
function numeric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value);
  if (typeof value === 'string' && /^-?\d[\d,]*(?:\.\d+)?$/.test(value.trim())) return numeric(Number(value.replaceAll(',', '')));
  return '';
}
function salaryText(value, currencyHint, deref) {
  return unique(values(value).map(item => {
    const salary = deref(item); if (typeof salary === 'number') return [plain(currencyHint), numeric(salary)].filter(Boolean).join(' ');
    if (typeof salary === 'string') return plain(salary);
    if (!salary || typeof salary !== 'object') return '';
    const amount = deref(salary.value) ?? salary;
    const currency = plain(salary.currency || currencyHint);
    const rawUnit = plain(amount?.unitText || amount?.unitCode || salary.unitText).toUpperCase();
    const unit = ({ YEAR: 'year', YR: 'year', ANN: 'year', MONTH: 'month', MON: 'month', WEEK: 'week', WEE: 'week', DAY: 'day', D: 'day', HOUR: 'hour', HUR: 'hour', HR: 'hour' })[rawUnit];
    let range;
    if (typeof amount === 'number' || typeof amount === 'string') range = numeric(amount) || plain(amount);
    else {
      const min = numeric(amount?.minValue); const max = numeric(amount?.maxValue);
      range = min && max && min !== max ? `${min}–${max}` : min || max || numeric(amount?.value);
    }
    return range ? [currency, range, unit ? `per ${unit}` : rawUnit ? `per ${rawUnit.toLowerCase()}` : ''].filter(Boolean).join(' ') : '';
  })).join('; ');
}
function contactText(value, deref) {
  return unique(values(value).map(item => {
    const contact = deref(item); if (typeof contact === 'string') return plain(contact); if (!contact || typeof contact !== 'object') return '';
    return unique([plain(contact.name), plain(contact.email).replace(/^mailto:/i, ''), plain(contact.telephone)]).join(' · ');
  })).join('; ');
}
function identifierText(value, deref) {
  return unique(values(value).map(item => {
    const id = deref(item);
    if (typeof id === 'string' || typeof id === 'number') return plain(id);
    if (id && typeof id === 'object') return plain(id.value);
    return '';
  })).join('; ');
}
function structuredFields(job, deref, warnings) {
  const company = organisationName(job.hiringOrganization, deref);
  const locationTypes = [...values(job.jobLocationType), ...values(job.workplaceType), ...values(job.workMode)].map(plain);
  const remote = locationTypes.some(item => /^(?:telecommute|remote)$/i.test(item));
  const hybrid = locationTypes.some(item => /^hybrid$/i.test(item));
  const onsite = locationTypes.some(item => /^(?:on-?site|in-?office|office)$/i.test(item));
  let workMode = remote ? 'Remote' : hybrid ? 'Hybrid' : onsite ? 'On-site' : '';
  if (!workMode && typeof job.title === 'string') {
    workMode = detectWorkMode(job.title);
  }
  let location = locationName(job.jobLocation, deref);
  if (remote) location = unique([location, locationName(job.applicantLocationRequirements, deref)]).join('; ');
  let description = decodedText(job.description);
  for (const [key, label] of [['responsibilities','Responsibilities'],['qualifications','Qualifications'],['educationRequirements','Education'],['experienceRequirements','Experience'],['skills','Skills']]) {
    const section = values(job[key]).map(item => decodedText(typeof item === 'object' ? deref(item)?.description : item)).filter(Boolean).join('\n');
    if (section && !description.includes(section)) description += `${description ? '\n\n' : ''}${label}\n${section}`;
  }
  const employer = deref(values(job.hiringOrganization)[0]);
  const datePosted = parseDateIso(job.datePosted) || (typeof job.datePosted === 'string' ? plain(job.datePosted) : '');
  return {
    company, role: plain(job.title || job.name), jobReference: identifierText(job.identifier, deref),
    location, workMode,
    salary: salaryText(job.baseSalary || job.estimatedSalary, job.salaryCurrency, deref),
    employmentType: unique(values(job.employmentType).map(item => plain(item).replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, char => char.toUpperCase()))).join('; '),
    contact: contactText(job.applicationContact || job.contact || employer?.contactPoint, deref),
    deadline: actualDate(job.validThrough, warnings),
    datePosted,
    description,
  };
}
function candidateLinks(job, deref) {
  const mainEntity = deref(job.mainEntityOfPage);
  return unique([typeof job.url === 'string' ? job.url : job.url?.['@id'], typeof mainEntity === 'string' ? mainEntity : mainEntity?.url || mainEntity?.['@id'], job['@id']]);
}
function selectJob(jobs, deref, sourceUrl, warnings) {
  const distinct = new Map();
  for (const job of jobs) {
    const title = plain(job.title || job.name); const company = organisationName(job.hiringOrganization, deref);
    // References and repeated render copies of the same posting are common.
    const primaryLink = safeUrl(typeof job.url === 'string' ? job.url : job.url?.['@id'], sourceUrl) || safeUrl(job['@id'], sourceUrl);
    const key = `${primaryLink ? matchUrl(primaryLink, sourceUrl) : ''}|${title.toLowerCase()}|${company.toLowerCase()}`;
    if (!title && !job.description) continue;
    const previous = distinct.get(key);
    if (!previous || decodedText(job.description).length > decodedText(previous.description).length) distinct.set(key, job);
  }
  const candidates = [...distinct.values()]; if (!candidates.length) return null;
  const pageUrl = matchUrl(sourceUrl, sourceUrl);
  const matches = candidates.filter(job => candidateLinks(job, deref).some(link => {
    const m = matchUrl(link, sourceUrl);
    if (m === pageUrl) return true;
    try {
      const p1 = new URL(link, sourceUrl);
      const p2 = new URL(sourceUrl);
      const jid1 = p1.searchParams.get('gh_jid') || p1.searchParams.get('token');
      const jid2 = p2.searchParams.get('gh_jid');
      if (jid1 && jid2 && jid1 === jid2) return true;
    } catch {}
    return false;
  }));
  if (candidates.length > 1) {
    if (matches.length !== 1) unreadable('This page contains several different jobs. Open a specific job listing or paste its description instead.', 'JOB_PAGE_AMBIGUOUS');
    warnings.push('Several jobs were present; the listing whose URL matches this page was selected. Confirm the role and employer.');
    return matches[0];
  }
  if (!matches.length && candidateLinks(candidates[0], deref).some(link => safeUrl(link, sourceUrl))) warnings.push('The job details link to a different page. Confirm this is the opportunity you intended to capture.');
  return candidates[0];
}
function primaryHeading($) {
  const jobTitle = plain($('.top-card-layout__title').first().text());
  if (jobTitle && !genericTitle.test(jobTitle)) return jobTitle;
  const heading = plain($('h1').first().text());
  if (heading && !genericTitle.test(heading)) return heading;
  const metaTitle = plain($('meta[property="og:title"]').first().attr('content'));
  if (metaTitle && !genericTitle.test(metaTitle)) return metaTitle;
  const pageTitle = plain($('title').first().text());
  return pageTitle && !genericTitle.test(pageTitle) ? pageTitle : '';
}
function blockedPage($, originalTitle) {
  const primaryHeadings = $('h1').toArray().slice(0, 2).map(element => plain($(element).text()));
  if (!originalTitle && !primaryHeadings.length) primaryHeadings.push(plain($('h2').first().text()));
  const headings = unique([originalTitle, ...primaryHeadings]);
  const challenge = /^(?:access\s+denied|request\s+(?:blocked|rejected)|(?:403|401)(?:\s*[-:|].*)?|forbidden|just\s+a\s+moment\b.*|checking\s+(?:your\s+)?browser\b.*|(?:security|human)\s+verification(?:\s+required)?[.!:]?|verify\s+(?:that\s+)?you(?:'re|\s+are)?\s+(?:a\s+)?human\b.*|captcha\b.*|robot\s+check\b.*|sign\s*in(?:\s+to\b.*)?|log\s*in(?:\s+to\b.*)?)$/i;
  if (headings.some(heading => challenge.test(heading))) return true;
  const body = plain($('body').text());
  return body.length < 1600 && /(?:verify (?:that )?you(?:'re| are) human|access (?:to this page (?:has been |is ))?denied|request (?:has been )?blocked|enable javascript and cookies to continue|complete (?:the |this )?(?:captcha|security check)|unusual traffic from your|sign in to (?:view|see|access) (?:this|the) (?:job|listing)|checking your browser before (?:accessing|continuing))/i.test(body);
}
function fallbackFields($, warnings) {
  const fields = { role: primaryHeading($) };
  const companySelectors = [
    '[itemprop="hiringOrganization"] [itemprop="name"]',
    '[itemprop="hiringOrganization"]',
    '[data-testid="company-name"]',
    '[data-testid="job-company"]',
    '[data-testid="employer-name"]',
    '[data-test="employer-name"]',
    '.company-name',
    '.employer-name',
    '.company__name',
    '.job-company-name',
    '[class*="company-name"]',
    '[class*="employerName"]',
    '.topcard__org-name-link',
  ];
  for (const selector of companySelectors) {
    const element = $(selector).first();
    const company = plain(element.attr('content') || element.text());
    if (company) { fields.company = company; break; }
  }
  for (const [key, selectors] of Object.entries({
    location: ['[itemprop="jobLocation"]','[data-testid="job-location"]','.job-location','span.topcard__flavor--bullet'],
    salary: ['[itemprop="baseSalary"]','[data-testid="job-salary"]','.job-salary','[data-test-id="salary-compensation"]','.compensation__salary','.salary-snippet-container','[data-testid="attribute_snippets_test_id"]','[data-testid="jobsearch-JobInfoHeader-salary"]'],
    employmentType: ['[itemprop="employmentType"]','[data-testid="employment-type"]'],
    workMode: ['[data-testid="workplace-type"]','[data-testid="work-mode"]','.jobs-unified-top-card__workplace-type','[data-automation="job-workplace-type"]','.workplace-type'],
    jobReference: ['[itemprop="identifier"]','[data-testid="job-reference"]'],
  })) for (const selector of selectors) {
    const element = $(selector).first(); const text = plain(element.attr('content') || element.text());
    if (text) { fields[key] = text; break; }
  }

  // Refine workMode
  if (fields.workMode) {
    const mode = detectWorkMode(fields.workMode);
    if (mode) fields.workMode = mode;
  }
  if (!fields.workMode) {
    for (const selector of [
      '.job-details-jobs-unified-top-card__job-insight',
      'span.topcard__flavor--bullet',
      '.topcard__flavor',
      '[class*="workplace"]',
      '[class*="workMode"]',
    ]) {
      $(selector).each((_, el) => {
        if (fields.workMode) return;
        const mode = detectWorkMode(plain($(el).text()));
        if (mode) fields.workMode = mode;
      });
      if (fields.workMode) break;
    }
  }
  if (!fields.workMode) {
    $('.description__job-criteria-item').each((_, element) => {
      const label = plain($(element).find('.description__job-criteria-subheader').text());
      const val = plain($(element).find('.description__job-criteria-text').text());
      if (/workplace|work\s*mode|arrangement/i.test(label)) {
        fields.workMode = detectWorkMode(val) || val;
      }
    });
  }

  // Refine salary if missing
  if (!fields.salary) {
    for (const selector of [
      '.job-details-jobs-unified-top-card__job-insight',
      'span.topcard__flavor--bullet',
      '.topcard__flavor',
      '.job-details-jobs-unified-top-card__primary-description-container',
      '.top-card-layout',
    ]) {
      $(selector).each((_, el) => {
        if (fields.salary) return;
        const text = plain($(el).text());
        const match = text.match(SALARY_PATTERN);
        if (match) fields.salary = match[0].trim();
      });
      if (fields.salary) break;
    }
  }

  // LinkedIn Easy Apply
  const easyApply = $('.jobs-apply-button--easy-apply, [data-is-easy-apply="true"]').length > 0 ||
    $('button, a').toArray().some(el => {
      const t = plain($(el).text());
      return /^easy\s*apply$/i.test(t) || /\beasy\s*apply\b/i.test(t);
    });
  if (easyApply) {
    fields.applicationRoute = 'LinkedIn Easy Apply';
  }

  // Date posted
  for (const selector of [
    '[itemprop="datePosted"]',
    'meta[property="og:article:published_time"]',
    'meta[name="datePosted"]',
    'time[datetime]',
    '[data-testid="job-posting-date"]',
    '.posted-time-ago__text',
    '[data-testid="myJobsStateDate"]',
  ]) {
    const el = $(selector).first();
    if (el.length) {
      const raw = el.attr('datetime') || el.attr('content') || plain(el.text());
      const iso = parseDateIso(raw);
      if (iso) {
        fields.datePosted = iso;
        break;
      } else if (raw && /\b(?:\d+\s+(?:day|week|month|hour|minute)s?\s+ago|today|yesterday)\b/i.test(raw)) {
        const m = raw.match(/\b(?:\d+\s+(?:day|week|month|hour|minute)s?\s+ago|today|yesterday)\b/i);
        if (m) { fields.datePosted = m[0]; break; }
      }
    }
  }

  // Applicant count
  for (const selector of [
    '.num-applicants__caption',
    'figure.topcard__flavor--bullet',
    '.job-details-jobs-unified-top-card__job-insight',
    '.jobs-unified-top-card__bullet',
    'span.topcard__flavor--bullet',
  ]) {
    $(selector).each((_, el) => {
      if (fields.applicantCount) return;
      const text = plain($(el).text());
      const match = text.match(APPLICANT_PATTERN);
      if (match) {
        fields.applicantCount = match[1].trim();
      }
    });
    if (fields.applicantCount) break;
  }

  // Amazon Jobs publishes visible sections rather than JobPosting JSON-LD.
  const jobMeta = plain($('#job-detail .details-line .meta').first().text())
    .match(/^Job ID:\s*([^|]+)\s*\|\s*(.+)$/i);
  if (jobMeta) {
    fields.jobReference ||= jobMeta[1].trim();
    fields.company ||= jobMeta[2].trim();
    fields.location ||= unique($('#job-detail .location-icon .association-content li')
      .toArray().map(element => plain($(element).text()))).join('; ');
  }
  if (!fields.employmentType) $('.description__job-criteria-item').each((_, element) => {
    const label = plain($(element).find('.description__job-criteria-subheader').text());
    if (/^employment type$/i.test(label)) fields.employmentType = plain($(element).find('.description__job-criteria-text').text());
  });
  const expires = $('[itemprop="validThrough"]').first();
  if (expires.length) fields.deadline = actualDate(expires.attr('content') || expires.attr('datetime') || expires.text(), warnings);
  for (let index = 0; index < DESCRIPTION_SELECTORS.length; index++) {
    const selector = DESCRIPTION_SELECTORS[index];
    const candidates = $(selector).toArray().map(element => decodedText($(element).html() || $(element).text())).filter(Boolean);
    candidates.sort((a,b) => b.length - a.length);
    const selected = candidates.find(text => text.length >= 120 && ((text.match(jobSignals) || []).length >= (index < DESCRIPTION_SELECTORS.length - 3 ? 1 : 2)));
    if (selected) { fields.description = selected; break; }
  }
  if (!fields.description) {
    const metaDescription = decodedText($('meta[name="description"]').first().attr('content') || $('meta[property="og:description"]').first().attr('content'));
    // A search-result teaser alone is insufficient to preserve a useful JD.
    if (metaDescription.length >= 240 && (metaDescription.match(jobSignals) || []).length >= 3) {
      fields.description = metaDescription;
      warnings.push('Only the page summary was available; the full job description may be missing.');
    }
  }
  if (!fields.workMode && fields.description) {
    const early = fields.description.slice(0, 800);
    const mode = detectWorkMode(early);
    if (mode) fields.workMode = mode;
  }
  if (!fields.salary && fields.description) {
    const early = fields.description.slice(0, 1000);
    const match = early.match(SALARY_PATTERN);
    if (match) fields.salary = match[0].trim();
  }
  return fields;
}

/** Read one already-fetched HTML page. This function performs no network access. */
export function parseJobPage(html, { url } = {}) {
  const sourceUrl = safeUrl(url);
  if (!sourceUrl) unreadable('A complete http or https source URL is required.', 'JOB_PAGE_INVALID_URL');
  if (typeof html !== 'string' || !html.trim()) unreadable('The page was empty. Upload or paste the job description instead.');
  if (Buffer.byteLength(html) > 4 * 1024 * 1024) throw new JobPageParseError('The job page is too large to parse.', 413, 'JOB_PAGE_TOO_LARGE');
  const warnings = [];
  const $ = load(html);
  const title = plain($('title').first().text());
  const { jobs, deref } = graphData($, warnings);
  // Remove page chrome only after reading JSON-LD. It is a source of structured
  // facts, whereas scripts and navigation must never enter the saved JD text.
  $(CLEANUP).remove();
  if (blockedPage($, title)) unreadable('The site returned a login, access restriction, or bot-check page. Upload or paste the job description instead.', 'JOB_PAGE_BLOCKED');
  const job = selectJob(jobs, deref, sourceUrl, warnings);
  let fields; let method;
  if (job) {
    fields = structuredFields(job, deref, warnings); method = 'structured-data';
    const fallbackWarnings = [];
    const fallback = fallbackFields($, fallbackWarnings);
    if (!fields.role && fallback.role) fields.role = fallback.role;
    if ((!fields.description || fields.description.length < 100) && fallback.description?.length > (fields.description?.length || 0)) {
      fields.description = fallback.description;
    }
    if (!fields.company && fallback.company) fields.company = fallback.company;
    if (!fields.salary && fallback.salary) fields.salary = fallback.salary;
    if (!fields.workMode && fallback.workMode) fields.workMode = fallback.workMode;
    if (!fields.applicationRoute && fallback.applicationRoute) fields.applicationRoute = fallback.applicationRoute;
    if (!fields.datePosted && fallback.datePosted) fields.datePosted = fallback.datePosted;
    if (!fields.applicantCount && fallback.applicantCount) fields.applicantCount = fallback.applicantCount;
    if (!fields.location && fallback.location) fields.location = fallback.location;
    if (!fields.employmentType && fallback.employmentType) fields.employmentType = fallback.employmentType;
    if (!fields.jobReference && fallback.jobReference) fields.jobReference = fallback.jobReference;
    if (!fields.deadline && fallback.deadline) {
      fields.deadline = fallback.deadline;
      for (const w of fallbackWarnings) {
        if (/deadline/i.test(w)) warnings.push(w);
      }
    }
  } else {
    fields = fallbackFields($, warnings); method = 'page-content';
    warnings.push('Details were read from the page content. Please check them against the listing.');
  }
  if (!fields.role || genericTitle.test(fields.role) || !fields.description || fields.description.length < 100) {
    if (isJavaScriptShell(html)) {
      unreadable(
        'This job listing appears to require JavaScript to render. Open the listing in your browser and paste its text or upload the job description.',
        'JOB_PAGE_JS_REQUIRED',
      );
    }
    unreadable('A useful job description could not be found on this page. Open the individual listing or upload/paste the description instead.');
  }
  if (!fields.company) warnings.push('The employer could not be identified. Enter it manually.');
  const cleanSource = cleanJobUrl(sourceUrl);
  fields.url = cleanSource;
  const output = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const max = key === 'description' ? MAX_DESCRIPTION : key === 'url' ? 4000 : MAX_FIELD;
    if (value.length > max) warnings.push(`The ${key === 'description' ? 'job description' : key} was truncated to ${max.toLocaleString('en-GB')} characters. Consult the source before saving.`);
    output[key] = value.slice(0, max);
  }
  return { fields: output, method, warnings: unique(warnings), sourceUrl: cleanSource, resolvedUrl: cleanSource, retrievedAt: new Date().toISOString() };
}

// Clean job URLs by stripping tracking, referral, marketing, and session query parameters
// while strictly preserving routing keys and job identifiers (e.g. jk, vjk, gh_jid, id).

const TRACKING_PARAM_REGEX = /^(?:utm_[a-z0-9_]*|itm_[a-z0-9_]*|ga_[a-z0-9_]*|gclid|fbclid|msclkid|dclid|twclid|ttclid|yclid|wbraid|gbraid|mc_[a-z0-9_]*|_hs[a-z0-9_]*|hsctatracking|trk|trackingid|refid|midtoken|trkinfo|originalsubdomain|lici|rcm|ebp|recommendedflavor|tk|from|rjptk|xpse|xfps|xkcb|vjs|fromage|advn|co|jobtype|gh_src|lever-source|lever-origin|sid|si|igshid|subid|ref|source|campaign|partner|affiliate|spjobid|spmailingid|spuserid|spreportid)$/i;

const PRESERVED_KEYS = new Set([
  'jk',
  'vjk',
  'gh_jid',
  'id',
  'jobid',
  'job_id',
  'jid',
  'reqid',
  'req_id',
  'vacancy_id',
  'position_id',
  'p',
  'viewjob',
]);

/**
 * Strips tracking query parameters from job URLs and canonicalizes path formatting.
 *
 * @param {string} rawUrl - The input URL string to clean
 * @param {string|URL} [base] - Optional base URL for resolving relative links
 * @returns {string} - Cleaned canonical URL
 */
export function cleanJobUrl(rawUrl, base) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '';
  let url;
  try {
    url = new URL(rawUrl.trim(), base);
  } catch {
    return rawUrl.trim();
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return rawUrl.trim();
  }

  // Remove tracking or empty fragment hashes
  if (url.hash && (/^#(?:utm_|xtor|ref|trk)/i.test(url.hash) || url.hash === '#')) {
    url.hash = '';
  }

  // Strip known tracking keys while strictly preserving essential job identifiers
  for (const key of [...url.searchParams.keys()]) {
    const lowerKey = key.toLowerCase();
    if (PRESERVED_KEYS.has(lowerKey)) continue;
    if (TRACKING_PARAM_REGEX.test(key) || TRACKING_PARAM_REGEX.test(lowerKey)) {
      url.searchParams.delete(key);
    }
  }

  // Normalize search parameters order for deterministic canonical comparison
  url.searchParams.sort();

  // Strip trailing slashes on pathname unless it is the root path '/'
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  return url.href;
}

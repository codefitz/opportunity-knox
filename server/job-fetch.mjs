import http from "node:http";
import https from "node:https";
import { lookup as systemLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import ipaddr from "ipaddr.js";

const MAX_BYTES = 2 * 1024 * 1024;
const DEADLINE_MS = 15_000;
const MAX_REDIRECTS = 4;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const INTERNAL_SUFFIXES = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "lan",
  "home",
  "test",
  "invalid",
  "onion",
];

export class JobFetchError extends Error {
  constructor(message, code = "FETCH_FAILED", status = 422) {
    super(message);
    this.name = "JobFetchError";
    this.code = code;
    this.status = status;
  }
}

function invalid(message) {
  return new JobFetchError(message, "INVALID_URL", 400);
}

function timeoutError() {
  return new JobFetchError(
    "The job page took too long to respond. Try again, paste its text, or upload the job description.",
    "TIMEOUT",
  );
}

function validateUrl(input) {
  if (
    typeof input !== "string" ||
    input.length > 8192 ||
    /[\u0000-\u001f\u007f]/u.test(input)
  ) {
    throw invalid("Enter a complete public http:// or https:// job-page URL.");
  }
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw invalid("Enter a complete public http:// or https:// job-page URL.");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw invalid("Only public HTTP and HTTPS job-page URLs are supported.");
  if (url.username || url.password)
    throw invalid(
      "Job-page URLs containing a username or password are not supported.",
    );
  if (url.port)
    throw invalid("Job-page URLs must use the standard HTTP or HTTPS port.");
  url.hash = "";
  const hostname = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (!hostname || hostname.includes("%"))
    throw invalid("Enter a public job-page hostname.");
  if (
    !isIP(hostname) &&
    (!hostname.includes(".") ||
      INTERNAL_SUFFIXES.some(
        (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
      ))
  ) {
    throw invalid(
      "Local and internal network addresses cannot be used as job-page URLs.",
    );
  }
  if (isIP(hostname)) assertPublicAddress(hostname);
  return { url, hostname };
}

function assertPublicAddress(address) {
  let parsed;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    throw new JobFetchError(
      "The job-page hostname returned an invalid network address.",
      "UNSAFE_ADDRESS",
    );
  }
  // Permit only ordinary globally routable unicast. This rejects loopback, RFC1918,
  // link-local, CGNAT, documentation, multicast, reserved and IPv4-mapped IPv6 ranges.
  if (
    parsed.range() !== "unicast" ||
    (parsed.kind() === "ipv6" && !parsed.match(ipaddr.parseCIDR("2000::/3")))
  ) {
    throw new JobFetchError(
      "Local, private, and reserved network addresses cannot be used as job-page URLs.",
      "UNSAFE_ADDRESS",
    );
  }
  // Additional special-purpose ranges that some ipaddr versions classify as unicast.
  const blocked =
    parsed.kind() === "ipv4"
      ? [
          "192.0.0.0/24",
          "192.0.2.0/24",
          "192.88.99.0/24",
          "198.18.0.0/15",
          "198.51.100.0/24",
          "203.0.113.0/24",
        ]
      : [
          "2001::/23",
          "2001:db8::/32",
          "2002::/16",
          "3fff::/20",
          "64:ff9b::/96",
          "64:ff9b:1::/48",
        ];
  if (blocked.some((range) => parsed.match(ipaddr.parseCIDR(range)))) {
    throw new JobFetchError(
      "Reserved network addresses cannot be used as job-page URLs.",
      "UNSAFE_ADDRESS",
    );
  }
}

function withDeadline(promise, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(timeoutError());
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutError()), remaining);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function resolvePublic(hostname, lookup, deadline) {
  if (isIP(hostname)) return { address: hostname, family: isIP(hostname) };
  let records;
  try {
    records = await withDeadline(
      Promise.resolve().then(() =>
        lookup(hostname, { all: true, verbatim: true }),
      ),
      deadline,
    );
  } catch (error) {
    if (error instanceof JobFetchError) throw error;
    throw new JobFetchError(
      "The job-page hostname could not be resolved. Check the link, or paste/upload the job description.",
      "DNS_ERROR",
    );
  }
  if (!Array.isArray(records) || !records.length)
    throw new JobFetchError(
      "The job-page hostname has no usable public address.",
      "DNS_ERROR",
    );
  for (const record of records) {
    if (
      !record ||
      !isIP(record.address) ||
      isIP(record.address) !== Number(record.family)
    ) {
      throw new JobFetchError(
        "The job-page hostname returned an invalid network address.",
        "UNSAFE_ADDRESS",
      );
    }
    assertPublicAddress(record.address);
  }
  return records[0];
}

function networkError(error) {
  if (error instanceof JobFetchError) return error;
  if (["ETIMEDOUT", "ESOCKETTIMEDOUT"].includes(error?.code))
    return timeoutError();
  if (/CERT|TLS|SSL/.test(error?.code || ""))
    return new JobFetchError(
      "A secure connection to this job page could not be verified. Paste its text or upload the job description instead.",
      "TLS_ERROR",
    );
  return new JobFetchError(
    "The job page could not be reached. Check the link, or paste/upload the job description.",
    "NETWORK_ERROR",
  );
}

function requestPage(url, address, deadline, maxBytes, injectedRequest) {
  return new Promise((resolve, reject) => {
    let request;
    let response;
    let streams = [];
    let settled = false;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(timeoutError());
    const timer = setTimeout(() => fail(timeoutError()), remaining);
    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const stream of streams) stream.destroy();
      response?.destroy();
      request?.destroy();
      reject(networkError(error));
    }
    function done(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }
    const options = {
      method: "GET",
      agent: false,
      family: address.family,
      autoSelectFamily: false,
      // DNS is pinned here; the HTTP client cannot perform a second, unvalidated lookup.
      lookup(_hostname, lookupOptions, callback) {
        if (typeof lookupOptions === "function") callback = lookupOptions;
        if (lookupOptions?.all)
          callback(null, [
            { address: address.address, family: address.family },
          ]);
        else callback(null, address.address, address.family);
      },
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; OpportunityBoard/0.1; job-description preview)",
        Accept: "text/html,application/xhtml+xml;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "close",
      },
    };
    try {
      const transport =
        injectedRequest ||
        (url.protocol === "https:" ? https.request : http.request);
      request = transport(url, options, (incoming) => {
        response = incoming;
        response.on("error", fail);
        const status = response.statusCode;
        if (REDIRECTS.has(status)) {
          const location = response.headers.location;
          response.resume();
          if (typeof location !== "string" || !location)
            return fail(
              new JobFetchError(
                "The job page redirected without a destination. Paste its text or upload its PDF.",
                "INVALID_REDIRECT",
              ),
            );
          done({ redirect: location });
          response.destroy();
          return;
        }
        if ([401, 403, 429].includes(status))
          return fail(
            new JobFetchError(
              "This website requires sign-in or is blocking automated access. Open the link yourself, then paste the text or upload the job description.",
              "ACCESS_BLOCKED",
            ),
          );
        if (status !== 200)
          return fail(
            new JobFetchError(
              `The job page returned HTTP ${status || "an unknown error"}. The listing may have moved or expired; paste its text or upload the job description.`,
              "HTTP_ERROR",
            ),
          );
        const contentType = String(response.headers["content-type"] || "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        if (contentType === "application/pdf" || /\.pdf$/i.test(url.pathname))
          return fail(
            new JobFetchError(
              "This link points to a PDF. Download it and upload the job description instead.",
              "PDF_DOCUMENT",
            ),
          );
        if (!["text/html", "application/xhtml+xml"].includes(contentType))
          return fail(
            new JobFetchError(
              "This link did not return a supported HTML job page. Paste the description or upload its PDF/DOCX instead.",
              "UNSUPPORTED_CONTENT",
            ),
          );
        const declaredLength = Number(response.headers["content-length"]);
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes)
          return fail(
            new JobFetchError(
              "The job page is too large to read safely. Paste the relevant description or upload its document.",
              "PAGE_TOO_LARGE",
            ),
          );
        const encoding = String(
          response.headers["content-encoding"] || "identity",
        )
          .trim()
          .toLowerCase();
        let decoded = response;
        if (encoding !== "identity") {
          const decompress = {
            gzip: createGunzip,
            "x-gzip": createGunzip,
            br: createBrotliDecompress,
            deflate: createInflate,
          }[encoding];
          if (!decompress)
            return fail(
              new JobFetchError(
                "This job page uses an unsupported response encoding. Paste or upload the description instead.",
                "UNSUPPORTED_ENCODING",
              ),
            );
          decoded = decompress();
          streams = [decoded];
          decoded.on("error", () =>
            fail(
              new JobFetchError(
                "The compressed job page could not be decoded. Paste or upload the description instead.",
                "DECODE_ERROR",
              ),
            ),
          );
          response.pipe(decoded);
        }
        let encodedBytes = 0;
        let decodedBytes = 0;
        const chunks = [];
        response.on("data", (chunk) => {
          encodedBytes += chunk.length;
          if (encodedBytes > maxBytes)
            fail(
              new JobFetchError(
                "The job page is too large to read safely. Paste the description or upload its document.",
                "PAGE_TOO_LARGE",
              ),
            );
        });
        decoded.on("data", (chunk) => {
          if (settled) return;
          decodedBytes += chunk.length;
          if (decodedBytes > maxBytes)
            return fail(
              new JobFetchError(
                "The job page is too large after decoding. Paste the relevant description or upload its document.",
                "PAGE_TOO_LARGE",
              ),
            );
          chunks.push(Buffer.from(chunk));
        });
        response.on("aborted", () =>
          fail(
            new JobFetchError(
              "The job-page connection ended before the page finished downloading. Try again or paste/upload the description.",
              "NETWORK_ERROR",
            ),
          ),
        );
        decoded.on("end", () =>
          done({
            html: Buffer.concat(chunks).toString("utf8"),
            url: url.href,
            contentType,
          }),
        );
      });
      request.on("error", fail);
      request.end();
    } catch (error) {
      fail(error);
    }
  });
}

/** Fetch public HTML while validating DNS and pinning each request to an approved IP. */
export async function fetchJobPage(inputUrl, options = {}) {
  const maxBytes = Math.min(
    MAX_BYTES,
    Math.max(1, options.maxBytes ?? MAX_BYTES),
  );
  const deadline =
    Date.now() +
    Math.min(DEADLINE_MS, Math.max(1, options.deadlineMs ?? DEADLINE_MS));
  const lookup = options.lookup || systemLookup;
  let current = inputUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const { url, hostname } = validateUrl(current);
    const address = await resolvePublic(hostname, lookup, deadline);
    const result = await requestPage(
      url,
      address,
      deadline,
      maxBytes,
      options.request,
    );
    if (!result.redirect) return result;
    if (hop === MAX_REDIRECTS)
      throw new JobFetchError(
        "The job page redirected too many times. Open it yourself, then paste or upload the job description.",
        "TOO_MANY_REDIRECTS",
      );
    try {
      current = new URL(result.redirect, url).href;
    } catch {
      throw new JobFetchError(
        "The job page redirected to an invalid URL. Paste or upload the description instead.",
        "INVALID_REDIRECT",
      );
    }
  }
  throw new JobFetchError(
    "Could not retrieve the job page. Paste or upload the description instead.",
  );
}

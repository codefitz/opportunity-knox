import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { fetchJobPage, JobFetchError } from "../server/job-fetch.mjs";

const publicLookup = async () => [{ address: "8.8.8.8", family: 4 }];
const html = "<html><body><h1>Senior architect</h1></body></html>";

function transport(replies, calls = []) {
  return (url, options, callback) => {
    const request = new EventEmitter();
    request.destroyed = false;
    request.destroy = () => {
      request.destroyed = true;
    };
    request.end = () => {
      const reply = replies.shift();
      calls.push({ url: String(url), options, request });
      if (!reply || reply.neverRespond) return;
      queueMicrotask(() => {
        if (request.destroyed) return;
        if (reply.requestError)
          return request.emit("error", reply.requestError);
        const response = new PassThrough();
        response.statusCode = reply.status ?? 200;
        response.headers = {
          "content-type": "text/html; charset=utf-8",
          ...reply.headers,
        };
        callback(response);
        if (reply.aborted) {
          response.emit("aborted");
        } else if (!reply.neverEnd) {
          response.end(reply.body ?? html);
        } else {
          response.write(reply.body ?? "<html>partial");
        }
      });
    };
    return request;
  };
}

function options(replies, overrides = {}) {
  return { lookup: publicLookup, request: transport(replies), ...overrides };
}

function hasCode(code) {
  return (error) => error instanceof JobFetchError && error.code === code;
}

test("public HTML requests use a pinned approved address without cookies or unsafe TLS options", async () => {
  const calls = [];
  let lookupCount = 0;
  const lookup = async (host, settings) => {
    lookupCount++;
    assert.equal(host, "jobs.example.com");
    assert.equal(settings.all, true);
    return [
      { address: "8.8.8.8", family: 4 },
      { address: "1.1.1.1", family: 4 },
    ];
  };
  const result = await fetchJobPage("https://jobs.example.com/role#tracking", {
    lookup,
    request: transport([{}], calls),
  });
  assert.deepEqual(result, {
    html,
    url: "https://jobs.example.com/role",
    contentType: "text/html",
  });
  assert.equal(lookupCount, 1);
  const requestOptions = calls[0].options;
  assert.equal(requestOptions.agent, false);
  assert.equal(requestOptions.autoSelectFamily, false);
  assert.notEqual(requestOptions.rejectUnauthorized, false);
  assert.equal(requestOptions.headers.Cookie, undefined);
  assert.equal(requestOptions.headers.Authorization, undefined);
  requestOptions.lookup("jobs.example.com", {}, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, "8.8.8.8");
    assert.equal(family, 4);
  });
  requestOptions.lookup(
    "jobs.example.com",
    { all: true },
    (error, addresses) => {
      assert.equal(error, null);
      assert.deepEqual(addresses, [{ address: "8.8.8.8", family: 4 }]);
    },
  );
});

test("URL tricks, credentials, internal names and non-default ports are rejected before network access", async () => {
  const badUrls = [
    "file:///etc/passwd",
    "gopher://example.com",
    "javascript:alert(1)",
    "/relative-job",
    "https://user:pass@example.com",
    "https://example.com:8443/job",
    "http://example.com:443",
    "http://localhost",
    "https://localhost./job",
    "https://sub.localhost",
    "http://printer",
    "http://router.local",
    "http://host.internal",
    "http://x.localdomain",
    "http://127.1",
    "http://2130706433",
    "http://0x7f000001",
    "http://0177.0.0.1",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "https://[fe80::1%25eth0]/",
    "https://example.com\n.example.net",
  ];
  for (const url of badUrls) {
    let requested = false;
    await assert.rejects(
      fetchJobPage(url, {
        lookup: async () => {
          requested = true;
          return publicLookup();
        },
        request: () => {
          requested = true;
        },
      }),
      JobFetchError,
      url,
    );
    assert.equal(requested, false, url);
  }
});

test("private, link-local, reserved and special address classes are blocked", async () => {
  const addresses = [
    "0.0.0.0",
    "10.1.2.3",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "192.0.0.9",
    "192.0.2.1",
    "192.88.99.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:8.8.8.8",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "2001::1",
    "2002::1",
    "3fff::1",
    "64:ff9b::808:808",
    "4000::1",
  ];
  for (const address of addresses) {
    let requested = false;
    await assert.rejects(
      fetchJobPage("https://jobs.example.com", {
        lookup: async () => [
          { address, family: address.includes(":") ? 6 : 4 },
        ],
        request: () => {
          requested = true;
        },
      }),
      hasCode("UNSAFE_ADDRESS"),
      address,
    );
    assert.equal(requested, false, address);
  }
});

test("all DNS answers are checked; mixed public/private DNS is refused", async () => {
  await assert.rejects(
    fetchJobPage(
      "https://jobs.example.com",
      options([{}], {
        lookup: async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      }),
    ),
    hasCode("UNSAFE_ADDRESS"),
  );
  for (const records of [
    [],
    [{ address: "nonsense", family: 4 }],
    [{ address: "8.8.8.8", family: 6 }],
  ]) {
    await assert.rejects(
      fetchJobPage(
        "https://jobs.example.com",
        options([{}], { lookup: async () => records }),
      ),
      JobFetchError,
    );
  }
});

test("public IPv6 is allowed and pinned, and public IP literals do not trigger DNS", async () => {
  const calls = [];
  await fetchJobPage("https://jobs.example.com", {
    lookup: async () => [{ address: "2001:4860:4860::8888", family: 6 }],
    request: transport([{}], calls),
  });
  calls[0].options.lookup("jobs.example.com", {}, (_error, address, family) => {
    assert.equal(address, "2001:4860:4860::8888");
    assert.equal(family, 6);
  });
  await fetchJobPage(
    "https://8.8.8.8/job",
    options([{}], {
      lookup: () => {
        throw new Error("must not look up literals");
      },
    }),
  );
});

test("each redirect resolves and pins its own approved public destination", async () => {
  const calls = [];
  const hosts = [];
  const lookup = async (host) => {
    hosts.push(host);
    return [{ address: hosts.length === 1 ? "8.8.8.8" : "1.1.1.1", family: 4 }];
  };
  const result = await fetchJobPage("https://jobs.example.com/role", {
    lookup,
    request: transport(
      [
        {
          status: 302,
          headers: { location: "https://careers.example.net/job" },
        },
        {},
      ],
      calls,
    ),
  });
  assert.deepEqual(hosts, ["jobs.example.com", "careers.example.net"]);
  assert.equal(result.url, "https://careers.example.net/job");
  calls[1].options.lookup("careers.example.net", {}, (_error, address) =>
    assert.equal(address, "1.1.1.1"),
  );
});

test("redirects to private IPs, credentials or private DNS are blocked before that request", async () => {
  for (const location of [
    "http://127.0.0.1/secret",
    "http://169.254.169.254/latest/meta-data",
    "https://user:pass@public.example.com/",
  ]) {
    const calls = [];
    await assert.rejects(
      fetchJobPage(
        "https://jobs.example.com",
        options([], {
          request: transport([{ status: 302, headers: { location } }], calls),
        }),
      ),
      JobFetchError,
    );
    assert.equal(calls.length, 1);
  }
  const calls = [];
  await assert.rejects(
    fetchJobPage("https://jobs.example.com", {
      lookup: async (host) => [
        {
          address: host === "jobs.example.com" ? "8.8.8.8" : "10.1.1.1",
          family: 4,
        },
      ],
      request: transport(
        [{ status: 301, headers: { location: "https://private.example.net" } }],
        calls,
      ),
    }),
    hasCode("UNSAFE_ADDRESS"),
  );
  assert.equal(calls.length, 1);
});

test("relative redirects are supported and redirect loops stop after four hops", async () => {
  const result = await fetchJobPage(
    "https://jobs.example.com/old",
    options([{ status: 307, headers: { location: "/new" } }, {}]),
  );
  assert.equal(result.url, "https://jobs.example.com/new");
  const calls = [];
  await assert.rejects(
    fetchJobPage(
      "https://jobs.example.com",
      options([], {
        request: transport(
          Array.from({ length: 6 }, () => ({
            status: 302,
            headers: { location: "/again" },
          })),
          calls,
        ),
      }),
    ),
    hasCode("TOO_MANY_REDIRECTS"),
  );
  assert.equal(calls.length, 5);
  await assert.rejects(
    fetchJobPage(
      "https://jobs.example.com",
      options([{ status: 302, headers: { location: "" } }]),
    ),
    hasCode("INVALID_REDIRECT"),
  );
});

test("gzip, brotli and deflate bodies decode within the limit", async () => {
  for (const [encoding, encode] of [
    ["gzip", gzipSync],
    ["br", brotliCompressSync],
    ["deflate", deflateSync],
  ]) {
    const result = await fetchJobPage(
      "https://jobs.example.com",
      options([
        { headers: { "content-encoding": encoding }, body: encode(html) },
      ]),
    );
    assert.equal(result.html, html);
  }
  const result = await fetchJobPage(
    "https://jobs.example.com",
    options([{ headers: { "content-type": "application/xhtml+xml" } }]),
  );
  assert.equal(result.contentType, "application/xhtml+xml");
});

test("encoded, declared, decoded and compression-bomb sizes are limited", async () => {
  await assert.rejects(
    fetchJobPage(
      "https://jobs.example.com",
      options([{ body: "a".repeat(100) }], { maxBytes: 64 }),
    ),
    hasCode("PAGE_TOO_LARGE"),
  );
  await assert.rejects(
    fetchJobPage(
      "https://jobs.example.com",
      options([{ headers: { "content-length": "100" } }], { maxBytes: 64 }),
    ),
    hasCode("PAGE_TOO_LARGE"),
  );
  await assert.rejects(
    fetchJobPage(
      "https://jobs.example.com",
      options(
        [
          {
            headers: { "content-encoding": "gzip" },
            body: gzipSync("a".repeat(1000)),
          },
        ],
        { maxBytes: 64 },
      ),
    ),
    hasCode("PAGE_TOO_LARGE"),
  );
});

test("PDFs, non-HTML and unsupported/broken compression provide upload fallbacks", async () => {
  await assert.rejects(
    fetchJobPage(
      "https://jobs.example.com",
      options([{ headers: { "content-type": "application/pdf" } }]),
    ),
    (error) => error.code === "PDF_DOCUMENT" && /upload/i.test(error.message),
  );
  await assert.rejects(
    fetchJobPage("https://jobs.example.com/jd.PDF", options([{}])),
    hasCode("PDF_DOCUMENT"),
  );
  await assert.rejects(
    fetchJobPage(
      "https://jobs.example.com",
      options([{ headers: { "content-type": "application/json" } }]),
    ),
    hasCode("UNSUPPORTED_CONTENT"),
  );
  await assert.rejects(
    fetchJobPage(
      "https://jobs.example.com",
      options([{ headers: { "content-encoding": "zstd" } }]),
    ),
    hasCode("UNSUPPORTED_ENCODING"),
  );
  await assert.rejects(
    fetchJobPage(
      "https://jobs.example.com",
      options([{ headers: { "content-encoding": "gzip" }, body: "not gzip" }]),
    ),
    hasCode("DECODE_ERROR"),
  );
});

test("HTTP access restrictions and other status errors have useful messages", async () => {
  for (const status of [401, 403, 429]) {
    await assert.rejects(
      fetchJobPage("https://jobs.example.com", options([{ status }])),
      (error) =>
        error.code === "ACCESS_BLOCKED" && /paste|upload/i.test(error.message),
    );
  }
  await assert.rejects(
    fetchJobPage("https://jobs.example.com", options([{ status: 404 }])),
    (error) => error.code === "HTTP_ERROR" && /404/.test(error.message),
  );
});

test("total deadlines cover DNS lookup, waiting for headers, and stalled bodies", async () => {
  await assert.rejects(
    fetchJobPage("https://jobs.example.com", {
      lookup: () => new Promise(() => {}),
      deadlineMs: 10,
    }),
    hasCode("TIMEOUT"),
  );
  const calls = [];
  await assert.rejects(
    fetchJobPage(
      "https://jobs.example.com",
      options([], {
        request: transport([{ neverRespond: true }], calls),
        deadlineMs: 10,
      }),
    ),
    hasCode("TIMEOUT"),
  );
  assert.equal(calls[0].request.destroyed, true);
  await assert.rejects(
    fetchJobPage(
      "https://jobs.example.com",
      options([{ neverEnd: true }], { deadlineMs: 10 }),
    ),
    hasCode("TIMEOUT"),
  );
});

test("DNS, connection, certificate and truncated-response errors are controlled", async () => {
  await assert.rejects(
    fetchJobPage(
      "https://jobs.example.com",
      options([{}], {
        lookup: async () => {
          throw Object.assign(new Error("secret resolver detail"), {
            code: "ENOTFOUND",
          });
        },
      }),
    ),
    (error) => error.code === "DNS_ERROR" && !error.message.includes("secret"),
  );
  await assert.rejects(
    fetchJobPage(
      "https://jobs.example.com",
      options([
        {
          requestError: Object.assign(new Error("failed"), {
            code: "ECONNREFUSED",
          }),
        },
      ]),
    ),
    hasCode("NETWORK_ERROR"),
  );
  await assert.rejects(
    fetchJobPage(
      "https://jobs.example.com",
      options([
        {
          requestError: Object.assign(new Error("certificate failed"), {
            code: "CERT_HAS_EXPIRED",
          }),
        },
      ]),
    ),
    hasCode("TLS_ERROR"),
  );
  await assert.rejects(
    fetchJobPage("https://jobs.example.com", options([{ aborted: true }])),
    hasCode("NETWORK_ERROR"),
  );
});

test('intake can retain exact decoded source bytes and opt into public PDF downloads without loosening URL guards',async()=>{
 const bytes=Buffer.from('%PDF-fictional-original\n');const result=await fetchJobPage('https://jobs.example.com/role.pdf',{lookup:publicLookup,request:transport([{headers:{'content-type':'application/pdf'},body:bytes}]),includeBytes:true,allowPdf:true});assert.equal(result.contentType,'application/pdf');assert.deepEqual(result.bytes,bytes);
 await assert.rejects(fetchJobPage('http://127.0.0.1/internal.pdf',{allowPdf:true,includeBytes:true}),e=>e.code==='UNSAFE_ADDRESS');
});

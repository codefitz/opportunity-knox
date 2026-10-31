import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJobPage } from '../server/job-parser.mjs';

const url = 'https://jobs.example.test/roles/architect';
const description = '<p>Help our fictional research team build reliable systems &amp; useful tools.</p><h2>Responsibilities</h2><ul><li>Design services with colleagues.</li><li>Review requirements and improve software quality.</li></ul><p>Applicants should bring relevant architecture experience and communication skills.</p>';
const posting = (extra = {}) => ({ '@context':'https://schema.org', '@type':'JobPosting', title:'Solutions Architect', description, hiringOrganization:{ '@type':'Organization', name:'Fictional Research &amp; Co' }, url, ...extra });
const html = (data, content = '') => `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head><body>${content}</body></html>`;
const page = (content, head = '') => `<!doctype html><html><head>${head}</head><body>${content}</body></html>`;
const parse = (content, source = url) => parseJobPage(content, { url: source });

test('JobPosting fields retain readable paragraphs, bullets, entities, salary and deadline', () => {
  const result = parse(html(posting({
    identifier: { '@type':'PropertyValue', name:'Fictional Research', value:'FR-042' },
    jobLocation:[{ '@type':'Place', address:{ addressLocality:'London', addressRegion:'England', addressCountry:'GB' } }, { address:{ addressLocality:'Bristol', addressCountry:'GB' } }],
    baseSalary:{ '@type':'MonetaryAmount', currency:'GBP', value:{ '@type':'QuantitativeValue', minValue:70000, maxValue:90000, unitText:'YEAR' } },
    employmentType:['FULL_TIME','CONTRACTOR'], validThrough:'2026-12-01T23:59:00+00:00',
    applicationContact:{ name:'Recruitment Team', email:'jobs@example.test', telephone:'+44 0000 000000' },
  })));
  assert.equal(result.method,'structured-data'); assert.equal(result.fields.company,'Fictional Research & Co');
  assert.equal(result.fields.role,'Solutions Architect'); assert.equal(result.fields.jobReference,'FR-042');
  assert.equal(result.fields.location,'London, England, GB; Bristol, GB');
  assert.equal(result.fields.salary,'GBP 70,000–90,000 per year'); assert.equal(result.fields.employmentType,'Full Time; Contractor');
  assert.equal(result.fields.deadline,'2026-12-01'); assert.match(result.fields.contact,/jobs@example.test/);
  assert.match(result.fields.description,/systems & useful tools\.\n\nResponsibilities/); assert.match(result.fields.description,/• Design services/);
  assert.doesNotMatch(result.fields.description,/<(?:p|li|h2)>|&amp;/); assert.equal(result.sourceUrl,url); assert.equal(result.resolvedUrl,url); assert.ok(Number.isFinite(Date.parse(result.retrievedAt)));
});

test('nested graphs, type arrays, @id references, remote eligibility and numeric salaries', () => {
  const job = posting({ '@type':['Thing','https://schema.org/JobPosting'], '@id':url+'#job', hiringOrganization:{'@id':'#employer'}, jobLocation:{'@id':'#office'}, jobLocationType:'TELECOMMUTE', applicantLocationRequirements:[{name:'United Kingdom'},{name:'Ireland'}], baseSalary:{currency:'EUR',value:{value:75,unitText:'HOUR'}} });
  const result = parse(html({ '@context':'https://schema.org', '@graph':[
    { '@type':'WebPage', mainEntity:job }, { '@id':'#employer','@type':'Organization', name:'Fictional Graph Company' }, { '@id':'#office','@type':'Place', address:{addressLocality:'Dublin',addressCountry:'IE'} },
  ] }));
  assert.equal(result.fields.company,'Fictional Graph Company'); assert.equal(result.fields.location,'Dublin, IE; United Kingdom; Ireland');
  assert.equal(result.fields.workMode,'Remote'); assert.equal(result.fields.salary,'EUR 75 per hour');
});

test('arrays and duplicate JobPosting copies do not create false ambiguity', () => {
  const job=posting(); const result=parse(html([job,{...job}, {'@type':'BreadcrumbList',name:'Career navigation'}]));
  assert.equal(result.fields.role,'Solutions Architect'); assert.equal(result.warnings.some(w=>/several/i.test(w)),false);
});

test('selects the specific matching job from multiple postings and rejects search results', () => {
  const other=posting({title:'Data Engineer',url:'https://jobs.example.test/roles/data'});
  const result=parse(html([other,posting()])); assert.equal(result.fields.role,'Solutions Architect'); assert.ok(result.warnings.some(w=>/Several jobs/.test(w)));
  assert.throws(()=>parse(html([other,posting()]),'https://jobs.example.test/search'),e=>e.status===422&&e.code==='JOB_PAGE_AMBIGUOUS');
  assert.throws(()=>parse(html([posting({'@id':url+'#one',url:undefined}),posting({title:'Data Engineer','@id':url+'#two',url:undefined})])),e=>e.status===422);
});

test('tracking query strings do not prevent matching a specific posting', () => {
  const result=parse(html([posting(),posting({title:'Another Role',url:'https://jobs.example.test/roles/another'})]),url+'/?utm_source=fictional');
  assert.equal(result.fields.role,'Solutions Architect'); assert.equal(result.fields.url,url+'/?utm_source=fictional');
});

test('invalid calendar deadlines are omitted with a warning, valid leap days retained', () => {
  const invalid=parse(html(posting({validThrough:'2026-02-30T12:00:00Z'}))); assert.equal(invalid.fields.deadline,undefined); assert.ok(invalid.warnings.some(w=>/deadline was invalid/.test(w)));
  assert.equal(parse(html(posting({validThrough:'2028-02-29'}))).fields.deadline,'2028-02-29');
});

test('semantic fallback captures job content and removes navigation, cookies and scripts', () => {
  const content=`<nav>Navigate to our products</nav><div class="cookie-banner">Accept advertising cookies</div><main><h1>Platform Engineer</h1><span class="company-name">Fictional Systems</span><span data-testid="job-location">York, UK</span><article><h2>About the role</h2>${description}<script>alert('not a job')</script></article></main><footer>Privacy links and marketing</footer>`;
  const result=parse(page(content)); assert.equal(result.method,'page-content'); assert.equal(result.fields.company,'Fictional Systems'); assert.equal(result.fields.role,'Platform Engineer');
  assert.equal(result.fields.location,'York, UK'); assert.match(result.fields.description,/architecture experience/);
  assert.doesNotMatch(result.fields.description,/advertising cookies|products|alert\(|marketing/);
});

test('LinkedIn-shaped public and guest content captures the specific job and clean location', () => {
  for(const tag of ['h1','h2']) {
    const content=`<h2>Join or sign in to find your next job</h2><section class="top-card-layout"><${tag} class="top-card-layout__title">Fictional Delivery Analyst</${tag}><a class="topcard__org-name-link">Fictional Consulting &amp; Co</a><span class="topcard__flavor--bullet">Leeds, England, United Kingdom</span><figure class="topcard__flavor--bullet">Be among the first applicants</figure></section><div class="show-more-less-html__markup">${description}</div><ul class="description__job-criteria-list"><li class="description__job-criteria-item"><h3 class="description__job-criteria-subheader">Employment type</h3><span class="description__job-criteria-text">Full-time</span></li></ul>`;
    const result=parse(page(content)); assert.equal(result.fields.role,'Fictional Delivery Analyst'); assert.equal(result.fields.company,'Fictional Consulting & Co'); assert.equal(result.fields.location,'Leeds, England, United Kingdom'); assert.equal(result.fields.employmentType,'Full-time'); assert.match(result.fields.description,/• Review requirements/);
  }
});

test('employer is not inferred from a job board brand and missing company stays missing', () => {
  const result=parse(page(`<main><h1>Research Engineer</h1><article>${description}</article></main>`, '<meta property="og:site_name" content="Fictional Job Board">'));
  assert.equal(result.fields.company,undefined); assert.ok(result.warnings.some(w=>/employer could not be identified/.test(w)));
});

test('malformed JSON-LD can fall back to useful visible content without pretending it was structured', () => {
  const result=parse(page(`<main><h1>Research Engineer</h1><div data-testid="job-description">${description}</div></main>`, '<script type="application/ld+json">{broken}</script>'));
  assert.equal(result.method,'page-content'); assert.ok(result.warnings.some(w=>/could not be read/.test(w)));
});

test('access denied, login, CAPTCHA, and JavaScript challenges are not captured as descriptions', () => {
  for(const content of [
    page('<h1>Access denied</h1><p>Your request was blocked.</p>'),
    page('<h1>Sign in to Example Jobs</h1><main><p>Sign in to view this job.</p></main>'),
    page('<h1>Verify you are human</h1><main>Complete the CAPTCHA to continue.</main>'),
    page('<main>Enable JavaScript and cookies to continue</main>','<title>Just a moment...</title>'),
    html(posting(),'<h1>Access denied</h1>'),
  ]) assert.throws(()=>parse(content),e=>e.status===422&&e.code==='JOB_PAGE_BLOCKED');
});

test('empty pages, generic search pages and short summaries are rejected', () => {
  for(const content of ['',page('<h1>Jobs</h1><main>Search our open positions.</main>'),page('<h1>Architect</h1>','<meta name="description" content="Apply now for this role">')]) assert.throws(()=>parse(content),e=>e.status===422);
});

test('double-escaped descriptions are decoded and output lengths are bounded', () => {
  const escaped=description.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const readable=parse(html(posting({description:escaped}))); assert.match(readable.fields.description,/• Design services/); assert.doesNotMatch(readable.fields.description,/<p>|&amp;/);
  const large=parse(html(posting({description:'Experience with fictional engineering systems. '.repeat(5000)})));
  assert.equal(large.fields.description.length,200000); assert.ok(large.warnings.some(w=>/truncated/.test(w)));
});


test('an optional sign-in modal does not hide an otherwise public job', () => {
  const result=parse(page(`<main><h1>Security Verification Engineer</h1><article>${description}</article></main><section><h2>Sign in</h2><p>Sign in for more features.</p></section>`));
  assert.equal(result.fields.role,'Security Verification Engineer'); assert.match(result.fields.description,/architecture experience/);
});

test('JavaScript SPA shell without description throws JOB_PAGE_JS_REQUIRED', () => {
  const spaShell = page('<div id="root"></div><script src="/static/bundle.js"></script>', '<title>Fictional Careers</title>');
  assert.throws(
    () => parse(spaShell),
    (e) => {
      assert.equal(e.status, 422);
      assert.equal(e.code, 'JOB_PAGE_JS_REQUIRED');
      assert.match(e.message, /JavaScript to render/i);
      return true;
    },
  );
});

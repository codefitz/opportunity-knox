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

test('tracking query strings do not prevent matching a specific posting and are cleaned', () => {
  const result=parse(html([posting(),posting({title:'Another Role',url:'https://jobs.example.test/roles/another'})]),url+'/?utm_source=fictional&gclid=test1234');
  assert.equal(result.fields.role,'Solutions Architect'); assert.equal(result.fields.url,url);
});

test('Indeed and Greenhouse tracking parameters are cleaned while matching specific posting', () => {
  const indeedUrl = 'https://uk.indeed.com/viewjob?jk=67bdb57bfedf4c87';
  const indeedJob = { '@context':'https://schema.org', '@type':'JobPosting', title:'Staff Engineer', description, hiringOrganization:{ '@type':'Organization', name:'Indeed Co' }, url: indeedUrl };
  const dirtyIndeed = `${indeedUrl}&tk=1k5qkv9cp2k7r001&from=email&rjptk=token&xpse=123`;
  const indeedResult = parseJobPage(html([indeedJob]), { url: dirtyIndeed });
  assert.equal(indeedResult.fields.role, 'Staff Engineer');
  assert.equal(indeedResult.fields.url, indeedUrl);

  const ghUrl = 'https://teachforall.org/jobs-and-graduate-programs/jobs?gh_jid=7727042003';
  const ghJob = { '@context':'https://schema.org', '@type':'JobPosting', title:'Program Director', description, hiringOrganization:{ '@type':'Organization', name:'Teach For All' }, url: ghUrl };
  const dirtyGh = `${ghUrl}&gh_src=h916zlja3us&utm_campaign=board`;
  const ghResult = parseJobPage(html([ghJob]), { url: dirtyGh });
  assert.equal(ghResult.fields.role, 'Program Director');
  assert.equal(ghResult.fields.url, ghUrl);
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

test('Amazon-shaped static sections retain qualifications and visible employer, reference and locations', () => {
  const result = parse(page(`<div id="job-detail">
    <h1>Fictional Delivery Consultant</h1>
    <div class="details-line"><p class="meta">Job ID: FICTION-042 | Fictional Cloud (UK Branch)</p></div>
    <div id="job-detail-body"><div class="content">
      <div class="section"><h2>Description</h2>${description}</div>
      <div class="section"><h2>Basic Qualifications</h2><p>Experience designing cloud services.</p></div>
      <div class="section"><h2>Preferred Qualifications</h2><p>Cloud certification.</p></div>
    </div><div class="location-icon"><ul class="association-content"><li>Bristol, UK</li><li>London, UK</li></ul></div>
    <div>Share this job</div></div></div><footer>Career navigation</footer>`));
  assert.equal(result.method, 'page-content');
  assert.equal(result.fields.role, 'Fictional Delivery Consultant');
  assert.equal(result.fields.company, 'Fictional Cloud (UK Branch)');
  assert.equal(result.fields.jobReference, 'FICTION-042');
  assert.equal(result.fields.location, 'Bristol, UK; London, UK');
  assert.match(result.fields.description, /Basic Qualifications\n\nExperience designing cloud services/);
  assert.match(result.fields.description, /Preferred Qualifications\n\nCloud certification/);
  assert.doesNotMatch(result.fields.description, /Share this job|Career navigation|Job ID:/);
  assert.equal(result.fields.salary, undefined);
  assert.equal(result.fields.deadline, undefined);
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

test('workMode detects Remote, Hybrid, and On-site across structured data and fallback selectors', () => {
  // Structured data workplaceType / jobLocationType
  const hybridJob = posting({ workplaceType: 'Hybrid', jobLocation: { address: { addressLocality: 'Manchester' } } });
  const hybridRes = parse(html(hybridJob));
  assert.equal(hybridRes.fields.workMode, 'Hybrid');

  const onsiteJob = posting({ jobLocationType: 'On-site', jobLocation: { address: { addressLocality: 'London' } } });
  const onsiteRes = parse(html(onsiteJob));
  assert.equal(onsiteRes.fields.workMode, 'On-site');

  // Fallback selector for workplace-type badge
  const fallbackHtml = page(`
    <main>
      <h1>Cloud Reliability Engineer</h1>
      <span class="company-name">Fictional Ops</span>
      <span class="jobs-unified-top-card__workplace-type">Hybrid</span>
      <article>${description}</article>
    </main>
  `);
  const fallbackRes = parse(fallbackHtml);
  assert.equal(fallbackRes.fields.workMode, 'Hybrid');

  // Work mode from job criteria list
  const criteriaHtml = page(`
    <main>
      <h1>Full Stack Developer</h1>
      <span class="company-name">Remote Co</span>
      <ul class="description__job-criteria-list">
        <li class="description__job-criteria-item">
          <h3 class="description__job-criteria-subheader">Workplace type</h3>
          <span class="description__job-criteria-text">Fully remote</span>
        </li>
      </ul>
      <article>${description}</article>
    </main>
  `);
  const criteriaRes = parse(criteriaHtml);
  assert.equal(criteriaRes.fields.workMode, 'Remote');
});

test('salary extraction recognizes LinkedIn topcard insights, Indeed salary attributes and regex patterns', () => {
  // LinkedIn insight chip with salary
  const linkedinSalary = page(`
    <main>
      <h1>Senior Staff Engineer</h1>
      <span class="company-name">LinkedIn Fictional</span>
      <div class="job-details-jobs-unified-top-card__job-insight">
        <span>£75,000 - £90,000 a year</span>
      </div>
      <article>${description}</article>
    </main>
  `);
  const res1 = parse(linkedinSalary);
  assert.equal(res1.fields.salary, '£75,000 - £90,000 a year');

  // Indeed attribute snippet
  const indeedSalary = page(`
    <main>
      <h1>DevOps Lead</h1>
      <span class="company-name">Indeed Fictional</span>
      <div data-testid="attribute_snippets_test_id">
        <span>$140,000 - $160,000 a year</span>
      </div>
      <article>${description}</article>
    </main>
  `);
  const res2 = parse(indeedSalary);
  assert.equal(res2.fields.salary, '$140,000 - $160,000 a year');

  // Day rate pattern in topcard
  const dayRate = page(`
    <main>
      <h1>Contract Agile Coach</h1>
      <span class="company-name">Agile Fictional</span>
      <div class="top-card-layout">
        <span>£500 - £600 per day</span>
      </div>
      <article>${description}</article>
    </main>
  `);
  const res3 = parse(dayRate);
  assert.equal(res3.fields.salary, '£500 - £600 per day');

  // Structured estimatedSalary fallback
  const estimatedJob = posting({ estimatedSalary: { currency: 'EUR', value: { minValue: 60000, maxValue: 75000, unitText: 'YEAR' } } });
  const res4 = parse(html(estimatedJob));
  assert.equal(res4.fields.salary, 'EUR 60,000–75,000 per year');
});

test('LinkedIn Easy Apply is detected and populates applicationRoute', () => {
  const easyApplyPage = page(`
    <main>
      <h1>Staff Architect</h1>
      <span class="company-name">Easy Apply Corp</span>
      <button class="jobs-apply-button--easy-apply">Easy Apply</button>
      <article>${description}</article>
    </main>
  `);
  const result = parse(easyApplyPage);
  assert.equal(result.fields.applicationRoute, 'LinkedIn Easy Apply');

  // Also when attribute is present
  const easyApplyAttr = page(`
    <main>
      <h1>Staff Architect</h1>
      <span class="company-name">Easy Apply Corp</span>
      <button data-is-easy-apply="true">Apply now</button>
      <article>${description}</article>
    </main>
  `);
  const resultAttr = parse(easyApplyAttr);
  assert.equal(resultAttr.fields.applicationRoute, 'LinkedIn Easy Apply');
});

test('datePosted and applicantCount are extracted cleanly from structured and fallback signals', () => {
  // Structured datePosted
  const structuredJob = posting({ datePosted: '2026-10-15T09:00:00Z' });
  const sRes = parse(html(structuredJob));
  assert.equal(sRes.fields.datePosted, '2026-10-15');

  // Fallback posted time and applicant count
  const fallbackPage = page(`
    <main>
      <h1>Security Architect</h1>
      <span class="company-name">Cyber Fictional</span>
      <span class="posted-time-ago__text">3 days ago</span>
      <figcaption class="num-applicants__caption">Over 100 applicants</figcaption>
      <article>${description}</article>
    </main>
  `);
  const fRes = parse(fallbackPage);
  assert.equal(fRes.fields.datePosted, '3 days ago');
  assert.equal(fRes.fields.applicantCount, 'Over 100 applicants');

  // Topcard bullet with "Be among the first 25 applicants"
  const bulletPage = page(`
    <main>
      <h1>Frontend Lead</h1>
      <span class="company-name">UI Fictional</span>
      <time datetime="2026-11-01">Nov 1, 2026</time>
      <span class="job-details-jobs-unified-top-card__job-insight">Be among the first 25 applicants</span>
      <article>${description}</article>
    </main>
  `);
  const bRes = parse(bulletPage);
  assert.equal(bRes.fields.datePosted, '2026-11-01');
  assert.equal(bRes.fields.applicantCount, 'Be among the first 25 applicants');
});

test('Greenhouse embed matching connects embedded gh_jid parameter to embed token URL', () => {
  const ghUrl = 'https://teachforall.org/jobs?gh_jid=7727042003';
  const embedJob = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: 'Director of Operations',
    description,
    hiringOrganization: { '@type': 'Organization', name: 'Teach For All' },
    url: 'https://boards.greenhouse.io/embed/job_app?token=7727042003',
  };
  const otherJob = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: 'Other Role',
    description,
    hiringOrganization: { '@type': 'Organization', name: 'Teach For All' },
    url: 'https://boards.greenhouse.io/embed/job_app?token=1111111111',
  };
  const result = parseJobPage(html([otherJob, embedJob]), { url: ghUrl });
  assert.equal(result.fields.role, 'Director of Operations');
  assert.equal(result.fields.company, 'Teach For All');
});

test('custom CMS fallback selectors support WordPress/Nexor templates with .entry-content and .career-detail', () => {
  const cmsPage = page(`
    <div class="career-single">
      <h1>Principal Systems Consultant</h1>
      <div class="company__name">Nexor Systems</div>
      <div class="career-detail">
        <p>Nexor is a trusted cyber security partner providing critical solutions.</p>
        <h2>Responsibilities</h2>
        <ul><li>Architect high assurance security boundaries.</li><li>Guide engineering teams.</li></ul>
        <p>Applicants should bring extensive systems architecture and defense sector experience.</p>
      </div>
    </div>
  `);
  const result = parse(cmsPage);
  assert.equal(result.method, 'page-content');
  assert.equal(result.fields.role, 'Principal Systems Consultant');
  assert.equal(result.fields.company, 'Nexor Systems');
  assert.match(result.fields.description, /high assurance security boundaries/);
});

test('structured JobPosting with missing fields is complemented by visible fallback details', () => {
  const minimalJob = posting({
    title: 'Senior Partner Architect',
    description,
    // Note: no salary, workMode, datePosted, or applicationRoute in structured data
  });
  const pageWithBadges = html(minimalJob, `
    <div class="jobs-unified-top-card__workplace-type">Remote</div>
    <div class="job-details-jobs-unified-top-card__job-insight">£80,000 - £95,000 a year</div>
    <button class="jobs-apply-button--easy-apply">Easy Apply</button>
    <figcaption class="num-applicants__caption">42 applicants</figcaption>
    <time datetime="2026-10-20">2026-10-20</time>
  `);
  const result = parse(pageWithBadges);
  assert.equal(result.method, 'structured-data');
  assert.equal(result.fields.role, 'Senior Partner Architect');
  assert.equal(result.fields.workMode, 'Remote');
  assert.equal(result.fields.salary, '£80,000 - £95,000 a year');
  assert.equal(result.fields.applicationRoute, 'LinkedIn Easy Apply');
  assert.equal(result.fields.applicantCount, '42 applicants');
  assert.equal(result.fields.datePosted, '2026-10-20');
});

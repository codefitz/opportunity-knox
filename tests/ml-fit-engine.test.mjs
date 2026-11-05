import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";
import {
  extractTermFrequencies,
  buildTfIdfVector,
  cosineSimilarity,
  extractSkills,
  canonicalSkillName,
  evaluateSeniorityDistance,
  computeTitleSimilarity,
  evaluateOpportunityFit,
} from "../server/ml-fit-engine.mjs";

async function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "ml-fit-test-"));
  const options = {
    dataDir: join(root, "state"),
    filesDir: join(root, "files"),
    setupToken: "test-setup-token",
    automationEnabled: false,
  };
  const app = createApp(options);
  await new Promise((done) => app.server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = "";

  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  async function request(path, { method = "GET", body } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const type = response.headers.get("content-type") || "";
    const data = type.includes("application/json")
      ? await response.json()
      : await response.text();
    return { response, status: response.status, data };
  }

  const setupRes = await request("/api/setup", {
    method: "POST",
    body: {
      password: "test-password-123",
      token: "test-setup-token",
    },
  });
  assert.equal(setupRes.status, 200);
  cookie = setupRes.response.headers.get("set-cookie").split(";")[0];

  return { request, app };
}

test("Conventional ML Engine: TF-IDF vectorization and sublinear cosine similarity", () => {
  const textA =
    "Senior TypeScript and React developer building cloud-native microservices with Kubernetes and PostgreSQL.";
  const textB =
    "Staff Frontend Engineer expert in React, TypeScript, and modern web application development.";
  const textC =
    "Certified Executive Chef specializing in classical French pastry and kitchen inventory management.";

  const freqsA = extractTermFrequencies(textA);
  const freqsB = extractTermFrequencies(textB);
  const freqsC = extractTermFrequencies(textC);

  assert.ok(freqsA.has("typescript"));
  assert.ok(freqsA.has("react"));
  assert.ok(freqsA.has("kubernetes"));

  const vecA = buildTfIdfVector(freqsA);
  const vecB = buildTfIdfVector(freqsB);
  const vecC = buildTfIdfVector(freqsC);

  // Self-similarity is 1.0
  const simAA = cosineSimilarity(vecA, vecA);
  assert.ok(Math.abs(simAA - 1.0) < 0.001);

  // High similarity between related tech roles (A and B share TypeScript, React, developer/engineer terms)
  const simAB = cosineSimilarity(vecA, vecB);
  assert.ok(simAB > 0.05, `Expected simAB > 0.05, got ${simAB}`);

  // Very low / zero similarity between tech engineer and pastry chef
  const simAC = cosineSimilarity(vecA, vecC);
  assert.ok(simAC < 0.05, `Expected simAC < 0.05, got ${simAC}`);
  assert.ok(simAB > simAC * 3, "Tech-tech similarity must substantially exceed tech-chef similarity");
});

test("Conventional ML Engine: Skill extraction and canonical name mapping", () => {
  const jobText = `
    We are seeking a Lead Backend Engineer with deep experience in Go (golang), Docker,
    PostgreSQL, Kubernetes (k8s), and REST APIs. Knowledge of AWS or GCP is highly desirable.
    Experience with Redis and CI/CD pipelines preferred.
  `;

  const skills = extractSkills(jobText, ["GraphQL", "Kafka"]);
  assert.ok(skills.has("Go"));
  assert.ok(skills.has("Docker"));
  assert.ok(skills.has("PostgreSQL"));
  assert.ok(skills.has("Kubernetes"));
  assert.ok(skills.has("REST API"));
  assert.ok(skills.has("AWS"));
  assert.ok(skills.has("GCP"));
  assert.ok(skills.has("Redis"));
  assert.ok(skills.has("CI/CD"));

  assert.equal(canonicalSkillName("k8s"), "Kubernetes");
  assert.equal(canonicalSkillName("postgres"), "PostgreSQL");
  assert.equal(canonicalSkillName("golang"), "Go");
});

test("Conventional ML Engine: Seniority rank distance calculation", () => {
  assert.equal(evaluateSeniorityDistance("senior", ["senior"]), 100);
  assert.equal(evaluateSeniorityDistance("lead", ["senior"]), 80);
  assert.equal(evaluateSeniorityDistance("mid", ["senior"]), 80);
  assert.equal(evaluateSeniorityDistance("entry", ["senior"]), 50);
  assert.equal(evaluateSeniorityDistance("director", ["senior"]), 50);
  assert.equal(evaluateSeniorityDistance("executive", ["senior"]), 20);
});

test("Conventional ML Engine: Composite fit evaluation produces evidence-grounded score, strengths and gaps", () => {
  const opp = {
    role: "Senior Full Stack Engineer",
    description: `
      Leading software firm is looking for a Senior Full Stack Engineer.
      Requirements:
      - 5+ years of experience with TypeScript, React, and Node.js
      - Experience with PostgreSQL and Docker
      - Exposure to Kubernetes and AWS cloud deployment
      - Work mode: Hybrid in London
    `,
    seniority: "senior",
    workMode: "Hybrid",
    tags: ["Full Stack", "TypeScript"],
  };

  const profile = {
    targetTitles: ["Full Stack Engineer", "Software Engineer"],
    targetSkills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
    targetSeniorities: ["senior"],
    workModes: ["Hybrid", "Remote"],
    careerTexts: [
      `
        Curriculum Vitae - Senior Engineer
        Summary: 6 years building web applications with React, TypeScript, Node.js, and PostgreSQL.
        Experienced in Docker containerization and modern REST API development.
      `,
    ],
  };

  const result = evaluateOpportunityFit(opp, profile);

  assert.ok(result.score >= 70, `Expected score >= 70, got ${result.score}`);
  assert.equal(result.tier, "strong");
  assert.ok(result.matchedSkills.includes("TypeScript"));
  assert.ok(result.matchedSkills.includes("React"));
  assert.ok(result.matchedSkills.includes("PostgreSQL"));
  assert.ok(result.missingSkills.includes("Kubernetes"));
  assert.ok(result.missingSkills.includes("AWS"));

  assert.ok(result.strengths.length > 0);
  assert.ok(result.strengths.some((s) => s.includes("core technical competencies")));
  assert.ok(result.strengths.some((s) => s.includes("Role title directly aligns")));

  assert.ok(result.gaps.length > 0);
  assert.ok(result.gaps.some((g) => g.includes("skills not found in your profile")));
});

test("Conventional ML Fit Engine: HTTP endpoint integration with offline assessment", async (t) => {
  const f = await createFixture(t);

  // 1. Upload CV to Career Hub (opportunityId = null)
  const cvDoc = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        name: "Engineering Resume.txt",
        contentBase64: Buffer.from(
          "Senior Software Engineer CV: 6 years building high scale apps with TypeScript, React, Node.js, PostgreSQL, Docker.",
        ).toString("base64"),
      },
    })
  ).data;
  assert.ok(cvDoc.id);

  // 2. Configure candidate target criteria
  const crit = (await f.request("/api/buddy/fit-criteria")).data;
  await f.request("/api/buddy/fit-criteria", {
    method: "PATCH",
    body: {
      revision: crit.revision,
      items: [{ id: "tech-fit", description: "Technical alignment", priority: "required" }],
      structured: {
        targetTitles: ["Senior Full Stack Engineer", "Staff Engineer"],
        targetSkills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
        targetSeniorities: ["senior"],
        workModes: ["hybrid", "remote"],
      },
    },
  });

  // 3. Create opportunity matching candidate background
  const opp = (
    await f.request("/api/opportunities", {
      method: "POST",
      body: {
        company: "Acme Corp",
        role: "Senior Full Stack Engineer",
        url: "https://example.com/jobs/123",
        jobReference: "REF-123",
        location: "London",
        workMode: "Hybrid",
        salary: "$120,000",
        employmentType: "Full-time",
        contact: "recruiter@example.com",
        deadline: "2026-12-31",
        description:
          "Seeking a Senior Full Stack Engineer skilled in TypeScript, React, Node.js, and Kubernetes.",
        priority: "high",
        nextAction: "Review fit",
        nextActionDate: "2026-11-10",
        tags: ["engineering"],
        stage: "identification",
      },
    })
  ).data;

  // 4. Verify fullRecord automatically computed non-zero alignmentScore and matched/missing skills
  const fetchedOpp = (await f.request(`/api/opportunities/${opp.id}`)).data;
  assert.ok(
    fetchedOpp.alignmentScore > 50,
    `Expected alignmentScore > 50, got ${fetchedOpp.alignmentScore}`,
  );
  assert.equal(fetchedOpp.alignmentTier, "strong");
  assert.ok(fetchedOpp.matchedSkills.includes("TypeScript"));
  assert.ok(fetchedOpp.matchedSkills.includes("React"));
  assert.ok(fetchedOpp.missingSkills.includes("Kubernetes"));

  // 5. Run Automated Fit Assessment using Conventional ML (offline, NO LLM required)
  const assessRes = await f.request(`/api/buddy/decisions/${opp.id}`, {
    method: "POST",
    body: {
      revision: fetchedOpp.revision,
      generalFit: true,
      engine: "ml",
      documentIds: [],
    },
  });

  assert.equal(assessRes.status, 200);
  assert.equal(assessRes.data.assessment.provider, "conventional-ml");
  assert.equal(assessRes.data.assessment.modelSource, "conventionalML");
  assert.ok(assessRes.data.reviewDraft.strengths.includes("core technical competencies"));
  assert.ok(assessRes.data.reviewDraft.gaps.includes("Kubernetes"));

  // 6. Opportunity moved to 'review' stage with event and review data
  const updatedOpp = (await f.request(`/api/opportunities/${opp.id}`)).data;
  assert.equal(updatedOpp.stage, "review");
  assert.ok(updatedOpp.review.strengths);
  assert.ok(updatedOpp.review.gaps);
  assert.equal(updatedOpp.events.at(-1).title, "Automated fit assessment");

  const decisions = (await f.request(`/api/buddy/decisions/${opp.id}`)).data;
  assert.equal(decisions.assessments.length, 1);
  assert.equal(decisions.assessments[0].stale, false);
});

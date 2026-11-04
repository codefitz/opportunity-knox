import test from "node:test";
import assert from "node:assert/strict";
import {
  computeTitleSimilarity,
  computeSkillsMatch,
  calculateAlignment,
} from "../server/alignment.mjs";

test("computeTitleSimilarity matches identical and overlapping job titles", () => {
  const targetTitles = ["Staff Software Engineer", "Solutions Architect"];

  assert.equal(computeTitleSimilarity("Solutions Architect", targetTitles), 100);
  assert.equal(computeTitleSimilarity("Lead Solutions Architect", targetTitles), 90);
  assert.ok(computeTitleSimilarity("Senior Software Engineer", targetTitles) >= 60);
  assert.ok(computeTitleSimilarity("Head of Marketing", targetTitles) < 30);
});

test("computeSkillsMatch counts target skills appearing in text", () => {
  const targetSkills = ["TypeScript", "Python", "Kubernetes", "AWS", "GraphQL"];
  const text = "We are seeking a developer proficient in TypeScript and Python, deploying on AWS.";

  const result = computeSkillsMatch(text, targetSkills);
  assert.equal(result.matchedSkills.length, 3);
  assert.ok(result.matchedSkills.includes("TypeScript"));
  assert.ok(result.matchedSkills.includes("Python"));
  assert.ok(result.matchedSkills.includes("AWS"));
  assert.equal(result.score, 60);
});

test("calculateAlignment computes composite score and tier", () => {
  const targetTitles = ["Lead Solutions Architect"];
  const targetSkills = ["TypeScript", "AWS", "Docker"];

  // Strong match: Title matches, all skills present
  const opStrong = {
    role: "Lead Solutions Architect",
    description: "Architect cloud platforms with TypeScript, AWS, and Docker containers.",
  };
  const resStrong = calculateAlignment(opStrong, targetTitles, targetSkills);
  assert.equal(resStrong.tier, "strong");
  assert.ok(resStrong.score >= 90);
  assert.equal(resStrong.matchedSkills.length, 3);

  // Moderate match: Title partial, some skills
  const opModerate = {
    role: "Cloud Architect",
    description: "Build microservices in TypeScript and PostgreSQL.",
  };
  const resModerate = calculateAlignment(opModerate, targetTitles, targetSkills);
  assert.ok(resModerate.tier === "moderate" || resModerate.tier === "reach");

  // Mismatch
  const opMismatch = {
    role: "Marketing Manager",
    description: "Manage content campaigns and social media channels.",
  };
  const resMismatch = calculateAlignment(opMismatch, targetTitles, targetSkills);
  assert.equal(resMismatch.tier, "mismatch");
  assert.ok(resMismatch.score < 25);
});

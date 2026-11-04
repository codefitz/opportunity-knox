import test from "node:test";
import assert from "node:assert/strict";
import {
  findExclusionMatches,
  checkOpportunityExclusions,
  buildKeywordRegex,
} from "../server/exclusions.mjs";

test("findExclusionMatches matches whole words without partial false positives", () => {
  const keywords = ["PHP", "Ruby", "Inside IR35", "DV clearance"];

  // Matches standalone PHP
  const res1 = findExclusionMatches("Senior PHP Developer role available", keywords);
  assert.deepEqual(res1, ["PHP"]);

  // Does not match inside other words like glyph
  const res2 = findExclusionMatches("Responsible for typography and glyph elements", keywords);
  assert.deepEqual(res2, []);

  // Matches multi-word phrases case-insensitively
  const res3 = findExclusionMatches("This contract is strictly inside ir35 with hybrid working", keywords);
  assert.deepEqual(res3, ["Inside IR35"]);

  // Matches multiple exclusion terms
  const res4 = findExclusionMatches("Role requires DV Clearance and legacy ruby code maintenance", keywords);
  assert.ok(res4.includes("Ruby"));
  assert.ok(res4.includes("DV clearance"));
});

test("findExclusionMatches handles keywords with special characters (.NET, C++)", () => {
  const keywords = [".NET", "C++", "Vue.js"];
  const text = "Experience required with modern .NET backend and C++ modules";
  const matches = findExclusionMatches(text, keywords);
  assert.ok(matches.includes(".NET"));
  assert.ok(matches.includes("C++"));
});

test("checkOpportunityExclusions searches across role, description, and tags", () => {
  const keywords = ["Junior", "Contract", "Crypto"];

  const op1 = {
    role: "Junior Software Engineer",
    company: "Acme",
    description: "Build web apps in Python",
  };
  assert.deepEqual(checkOpportunityExclusions(op1, keywords), ["Junior"]);

  const op2 = {
    role: "Staff Engineer",
    company: "Acme",
    tags: ["crypto", "web3"],
    description: "Distributed protocols",
  };
  assert.deepEqual(checkOpportunityExclusions(op2, keywords), ["Crypto"]);

  const op3 = {
    role: "Lead Architect",
    company: "Acme",
    description: "6 month fixed-term Contract position",
  };
  assert.deepEqual(checkOpportunityExclusions(op3, keywords), ["Contract"]);

  const op4 = {
    role: "Lead Architect",
    company: "Acme",
    description: "Permanent position building cloud software",
  };
  assert.deepEqual(checkOpportunityExclusions(op4, keywords), []);
});

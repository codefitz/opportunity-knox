import test from "node:test";
import assert from "node:assert/strict";
import { classifySeniority } from "../server/seniority.mjs";

test("classifySeniority identifies executive and director roles accurately", () => {
  assert.equal(classifySeniority("VP of Product"), "executive");
  assert.equal(classifySeniority("Chief Technology Officer"), "executive");
  assert.equal(classifySeniority("CTO & Co-Founder"), "executive");
  assert.equal(classifySeniority("Director of Engineering"), "director");
  assert.equal(classifySeniority("Head of Cloud Infrastructure"), "director");
  assert.equal(classifySeniority("Managing Director"), "director");
});

test("classifySeniority identifies lead, principal and architect roles", () => {
  assert.equal(classifySeniority("Lead Software Engineer"), "lead");
  assert.equal(classifySeniority("Principal Solutions Architect"), "lead");
  assert.equal(classifySeniority("Enterprise Cloud Architect"), "lead");
  assert.equal(classifySeniority("Tech Lead Manager"), "lead");
});

test("classifySeniority identifies senior and entry levels", () => {
  assert.equal(classifySeniority("Senior Full Stack Developer"), "senior");
  assert.equal(classifySeniority("Staff Site Reliability Engineer"), "senior");
  assert.equal(classifySeniority("Sr. Backend Developer"), "senior");

  assert.equal(classifySeniority("Junior Front End Engineer"), "entry");
  assert.equal(classifySeniority("Graduate Software Trainee"), "entry");
  assert.equal(classifySeniority("Associate Product Manager"), "entry");
});

test("classifySeniority falls back to description when title is unadorned", () => {
  const role = "Software Engineer";
  const descSenior = "We are seeking a senior professional with 8+ years experience leading services.";
  assert.equal(classifySeniority(role, descSenior), "senior");

  const descJunior = "This is a junior position for recent graduates eager to learn.";
  assert.equal(classifySeniority(role, descJunior), "entry");

  const descPlain = "Develop web software in Node.js and React.";
  assert.equal(classifySeniority(role, descPlain), null);
});

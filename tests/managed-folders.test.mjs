import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeFolderToken,
  opportunityFolderName,
  opportunitySubdirectory,
  buildOpportunityDocumentPath,
} from "../server/managed-folders.mjs";

test("sanitizeFolderToken normalizes diacritics, symbols, spaces and bounds length", () => {
  assert.equal(sanitizeFolderToken("Acme Corp & Co."), "acme-corp-co");
  assert.equal(sanitizeFolderToken("  Stripe, Inc.  "), "stripe-inc");
  assert.equal(sanitizeFolderToken("Société Générale"), "societe-generale");
  assert.equal(sanitizeFolderToken("!@#$%^&*()"), "unspecified");
  assert.equal(sanitizeFolderToken("", "custom-fallback"), "custom-fallback");
  assert.equal(sanitizeFolderToken(null, "fallback"), "fallback");

  const longRole = "Senior Principal Distributed Systems and Cloud Infrastructure Staff Architect Lead Engineer";
  const sanitized = sanitizeFolderToken(longRole, "role", 40);
  assert.ok(sanitized.length <= 40);
  assert.ok(!sanitized.endsWith("-"));
});

test("opportunityFolderName formats <id>-<company>-<role>", () => {
  const opp = {
    id: "opp-12345",
    company: "Google UK Ltd",
    role: "Senior AI Engineer",
  };
  assert.equal(opportunityFolderName(opp), "opp-12345-google-uk-ltd-senior-ai-engineer");

  const oppBlank = {
    id: "opp-999",
    company: "",
    role: "",
  };
  assert.equal(opportunityFolderName(oppBlank), "opp-999-company-role");
});

test("opportunitySubdirectory categorizes documents according to managed stage folders", () => {
  // Submitted takes precedence
  assert.equal(
    opportunitySubdirectory({ kind: "cv", status: "submitted", category: "tailored-cv" }),
    "submitted"
  );
  assert.equal(
    opportunitySubdirectory({ kind: "cover", status: "submitted" }),
    "submitted"
  );

  // Approved
  assert.equal(
    opportunitySubdirectory({ kind: "cv", status: "approved", category: "tailored-cv" }),
    "approved"
  );

  // Job description
  assert.equal(
    opportunitySubdirectory({ kind: "jd", status: "draft" }),
    "job-description"
  );
  assert.equal(
    opportunitySubdirectory({ category: "job-description" }),
    "job-description"
  );

  // Interviews
  assert.equal(
    opportunitySubdirectory({ kind: "interview" }),
    "interviews"
  );
  assert.equal(
    opportunitySubdirectory({ category: "star-story" }),
    "interviews"
  );

  // Drafts
  assert.equal(
    opportunitySubdirectory({ kind: "cv", status: "draft" }),
    "drafts"
  );
  assert.equal(
    opportunitySubdirectory({ kind: "cover", status: "draft" }),
    "drafts"
  );
  assert.equal(
    opportunitySubdirectory({ category: "tailored-cv", status: "draft" }),
    "drafts"
  );
  assert.equal(
    opportunitySubdirectory({ category: "supporting-statement" }),
    "drafts"
  );

  // Correspondence
  assert.equal(
    opportunitySubdirectory({ kind: "other", category: "other", status: "draft" }),
    "correspondence"
  );
  assert.equal(
    opportunitySubdirectory({ kind: "reference" }),
    "correspondence"
  );
});

test("buildOpportunityDocumentPath generates clean relative path", () => {
  const path = buildOpportunityDocumentPath({
    documentsSubdir: "opportunities",
    opportunity: {
      id: "abc-456",
      company: "Acme",
      role: "Backend Dev",
    },
    documentId: "doc-789",
    name: "My Tailored CV.pdf",
    kind: "cv",
    status: "draft",
    category: "tailored-cv",
  });

  assert.equal(
    path,
    "opportunities/abc-456-acme-backend-dev/drafts/doc-789.pdf"
  );
});

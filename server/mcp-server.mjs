#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const OPKNOX_URL = (process.env.OPKNOX_URL || "http://127.0.0.1:4318").replace(/\/+$/, "");
const OPKNOX_API_KEY = process.env.OPKNOX_API_KEY || "";

const server = new McpServer({
  name: "opportunity-knox",
  version: "0.4.9",
});

function formatError(prefix, error) {
  if (error instanceof Error) {
    if (error.cause?.code === "ECONNREFUSED" || error.message.includes("ECONNREFUSED")) {
      return `${prefix}: Could not connect to Opportunity Knox at ${OPKNOX_URL}. Ensure the application is running (e.g. 'npm start' or via the launcher).`;
    }
    return `${prefix}: ${error.message}`;
  }
  return `${prefix}: ${String(error)}`;
}

async function requestOpKnox(path, options = {}) {
  if (!OPKNOX_API_KEY) {
    throw new Error(
      "OPKNOX_API_KEY environment variable is not configured. Generate an API key in Opportunity Knox Settings → MCP Server, and add it to your Claude Desktop configuration.",
    );
  }

  const url = `${OPKNOX_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${OPKNOX_API_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text };
  }

  if (!response.ok) {
    const message = data.error || data.message || `HTTP ${response.status}`;
    throw new Error(`Opportunity Knox error (${response.status}): ${message}`);
  }

  return data;
}

// Tool 1: search_opportunities
server.tool(
  "search_opportunities",
  {
    query: z
      .string()
      .optional()
      .describe("Optional search keywords matching company, role, or description"),
    stage: z
      .string()
      .optional()
      .describe("Optional workflow stage filter (e.g. 'identification', 'review', 'drafting', 'submitted', 'interviews', 'outcome')"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Maximum number of opportunities to return (default 20, max 50)"),
  },
  async ({ query, stage, limit }) => {
    try {
      const data = await requestOpKnox("/api/mcp/v1/opportunities/search", {
        method: "POST",
        body: JSON.stringify({ query, stage, limit }),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: formatError("Failed to search opportunities", e) }],
        isError: true,
      };
    }
  },
);

// Tool 2: get_opportunity
server.tool(
  "get_opportunity",
  {
    id: z.string().describe("Opportunity ID (as returned by search_opportunities)"),
  },
  async ({ id }) => {
    try {
      const data = await requestOpKnox(`/api/mcp/v1/opportunities/${encodeURIComponent(id)}`, {
        method: "GET",
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data.opportunity, null, 2),
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: formatError(`Failed to get opportunity '${id}'`, e) }],
        isError: true,
      };
    }
  },
);

// Tool 3: search_career_evidence
server.tool(
  "search_career_evidence",
  {
    query: z.string().describe("Search keywords describing a role requirement, skill, or achievement to match against verified career documents"),
    opportunityId: z
      .string()
      .optional()
      .describe("Optional opportunity ID to also search documents specifically linked to this opportunity"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Maximum number of evidence excerpts to return (default 5, max 10)"),
  },
  async ({ query, opportunityId, limit }) => {
    try {
      const data = await requestOpKnox("/api/mcp/v1/career-evidence/search", {
        method: "POST",
        body: JSON.stringify({ query, opportunityId, limit }),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: formatError("Failed to search career evidence", e) }],
        isError: true,
      };
    }
  },
);

// Tool 4: read_career_evidence
server.tool(
  "read_career_evidence",
  {
    documentId: z.string().describe("Document ID of the verified evidence file (as found in search_career_evidence)"),
    passageIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Optional 0-based passage index to read a specific excerpt, or omit to read full text"),
  },
  async ({ documentId, passageIndex }) => {
    try {
      const queryParam = passageIndex !== undefined ? `?passageIndex=${passageIndex}` : "";
      const data = await requestOpKnox(
        `/api/mcp/v1/career-evidence/${encodeURIComponent(documentId)}${queryParam}`,
        { method: "GET" },
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data.document, null, 2),
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: formatError(`Failed to read evidence document '${documentId}'`, e) }],
        isError: true,
      };
    }
  },
);

// Tool 5: save_fit_review
server.tool(
  "save_fit_review",
  {
    opportunityId: z.string().describe("Opportunity ID to attach this fit review to"),
    expectedRevision: z
      .number()
      .int()
      .describe("The revision number of the opportunity that was assessed (obtained from get_opportunity) to prevent conflicting concurrent writes"),
    strengths: z
      .string()
      .describe("Clear bullet points or concise summary of candidate strengths directly matched to role requirements"),
    gaps: z
      .string()
      .describe("Clear bullet points of missing qualifications, unanswered questions, or areas needing candidate clarification"),
    reviewTimestamp: z
      .string()
      .optional()
      .describe("Optional ISO 8601 timestamp for when the review was conducted (server time used if omitted)"),
    evidenceReferences: z
      .array(z.string())
      .optional()
      .describe("Optional array of document IDs or names cited in the fit assessment"),
    requestId: z
      .string()
      .optional()
      .describe("Optional unique idempotency token for this save request"),
  },
  async ({
    opportunityId,
    expectedRevision,
    strengths,
    gaps,
    reviewTimestamp,
    evidenceReferences,
    requestId,
  }) => {
    try {
      const data = await requestOpKnox("/api/mcp/v1/fit-review", {
        method: "POST",
        body: JSON.stringify({
          opportunityId,
          expectedRevision,
          strengths,
          gaps,
          reviewTimestamp,
          evidenceReferences,
          requestId,
        }),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: formatError("Failed to save fit review", e) }],
        isError: true,
      };
    }
  },
);

// Connect via Stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);

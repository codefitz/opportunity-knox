import test from "node:test";
import assert from "node:assert/strict";
import {
  escapeIcsText,
  foldIcsLine,
  formatIcsTimestamp,
  buildVEvent,
  buildVCalendar,
  activityToVEvent,
  generateSingleActivityIcs,
  generateOpportunityCalendarIcs,
  generateAllInterviewsCalendarIcs,
} from "../server/calendar.mjs";

test("ICS escaping and line folding conform to RFC 5545", () => {
  assert.equal(escapeIcsText("Hello, World; Welcome\nNext line"), "Hello\\, World\\; Welcome\\nNext line");
  const longLine = "DESCRIPTION:" + "A".repeat(100);
  const folded = foldIcsLine(longLine);
  assert.ok(folded.includes("\r\n "));
  assert.ok(folded.split("\r\n")[0].length <= 75);
});

test("formatIcsTimestamp formats UTC timestamps and date-only strings", () => {
  const ts = formatIcsTimestamp("2026-11-15T14:30:00.000Z");
  assert.equal(ts, "20261115T143000Z");

  const dateOnly = formatIcsTimestamp("2026-11-15", true);
  assert.equal(dateOnly, "20261115");
});

test("buildVEvent creates valid VEVENT block with alarm and duration", () => {
  const event = buildVEvent({
    id: "act-123",
    summary: "System Design Interview",
    description: "Discuss scaling Kafka architecture",
    location: "Google Meet",
    startTime: "2026-11-20T10:00:00.000Z",
    durationMinutes: 45,
    createdAt: "2026-11-01T09:00:00.000Z",
    alarmMinutes: 15,
  });

  assert.ok(event.includes("BEGIN:VEVENT"));
  assert.ok(event.includes("UID:act-123@opportunity-knox"));
  assert.ok(event.includes("DTSTART:20261120T100000Z"));
  assert.ok(event.includes("DTEND:20261120T104500Z"));
  assert.ok(event.includes("SUMMARY:System Design Interview"));
  assert.ok(event.includes("LOCATION:Google Meet"));
  assert.ok(event.includes("BEGIN:VALARM"));
  assert.ok(event.includes("TRIGGER:-PT15M"));
  assert.ok(event.includes("END:VEVENT"));
});

test("activityToVEvent builds structured calendar event from opportunity activity", () => {
  const opp = {
    id: "opp-99",
    company: "Stripe",
    role: "Staff Engineer",
    stage: "interviews",
    status: "",
    location: "London",
  };

  const activity = {
    id: "act-99",
    kind: "interview",
    type: "video",
    title: "Round 2 Technical",
    scheduledAt: "2026-11-25T15:00:00.000Z",
    status: "planned",
    notes: "Review distributed consensus notes before call.",
    contact: "interviewer@stripe.com",
    createdAt: "2026-11-01T12:00:00.000Z",
  };

  const vEvent = activityToVEvent(activity, opp);
  assert.ok(vEvent.includes("SUMMARY:[video] Round 2 Technical (Staff Engineer — Stripe)"));
  assert.ok(vEvent.includes("interviewer@stripe.com"));
  assert.ok(vEvent.includes("distributed consensus"));
});

test("generateSingleActivityIcs and calendar exports wrap events in VCALENDAR", () => {
  const opp = {
    id: "opp-100",
    company: "Acme",
    role: "Tech Lead",
    stage: "interviews",
    activities: [
      {
        id: "act-1",
        kind: "interview",
        type: "video",
        title: "Initial Call",
        scheduledAt: "2026-11-10T11:00:00.000Z",
        createdAt: "2026-11-01T10:00:00.000Z",
      },
      {
        id: "act-2",
        kind: "interview",
        type: "in-person",
        title: "Final Onsite",
        scheduledAt: "2026-11-18T14:00:00.000Z",
        createdAt: "2026-11-01T10:00:00.000Z",
      },
    ],
  };

  const single = generateSingleActivityIcs(opp.activities[0], opp);
  assert.ok(single.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(single.includes("SUMMARY:[video] Initial Call"));
  assert.ok(single.endsWith("END:VCALENDAR\r\n"));

  const oppCal = generateOpportunityCalendarIcs(opp);
  assert.ok(oppCal.includes("Initial Call"));
  assert.ok(oppCal.includes("Final Onsite"));

  const allCal = generateAllInterviewsCalendarIcs([opp]);
  assert.ok(allCal.includes("Initial Call"));
  assert.ok(allCal.includes("Final Onsite"));
});

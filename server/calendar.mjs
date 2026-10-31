/**
 * iCalendar (RFC 5545) generator for Opportunity Knox interviews and activities.
 */

// Escape text according to RFC 5545 section 3.3.11
export function escapeIcsText(str = "") {
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Fold lines longer than 75 octets per RFC 5545 section 3.1
export function foldIcsLine(line) {
  if (line.length <= 75) return line;
  const parts = [];
  let cur = line;
  while (cur.length > 75) {
    parts.push(cur.slice(0, 75));
    cur = " " + cur.slice(75);
  }
  parts.push(cur);
  return parts.join("\r\n");
}

// Convert ISO string or Date to UTC timestamp string: YYYYMMDDTHHMMSSZ or YYYYMMDD for date-only
export function formatIcsTimestamp(val, dateOnly = false) {
  const d = typeof val === "string" ? new Date(val) : val;
  if (!d || Number.isNaN(d.getTime())) {
    throw new Error("Invalid date for ICS: " + val);
  }
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  if (dateOnly) {
    return `${year}${month}${day}`;
  }
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const mins = String(d.getUTCMinutes()).padStart(2, "0");
  const secs = String(d.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${mins}${secs}Z`;
}

/**
 * Build a VEVENT component for an interview or activity.
 */
export function buildVEvent({
  id,
  summary,
  description = "",
  location = "",
  startTime,
  durationMinutes = 60,
  createdAt,
  updatedAt,
  alarmMinutes = 30,
}) {
  const dtStamp = formatIcsTimestamp(updatedAt || createdAt || new Date());
  const isDateOnly = typeof startTime === "string" && /^\d{4}-\d{2}-\d{2}$/.test(startTime.trim());
  
  let dtStartLine = "";
  let dtEndLine = "";

  if (isDateOnly) {
    const startStr = startTime.trim().replace(/-/g, "");
    dtStartLine = `DTSTART;VALUE=DATE:${startStr}`;
    // End date is exclusive in iCalendar date-only; advance by 1 day
    const startDate = new Date(startTime.trim() + "T00:00:00Z");
    const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
    const endStr = formatIcsTimestamp(endDate, true);
    dtEndLine = `DTEND;VALUE=DATE:${endStr}`;
  } else {
    const startDate = new Date(startTime);
    dtStartLine = `DTSTART:${formatIcsTimestamp(startDate)}`;
    const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
    dtEndLine = `DTEND:${formatIcsTimestamp(endDate)}`;
  }

  const lines = [
    "BEGIN:VEVENT",
    `UID:${id}@opportunity-knox`,
    `DTSTAMP:${dtStamp}`,
    dtStartLine,
    dtEndLine,
    `SUMMARY:${escapeIcsText(summary)}`,
  ];

  if (description) {
    lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  }
  if (location) {
    lines.push(`LOCATION:${escapeIcsText(location)}`);
  }

  // Include an alert/alarm if requested and not date-only
  if (!isDateOnly && alarmMinutes > 0) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcsText("Reminder: " + summary)}`,
      `TRIGGER:-PT${alarmMinutes}M`,
      "END:VALARM",
    );
  }

  lines.push("END:VEVENT");
  return lines.map(foldIcsLine).join("\r\n");
}

/**
 * Format a complete VCALENDAR file from an array of VEVENT string blocks.
 */
export function buildVCalendar(events = [], calName = "Opportunity Knox Interviews") {
  const header = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Opportunity Knox//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calName)}`,
  ].map(foldIcsLine).join("\r\n");

  const footer = "END:VCALENDAR";

  if (!events.length) {
    return `${header}\r\n${footer}\r\n`;
  }

  return `${header}\r\n${events.join("\r\n")}\r\n${footer}\r\n`;
}

/**
 * Convert an opportunity activity (interview or scheduled communication) into a VEVENT block.
 */
export function activityToVEvent(activity, opportunity) {
  if (!activity || !activity.scheduledAt) return null;

  const roleCompany = `${opportunity.role} — ${opportunity.company}`;
  const isInterview = activity.kind === "interview";
  const channelType = activity.channel || activity.type || (isInterview ? "Interview" : "Communication");
  
  const summary = `[${channelType}] ${activity.title} (${roleCompany})`;

  const descParts = [
    `Opportunity: ${opportunity.role} at ${opportunity.company}`,
    `Stage: ${opportunity.stage}${opportunity.status ? ` (${opportunity.status})` : ""}`,
    `Kind: ${activity.kind} (${channelType})`,
    activity.contact ? `Contact: ${activity.contact}` : null,
    activity.status ? `Status: ${activity.status}` : null,
    activity.notes ? `\nNotes:\n${activity.notes}` : null,
    activity.followUp ? `\nFollow-up: ${activity.followUp}${activity.followUpDate ? ` (Due: ${activity.followUpDate})` : ""}` : null,
  ].filter(Boolean);

  let location = "";
  if (activity.type === "in-person" && opportunity.location) {
    location = opportunity.location;
  } else if (["video", "phone"].includes(activity.type)) {
    location = activity.contact || activity.type;
  } else if (activity.contact) {
    location = activity.contact;
  }

  return buildVEvent({
    id: `activity-${activity.id}`,
    summary,
    description: descParts.join("\n"),
    location,
    startTime: activity.scheduledAt,
    durationMinutes: 60,
    createdAt: activity.createdAt,
    updatedAt: activity.history?.length ? activity.history[activity.history.length - 1].changedAt : activity.createdAt,
    alarmMinutes: 30,
  });
}

/**
 * Generate iCalendar for a single activity.
 */
export function generateSingleActivityIcs(activity, opportunity) {
  const event = activityToVEvent(activity, opportunity);
  if (!event) return null;
  const calName = `${opportunity.company} — ${activity.title}`;
  return buildVCalendar([event], calName);
}

/**
 * Generate iCalendar containing all scheduled activities/interviews for an opportunity.
 */
export function generateOpportunityCalendarIcs(opportunity) {
  const events = (opportunity.activities || [])
    .filter((a) => Boolean(a.scheduledAt))
    .map((a) => activityToVEvent(a, opportunity))
    .filter(Boolean);

  const calName = `${opportunity.company} — Interviews & Activities`;
  return buildVCalendar(events, calName);
}

/**
 * Generate iCalendar containing all scheduled activities across all opportunities.
 */
export function generateAllInterviewsCalendarIcs(opportunities = []) {
  const events = [];
  for (const opp of opportunities) {
    for (const act of opp.activities || []) {
      if (act.scheduledAt) {
        const vEvent = activityToVEvent(act, opp);
        if (vEvent) events.push(vEvent);
      }
    }
  }
  return buildVCalendar(events, "Opportunity Knox — Scheduled Interviews");
}

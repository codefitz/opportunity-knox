import test from "node:test";
import assert from "node:assert/strict";
import {
  applicationActivity,
  buildActionQueue,
  calendarDay,
  dashboardMetrics,
  dayDifference,
  firstSubmission,
  plannedInterviews,
  sortTasks,
  validDay,
} from "../src/lib/dashboard.ts";

const now = new Date("2026-10-22T12:00:00Z");
function opportunity(id, extra = {}) {
  return {
    id,
    company: `Fictional ${id}`,
    role: "Architect",
    stage: "identification",
    outcome: "",
    createdAt: "2026-10-22T10:00:00Z",
    nextAction: "",
    nextActionDate: "",
    events: [],
    activities: [],
    ...extra,
  };
}
function task(id, dueDate = "", extra = {}) {
  return {
    id,
    title: id,
    notes: "",
    dueDate,
    completed: false,
    opportunityId: "",
    revision: 1,
    createdAt: "2026-10-20T10:00:00Z",
    updatedAt: "2026-10-20T10:00:00Z",
    completedAt: "",
    ...extra,
  };
}
function event(stage, effectiveAt) {
  return {
    id: `${stage}-${effectiveAt}`,
    stage,
    effectiveAt,
    recordedAt: "2026-10-22T11:00:00Z",
    note: "",
  };
}

test("empty dashboard has measured zero counts and no invented hire rate", () => {
  const metrics = dashboardMetrics([], [], "Europe/London", now);
  assert.equal(metrics.total, 0);
  assert.equal(metrics.active, 0);
  assert.equal(metrics.submitted, 0);
  assert.equal(metrics.hireShare, null);
  assert.equal(
    metrics.pipeline.reduce((n, row) => n + row.count, 0),
    0,
  );
  assert.equal(
    metrics.outcomes.reduce((n, row) => n + row.count, 0),
    0,
  );
  assert.deepEqual(buildActionQueue([], []), []);
});

test("submission history counts an opportunity once and retains its first recorded date", () => {
  const first = "2026-10-20T09:00:00Z";
  const records = [
    opportunity("revisited", {
      stage: "interviews",
      events: [
        event("identification", "2026-10-19T09:00:00Z"),
        event("submitted", first),
        event("submitted", "2026-09-01T09:00:00Z"),
        event("interviews", "2026-10-21T09:00:00Z"),
        event("submitted", "2026-10-22T09:00:00Z"),
      ],
    }),
    opportunity("skipped", { stage: "interviews" }),
    opportunity("future", {
      stage: "submitted",
      events: [event("submitted", "2026-10-25T09:00:00Z")],
    }),
  ];
  assert.equal(firstSubmission(records[0]), first);
  const metrics = dashboardMetrics(records, [], "Europe/London", now);
  assert.equal(metrics.submitted, 1);
  assert.deepEqual(metrics.submittedIds, ["revisited"]);
  const series = applicationActivity(records, 30, "Europe/London", now);
  assert.equal(
    series.reduce((n, day) => n + day.submitted, 0),
    1,
  );
  assert.deepEqual(
    series.find((day) => day.date === "2026-10-20").submittedIds,
    ["revisited"],
  );
  assert.equal(series.at(-1).submitted, 0);
});

test("calendar conversions preserve date-only values and respect workspace midnight and leap dates", () => {
  assert.equal(
    calendarDay("2026-10-21T23:30:00Z", "Europe/London"),
    "2026-10-22",
  );
  assert.equal(
    calendarDay("2026-10-22T00:30:00Z", "America/New_York"),
    "2026-10-21",
  );
  assert.equal(calendarDay("2026-10-22", "Pacific/Honolulu"), "2026-10-22");
  assert.equal(calendarDay("not a date", "Europe/London"), "");
  assert.equal(validDay("2026-02-29"), false);
  assert.equal(validDay("2028-02-29"), true);
  assert.equal(dayDifference("2026-10-26", "2026-10-25"), 1);
});

test("activity windows recalculate their records without changing current totals", () => {
  const records = [
    opportunity("older", { createdAt: "2026-09-15T12:00:00Z" }),
    opportunity("today", {
      createdAt: "2026-10-21T23:30:00Z",
      events: [event("submitted", "2026-10-22T08:00:00Z")],
    }),
  ];
  const short = applicationActivity(records, 14, "Europe/London", now);
  const long = applicationActivity(records, 90, "Europe/London", now);
  assert.equal(short.length, 14);
  assert.equal(long.length, 90);
  assert.equal(
    short.reduce((n, day) => n + day.identified, 0),
    1,
  );
  assert.equal(
    long.reduce((n, day) => n + day.identified, 0),
    2,
  );
  assert.deepEqual(short.at(-1).identifiedIds, ["today"]);
  assert.equal(dashboardMetrics(records, [], "Europe/London", now).total, 2);
});

test("open task and opportunity-action queue sorts by due date and preserves source identities", () => {
  const tasks = [
    task("undated"),
    task("later", "2026-10-24"),
    task("finished", "2026-10-01", { completed: true }),
    task("early", "2026-10-19"),
  ];
  const records = [
    opportunity("active", {
      nextAction: "Follow up",
      nextActionDate: "2026-10-20",
    }),
    opportunity("closed", {
      outcome: "rejected",
      stage: "outcome",
      nextAction: "Old action",
      nextActionDate: "2026-10-01",
    }),
  ];
  const queue = buildActionQueue(tasks, records);
  assert.deepEqual(
    queue.map((row) => row.id),
    ["task:early", "opportunity:active", "task:later", "task:undated"],
  );
  assert.equal(queue[1].source, "opportunity");
  assert.equal(queue[1].task, undefined);
  assert.deepEqual(
    buildActionQueue(tasks, records, false).map((row) => row.id),
    ["task:early", "task:later", "task:undated"],
  );
  assert.deepEqual(
    tasks.map((row) => row.id),
    ["undated", "later", "finished", "early"],
  );
});

test("task due sorting and overdue counts exclude completed work and treat today as due", () => {
  const tasks = [
    task("none"),
    task("today", "2026-10-22"),
    task("past", "2026-10-21"),
    task("done", "2026-10-20", { completed: true }),
  ];
  assert.deepEqual(
    sortTasks(tasks).map((row) => row.id),
    ["done", "past", "today", "none"],
  );
  const metrics = dashboardMetrics([], tasks, "Europe/London", now);
  assert.equal(metrics.openTasks, 3);
  assert.equal(metrics.overdueTasks, 1);
});

test("pipeline and outcome totals reconcile and hire share uses hired/rejected only", () => {
  const records = [
    opportunity("active"),
    ...[
      "hired",
      "rejected",
      "rejected",
      "rejected",
      "ignored",
      "withdrawn",
      "closed",
    ].map((outcome, i) =>
      opportunity(String(i), { outcome, stage: "outcome" }),
    ),
  ];
  const metrics = dashboardMetrics(records, [], "Europe/London", now);
  assert.equal(metrics.active, 1);
  assert.equal(metrics.closed, 7);
  assert.equal(metrics.hireShare, 0.25);
  assert.equal(
    metrics.pipeline.reduce((n, row) => n + row.count, 0),
    8,
  );
  assert.equal(
    metrics.outcomes.reduce((n, row) => n + row.count, 0),
    7,
  );
});

test("planned interview queue excludes closed opportunities, communications and completed interviews", () => {
  const interview = (id, scheduledAt, extra = {}) => ({
    id,
    title: id,
    kind: "interview",
    status: "planned",
    scheduledAt,
    ...extra,
  });
  const records = [
    opportunity("active", {
      activities: [
        interview("undated", ""),
        interview("later", "2026-10-24T10:00:00Z"),
        interview("first", "2026-10-23T10:00:00Z"),
        interview("done", "2026-10-20T10:00:00Z", { status: "completed" }),
        interview("mail", "2026-10-22T10:00:00Z", { kind: "communication" }),
      ],
    }),
    opportunity("closed", {
      outcome: "hired",
      stage: "outcome",
      activities: [interview("old", "2026-10-19T10:00:00Z")],
    }),
  ];
  assert.deepEqual(
    plannedInterviews(records).map((row) => row.activity.id),
    ["first", "later", "undated"],
  );
});

test('rescheduled interviews stay upcoming and unfinished activity follow-ups join the dated action queue',()=>{
  const activity={id:'a',kind:'interview',type:'custom panel',title:'Panel',status:'rescheduled',createdAt:'2026-10-29T10:00:00Z',scheduledAt:'2026-11-02',followUp:'Send slides',followUpDate:'2026-10-30'};
  const o=opportunity('panel',{activities:[activity,{...activity,id:'done',followUpDone:true},{...activity,id:'cancelled',status:'cancelled'},{...activity,id:'comms',kind:'communication',status:'completed',followUp:'Reply to recruiter',followUpDate:'2026-10-29'}]});
  assert.equal(plannedInterviews([o]).length,2);
  const queue=buildActionQueue([task('later','2026-11-01')],[o]);
  assert.deepEqual(queue.map(i=>i.title),['Reply to recruiter','Send slides','later']);assert.equal(queue[0].source,'activity');assert.equal(queue[0].opportunityId,o.id);
  assert.equal(buildActionQueue([], [o], false).length,0);
  assert.equal(buildActionQueue([], [{...o,outcome:'rejected'}]).length,0);
  assert.equal(plannedInterviews([{...o,outcome:'rejected'}]).length,0);
});

test('pending offer deadlines join dated queues while accepted/declined offers never count as hires',()=>{
 const offer={id:'initial',title:'Initial package',decision:'pending',responseDueDate:'2026-10-30',createdAt:'2026-10-29T10:00:00Z'};
 const o=opportunity('offers',{stage:'final-interview',offers:[offer,{...offer,id:'accepted',decision:'accepted'},{...offer,id:'declined',decision:'declined'},{...offer,id:'undated',responseDueDate:''}]});
 const rows=buildActionQueue([task('later','2026-11-01')],[o]);assert.deepEqual(rows.map(r=>r.title),['Respond to offer: Initial package','later']);assert.equal(rows[0].source,'offer');assert.equal(rows[0].opportunityId,o.id);assert.equal(buildActionQueue([],[o],false).length,0);assert.equal(buildActionQueue([],[{...o,outcome:'hired'}]).length,0);
 assert.equal(dashboardMetrics([o],[],'Europe/London',now).outcomes.find(v=>v.id==='hired').count,0);
});

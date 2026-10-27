# Opportunity Knox 0.3 integration contract

User asks: rebrand Opportunity Knox; themes including Cappuccino; standalone sidebar Kanban page; user name/photo settings; reference library as a career-material data dump intended for future AI chunking; live statistics dashboard; due-date-sorted to-do page. Keep the existing app, Docker commands, state locations and data compatible. No public deployment or AI provider connection.

## Implementation layout

- `server/app.mjs` and `server/profile.mjs`: settings, profile, tasks, backup/export and validated uploads.
- `src/App.tsx`, `src/types.ts`, `src/styles.css`, `src/themes.css`, `src/components/ProfileSettings.tsx`: navigation, shared state, branding, themes, profile and library.
- `src/components/Dashboard.tsx`, `src/components/Todos.tsx`, `src/dashboard.css`, `src/lib/dashboard.ts`: statistics, charts, action queues and task editing.
- `tests/server.test.mjs` and `tests/dashboard.test.mjs`: persistence, migration, conflict and calculation checks.

## Shared types and API

Settings adds theme:'forest'|'cappuccino'|'ocean'|'midnight' (default forest). PATCH /api/settings validates theme and preserves all other settings.

Profile type {name:string,avatarUrl:string,revision:number}; default name 'Your workspace', avatarUrl ''. GET /api/profile -> Profile. PATCH /api/profile {revision,name?,imageBase64?,removeAvatar?} -> Profile; new name trimmed length1..80; PNG/JPEG/WebP real signature validated, max2MiB bytes, no SVG. Authenticated GET /api/profile/avatar serves image bytes. Store photo in SQLite config or private state and include in private backup; exclude image bytes from record export. Updates require revision and stale updates return409.

Task type {id,title,notes,dueDate,completed:boolean,opportunityId:string,revision:number,createdAt,updatedAt,completedAt:string}; dates are date-only YYYY-MM-DD or ''. GET /api/tasks -> {tasks:Task[]}. POST /api/tasks {title,notes?,dueDate?,opportunityId?} -> Task201. PATCH /api/tasks/:id {revision,title?,notes?,dueDate?,opportunityId?,completed?} -> Task. Title required max300; notes max10000; linked opportunity must exist. Completion date automatic, reopened tasks clear completedAt. No deletion required; show completed tasks so changes are reversible. Store tasks independently, include in full backup and records export. Existing databases must open without resetting anything.

GET /api/board adds profile:Profile and tasks:Task[] to current payload, plus documentCount:number (all documents) and referenceCount:number (unlinked library docs). Shared types are exported from src/types.ts alongside the existing opportunity types. Keep existing Opportunity/BoardDocument fields.

## Component props

Dashboard default export props {opportunities:Opportunity[],tasks:Task[],profile:Profile,timezone:string,referenceCount:number,onOpenOpportunity:(id:string)=>void,onNavigate:(page:'board'|'todos'|'library')=>void,onAddOpportunity:()=>void,onRefresh:()=>void,refreshing:boolean}. It derives all stats from those records, never examples. Native SVG/CSS charts need no extra dependency. Source definitions next to chart/info. Handle empty data without fabricated trend/rates. Headline current counts; pipeline by current stage; confirmed submission counts distinct opportunities based on saved submitted-stage events, not assumed progression; outcomes; application activity period selector scoped only to activity chart; upcoming tasks/next-actions and interviews. Repeated stage visits must not double-count distinct applications. Keep date-only task values in configured timezone. Drill into chart/rows meaningfully, and reflect mutations by props/reload. Modest auto-refresh is owned App (e.g.30s + window focus), so dashboard updates across devices.

Todos default export props {tasks:Task[],opportunities:Opportunity[],timezone:string,onChanged:()=>void,onError:(e:unknown)=>void,onOpenOpportunity:(id:string)=>void}. Fetch mutations through existing api/json helpers. Add/edit/complete/reopen manual tasks. Default queue sorted oldest due date first, undated last; completed separate view. May show active opportunity nextAction rows as derived actions, clearly labelled and opened via opportunity detail, without fake completion checkboxes. Label task and derived-action counts honestly. Form dates use date-only strings. Preserve stale-edit errors/reload. Accessible labels and responsive layout.

Dashboard/Todos both import ../dashboard.css, using shared CSS variables --ink,--muted,--line,--surface,--green,--page-bg,--panel-soft,--danger,--amber,--shadow. Namespace dashboard/task classes to avoid existing UI. Use own heading elements/buttons rather than importing private App helpers.

## Navigation/profile/themes

Routes use hash paths #/dashboard (default), #/opportunities (list), #/board (Kanban), #/todos, #/library, #/settings. Kanban is its own page; remove board/list toggle in shared page and expose both pages in sidebar. Support back/forward and reload links; preserve #setup= token handling. Branding/title/auth read Opportunity Knox. Keep technical repository/project/state names opportunity-board to preserve existing installations. Profile name/avatar shown in sidebar; profile settings open from profile button, separate Sign out control. Avatar upload UI can preview, save/remove and report validation errors.

Themes apply through document.documentElement.dataset.theme; settings persist server-side and browser cache avoids flash. All four themes must cover forms/modals/charts/sidebar, including dark text contrast. Reference library: explicitly invite CVs, old JDs, project notes, achievements, certificates, interview notes, articles and any career-related evidence. Describe stored originals, local text preparation and explicit semantic indexing accurately. Show actual preparation/index status; never claim an unprocessed file is indexed. Career Buddy uses only selected sources, combining keyword retrieval with saved compatible vectors and reporting fallback when semantic search is unavailable.

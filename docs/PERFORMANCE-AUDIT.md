# Production Performance Audit

> Method: **evidence-first**. Every finding cites a real file:line in this codebase.
> I cannot reach your live server/DB from here, so items needing runtime numbers are
> marked **[verify on server]** with the exact command to run. No rewrites — every
> fix reuses existing code.

**Legend:** P0 = fix now (biggest, safe wins) · P1 = high · P2 = medium · P3 = config/infra.

---

## Scoreboard of confirmed findings

| # | Pri | Problem | Evidence |
|---|-----|---------|----------|
| 1 | **P0** | Employee dashboard loads **every task in the DB** | `routes/employees.js:464` `Task.find({})` |
| 2 | **P0** | Every task update logs the **full request body, pretty-printed** | `routes/tasks.js:1577` |
| 3 | **P1** | Mongo **connection pool capped at 10** | `lib/db.js:14` |
| 4 | **P1** | Manager Tasks **polls every 10s** (incl. expensive project aggregation) | `pages/manger/Tasks.tsx:883,905` |
| 5 | **P1** | Project list runs a **`$lookup`+`$reduce` aggregation** per request | `routes/projects.js` GET `/` |
| 6 | **P2** | Task search uses **unanchored `$regex`** (ignores text index) | `routes/tasks.js` search filter |
| 7 | **P2** | **`autoIndex` left on** in production | `lib/db.js` (not disabled) |
| 8 | **P2** | **100 MB JSON body** limit; base64 uploads via JSON | `index.js:331` |
| 9 | **P3** | Single Node process (**no clustering**) on a dedicated box | deployment |
| 10 | **P3** | Mongo/Node **co-tenant memory**, no WiredTiger cap, no profiler | server config |

---

## P0-1 — Employee dashboard fetches the entire tasks collection

**1. Problem** — Opening the employee dashboard is slow and gets slower as tasks grow.

**2. Root cause** — `routes/employees.js:464`:
```js
const [tasks, schedule, todayEntry, unreadMessages, monthEntries] = await Promise.all([
  Task.find({}).sort({ updatedAt: -1 }).lean(),   // ← EVERY task in the DB
  ...
]);
// then computes counts in JS: tasks.filter(t => t.status === "completed").length, etc.
```
It pulls **all task documents**, sorted, into Node memory just to compute a few counts.

**3. Performance impact** — At 100k tasks this is a multi-second query + tens of MB transferred + GC pressure on **every dashboard hit**. This is the single biggest dashboard bottleneck. Directly blocks your "Dashboard < 2s" target.

**4. Recommended solution** — Replace the fetch-all with a server-side aggregation / `countDocuments` that returns only the numbers. Same output shape, no functional change.

**5. Code changes** (drop-in for the `Task.find({})` element):
```js
// counts only — no documents shipped
const [statusAgg, recent] = await Promise.all([
  Task.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]),
  Task.find({}, { title: 1, status: 1, priority: 1, dueDate: 1, updatedAt: 1 })
    .sort({ updatedAt: -1 }).limit(5).lean(),   // only what the widget shows
]);
const byStatus = Object.fromEntries(statusAgg.map(s => [s._id, s.count]));
const stats = {
  total: Object.values(byStatus).reduce((a, b) => a + b, 0),
  completed: byStatus.completed || 0,
  pending: byStatus.pending || 0,
  inProgress: byStatus["in-progress"] || 0,
};
```
(Keep the rest of the handler; just stop materializing all tasks. If the widget lists recent tasks, use `recent`.)

**6. Database changes** — none.

**7. Index changes** — the `$group` on `status` is a covered scan; add nothing, or `{ status: 1 }` already exists (field-level index on `Task.status`).

**8. Expected gain** — dashboard task step from **O(N) seconds + O(N) memory** → **~5–20 ms** constant. Likely the difference between a 3–6 s dashboard and a sub-second one.

**9. Risk** — **Low.** Output numbers identical; only the data path changes.

**10. Testing** — `explain("executionStats")` on both before/after; assert the dashboard JSON (`tasks.total/completed/...`) is unchanged for a test user; measure endpoint p95 with `autocannon -c 20 -d 20 /api/employees/me/dashboard`.

---

## P0-2 — Every task update logs the full request body (pretty-printed)

**1. Problem** — `PUT /api/tasks/:id` is slow and floods logs, worst on tasks with attachments.

**2. Root cause** — `routes/tasks.js:1577`:
```js
console.log("PUT /api/tasks Update Payload:", JSON.stringify(req.body, null, 2));
```
Runs on **every** update. `req.body` can contain **base64 attachments/images** (the JSON limit is 100 MB — see P2-8). `JSON.stringify(…, null, 2)` serializes and pretty-prints the whole thing **synchronously on the event loop**, then writes it to stdout/log.

**3. Performance impact** — For a task edit carrying a base64 image, this is **tens of MB stringified + written synchronously**, blocking the event loop (stalls *all* concurrent requests) and ballooning logs/disk I/O. CPU + event-loop-blocking + disk, all at once.

**4. Recommended solution** — Delete it, or gate behind a debug flag and never stringify bodies.

**5. Code changes**:
```js
// remove entirely, or:
if (process.env.DEBUG_TASKS === "true") {
  console.log("PUT /api/tasks", req.params.id, "keys:", Object.keys(req.body || {}));
}
```

**6/7. DB / index** — none.

**8. Expected gain** — removes a synchronous multi-MB serialize+write from the hot update path → update latency drops from **hundreds of ms–seconds** (with media) to **normal**; event-loop stalls gone.

**9. Risk** — **Very low** (log-only). Audit the other `console.log`s in `projects.js:738–818` (logo update path) similarly.

**10. Testing** — update a task with a large attachment, watch event-loop lag (`--prof` or `clinic doctor`) before/after; confirm behavior unchanged.

---

## P1-3 — MongoDB connection pool capped at 10

**1. Problem** — Under concurrency, requests queue waiting for a DB connection.

**2. Root cause** — `lib/db.js:14` `maxPoolSize: 10`. With app + DB on one box and aggregations that hold a connection, 10 is easily exhausted; excess requests block on checkout.

**3. Impact** — Tail latency spikes under load; APIs that are individually fast wait in line. Hurts the "API < 300 ms" target during traffic.

**4. Solution** — Raise pool to match cores/workload; keep it sane for a single box.

**5/6. Code**:
```js
await mongoose.connect(uri, {
  maxPoolSize: 50,            // was 10
  minPoolSize: 5,
  socketTimeoutMS: 45000,
  serverSelectionTimeoutMS: 5000,
  autoIndex: false,          // see P2-7
});
```

**7. Index** — none.

**8. Expected gain** — removes connection-queue stalls; smoother p95/p99 under concurrent load.

**9. Risk** — **Low.** More sockets to a local mongod (cheap). Ensure mongod `ulimit -n` is high (see P3-10).

**10. Testing** — `autocannon -c 100` against a read endpoint; watch `db.serverStatus().connections` and p99 before/after.

---

## P1-4 — Manager Tasks page polls every 10 seconds

**1. Problem** — The manager Tasks screen re-hits the API continuously even when idle.

**2. Root cause** — `pages/manger/Tasks.tsx:883` and `:905`:
```js
refetchInterval: 10000, // tasks query AND projects query
```
Two polls every 10 s per open tab. The **projects** poll triggers the expensive aggregation in P1-5. Multiply by every manager with the tab open.

**3. Impact** — Constant backend + DB load with no user action; wasted bandwidth; needless re-renders of a large page. Steals capacity from real requests.

**4. Solution** — You already run **Socket.IO** — invalidate on socket events instead of polling. If keeping polling, lengthen it and pause when the tab is hidden.

**5. Code changes** (minimal, keep behavior):
```js
// Option A (best): remove refetchInterval; invalidate on socket "task/project changed"
// Option B (safe now): poll far less often, only when visible
refetchInterval: (q) => (document.visibilityState === "visible" ? 60000 : false),
refetchIntervalInBackground: false,
```

**6/7. DB/index** — none.

**8. Expected gain** — cuts idle backend/DB load from these screens by **~6–12×** (10 s → 60 s + hidden-tab pause), or to ~0 with socket invalidation.

**9. Risk** — **Low.** Data freshness via socket or 60 s; add a manual refresh button if desired.

**10. Testing** — open the page idle, count requests/min in the network panel before/after.

---

## P1-5 — Project list runs a `$lookup` + `$reduce` aggregation per request

**1. Problem** — `GET /api/projects` is heavier than a list should be, and it's polled (P1-4).

**2. Root cause** — `routes/projects.js` GET `/` aggregates every project with `$lookup` into `tasks` then `$reduce`s attachments to compute `taskCount` / `taskAttachmentStats` inline, per page load.

**3. Impact** — Each list call fans out to the tasks collection and does per-project reduction. Combined with 10 s polling, it's a steady expensive load. Slower project lists; contention.

**4. Solution** — (a) Stop polling it (P1-4). (b) **Denormalize `taskCount`** onto the Project (maintain via the existing task create/delete paths and `$inc`), so the list needs no `$lookup`. (c) Ensure `tasks.projectId` is indexed (it is) so the lookup, when used, is keyed.

**5. Code changes** — increment/decrement `Project.taskCount` in the task create/delete handlers you already have; drop the `$lookup` from the list and read the stored counter. (Attachment stats can move to the project-detail endpoint, which is opened far less often.)

**6. DB changes** — add `taskCount: { type: Number, default: 0 }` to the Project schema (additive).

**7. Index** — `tasks { projectId: 1 }` exists ✓.

**8. Expected gain** — project list from an aggregation with fan-out → a plain indexed `find` → typically **5–20×** faster and far less DB CPU.

**9. Risk** — **Medium** (counter drift). Mitigate with a nightly reconcile job; keep the aggregation available on the detail view as source of truth.

**10. Testing** — compare list latency with `explain`; verify `taskCount` matches a `countDocuments` spot check.

---

## P2-6 — Task search uses unanchored `$regex` (bypasses the text index)

**1. Problem** — Searching tasks is slower than 300 ms on large data.

**2. Root cause** — the list search builds `new RegExp(escaped, "i")` and matches `title`/`description`/`assignees` — an **unanchored, case-insensitive regex** can't use a btree index → collection scan. Meanwhile `Task` already has a **text index** `{ title: "text", description: "text" }` that's unused by search.

**3. Impact** — Search latency grows linearly with collection size; blows the "Search < 300 ms" target.

**4. Solution** — Use `$text` for the free-text part when a search term is present (keep regex only as a fallback for partial/prefix if you need it). Reuse the existing text index.

**5. Code**:
```js
if (searchQ) {
  conditions.push({ $text: { $search: searchQ } });   // uses the existing text index
  // optional relevance: proj/sort by { score: { $meta: "textScore" } }
}
```

**6. DB** — none. **7. Index** — reuse existing text index; if you also want assignee search, keep a narrow regex on `assignees` only.

**8. Expected gain** — search from **O(N) scan** → indexed lookup, typically **10–100×** on large collections.

**9. Risk** — **Low–Medium** (text search matches whole words, not substrings — confirm UX is acceptable; keep a regex fallback if substring search is required).

**10. Testing** — `db.tasks.find({$text:{$search:"foo"}}).explain("executionStats")` → expect `IXSCAN` on the text index, not `COLLSCAN`.

---

## P2-7 — `autoIndex` enabled in production

**1. Problem** — Startup/first-write cost and risk on large collections.

**2. Root cause** — `lib/db.js` doesn't set `autoIndex: false`; Mongoose tries to ensure every schema index on model init.

**3. Impact** — On boot with big collections, index (re)builds add load and can stall; risky during deploys.

**4/5. Solution** — `autoIndex: false` (shown in P1-3) and build indexes via an explicit migration/`syncIndexes()` run during a maintenance window.

**6/7. DB/index** — build intentionally, `{ background: true }` semantics (rolling on a replica set).

**8. Gain** — predictable, fast startup; no surprise index builds under traffic.

**9. Risk** — **Low** (just ensure indexes are created by the migration).

**10. Testing** — boot with `autoIndex:false`; run the index migration; confirm `db.tasks.getIndexes()` matches the schema.

---

## P2-8 — 100 MB JSON body limit; base64 uploads through JSON

**1. Problem** — Large create/update payloads are slow to parse and memory-heavy.

**2. Root cause** — `index.js:331` `express.json({ limit: "100mb" })`; attachments are sent as base64 in the JSON body (also feeds P0-2).

**3. Impact** — base64 is ~33% larger than binary; parsing a multi-MB JSON body blocks the event loop and spikes memory. Slow uploads, GC pauses.

**4. Solution** — You already use **multer** for some uploads — route binary uploads through multipart (existing pattern) and lower the JSON limit (e.g., `2mb`) for regular API calls. Don't rewrite; migrate the attachment paths to the multipart endpoints you already have.

**5. Code** — reduce JSON limit for non-upload routes; keep multipart for files.

**8. Gain** — smaller, faster request parsing; lower memory; fewer event-loop stalls on writes.

**9. Risk** — **Medium** (must move attachment clients to multipart) — do incrementally.

**10. Testing** — upload a 10 MB file via multipart vs base64 JSON; compare latency + RSS.

---

## Index recommendations (with reasons) — [verify on server with explain]

`Task` already indexes: `projectId,status` · `assignees,status` · `createdAt,status` · `projectId,createdAt` · text`{title,description}` · single fields incl. `dueDate`, `executionPriority`. Add:

| Index | Reason | Serves |
|---|---|---|
| `{ status: 1, dueDate: 1 }` | overdue query `{status:{$ne:"completed"}, dueDate:{$lt:now}}` — put equality-ish before range | dashboard overdue, analytics |
| `{ dueDate: 1 }` (exists) | Calendar/Timeline `dueFrom/dueTo` range | new views |
| `{ updatedAt: -1, _id: -1 }` | keyset/cursor pagination (avoid deep `skip`) | large lists |
| `{ status: 1, executionPriority: 1 }` | Kanban ordering within a column | Kanban view |
| `WorkSession { status:1, startedAt:-1 }` (exists) | WIP grid | WIP |
| `TaskDependency { predecessorId:1 } / { successorId:1 }` (exist) | Gantt edges | Timeline |

**Run this to find real offenders** (mongo shell, on the server):
```js
db.setProfilingLevel(1, { slowms: 50 });     // log queries > 50ms
// reproduce dashboard/list/search, then:
db.system.profile.find().sort({ millis: -1 }).limit(20).pretty();
// for each: db.<coll>.find(<query>).sort(<sort>).explain("executionStats")
//   → target IXSCAN with low totalDocsExamined; COLLSCAN = missing index
```

---

## Pagination

**Problem** — `skip/limit` (offset) pagination degrades on deep pages (`skip` walks N docs). **Evidence:** `lib/pagination.js` uses page/skip.
**Solution** — offer **cursor (keyset) pagination** on `{updatedAt,_id}` for the big lists (the new Task Workspace already loads incrementally; extend the same to admin lists). Keep offset for shallow pages. **Gain:** deep pages go from O(skip) → O(limit). **Risk:** Low (additive param). **Test:** `explain` page 1 vs page 500 before/after.

---

## Server / infra (P3) — [verify on server]

**Node / PM2**
- **Cluster mode**: a single Node process uses one core. On a multi-core box run PM2 cluster: `pm2 start app.js -i max`. **Because you use Socket.IO**, add the **Redis adapter** (`@socket.io/redis-adapter` — you already run Redis) and sticky sessions in Nginx (`ip_hash` or `hash $remote_addr`). Gain: near-linear throughput with cores. Risk: Medium (socket stickiness) — test sockets after.
- `--max-old-space-size` sized to leave RAM for WiredTiger (below).
- Ensure `NODE_ENV=production`.

**Nginx (reverse proxy)**
- Enable **Brotli** (better than gzip for text) *and* keep gzip fallback; Express `compression()` can then be a fallback.
- **Static asset caching**: `location ~* \.(js|css|png|woff2)$ { expires 1y; add_header Cache-Control "public, immutable"; }` (hashed Vite filenames make this safe).
- **HTTP/2** on TLS; **keep-alive** upstream (`proxy_http_version 1.1; proxy_set_header Connection "";`).
- Gzip/serve the built React bundle from Nginx directly, not Node.

**MongoDB (same box)**
- **WiredTiger cache**: default is ~50% of (RAM−1GB). With Node co-located, set it explicitly so they don't fight: `storage.wiredTiger.engineConfig.cacheSizeGB: <~40% of RAM>`. **[verify RAM]** with `free -h`.
- **Slow query profiler**: `slowms: 50` (above) to catch anything >50 ms.
- **ulimit**: raise open files (`nofile` 64000+) so the larger pool + connections don't hit limits.
- **Journal** on; ensure data dir is on **SSD** (`iostat -x 1` to check `%util`/await). Swap should be near-idle (`vmstat 1`); if swapping, cache is oversized.
- Watch `db.serverStatus().wiredTiger.cache` eviction and `globalLock`/`connections`.

**Diagnostics to capture the real numbers**
```bash
free -h; vmstat 1 5; iostat -x 1 5          # RAM, swap, disk
pm2 monit                                    # per-process CPU/mem, restarts
mongostat --rowcount 10; mongotop 5          # ops, lock %, hot collections
# app: clinic doctor -- node app.js   (event-loop lag, GC)
```

---

## Frontend (React) — confirmed + [verify with build]

- **Good already:** 82 route-level `lazy()` splits (`AdminRoutes.tsx`) → code splitting is in place; new Task Workspace uses **virtual scrolling** + infinite loading + one shared query.
- **Issue — huge components:** `pages/admin/Tasks.tsx` (~5600 lines) and `pages/manger/Tasks.tsx` ship as large chunks and re-render broadly. **Don't rewrite** — incrementally: wrap heavy rows/cards in `React.memo`, memoize derived lists with `useMemo`, and split dialogs into lazy sub-components. **Gain:** fewer re-renders, smaller initial view chunk. **Risk:** Low. **Test:** React Profiler render counts before/after.
- **Polling** (P1-4) also causes broad re-renders — fixing it helps the frontend too.
- **Bundle:** run `npx vite build && npx vite-bundle-visualizer` **[verify]** to find heavy deps (e.g., recharts, framer-motion) and lazy-load them per view (Executive Dashboard already lazy).
- **Duplicate API calls:** Global Search loads 4 entity types (≤100 each) on every open — cache with `staleTime` (react-query) so re-opening within N minutes doesn't refetch.
- **Images:** serve via Nginx with long cache headers; add `loading="lazy"` to non-critical `<img>`.

---

## Security — preserved

All changes keep existing `requireAuth` / `requireClearHire` / `requireRole` and validation. None removes auth, authorization, or input validation. Lowering the JSON body limit *increases* safety; disabling `autoIndex` and reducing logging remove DoS/leak surface. No optimization here weakens security.

---

## Priority order (do in this sequence — biggest, safest first)

1. **P0-1** dashboard aggregation (kills the worst query) — Low risk, huge win.
2. **P0-2** remove hot-path body logging — Very low risk.
3. **P1-3** raise pool + `autoIndex:false` — Low risk.
4. **P1-4** stop 10 s polling — Low risk.
5. Run the **slow-query profiler** + `explain` to confirm index gaps, then add the indexes above.
6. **P1-5** denormalize `taskCount`; **P2-6** text search.
7. Infra: Nginx Brotli/caching/HTTP2, PM2 cluster + Redis socket adapter, WiredTiger cache sizing.

**Quick wins #1–#4 are low-risk and I can apply them now on request** — they target the confirmed worst offenders and need no schema or API contract change.

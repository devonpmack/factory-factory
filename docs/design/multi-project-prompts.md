# Multi-Project Prompts Proposal

## Summary

This proposal describes how Factory Factory could support prompts that affect multiple projects without requiring the user to explicitly select those projects up front.

There are two viable models:

- `Task` fan-out: infer affected projects and create one normal workspace per project
- multi-repo session: create one synthetic workspace whose working directory contains multiple repositories

If the product requirement is specifically that one session must span multiple repositories, the recommended design is:

- introduce a new top-level `Task` concept
- require every task to begin with a planning/routing phase
- require the user to confirm the proposed repository set before execution starts
- allow a task to resolve to one or more repositories
- create a synthetic aggregate workspace root for the task
- materialize each selected repository under that root
- start one agent session with its `workingDir` set to the aggregate root

This gives the user one session, one transcript, and one place to work, while still preserving explicit repository boundaries inside the filesystem layout.

## Problem

Today, Factory Factory is strongly project-scoped:

- each `Workspace` belongs to exactly one `Project`
- each agent session runs from exactly one workspace worktree
- the UI is routed primarily under `/projects/:slug/...`
- prompt entry points eventually create or operate on a single workspace

That works well for project-local tasks, but it breaks down for prompts like:

- "Update the auth flow across all apps"
- "Rename this feature flag everywhere"
- "Apply this API contract change to the web app, backend, and worker"
- "Find every project affected by this billing model change and update them"

The user goal here is not "open project X and start a workspace". The user goal is "here is a task; figure out which projects it touches and do the right thing".

## Goals

- Support entering a prompt without first choosing a project.
- Support tasks that may affect one or many projects.
- Avoid making the user explicitly enumerate projects in the common case.
- Require the system to plan first and propose affected repositories before making changes.
- Require explicit user confirmation of the repository set before execution begins.
- Preserve the existing workspace, session, and worktree model as much as possible.
- Reuse existing workspace initialization, session startup, and quick chat patterns where possible.
- Support a single session that can inspect and edit more than one repository.

## Non-Goals

- Do not replace the current project-scoped workspace UX.
- Do not attempt full autonomous cross-project planning in the first iteration.
- Do not solve cross-project merge orchestration in this proposal beyond basic fan-out tracking.

## Current Constraints

### Data model

The current schema makes workspace ownership single-project:

- `Project` owns many `Workspace` records
- `Workspace` has a required `projectId`
- `AgentSession` belongs to one workspace

This means there is no existing top-level object that can represent a user request spanning multiple projects.

### Session runtime

Session startup currently resolves a single `workingDir` from `workspace.worktreePath`. The runtime, replay loading, attachment handling, and provider launch behavior all assume one session runs inside one workspace tree.

That is a strong architectural constraint, and it is a reasonable one.

### UI routing and context

The app sets project context from project-scoped routes. Existing intake and navigation patterns assume the user is already "inside" a project when creating or viewing workspaces.

### Prompt plumbing

Prompt files and quick actions are not the hard part. The prompt layer is mostly content loading. The real constraint is that prompt execution ultimately lands in a single workspace/session scope.

## Recommendation

### Preferred direction: task-backed multi-repo session

If the requirement is that the user should have one session spanning multiple repositories, the best fit is not a traditional multi-project workspace attached to many projects directly.

Instead, add a task-backed synthetic workspace root.

Conceptually:

- `Task`: stores the original prompt and routing result
- `TaskRepo`: stores the repositories selected for the task
- `TaskWorkspace`: a synthetic execution root for the task
- one agent session starts from that synthetic root and can traverse all selected repositories

The aggregate root could look like:

```text
<task-root>/
  repos/
    web-app/
    api-server/
    worker/
  notes/
  outputs/
```

The session `workingDir` would be `<task-root>`, not an individual repo.

This is important because the current runtime only needs one cwd. We can preserve that invariant by making the cwd an aggregate directory instead of a single repository.

### Introduce a top-level `Task`

Add a new entity that represents a user prompt before it has been resolved to one or more workspaces.

Suggested responsibilities:

- store the original prompt
- track inference status
- track selected or inferred projects
- track child workspaces created for the task
- serve as the canonical object for a cross-project operation

Conceptually:

- `Task`: "rename feature flag X everywhere"
- `TaskProject`: links between the task and inferred/confirmed projects
- `TaskWorkspace`: links between the task and the concrete workspaces created to execute the work

The core idea is that a task becomes the top-level owner of cross-repository intent.

### Add a synthetic aggregate workspace

Instead of attaching one workspace to many projects directly, create a synthetic task workspace that owns a task root directory.

That root should contain one checked out repository per selected project.

Suggested shape:

- `TaskWorkspace`
  - `id`
  - `taskId`
  - `rootPath`
  - `status`
  - `sessionId`

Suggested filesystem layout:

- `<rootPath>/repos/<project-slug>`
- optional shared task files under `<rootPath>/notes` or `<rootPath>/outputs`

This gives us:

- one session
- one cwd
- one transcript
- multiple repositories available under predictable subdirectories

### Materialize repositories under the task root

There are a few ways to place repositories into the task root:

1. Symlink each project repo into the task root
2. Create per-project worktrees under the task root
3. Create lightweight task-local checkout folders under the task root

Recommendation:

- use worktrees when task edits should be isolated from the base repo checkout
- use symlinks only for read-heavy exploration spikes

For actual implementation work, worktrees are safer because they preserve branch isolation.

### Add global intake

Add a new top-level task composer outside the project-scoped route hierarchy.

Examples:

- `/tasks/new`
- `/tasks/:id`

The user should be able to enter a prompt without selecting a project first.

The backend then:

1. creates a `Task`
2. runs a mandatory planning/routing phase
3. proposes a repository set
4. waits for explicit user confirmation
5. creates a synthetic task workspace root
6. materializes selected repositories under that root
7. starts one session against that aggregate root

### Mandatory planning/routing phase

This should be mandatory for every multi-repo task.

The system must not launch directly into editing, even when routing confidence is high.

The planning phase should:

- inspect the prompt
- rank candidate repositories
- explain why each repo was included
- identify likely non-target repos where useful
- present the proposed repository set to the user

Execution begins only after the user confirms the target repositories.

### Add project inference

Project inference should be deterministic and lightweight before any model-assisted heuristics are added.

Suggested signal sources:

- project name
- project slug
- repo path
- GitHub owner/repo
- issue provider metadata
- top-level file names
- README/package/app manifest snippets
- cached file list or directory names

Suggested ranking approach:

1. Exact entity matches
   - explicit repo names
   - app/package names
   - service names
2. Keyword overlap
   - terms from the prompt against project metadata
3. Repo-content hints
   - auth, billing, api, web, worker, mobile, docs, sdk, etc.
4. Relationship rules
   - prompt mentions "frontend and backend"
   - prompt mentions shared concepts known to multiple projects

The first version should bias toward simple explainable scoring rather than model-only routing.

### Confirmation is mandatory

Routing confidence should still be computed and shown, but confidence should not bypass confirmation.

Recommended policy:

- always show the proposed repository set
- always require user confirmation before repo materialization
- allow the user to remove repos
- optionally allow the user to add repos

This preserves the "don’t make me specify projects from scratch" goal while ensuring the system never silently targets the wrong repo set.

## Proposed Data Model

Suggested additions:

### `Task`

- `id`
- `title`
- `prompt`
- `status`
- `routingStatus`
- `routingSummary`
- `planningNotes`
- `confirmedAt`
- `createdAt`
- `updatedAt`

Possible statuses:

- `NEW`
- `ROUTING`
- `AWAITING_CONFIRMATION`
- `READY`
- `RUNNING`
- `PARTIAL`
- `DONE`
- `FAILED`

### `TaskProject`

- `id`
- `taskId`
- `projectId`
- `selectionSource` (`AUTO`, `USER_CONFIRMED`, `MANUAL`)
- `confidenceScore`
- `reasonSummary`

### `TaskRepo`

- `id`
- `taskId`
- `projectId`
- `mountPath`
- `branchName`
- `materializationMode`
- `status`

`materializationMode` could be:

- `WORKTREE`
- `SYMLINK`
- `CHECKOUT`

### `TaskWorkspace`

- `id`
- `taskId`
- `projectId`
- `rootPath`
- `status`
- `primarySessionId`

For a pure multi-repo session model, `TaskWorkspace` is the aggregate execution root rather than a normal project workspace.

## Proposed Flow

### 1. User creates a task

User enters:

> Rename the old billing feature flag to `billing-v2` everywhere it is still used.

System creates a `Task` record with the original prompt.

### 2. System performs planning/routing

The routing service scans available projects and produces candidates such as:

- `web-app` score 0.92
- `api-server` score 0.88
- `worker` score 0.77
- `docs-site` score 0.31

### 3. System proposes target repositories

For example:

- propose `web-app`, `api-server`, and `worker`
- exclude `docs-site`

The proposal should show:

- included repos
- excluded repos
- confidence and reasoning
### 4. User confirms target repositories

The user must explicitly confirm the repository set.

The confirmation UI should support:

- accept as-is
- remove repos
- optionally add repos

Only after confirmation does the task continue.

### 5. System creates the aggregate root

For example:

```text
~/factory-factory/tasks/task-123/
  repos/web-app
  repos/api-server
  repos/worker
```

### 6. System materializes selected repositories

For each selected project:

- create a task-scoped worktree or checkout
- mount it under `repos/<slug>`
- record the mounted location in `TaskRepo`

### 7. System starts one session

Start a normal agent session, but set:

- `workingDir = <task-root>`

The user can then work across:

- `repos/web-app/...`
- `repos/api-server/...`
- `repos/worker/...`

### 8. Task page becomes the session entrypoint

The task page should show:

- original prompt
- planning/routing output
- confirmation state
- selected repositories
- materialization status per repo
- one shared session transcript
- optional per-repo branch summaries

## Ratchet Integration

If a multi-repo task creates one PR per repository, Ratchet should monitor those repo-level PRs but dispatch repair work back to the single top-level task session/worktree.

This matches the product behavior you want:

- one shared agent session spans the bigger worktree
- each selected repo can still have its own branch and PR
- if any repo PR fails CI or gets review comments, Ratchet wakes the top-level agent instead of spawning a separate per-repo fixer workspace

### Core model

The aggregate task root remains the execution target.

Ratchet should treat:

- PR status as repo-local
- repair execution as task-global

That means the system needs to track both:

- task-level execution state
- repo-level PR state

Suggested additions:

### `TaskRepoPullRequest`

- `id`
- `taskRepoId`
- `provider`
- `repoOwner`
- `repoName`
- `prNumber`
- `prUrl`
- `prState`
- `prCiStatus`
- `prReviewState`
- `lastReviewCommentId`
- `lastCiRunId`
- `ratchetState`
- `ratchetLastCheckedAt`

This is effectively the current workspace PR snapshot model, but attached to a task repo rather than a normal single-project workspace.

### `TaskWorkspace`

Add ratchet linkage fields:

- `ratchetEnabled`
- `ratchetActiveSessionId`
- `ratchetCurrentActivity`
- `ratchetStateUpdatedAt`

The important difference is that `ratchetActiveSessionId` now points to the shared top-level task session rather than a repo-local fixer session.

### Ratchet dispatch behavior

Recommended behavior:

1. Poll all task-linked PRs.
2. Compute ratchet state per PR.
3. If no PR is actionable, do nothing.
4. If one or more PRs are actionable, enqueue repair work for the shared task session.
5. If the shared task session is already active, append a structured follow-up prompt instead of launching another fixer.

This preserves one top-level agent and one transcript.

### What Ratchet sends to the top-level agent

Ratchet should not just say "CI failed". It should send repo-scoped repair instructions into the shared session.

Example:

> Ratchet update for task `billing-v2-rollout`.
>
> The PR for `repos/api-server` is failing CI.
> PR: `https://github.com/acme/api-server/pull/123`
> Failing checks:
> - `unit-tests`
> - `typecheck`
>
> Investigate and fix the issue in `repos/api-server`. Before finishing, review whether the same root cause also affects:
> - `repos/web-app`
> - `repos/worker`

For review comments:

> Ratchet update for task `billing-v2-rollout`.
>
> The PR for `repos/web-app` has actionable review comments.
> PR: `https://github.com/acme/web-app/pull/456`
> Focus your changes in `repos/web-app`, but account for any required consistency with other repos in this task root.

This is materially better than a repo-local fixer because the agent has full context across repos and can fix the shared root cause once.

### Dispatch policy for multiple failing PRs

If multiple child PRs fail at once, Ratchet should not spawn multiple competing fixers.

Recommended policy:

- maintain a task-level queue of actionable PR issues
- deduplicate related failures where possible
- wake the shared task session once with a consolidated prompt

Example consolidated prompt:

- `repos/api-server` PR failing `typecheck`
- `repos/web-app` PR failing integration tests due to API contract mismatch

Ratchet should tell the top-level agent to treat these as one cross-repo repair pass.

### Session ownership rules

For multi-repo tasks, there should be exactly one Ratchet repair session at a time per task workspace.

Rules:

- if the shared task session is actively working, Ratchet records the PR delta and waits
- if the shared task session is idle, Ratchet appends the repair instruction to that session
- if no shared task session exists, Ratchet creates or restarts the top-level session

This mirrors the current "do not compete with active user work" rule, but the lock key becomes `taskWorkspaceId` rather than `workspaceId`.

### Why top-level dispatch is useful

This model is especially strong for cross-repo breakage:

- an API change breaks server CI and web tests
- a shared rename fails in one repo and review comments land in another
- one PR goes green only after a sibling repo PR is updated

A repo-local fixer lacks the full worktree context. The top-level agent has it.

### PR creation model

Even with a shared top-level session, PRs should remain per repo.

That means:

- one branch per repo
- one PR per repo
- one PR status snapshot per repo
- one repair agent session across all repos

The task becomes the coordination container; PRs remain repository-native.

### UI expectations

The task page should surface:

- shared session status
- per-repo PR status
- which repo triggered the latest Ratchet wake-up
- whether the task session is currently handling CI, review comments, or waiting

Example task-level indicators:

- `Task Active: Fixing CI in api-server`
- `Task Active: Addressing review comments in web-app`
- `Task Waiting: worker PR checks running`

### Required adaptation from current Ratchet

Current Ratchet is workspace-centric. For multi-repo tasks it needs a second execution mode:

- normal mode: repo PR belongs to one workspace, Ratchet dispatches repo-local fixer behavior
- task mode: repo PR belongs to a `TaskRepo`, Ratchet dispatches into the shared task workspace session

The cleanest design is likely:

- keep ratchet decision logic PR-local
- make ratchet execution target pluggable

Conceptually:

```ts
type RatchetExecutionTarget =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'task-workspace'; taskWorkspaceId: string; taskSessionId?: string };
```

The decision engine still says:

- `CI_FAILED`
- `REVIEW_PENDING`
- `READY`

But the executor decides whether to:

- launch a repo-local fixer, or
- message the shared top-level agent

### Recommended first version

For the first implementation:

- allow Ratchet on multi-repo tasks only when there is a single shared task session
- route all actionable PR failures into that session
- do not attempt concurrent parallel fixers inside the same task

This keeps the behavior coherent and avoids racing edits across repos.

## Prompt Strategy

The original prompt should be preserved exactly once on the `Task`.

The multi-repo session should receive the original task prompt plus explicit structural context.

Example system/user preamble:

> Top-level task: Rename the old billing feature flag to `billing-v2` everywhere it is still used.
>
> You are working in a task root that contains multiple repositories under `repos/`.
> The available repositories are:
> - `repos/web-app`
> - `repos/api-server`
> - `repos/worker`
>
> When making changes, prefer repository-relative commands and be explicit about which repo you are editing.

This reduces ambiguity and makes the aggregate cwd understandable to the agent.

## UX Proposal

### New top-level task entry point

Add a global action like:

- "New Task"
- "Cross-Project Prompt"

This should live outside the current project page hierarchy.

### Task detail page

The task detail page should show:

- original prompt
- planning/routing output
- inferred projects and confidence
- confirmation state
- selected repositories
- aggregate status
- shared session state
- any pending confirmation step

### Repository-aware navigation

The task view should allow:

- opening the shared session
- jumping directly into a selected repo subtree
- viewing per-repo git state

It does not need to pretend this is a normal single-project workspace.

### Confirmation UI

Confirmation should always happen, not only when inference is ambiguous.

Suggested UI:

- "Proposed repositories for this task"
- show ranked candidates with reasons
- allow confirm/remove before launching

This still honors the requirement that the user should not need to specify projects from scratch.

## API Proposal

Suggested additions:

### Task router

- `task.create({ prompt })`
- `task.get({ id })`
- `task.list(...)`
- `task.route({ id })`
- `task.confirmProjects({ id, projectIds })`
- `task.launch({ id })`
- `task.getSummaryState({ id })`
- `task.startSession({ id })`
- `task.listRepos({ id })`

Recommended lifecycle rules:

- `task.launch` is invalid until routing is complete and repositories are confirmed
- `task.startSession` is invalid until repo materialization is complete

### Routing service

Add a backend service responsible for:

- collecting candidate projects
- computing confidence
- storing routing decisions
- waiting for explicit confirmation before launch

### Session runtime integration

The critical runtime change is small in concept:

- today, session startup resolves one `workingDir` from a workspace worktree
- for tasks, session startup should resolve one `workingDir` from `TaskWorkspace.rootPath`

That preserves the single-cwd contract while expanding what exists beneath that cwd.

### File mention integration

File mentions are currently project-local. For multi-repo sessions, add a repo-aware file source:

- include the repo slug in file mention results
- insert paths like `repos/api-server/src/index.ts`
- bias ranking toward shorter and more exact matches

This is a meaningful but contained UI/backend change.

## Why This Is Better Than a True Multi-Project Workspace

The hard part is not "many repos", it is "many repos while the runtime only understands one cwd".

The aggregate task root solves that cleanly:

- one session
- one cwd
- many repos nested under it

This is much less invasive than redefining `Workspace` ownership to support many projects directly.

## Alternatives

### Alternative A: Force explicit project selection

User enters a prompt and must choose one or more projects before continuing.

Pros:

- simplest to implement
- no inference ambiguity

Cons:

- does not meet the stated product goal
- adds friction for common cases
- weakens the "Factory Factory figures it out" experience

### Alternative B: Single global task, no fan-out

Create a task record but do not create child workspaces. The task just stores notes and routing output.

Pros:

- minimal schema change

Cons:

- does not integrate with existing execution model
- leaves unclear where real work happens

### Alternative C: One coordinator workspace plus linked implementation workspaces

Create:

- one "coordinator" workspace in a synthetic/global project
- one implementation workspace per inferred project

Pros:

- potentially useful for larger cross-project efforts
- gives the user a single coordinating chat

Cons:

- adds a synthetic project or nonstandard workspace type
- introduces more workflow complexity
- probably too much for V1

This could still be a future enhancement after a shared-session multi-repo root ships.

### Alternative D: Keep one session but teach the runtime to hop cwd between repos

In this model, the session stores a repo set and an "active repo", and tools implicitly execute against the active repo unless switched.

Pros:

- one session
- less filesystem indirection

Cons:

- pushes complexity into runtime/tooling
- makes behavior less transparent
- harder to debug than a real aggregate directory

I do not recommend this over an explicit aggregate root.

## Recommended Rollout

### Phase 1: Mandatory planning and confirmation with shared session

- Add `Task`
- Add `TaskRepo`
- Add `TaskWorkspace`
- Add global task composer
- Always run planning/routing first
- Always require repository confirmation
- Create an aggregate task root
- Materialize selected repos as task-local worktrees
- Start one shared session from the task root

This is the safest version and matches the desired product behavior exactly.

### Phase 2: Repo-aware UX improvements

- richer task status
- per-repo git summaries
- repo-aware file mentions
- task-level diff summaries

### Phase 3: Optional fan-out mode

- allow the user to choose between:
  - one shared multi-repo session
  - one workspace per project
- keep the same top-level task abstraction for both

### Phase 4: Optional coordinator agent

- add a top-level coordinating session if it proves useful
- keep implementation workspaces project-local

## Implementation Notes

### Reuse existing session startup path

The best part of the aggregate-root design is that it keeps the startup contract mostly intact:

- the session still launches against one working directory
- the runtime still tracks one cwd
- only the contents of that cwd change

### Worktree materialization strategy

For editable multi-repo sessions, prefer task-local worktrees:

- easier branch isolation
- clearer cleanup semantics
- safer than writing directly in the source repo root

### Git behavior

Git UX will need to become repo-aware.

Examples:

- status panel should show per-repo git state
- branch rename logic cannot assume one branch for the whole task
- PR creation likely remains per repo, not per task

This is the biggest product complexity after initial routing.

### Make routing explainable

Store routing reasons and confidence values. Users should be able to see why a project was included.

This matters operationally because cross-project routing mistakes are expensive.

### Keep inference cheap at first

The first version does not need embeddings or heavy semantic indexing.

Start with:

- project metadata
- repo naming
- lightweight file and README signals

If needed later, add a richer index.

## Open Questions

- Should a task be allowed to exist indefinitely in `AWAITING_CONFIRMATION`?
- Should task-linked sessions get a distinct visual treatment from normal workspace sessions?
- Should task fan-out happen synchronously on create, or as an async routing job?
- Should routing consider archived projects?
- Should tasks support rerun or "add another project" after launch?
- Should we expose project inference as an inspectable debug view for development?
- Should a task support both shared-session mode and fan-out mode?
- How should repo-specific startup scripts behave inside a shared task root?

## Recommendation

Implement multi-project prompts by introducing a top-level `Task` abstraction and supporting a synthetic task workspace root that contains multiple repositories.

This is the best path if the product requirement is one session spanning multiple repos and execution must begin only after planning and confirmation, because:

- it preserves the single-cwd runtime contract
- it gives the user one transcript and one place to work
- it supports no-project upfront intake
- it allows mandatory planning and explicit confirmation
- it avoids redefining normal project workspaces to have many owners

The key product idea becomes:

> The user should create a task, not choose a project.
>
> The system should plan first and propose which repositories belong to that task.
>
> The user must confirm that repository set.
>
> Only then should the system materialize those repositories under one aggregate task root and run the agent there.

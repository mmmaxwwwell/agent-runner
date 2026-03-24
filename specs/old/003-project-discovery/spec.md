# Feature Specification: Project Directory Discovery & Onboarding

**Feature Branch**: `003-project-discovery`
**Created**: 2026-03-23
**Status**: Draft
**Input**: User description: "Project Directory Discovery & Onboarding"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse All Projects in Workspace (Priority: P1)

A user opens the dashboard and sees every directory in their configured projects folder (`~/git` by default), regardless of whether those directories have been formally registered. Registered projects show their current task progress, session history, and status. Unregistered directories appear separately with a clear visual distinction and an "Onboard" action. The user can immediately understand which codebases are available and which ones are already being managed.

**Why this priority**: This is the core value — making invisible directories visible. Without this, users cannot discover or interact with codebases that haven't completed the full spec-kit workflow.

**Independent Test**: Can be fully tested by placing several directories in the projects folder (some registered, some not) and verifying the dashboard displays both categories with correct visual distinction.

**Acceptance Scenarios**:

1. **Given** the projects folder contains 5 directories and 2 are registered in `projects.json`, **When** the user opens the dashboard, **Then** all 5 directories appear — 2 as registered projects with task progress and sessions, and 3 as discovered directories with an "Onboard" action.
2. **Given** the projects folder contains a hidden directory (e.g., `.config`), **When** the dashboard loads, **Then** the hidden directory is not displayed.
3. **Given** the projects folder is empty, **When** the dashboard loads, **Then** an empty state message is shown indicating no projects were found.

---

### User Story 2 - Onboard a Discovered Directory (Priority: P2)

A user sees an unregistered directory on the dashboard and clicks the "Onboard" action. The system immediately registers the project (adds it to `projects.json`) and starts the new-project workflow. The project appears on the dashboard right away as a registered project, even before the workflow phases complete. If any phase fails, the project remains visible on the dashboard with an indication of its current state.

**Why this priority**: Discovery without the ability to act on it provides limited value. Onboarding turns visibility into productivity by allowing users to bring any codebase into the managed workflow.

**Independent Test**: Can be tested by clicking "Onboard" on a discovered directory and verifying it immediately appears as a registered project, then confirming it persists even if the workflow is interrupted.

**Acceptance Scenarios**:

1. **Given** an unregistered directory appears on the dashboard, **When** the user clicks "Onboard", **Then** the project is immediately registered and appears as a registered project on the dashboard.
2. **Given** a user starts onboarding a directory, **When** the spec-kit workflow fails mid-way, **Then** the project remains registered on the dashboard with its current phase status visible.
3. **Given** a previously failed onboarding attempt, **When** the user views the project on the dashboard, **Then** they can see the current workflow state and have the option to retry or continue from where it stopped.

---

### User Story 3 - View Directory Metadata Before Onboarding (Priority: P3)

Before committing to onboarding, a user can see useful context about a discovered directory: whether it's a git repository, and whether it already contains spec-kit artifacts (such as `spec.md`, `plan.md`, or `tasks.md`). This helps the user understand the state of a directory and make an informed decision about whether to onboard it.

**Why this priority**: Metadata provides useful context but isn't essential for the core discovery and onboarding flow. Users can onboard without it, but it reduces uncertainty.

**Independent Test**: Can be tested by placing directories with varying states (git repo vs. plain folder, with and without spec-kit artifacts) in the projects folder and verifying the correct metadata indicators appear.

**Acceptance Scenarios**:

1. **Given** a discovered directory that is a git repository, **When** the dashboard displays it, **Then** a git indicator is shown.
2. **Given** a discovered directory containing a `spec.md` file, **When** the dashboard displays it, **Then** it indicates that spec-kit artifacts are present.
3. **Given** a discovered directory that is neither a git repo nor has spec-kit artifacts, **When** the dashboard displays it, **Then** only the directory name and "Onboard" action are shown.

---

### Edge Cases

- What happens when the configured projects directory does not exist? The system should display an error or guidance to configure the correct path.
- What happens when a directory is deleted from disk after being discovered but before onboarding? The dashboard should handle the missing directory gracefully on the next refresh.
- What happens when a registered project's directory no longer exists on disk? The project should show a warning indicating the directory is missing.
- What happens when a directory name conflicts with an already-registered project name? The system should use the directory path as the unique identifier, not just the name.
- What happens when the projects directory contains symlinks? Symlinks to directories should be treated as regular directories; broken symlinks should be skipped.
- What happens when a directory has restricted permissions? The system should skip unreadable directories and continue scanning others.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The existing `GET /api/projects` endpoint MUST be extended to return both registered projects (with `type: "registered"`) and discovered directories (with `type: "discovered"`) in a single response.
- **FR-002**: The system MUST scan only top-level entries in the configured projects directory — no recursive scanning.
- **FR-003**: The system MUST skip hidden directories (names starting with `.`) during scanning.
- **FR-004**: The system MUST respect the `projectsDir` configuration (`AGENT_RUNNER_PROJECTS_DIR` env var, defaulting to `~/git`).
- **FR-005**: For each discovered directory, the system MUST detect whether it is a git repository.
- **FR-006**: For each discovered directory, the system MUST detect the presence of spec-kit artifacts (`spec.md`, `plan.md`, `tasks.md`).
- **FR-007**: The dashboard MUST visually distinguish registered projects from discovered directories.
- **FR-008**: Each discovered directory MUST have an "Onboard" action that initiates the new-project workflow.
- **FR-009**: The onboard action MUST register the project (persist to `projects.json`) before running any workflow phases, so it appears on the dashboard immediately.
- **FR-010**: Project registration MUST NOT require `tasks.md` or any other spec-kit artifact to exist.
- **FR-011**: The system MUST NOT display directories that are already registered as projects in the discovered list.
- **FR-012**: The system MUST handle inaccessible or missing projects directories gracefully with an appropriate message.
- **FR-013**: The discovered-directories list MUST be computed on page load only; no live-watching or polling of the projects directory is required.

### Key Entities

- **Registered Project**: A project entry in `projects.json` with associated session history, task progress, and workflow state. Represents a fully or partially onboarded codebase. Minimal schema at registration: `{ name: string, path: string, createdAt: string (ISO 8601), status: "onboarding" | "active" | "error" }`. Additional fields (sessions, taskProgress) are populated as the workflow proceeds.
- **Discovered Directory**: A top-level, non-hidden folder in the configured projects directory that is not present in `projects.json`. Represents a codebase available for onboarding.
- **Projects Directory**: The configured root folder (default `~/git`) that the system scans for directories.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All non-hidden, top-level directories in the projects folder appear on the dashboard within 2 seconds of page load.
- **SC-002**: Users can onboard a discovered directory in a single click, and the project appears on the dashboard immediately (under 1 second) without waiting for workflow phases to complete.
- **SC-003**: Users can distinguish at a glance between registered projects and discovered directories based on visual presentation alone.
- **SC-004**: 100% of directories previously invisible to users (not in `projects.json`) become visible on the dashboard after this feature ships.
- **SC-005**: Failed onboarding attempts no longer result in orphaned, invisible directories — all projects remain accessible on the dashboard regardless of workflow state.

## Clarifications

### Session 2026-03-23

- Q: How should the dashboard keep the discovered-directories list current after initial load? → A: Refresh only on page load (manual browser refresh to update).
- Q: What fields should a newly registered project entry in `projects.json` contain at onboarding time? → A: `{ name, path, createdAt, status: "onboarding" }` — minimal entry; additional fields populated as workflow proceeds.
- Q: How should the API endpoint for discovery be structured? → A: Single `GET /api/projects` endpoint returns both registered and discovered entries, distinguished by a `type` field.

## Assumptions

- The projects directory typically contains fewer than 100 top-level directories, so scanning performance is not a concern.
- Symlinks pointing to directories are treated as directories; broken symlinks are silently skipped.
- The existing `projects.json` structure can accommodate projects at any stage of the spec-kit workflow (not just fully completed ones).
- Users onboard one project at a time; bulk onboarding is not required for this feature.

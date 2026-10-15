# Bringing SILO into the site

SILO (`~/Documents/repos/silo`, "System for Improving Learning Outcomes") is a pedagogy design framework: eight entity schemas, a curriculum analyzer built on Alexander's "misfit variables", sixteen pedagogy patterns (PDSCs), and a self-healing-pedagogy layer. This page says what to take, in what order, and what to leave.

Status: plan only, nothing built. Written 2026-10-14.

## What we take and what we leave

| Take | Leave |
|---|---|
| Learning outcomes, as a content type | The Payload CMS and React app (`apps/cms`, `apps/web`); HAX is the platform |
| The curriculum analyzer (`src/tools/curriculumAnalyzer.ts`) | SILO's course, syllabus, people and software-form schemas; the site's course, program, pathway and sequence types already cover them |
| Effort (energy × time) as a weekly load view | Detection-point telemetry and interventions; they need live LMS analytics we don't have |
| PDSC exemplars as pattern pages | |
| The self-healing readiness checklist | |
| Framework text, as guide and Welcome content | |

## What the site already has (and SILO's analyzer needs)

- **Sequences** (`lms/sequence-model.js`): modules by week, items with role, due week, points, grade group and rubric. This is the assessment and activity side.
- **Rubrics** (`rubrics/rubric-model.js`): weighted criteria, usage tracking.
- **Courses, programs, pathways**: the curricular structure.
- **Outcomes: almost nothing.** Only a free-text `oer-cs-outcome` block on course-site pages. Nothing links an outcome to an assessment, so the analyzer has no input yet. This sets the order below.

The model modules are plain functions with no browser or HAX dependencies, which is where the analyzer belongs.

## Phase 1: Learning outcomes

**Built 2026-10-14** (tested on a scratch copy; not yet run on the real site). Code: `custom/src/types/outcome.js` (type definition and plain functions: `outcomePages`, `outcomesOf`, `outcomesFor`, `assessedBy`), nu-hax `scripts/outcomes.mjs` (adds the type, the field and the section; safe to run again).

- **One shared bank** (owner decision, 2026-10-14) of **Learning outcome** pages (`oer:outcome`) under Curriculum → Learning outcomes, after Programs. The page title is the statement. Fields: Code (PLO 2), Level (Bloom: Remember … Create, a reader filter), Courses, Pathways, Programs, Part of (a broader outcome).
- **Alignment lives on the assessed page, not the sequence item** (a change from the first draft of this plan): exercises, reflections, projects, activities (project steps, added after DMD 400 showed its deliverables are activities) and quizzes get a **Learning outcomes** field. An exercise then assesses the same outcomes in every sequence that uses it, it reuses the relation field's picker, header and "used in" for free, and nothing new is stored in sequences. A per-sequence override can be added later if a real case needs one.
- What shows where:
  - An outcome page lists the work that assesses it (Assessed by), and its courses, pathways and programs in its header.
  - Program pages (and new ones, through the type's template) list their outcomes.
  - A course page's "Taught in this course" table includes outcomes linked to the course directly.
  - The sequence builder's item settings show the page's outcomes, read-only, under Becomes.
- `outcomesFor(course)` also reaches outcomes through the course's programs and pathways. The curriculum check will use it; the course page's table doesn't yet.

Still to do in this phase, or later:
- Canvas export of outcomes, attached to rubric criteria. Trace the format in `docs/canvas-package-format.md` first.
- An outcome on a rubric criterion.
- ~~Design questions~~ decided 2026-10-14:
  - **Versions** (owner: "version the outcomes"), built like rubric versions: live links follow the latest wording; releasing work or a sequence pins its outcomes (`outcomePlan` in `versions/versioning.js`; a released sequence's items record `outcomes: [{ page, version }]`); a changed outcome is released first (minor bump); saving an in-use outcome asks first and offers Save as new outcome. DMD 400's five have v1.0.0 (`scripts/release-outcome-versions.mjs`).
  - **Picker**: the scoped dialog (`ui/oer-outcome-picker.js`), chosen over an inline combobox and an outcomes × work grid. **Alignment grid** added the same day (owner: "let's work on the alignment grid"): the sequence builder's Outcomes sheet, outcomes × graded pages, ticks saved to the pages with the sequence.
- Existing free-text "Learning objectives" lists on lessons, pathways, units and specializations, and course sites' outcome items, could be moved into the bank. That needs a decision; nothing is migrated yet.

## Phase 2: Curriculum check (the analyzer)

Port `curriculumAnalyzer.ts` (1,053 lines) and `types.ts` to a plain-JS module, `lms/curriculum-analysis.js` or a new `analysis/` folder, with the same no-browser rule. Keep its structure: misfit variables in five categories (alignment, effort, constraint, structural, coherence), the alignment graph, the semi-lattice score, and recommendations tied to a named unresolved force.

Input adapter (the real work): build SILO's `CurriculumInput` from the site's data.

| SILO input | From the site |
|---|---|
| courses | `oer:course` pages |
| learningOutcomes | `oer:outcome` pages (phase 1) |
| syllabi | the sequence's `text` items (syllabus, policies) |
| efforts | derived from sequence items; see phase 3 |
| constraints | course delivery mode and the term settings the export asks for |
| pdscs | pattern pages (phase 4), if present |

Checks that matter first (these need only outcomes + sequences + rubrics + pathways):
- An outcome no assessment is aligned to.
- A graded item aligned to no outcome.
- Weekly load that spikes against the course's average.
- A course no pathway or program reaches.
- A prerequisite loop or a missing prerequisite across a pathway.

Surface: a **Check curriculum** report beside Check links, one dialog per scope (course, pathway, program), listing findings by severity with a link to the page to fix. Authors only. Nothing is blocked; it informs.

Port notes: keep SILO's tests (`tests/tools`) and port them with the code, since the scoring is easy to get subtly wrong. Drop the Alexander commentary from user-facing text; say what is wrong and what to do ("Outcome 2 has no assignment").

## Phase 3: Effort and weekly load

Use SILO's effort schema as the model, but derive instead of asking: a sequence item's time comes from `schema:timeRequired` where set, otherwise from the item role and a default. Show a week-by-week load strip in the sequence builder's Preview tab, and feed the same numbers to phase 2's load check. Authors can override an item's hours; defaults are visible so nobody trusts a number they can't see.

## Phase 4: Pedagogy patterns

A **Pedagogy pattern** type (`oer:pattern`) seeded from the sixteen exemplars in `silo/docs/components/exemplars` (elastic deadlines, peer review, progressive scaffolding…). Each keeps SILO's headings: what it detects, how it responds, implementation steps, Canvas setup, signals. Sequence items can link to a pattern ("this discussion uses Iterative critique"), and the page shows "used in". A seed script like `create-sequence-from-plan.mjs` does the import; patterns stay generic, not tied to DART (owner decision, 2026-10-14); each exemplar still needs a read-through for site tone before it is published.

## Phase 5: Readiness checklist

The four-part self-healing checklist (detect, diagnose, respond, remember) as a short guided check on a course or sequence, scored the way SILO's page scores it, with each unchecked item pointing at a pattern from phase 4. Small and independent; do it once patterns exist so the advice links somewhere.

## Phase 6: Framework text

Bring the framework, cycle and role guides into the site as guide pages, and add a major-features schematic of the three scopes (class, curricular, program) to the Welcome page. Writing work with no code; edit for plain words and the site's reader level.

## Before starting

- SILO's working tree has many uncommitted changes (mostly `apps/cms`). The owner wants them kept (2026-10-14), so we do not touch that repo; the pieces we take are in `src/`, `packages/` and `docs/`, and we read them as they are.
- Phases 1 and 2 are one unit of delivery: the analyzer is not useful without outcomes. Phases 3 to 6 can ship separately.
- Verification: unit tests for the ported analyzer and adapter; the usual browser check for each new UI. Use a scratch copy of the site for seeding, as with the Canvas import work.
- Leave contribution to the SILO repo itself alone; the port is a copy that evolves here.

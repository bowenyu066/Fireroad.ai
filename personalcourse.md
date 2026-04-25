# personalcourse.md

This file is the planned durable store for one student's course history and recommender preferences. The browser prototype currently mirrors this shape in `localStorage.fr-personalcourse-draft`; the backend should write the canonical version here or to an equivalent user-scoped record.

## Basic Info

- name: TBD
- major: TBD
- future_program_space: reserved for double major, minor, or concentration
- standing: prefrosh | freshman | sophomore | junior | senior | meng
- gpa: optional; not collected for prefrosh

## Planning Scope

- primary_planning_surface: active_semester
- editable_plan_state: fourYearPlan[activeSem]
- four_year_plan_role: canonical_term_aware_store_with_active_semester_ui

The durable student profile stores term-aware planned-course history in `fourYearPlan`. The current app edits only `fourYearPlan[activeSem]`; cross-semester moves and broad 4-year roadmap mutations are out of scope unless explicitly requested.

## Inputs

- transcript: not_provided
- resume: not_provided
- coursework_import: not_provided

## Courses

| course | name | term | grade | status | source | preference |
| --- | --- | --- | --- | --- | --- | --- |
| TBD |  |  |  | completed | transcript | neutral |

Course `status` should support `completed`, `in_progress`, `planned`, and `dropped`. Course `preference` is `like`, `neutral`, or `dislike`.

## Preferences

- skill_level: pre-cracked | competition-lite | high-school
- notes: TBD

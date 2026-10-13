# Decap migration audit: exercises, projects, DART 303 and DART 203

Checked 2026-10-13 against learning-materials-decapcms (`content/`), for every Decap exercise and project tagged DART 303 or DART 203, plus the thumbnails of every exercise and project.

## Thumbnails

- **No broken thumbnails.** All 44 exercise and project thumbnails here are valid image files and load (HTTP 200).
- **Two never came through:** *Animating a bouncing ball* (`viewport-render.png`) and *Animated textures* (`ex-7-intro-banner-compressed.jpg`). Both files are still in Decap's `public/uploads`.
- **Seventeen never had one in Decap** (the four DART 303 game-environment exercises, the DART 413 and DMD exercises, and pages made here). Their cards show the placeholder icon, which can read as "missing".

## Why: two causes

1. **The import ignored Decap's single `course:` field.** It read the newer `courses:` list, but most Decap exercises and lectures use `course: DART 303`. So 32 pages have no course link here (DART 413 and the DMD courses used the list and are fine):
   - 23 DART 303 exercises (every one from the main import)
   - 4 DART 303 lectures: Introduction to Animation; Introduction to Cameras, Lighting, and Rendering; Introduction to Modeling; Introduction to Texturing
   - 5 DART 203 exercises (Ian Brill's): Modeling a Basic Knight, Modeling a Figurative Knight, Modeling a King, Modeling a Low Poly Animal and Introduction to Particles, Modeling a Metal Horse Head. His other ten were imported separately later (their addresses are at the site's root) and have DART 203.
   That's why the DART 303 course page lists only four exercises.
2. **Two exercises came from the proof-of-concept import** (2026-09-30), before fields were mapped, and later imports skipped them because they already existed:
   - *Animated textures* has no fields at all: licence (CC BY 4.0), AI licences (AIUL-WA, AIUL-NA-3D), author, difficulty (Beginner), course (DART 303), thumbnail, attachment, and no link to its Decap source.
   - *Animating a bouncing ball* lost its thumbnail, difficulty (Beginner), author and one AI licence (AIUL-NA-3D); its attachment is here.

## What came through

For every DART 303 and DART 203 exercise and project: the text (no page lost more than a quarter of its words), images in the text, links, embeds (`iframe-component` → `oer-iframe`, now partly the Tutorial series block) and rubrics (`rubric-component` → `oer-rubric`). All six DART 303 projects have their course. No Decap exercise or project is missing a page here.

## Fixes

- **Done 2026-10-13** (`scripts/restore-seed-exercises.mjs`): *Animated textures* and *Animating a bouncing ball* have their Decap header images back (with alt text written for them), difficulty, author, licence, AI licences, Allow embedding, *Animated textures*' Image Sequence Download link, and their links to their Decap sources. A byte-for-byte check found every other exercise and project image identical to Decap's.
- **Done 2026-10-13** (`scripts/restore-course-links.mjs`): the 32 course links from Decap's `course:` field, plus *Animated textures*' DART 303 (33 pages; versions left as saved). The DART 303 course page now lists its exercises and lectures.
- **Optional:** thumbnails for the 17 exercises that never had one.

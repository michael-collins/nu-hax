---
name: video-to-page
description: >
  Turn a video (a YouTube link or a recording on this Mac) into a draft
  Tutorial or Lecture page on the learning-materials site: the video embedded,
  a written breakdown, screenshots with alt text, timestamps that play the
  video from that moment, and the transcript. Use when the user says "make a
  tutorial from this video", "turn this lecture into a page", "make a page
  from this YouTube video", "video to page", or gives a YouTube link or video
  file and wants it on the site.
---

# Video to page

The HAX maintainer's version (haxtheweb/praw `skills/hax-tutorial-site`) needs
a Word document that already holds the screenshots and the breakdown. Here
Claude makes those from the video itself, and the result is a **draft page in
learning-materials**, never published by this skill.

Scripts (in nu-hax `scripts/`): `video-source.mjs` (details, transcript,
contact sheets), `video-frames.mjs` (screenshots), `video-page.mjs` (builds and
saves the draft). Timestamps on the page are HAX's `page-anchor`, made to play
`oer-video` by the theme (`custom/src/blocks/oer-timestamps.js`).

## Before starting

- **Rights.** Screenshots and a written breakdown copy the video. Go ahead for
  the user's own videos (YouTube channel "Michael Collins") and ones they say
  they may adapt. For anyone else's, ask first; embedding alone is fine.
- **Type.** Tutorial when the video shows how to do something on screen (steps
  to follow); Lecture when it's a talk or slides (ideas to understand). Ask only
  if it's really unclear.
- **Where.** By default the page goes under the type's listing page
  (Tutorials, Lectures). Ask if the user named a course, book or parent page;
  `parent` takes a page id or address.

## Steps

1. **Get the video ready.**
   `node scripts/video-source.mjs <link or file> [--vocab "Blender, Maya"] [--fix "Hack CMS=HAXcms"]`
   It prints the work folder, the transcript's source, chapters, scene changes,
   and the times in each contact sheet (12 pictures, left to right, top to
   bottom). A 13-minute video takes about 30 seconds the first time. Captions:
   the video's own when it has them, else speech to text (mlx-whisper,
   punctuated, about 30 s for 13 minutes), else YouTube's automatic ones (no
   punctuation). `--captions youtube` or `--captions speech` picks one. Names
   are often wrong in either: re-run with `--fix` for the transcript, and spell
   names properly in what you write. If it says "check the transcript: nothing
   said 9:00–13:19", read that part: a quiet stretch is fine, but speech to
   text can lose its place, so re-run (without `--vocab`, or with
   `--captions youtube`).

2. **Understand it.** Read `transcript.txt` all the way through and look at
   every contact sheet (`sheets/sheet-NN.jpg`) with Read. Note what's on
   screen at each step: on-screen key overlays and open menus are good
   screenshot moments; transitions and mouse-in-motion aren't. Use chapters
   and scene changes (slide changes in lectures) as section breaks.

3. **Plan the page**, then pick one screenshot per step that changes what's
   on screen (tutorials) or per new slide or diagram worth keeping (lectures):
   usually 4 to 10. `node scripts/video-frames.mjs <work> 0:20 1:31 3:30 …`
   picks the sharpest frame near each time. **Look at every frame** with Read
   before using it; if it's mid-transition or doesn't show the point, take
   another time.

4. **Write `page.json` and `page.html`** in the work folder.

   `page.json`:
   ```json
   {
     "type": "oer:tutorial",
     "title": "Bouncing ball, part 2: motion paths and bounce interpolation",
     "description": "One or two sentences: what you'll be able to do.",
     "fields": { "authors": [{ "name": "Michael Collins", "url": "" }], "difficulty": "Beginner" }
   }
   ```
   Optional: `"parent"` (id or address), `"video": false` (no embed) or
   `"video": "<link>"` (a local recording that's online somewhere),
   `"transcript": false`. A Lecture's `fields.image` can be `"frames/…"` (its
   featured image; set `imageAlt` too). Fill `authors` with the user only for
   their own videos.

   `page.html` conventions:
   - `[1:30]` becomes a timestamp that plays the video from 1:30 (plain text
     when there's no video). Put one at the start of each step or section.
   - `<figure><img src="frames/t0091.0.jpg" alt="…"><figcaption><p>…</p></figcaption></figure>`
     for screenshots; `alt` is required. Say what the picture shows that
     matters for the step (the menu that's open, the value in a field, the
     shape of a curve), not "screenshot of". The caption says why it's there.
   - `<!-- video -->` where the video goes (default: the top). Put it after a
     short opening paragraph.
   - Use the site's blocks where they help: `<oer-callout type="tip" title="…">`
     (tip, info, warning). Keys in `<kbd>`, interface names in `<em>`.

   Shape:
   - **Tutorial:** an opening paragraph (what you'll make, what to know first),
     the video, then `<h2>` per part with an `<ol>` of steps, each
     `<li><p><strong>Do the thing.</strong> [m:ss] How…</p><figure>…</figure></li>`,
     and a short wrap-up.
   - **Lecture:** an opening paragraph, the video, then an `<h2>` per section
     of the talk (`<h2>Title</h2><p>[m:ss] …</p>`) with its key points as short
     paragraphs or a list, slide screenshots, key terms where the talk defines
     them, and "Check your understanding" questions at the end.

   Write as the site does (`docs/design-system.md` → Writing): plain words,
   sentence case, the video's facts only (never invent steps or settings), and
   the right names even where the captions got them wrong.

5. **Check, then save as a draft.**
   `node scripts/video-page.mjs <work> --dry-run` writes `final.html` without
   touching the site. Then, with the site running (`hax serve` in
   learning-materials):
   `node --env-file=.env.local scripts/video-page.mjs <work>`
   It uploads the screenshots (named after the page), adds the transcript
   (folded, a timestamp per paragraph), and saves an unpublished page. It
   refuses a video it has already made a page from unless given `--again`.
   HAXcms commits the whole site folder when it saves, so commit any theme
   changes in learning-materials first.

6. **Report** the draft's link, the number of screenshots, the transcript's
   source, and anything to check (names the captions may have got wrong,
   steps that were hard to follow). The work folder holds the downloaded video;
   offer to delete it once the page is right (`rm -r <work folder>`).

To try it without touching the real site, run step 5 against a scratch copy:
`HAX_BASE=http://localhost:3101 SITE_DIR=<copy> HAX_TOKENLESS=1` (see
`scripts/editor-check/README.md`).

## Local recordings and speech to text

`video-source.mjs` takes a file path (anything ffmpeg reads: .mp4, .mov,
.mkv, .webm). There's no video to embed unless the recording is online
somewhere (`"video": "<link>"` in page.json), so timestamps print as plain
times.

Speech to text is mlx-whisper (Apple Silicon), installed 2026-10-12 in its own
Python environment, `~/.cache/nu-hax/whisper-venv` (1.2 GB, mostly PyTorch),
with the `mlx-community/whisper-large-v3-turbo` model (1.5 GB) in
`~/.cache/huggingface`. `WHISPER_MODEL` picks another model. To set it up
again:

```bash
python3.13 -m venv ~/.cache/nu-hax/whisper-venv && ~/.cache/nu-hax/whisper-venv/bin/pip install mlx-whisper
```

whisper.cpp's `whisper-cli` (with a ggml model in `~/.cache/nu-hax/whisper/`)
works too if it's ever installed. Without either, video-source says "No
transcript" and carries on.

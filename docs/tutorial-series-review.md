# Tutorial series to review

Playlists turned into tutorial series (the `video-to-page` skill), newest last. Each series and its parts start as drafts; the exercise or project that embedded the playlist shows the series to signed-in authors and keeps the playlist for students until the series and its parts are published. Each entry lists what the write-up wasn't sure about, to check against the video before publishing.

## Bouncing a ball

Exercise: [Animating a bouncing ball](http://localhost:3000/exercises/animating-a-bouncing-ball). Series: [Bouncing a ball](http://localhost:3000/tutorials/bouncing-a-ball). Published 2026-10-12.

- Part 1 also covers motion paths (20:39–22:30); the page leaves them to Part 2.
- The keys for copying the scale values (15:26) are too faint to read.
- "Frames 9 and 15 are keyed round" comes from the speech, not the screen.
- The sphere's scale is never applied in the video; the page adds a callout to apply it.

## Animated textures

Exercise: [Animated textures](http://localhost:3000/exercises/animated-textures). Series: [Animated textures](http://localhost:3000/tutorials/animated-textures) (drafts): Modeling a TV and its table; Applying the animated texture and rendering the video.

- The videos use Blender 2.90.1. Auto Smooth (Object Data → Normals) was removed in 4.1, and EEVEE's Bloom, Ambient Occlusion and Screen Space Reflections checkboxes changed in 4.2. A callout for students on 4.x may help.
- Part 1, shaping the TV body (2:44–4:20): selections and axes are read from the frames; the speech is loose.
- Part 1, the second bevel (10:21): which edge loop isn't clear, so it isn't named.
- "Six pieces of geometry": the Outliner shows seven objects with the floor plane; the count is left out.
- Part 2 material names (tv-plastic, metal-knob, tv-plastic-2) are partly read from cut-off labels; which object got which is partly a guess.
- Vignette: 18 at first, 70 in a later frame; the page says it's raised later.
- Light keyframes: Power keyed at frame 11 (506.2 W), later lowered to 350 W; other frames aren't said.
- Menu paths named from speech: File → Export → Add to Render Queue; File → Export → Add to Adobe Media Encoder Queue. "Lock camera to view" isn't shown, so it's left generic.
- "PBR Materials add-on by 3D Wolf": name not checked.
- The TV reference photo isn't shown (a found image); the lens flare's keyframe values are left out (unclear).
- Part 2 and the series page say the screen's image sequence is "available to download" without a link; the exercise has the download.

## Modeling the Airline Chair

Exercise: [Modeling the Airline Chair](http://localhost:3000/exercises/modeling-the-airline-chair). Series: [Modeling the Airline Chair](http://localhost:3000/tutorials/modeling-the-airline-chair) (drafts): Setting up the reference image; Modeling the side; Modeling the side brace; Mirroring the side; Modeling the seat cushions; Adding the details; Fixing geometry problems.

- **Part 7 fixes another chair file, `Button-Modeling-Chair.blend`, which may be a student's.** The file name shows in the title bar of all 10 screenshots (as it does in the public video). Decide before publishing whether that's fine.
- Parts 1–6 use Blender 2.83 and Part 7 2.90. On 4.x: Apply is in the modifier's dropdown (or Ctrl+A over it); modifiers reorder by dragging, not arrows; "Absolute Grid Snap" is now "Absolute Increment Snap"; Face Orientation shows only back faces red (no blue); Auto Smooth is gone.
- Part 1: Numpad 3 as the shortcut for the side view is the write-up's addition.
- Part 2: how the reference image's rotation is unlocked and locked again isn't clear on screen.
- Part 3: the reference rotation at 1:27–1:53 isn't clear; the video then rotates the brace to fit instead.
- Part 4: the brackets section (4:10–6:24) is muddled; whether the earlier Alt+D copy was deleted isn't claimed. The mirror first working only on Z is read from the screen.
- Part 5: at 3:03 an unselected object is edited along with the rest; the video doesn't say why.
- Part 6: the speech says "maintain that seam", but moving the Mirror above the Subdivision Surface removes it; the page says it removes it. The rods' and hooks' positions are read from the screen.
- Part 7: "right-click to add to Quick Favorites" is the write-up's addition; the reference shows solid pink because the file can't find it.
- Transcript fixes: Kem Weber, supporting edge, subdiv, n-gon.
- The exercise's step now says "Follow the Modeling the Airline Chair tutorials above" (it said "six-part video demonstration"; the series has seven parts with the fix-up video).

## Texturing the Airline Chair

Exercise: [Texturing the Airline Chair](http://localhost:3000/exercises/texturing-the-airline-chair). Series: [Texturing the Airline Chair](http://localhost:3000/tutorials/texturing-the-airline-chair) (drafts): Choosing a mesh resolution; Applying scale; Marking seams and unwrapping; Making and applying an image texture; Texturing the side from a photo.

- **Part 5 builds the texture from photos of the real chair** (files 244141_743985d156708c43_b.jpg, 244191_…_b.jpg; they look like museum collection images, possibly Cooper Hewitt, not confirmed). Seven screenshots show them, t0058.8 nearly whole. Check their license before publishing.
- The edge-banding wood is a Textures.com file (TexturesCom_Wood_MapleVeneer_512_albedo, visible in t0510.4).
- On screen: your teaching folder path (Part 4's export dialog), your home folders (the Shading workspace's file browser), and a "secret stuff" collection (Parts 1–4).
- The exercise wants a UV map per part (uv-arm.jpg…); the videos export PNGs named UV2 and color.png and only unwrap and texture the side. Part 1 recommends applying Subdivision before texturing, while the side in Parts 2–5 keeps its Mirror modifier.
- Part 2: how the checker texture was set up isn't shown. Part 3: where the strip's seams go is described generally. Part 5: "this seam may need to be higher" is read as lining up the photo's wood joint with the UVs' inside corner; the edge banding is done off camera.
- Ctrl+L (Select Linked) is written for the video's ⌘L; Photoshop shortcuts shown are Mac ones. Spoken promises of links to texture sites and supplied textures are left out. A "Thank you." that speech to text invented over silence was removed from Part 5's transcript.
- Blender 2.83 in the videos. On 4.x: Apply is in the modifier's dropdown; "Viewport" is "Levels Viewport"; the video's UV menu has add-on entries (Peel Edge, UV Smoothing, Copy/Paste UV); Unwrap is a submenu; Stretching is in the UV Editor's Overlays popover; the Principled BSDF looks different; Image → Reload (Alt+R).
- The exercise's step now says "Follow the Texturing the Airline Chair tutorials above to create UV maps…".

## Lighting and rendering the Airline Chair

Exercise: [Lighting and Rendering the Airline Chair](http://localhost:3000/exercises/lighting-and-rendering-the-airline-chair). Series: [Lighting and rendering the Airline Chair](http://localhost:3000/tutorials/lighting-and-rendering-the-airline-chair) (drafts): Studio backdrop and three-point lighting; Refining the lighting and the leather; Framing the shot and finishing in Photoshop.

- Part 2's Shading-workspace screenshots (t0750, t0932, t0975, t1055) show your home folders in the file browser. Frames with your Desktop, Downloads and a "Mike_chapt…" file weren't used.
- Part 3's t0160.0 shows the reference photo side.jpg, probably someone else's photo of the real chair.
- The exercise asks for contrast and denoising; the Photoshop part adjusts only Hue/Saturation and Vibrance (Curves is mentioned), and nothing covers denoising. The video's samples advice is about 250 (500–700 optional); the exercise says 250–750.
- From the screen, not the speech: turning off the default light's camera visibility (Part 2, ~8:12); the back cushion's maps (18:35–19:10); 250 samples for the final render; the file names chair-render-1.png and chair-render-comp.png.
- "cc0textures.com" is now probably ambientCG (not checked); the page says CC0 Textures.
- Blender 2.83 and Photoshop 2020 in the videos. On 4.x: adaptive sampling and denoising are on by default ("Max Samples"); the Principled BSDF is reorganized (Clearcoat is Coat); Shadow Catcher is under Visibility › Mask; "Color Ramp". Cmd+Delete is Ctrl+Backspace on Windows.
- The exercise's step now says "Follow the Lighting and rendering the Airline Chair tutorials above…".

## Introduction to animation

Exercise: [Introduction to animation](http://localhost:3000/exercises/introduction-to-animation). Series: [Introduction to animation](http://localhost:3000/tutorials/introduction-to-animation) (drafts): Keyframes, parenting and the Graph Editor; Saving a playblast.

- **The videos and the exercise differ:** the video parents sphere → empty → cube and uses the empty as the sphere's pivot, where the exercise parents the sphere to the cube and uses the empty as the camera's target; the video's camera tracks the cube; it only makes a viewport playblast (no Render Animation); it saves to the desktop, without naming the .blend; it keys frames 1, 60 and 120.
- Speech and screen disagree: "760 degrees" at 1:29 (the screen shows 720°; the page says 720°); "rotate the cube" at ~12:14 while the sphere is selected (the page says the sphere).
- Part 2's screenshots (5 of 6) show the output path /Users/msc227/Desktop/.
- Exercise step 1 still says "Watch linked tutorials in Learning Resources from Blender Foundation and others", but the exercise has no Learning resources set. Left as it is.
- Blender 2.90 in the videos. On 4.1+: I keys straight away in the viewport (K opens the Insert Keyframe menu). Around 4.5 the output settings may add a Media Type choice before File Format (not checked).
- The exercise's step now says "Follow the Introduction to animation tutorials above to animate a camera, cube, and sphere."

## Rigging a character

Exercise: [Introduction to rigging](http://localhost:3000/exercises/introduction-to-rigging). Series: [Rigging a character](http://localhost:3000/tutorials/rigging-a-character) (drafts): Importing the base mesh; Setting up a Mirror modifier; Adding knees and elbows; Creating edge flow for deformation; Setting up an armature; Parenting the mesh to the armature; Posing with IK constraints.

- Part 1's t0026.0 shows /Users/msc227/Documents/teac…3-fa20/assignments/ex-6-rigging/, your home folder and a Recent list (product-concepts, ex5-animation, modeling-b1, p3d.in-test…). Parts 5–7 show ex6-rigging.blend in the title bar.
- **The video's height is wrong:** it reads Dimensions Z (1.68 m) as the height, but the model is rotated 90° on X, so the height is Y (11.5 m, about 12 m tall). Part 1 has a callout explaining it.
- The videos and the exercise differ: no Ctrl+A apply transforms (scale typed as 1; the 90° X rotation stays); no neck bone, no separate shoulder and arm bones, no numbering; weight painting only mentioned (Part 7, 24:15), not shown; the head's IK constraint has no target (the page calls it optional).
- Part 7 settings to check: axes inverted Z then Y (yours may differ); pole angle 90° legs, −90° arms; the right leg's pole target is only set at 20:36; "rotate this" at 23:13 is written as fine-tuning; left/right isn't named in the sitting-pose alt text.
- Bone names follow the screen: footIK.L/R, kneePoleTarget.L/R, elbowPoleTarget.L/R, handIK.L/R.
- Part 4's transcript keeps a few lone "Okay." lines after long pauses (unchecked); an invented "Thank you." at 21:07 was removed.
- Blender 2.90 in the videos. On 4.x: bone collections replaced bone layers and groups (Part 5 and the series intro say so); where the armature X-axis mirror toggle lives in 4.x is unchecked (Part 7 depends on turning it off in Pose Mode); Apply is in the modifier's dropdown.
- The exercise's steps now say "Work through the Rigging a character tutorials above." and "Follow the edge flow part of the tutorials (Creating edge flow for deformation)…". Its "watch the weight paint tutorials" step is left as it is (the series doesn't show weight painting).

## Sculpture garden with PBR materials

Exercise: [Sculpture Garden](http://localhost:3000/exercises/sculpture-garden). Series: [Sculpture garden with PBR materials](http://localhost:3000/tutorials/sculpture-garden-with-pbr-materials) (drafts): Introduction to PBR materials; Making the sculpture garden. The playlist had the introduction second; the series puts it first.

- Most screenshots in both parts show your home folders in the Shading workspace's file browser (BigFix, Creative Cloud, HoudiniProjects, redshift, UnrealEngine…). The final evening screenshot has a video player's controls over it.
- Textures and HDRIs on screen are ambientCG's (CC0): Wood Floor 044, Day Sky HDRI 045 A, DayEnvironmentHDRI055, Ground 037, Concrete 042A, Metal 057B, Concrete 031; only Ground 037 is credited aloud. Photoshop's own lookup presets (Kodak 5218, TealOrangePlusContrast). Add-on tabs students won't have: BlenderKit, Substance 3D, MACHIN3, Screencast Keys.
- The videos and the exercise differ: Part 2 lights the garden with the Sky Texture only (the HDRI is in Part 1); the evening walls are lit by small ground lights, not wall lights; files are named "sculpture garden", not LASTNAME-pbr; the Photoshop finish goes further (Color Lookup, vignette, grain). The textures-folder tip comes from the exercise.
- Guesses: "Brutal" read as "Brutalist" (the sign says Brutalist); "seismic placement" (1:52) and "two shades" (46:31) left as heard. Part 1 adds that water's IOR is about 1.33 (the video says about 1.35).
- Part 2, unclear: the wall trimming at 15:36; rebuilding the n-gon as quads (partly shown); the seams and Solidify fix at 53:00–55:00 are on the skylight ring; the redesign between 1:28:58 and 1:30:17 happens off camera.
- Blender 4.2.1 in the videos, so most carries over. Adaptive Subdivision needs the Experimental feature set; the sun elevations assume the Nishita sky; lights' Use Nodes is Cycles only. Mac shortcuts are given as Ctrl/Alt.
- Series difficulty is Intermediate (the exercise is listed as Beginner). The exercise's step now says "Work through the Sculpture garden with PBR materials tutorials above."

## Getting started with PlayCanvas

Project: [Realtime Game Environment](http://localhost:3000/projects/realtime-game-environment) (its Grant Abbitt playlist stays). Series: [Getting started with PlayCanvas](http://localhost:3000/tutorials/getting-started-with-playcanvas) (drafts): Bringing a Blender scene into PlayCanvas; Hosting your scene on GitHub Pages.

- **Part 2's video hosts someone else's project**: a PlayCanvas project titled with a person's name, with sexual-health signs in the scene ("Sex, Gender, Sexuality", "Living with Herpes") and upload files named sti-screening-kit and communityhealthcenter. It may be a student's or a client's. The page's 8 screenshots are cropped and chosen so none of that shows (checked), and the text and transcript don't mention it, but the embedded video (public on your channel) shows it all. Decide before publishing.
- Part 1's movement script (firstPersonMovement.js) "will be provided" but isn't attached anywhere; attach it to the part or the project.
- On screen: your GitHub account (michael-collins), michaelcollins.xyz in three Part 2 frames (the page explains a student's address will be github.io), and /Users/msc227/… paths in two Part 1 frames (one shows "dart303 2024" and recent folders).
- At 32:42 the speech says "add some friction" but the screen sets Linear Damping to 0.99; the page follows the screen.
- The video says private repositories need a paid account (out of date); the page just says leave it Public.
- The videos and the project differ: no environmental storytelling, texturing, lighting, sound, walkthrough recording, or collisions on every imported model.
- Recorded February–March 2024 (PlayCanvas engine 1.69.2, Blender 4.0). Likely changed: PlayCanvas's dashboard, Import Ammo, script attributes (newer projects use a different script system), Builds & Publish; GitHub's new-repository and Pages settings. Browser uploads to GitHub are limited (about 100 files and 25 MB per file).
- The project's step now says "Please follow the Getting started with PlayCanvas tutorials above to host your game on…".

## Creating 3D scene layouts in Blender

Project: [Ideas In Motion](http://localhost:3000/projects/ideas-in-motion). Series: [Creating 3D scene layouts in Blender](http://localhost:3000/tutorials/creating-3d-scene-layouts-in-blender) (drafts): The finished animatic; Organizing your project folder; A tour of the layout scene; Blocking the animation and setting up scenes; Rendering the viewport to image sequences; Switching cameras with markers; Editing the animatic with sound in After Effects; Exporting the animatic and swapping in final renders.

- **Sounds in the example animatic aren't credited in it:** "Space Residue" by Igor Amokian (FMA, CC BY-NC-SA 3.0), felix.blume's dog bark and river ambience (CC0), newagesoup's whoosh (CC BY 3.0), gerainsan's spaceship fly-by (license not seen). Heard in Parts 1, 7 and 8; Part 7's page tells students to note who to credit. Who made the dog, house and tree models isn't said.
- /Users/msc227/Documents/teaching/dart303-fa20/animatic/... is burned into every viewport render and shows in screenshots in Parts 1, 2, 5, 7 and 8. Frames with your freesound login (mscoll85) and a "student work" folder weren't used.
- The videos and the project differ: the project asks for "1080x1920" (vertical, or a typo?); the videos make a 20-second 1920×1080 animatic. The project says the demos show After Effects color grading; they don't. Not covered: test renders, EXR, the compositor, storyboarding.
- Unclear: "IE" in Part 1's credits; Part 4's Cmd+P (from speech) and the Affect Only → Origins path (the write-up's wording); the slowed scene keeps the name CAM-3_250-350_x400 for frames 166–200; where the footage is dropped in Part 7; Part 8 starts mid-sentence and uses an earlier After Effects project.
- Added by the write-up: Time Stretching callouts (Parts 2, 4), Blender 4.1's I key (Part 4), a metadata tip (Part 5), Edit → Split Layer (Part 7).
- Blender 2.91 and After Effects 2020. On 4.x: Time Remapping is Time Stretching; I keys straight away (K opens the menu); Emission Strength defaults to 0 since 4.0 (Part 3's moon won't glow until raised; not on the page); EEVEE changed in 4.2 and AgX makes renders look different. Media Encoder's "Vimeo 1080p Full HD" preset name is unchecked.
- The project's "Tutorial" section now holds the series (the heading is unchanged).

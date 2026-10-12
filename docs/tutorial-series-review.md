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

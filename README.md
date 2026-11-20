# Weight Brush Plus for Blockbench

A Blockbench 5.2+ plugin that makes the **Weight Brush** usable on low-poly meshes.

On a low-poly part, Blockbench's brush is all-or-nothing: every point near the brush centre gets the full amount in
one click. Erasing (Ctrl) also leaves points on **no bone at all**. Those points then stick in place when the parent
bone moves, which is also invalid skinning in a game engine.

## What it adds
1. **Strength slider** in the Weight Brush toolbar (default **25%**). Each dab moves a point's weight only that far,
   so you can build up or fade weights over a few dabs or one drag. Set it to 100% for Blockbench's normal
   all-at-once brush.
2. **Single clicks paint.** In Blockbench alone, a click right after the mouse enters the view, or after orbiting
   the camera, paints nothing until you drag a little. The camera's "has moved" flag is cleared only after the
   brush's first dab has been skipped. The plugin clears it at the start of each stroke.
3. **Erasing hands the weight to the parent bone** (on by default). Ctrl-paint weight off `lid_l` and it goes to
   `head`, so the points stay attached. Painting the back of an eyelid off the lid bone is then all it takes for it to
   stay with the face.

Ctrl+Z undoes a whole stroke, including the hand-off. Turn the hand-off off in **Settings ▸ Edit ▸ Weight Brush:
erasing gives weight to the parent bone**.

## Install
**File ▸ Plugins ▸ Load Plugin from File**, then pick [`weight_brush_plus.js`](weight_brush_plus.js) (optionally keep
`about.md` next to it).

## How it works (Blockbench 5.2.2)
- **Strength:** the brush computes each point's strength with `Math.hermiteBlend` (`weight_paint.ts`). The plugin
  scales that value by the strength, but only during a Weight Brush stroke. Other tools are unaffected.
- **Hand-off:** each stroke is one undo step that already tracks every bone of the armature. Before Blockbench
  stores the "after" state, the plugin gives the parent bone whatever weight a point lost overall. In Set mode,
  painting weight *on* already moves it between bones, so nothing extra happens there.

## Tested
In Blockbench 5.2.2 on a real low-poly rig: single clicks paint, and an eyelid weighted with the brush hinges
the way you'd expect, its back staying with the head.

Offline: `node tests/verify_weight_brush_plus.js` runs Blockbench's own dab formula and checks:
- one Ctrl-click at 25% takes 1 to 0.75, not straight to black;
- erasing to black on `lid_l` leaves the point fully on `head`;
- painting back on splits 0.25 / 0.75;
- the setting off gives Blockbench's own behaviour;
- the strength applies only during strokes, and unload is clean.

## Credits
Written with the help of an AI coding assistant (Claude). Issues and pull requests are welcome.

## License
[MIT](LICENSE)

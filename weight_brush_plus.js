/*
 * Weight Brush Plus for Blockbench 5.2+
 *
 * Makes Blockbench's Weight Brush usable on low-poly meshes:
 *  1. Strength slider in the Weight Brush toolbar (default 25%). Each dab changes a point's weight by at most
 *     that fraction of the way, so red fades to black over several clicks instead of in one.
 *  2. Single clicks paint (Blockbench skipped a click's first dab; you had to drag a little).
 *  3. Erasing hands the weight to the parent bone (on by default). Ctrl-painting a bone's weight off some
 *     points gives that weight to the bone's parent, so the points stay attached (e.g. the back of an eyelid
 *     erased from lid_l goes to head) instead of being left on no bone, which makes them stick in place when
 *     the head moves and is invalid skinning in a game engine.
 *
 * How (Blockbench 5.2.2, src/js/modeling/weight_paint.ts): every point's brush influence is computed with
 * Math.hermiteBlend(falloff). This plugin wraps the Weight Brush tool's onCanvasClick to mark a stroke as
 * running and, only then, scales Math.hermiteBlend's result by the strength. The whole stroke is one undo
 * step that already tracks every bone of the armature (Undo.initEdit({elements: all_bones})), so the hand-off
 * happens in 'finish_edit', before the "after" state is stored: one Ctrl+Z undoes both.
 *
 * The functions above "Blockbench layer" have no Blockbench dependencies, for Node tests.
 */
(function () {
	'use strict';

	const PLUGIN_ID = 'weight_brush_plus';
	const DEFAULT_STRENGTH = 25; // percent

	/**
	 * Hand erased weight to the parent bone.
	 * before / after: {boneUuid: {weightKey: weight}} for all bones; brushBone / parentBone: uuids.
	 * Returns {weightKey: amount} that was added to parentBone (and applies it to `after`).
	 */
	function handOff(before, after, brushBone, parentBone) {
		const added = {};
		if (!parentBone || !before[brushBone] || !after[brushBone]) return added;
		const keys = new Set([...Object.keys(before[brushBone]), ...Object.keys(after[brushBone])]);
		const total = (state, key) => Object.values(state).reduce((s, w) => s + (w[key] || 0), 0);
		for (const key of keys) {
			const lost = (before[brushBone][key] || 0) - (after[brushBone][key] || 0);
			if (!(lost > 1e-6)) continue;
			// Only what the point lost overall (Set mode moves weight between bones already).
			const deficit = Math.min(lost, total(before, key) - total(after, key));
			if (!(deficit > 1e-6)) continue;
			if (!after[parentBone]) after[parentBone] = {};
			after[parentBone][key] = Math.min(1, (after[parentBone][key] || 0) + deficit);
			added[key] = deficit;
		}
		return added;
	}

	/** Scaled influence: Blockbench's hermite falloff x strength (0..1). */
	function scaledInfluence(hermiteValue, strength) {
		return hermiteValue * Math.max(0, Math.min(1, strength));
	}

	const core = { handOff, scaledInfluence, DEFAULT_STRENGTH };

	// Outside Blockbench (Node tests) export the core and stop here.
	if (typeof Plugin === 'undefined' || typeof BARS === 'undefined') {
		if (typeof module === 'object' && module && module.exports) module.exports = core;
		return;
	}

	// ================================================================ Blockbench layer

	let active = false;
	let stroking = false;
	let brushBoneAtStroke = null;
	let origHermite = null, wrappedHermite = null;
	let tool = null, origClick = null, wrappedClick = null;
	let slider = null, handOffSetting = null;

	function strength() {
		let v = DEFAULT_STRENGTH;
		try { v = Number(slider && slider.get()); } catch (err) { /* default */ }
		if (!isFinite(v) || v <= 0) v = DEFAULT_STRENGTH;
		return v / 100;
	}

	function endStroke() {
		document.removeEventListener('pointerup', endStroke);
		stroking = false;
	}

	function onFinishEdit({ message }) {
		if (!active || message !== 'Paint vertex weights') return;
		if (!handOffSetting || !handOffSetting.value) return;
		const bone = brushBoneAtStroke;
		brushBoneAtStroke = null;
		if (!bone || !(bone.parent instanceof ArmatureBone)) return;
		const save = Undo.current_save;
		if (!save || !save.elements) return;
		const armature = bone.getArmature();
		const bones = armature ? armature.getAllBones() : [];
		const before = {}, after = {};
		for (const b of bones) {
			const copy = save.elements[b.uuid];
			if (!copy) return; // not tracked by this undo step: leave it alone
			before[b.uuid] = Object.assign({}, copy.vertex_weights || {});
			after[b.uuid] = Object.assign({}, b.vertex_weights || {});
		}
		const added = handOff(before, after, bone.uuid, bone.parent.uuid);
		if (!Object.keys(added).length) return;
		Object.assign(bone.parent.vertex_weights, after[bone.parent.uuid]);
		for (const m of Mesh.all) if (m.getArmature && m.getArmature() === armature) Mesh.preview_controller.updateGeometry(m);
	}

	Plugin.register(PLUGIN_ID, {
		title: 'Weight Brush Plus',
		author: 'yarrbeard-gyps',
		description: 'A strength slider for the Weight Brush, and erasing hands weight to the parent bone instead of leaving points unweighted.',
		icon: 'stylus_highlighter',
		version: '1.0.1',
		variant: 'both',
		min_version: '5.2.0',
		tags: ['Rigging'],
		onload() {
			tool = BarItems.weight_brush;
			if (!tool || typeof tool.onCanvasClick !== 'function') {
				console.warn('[Weight Brush Plus] Weight Brush not found; this needs Blockbench 5.2+');
				return;
			}
			active = true;

			slider = new NumSlider('slider_weight_brush_strength', {
				name: 'Weight Brush Strength',
				description: 'How much each dab changes a point\'s weight, in percent (Weight Brush Plus)',
				category: 'edit',
				tool_setting: 'weight_brush_strength',
				condition: () => Toolbox && Toolbox.selected && Toolbox.selected.id === 'weight_brush',
				settings: { min: 1, max: 100, interval: 1, default: DEFAULT_STRENGTH, show_bar: true },
			});
			if (Toolbars.weight_brush) Toolbars.weight_brush.add(slider, 1);

			handOffSetting = new Setting('weight_brush_hand_off', {
				name: 'Weight Brush: erasing gives weight to the parent bone',
				description: 'Ctrl-painting weight off a bone hands it to that bone\'s parent, so points never end up on no bone (Weight Brush Plus)',
				category: 'edit',
				value: true,
			});

			origHermite = Math.hermiteBlend;
			wrappedHermite = function (input) {
				const v = origHermite.call(this, input);
				return active && stroking ? scaledInfluence(v, strength()) : v;
			};
			Math.hermiteBlend = wrappedHermite;

			origClick = tool.onCanvasClick;
			wrappedClick = function (data) {
				const isStroke = active && data && data.event && !(data.event.altKey) && !(data.element instanceof ArmatureBone);
				if (isStroke) {
					stroking = true;
					brushBoneAtStroke = ArmatureBone.selected[0] || null;
					document.addEventListener('pointerup', endStroke);
					// Single clicks: the preview sets controls.hasMoved on mouseenter / after orbiting, and
					// OrbitControls only clears it on mousedown, which fires after this pointerdown. The brush's
					// first dab checks hasMoved and was skipped, so a plain click painted nothing.
					try {
						const controls = Preview.selected && Preview.selected.controls;
						if (controls) controls.hasMoved = false;
					} catch (err) { /* no preview */ }
				}
				try { return origClick.apply(this, arguments); }
				catch (err) { endStroke(); throw err; }
			};
			tool.onCanvasClick = wrappedClick;

			Blockbench.on('finish_edit', onFinishEdit);
		},
		onunload() {
			active = false;
			stroking = false;
			Blockbench.removeListener('finish_edit', onFinishEdit);
			if (Math.hermiteBlend === wrappedHermite) Math.hermiteBlend = origHermite;
			if (tool && tool.onCanvasClick === wrappedClick) tool.onCanvasClick = origClick;
			if (slider) {
				if (Toolbars.weight_brush) Toolbars.weight_brush.remove(slider);
				slider.delete();
			}
			if (handOffSetting) handOffSetting.delete();
			slider = handOffSetting = tool = null;
		},
	});
})();

// Offline checks for weight_brush_plus.js. Run: node tests/verify_weight_brush_plus.js
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const FILE = path.resolve(__dirname, '..', 'weight_brush_plus.js');
let pass = 0;
const ok = (cond, msg) => { assert(cond, msg); pass++; console.log('ok  ' + msg); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
const C = require(FILE);

// ---- core
ok(near(C.scaledInfluence(1, 0.25), 0.25) && C.scaledInfluence(0.8, 2) === 0.8, 'influence scaled by strength (clamped)');
{
	const before = { lid: { 'm:back': 1, 'm:front': 1 }, head: {} };
	const after = { lid: { 'm:front': 1 }, head: {} };
	const added = C.handOff(before, after, 'lid', 'head');
	ok(added['m:back'] === 1 && after.head['m:back'] === 1 && !added['m:front'], 'erased weight goes to the parent bone');
}
{
	const before = { lid: { 'm:a': 1 }, head: { 'm:a': 0 } };
	const after = { lid: { 'm:a': 0.6 }, head: { 'm:a': 0.4 } }; // Set mode already moved it
	ok(!Object.keys(C.handOff(before, after, 'lid', 'head')).length, 'no double hand-off when the weight already moved to another bone');
}

// ---- mock Blockbench with the real Weight Brush dab maths (weight_paint.ts)
Math.hermiteBlend = t => 3 * t * t - 2 * t * t * t; // as util/math_util.js
const docListeners = {};
const document = {
	addEventListener: (e, f) => { (docListeners[e] = docListeners[e] || []).push(f); },
	removeEventListener: (e, f) => { docListeners[e] = (docListeners[e] || []).filter(x => x !== f); },
};
const pointerUp = () => (docListeners.pointerup || []).slice().forEach(f => f({}));
class ArmatureBone {
	constructor(name, parent) { this.name = name; this.uuid = name + '-uuid'; this.parent = parent; this.vertex_weights = {}; }
	getArmature() { return armature; }
	getVertexWeight(m, vk) { return this.vertex_weights[m.uuid.slice(0, 6) + ':' + vk] || 0; }
	setVertexWeight(m, vk, w) { const k = m.uuid.slice(0, 6) + ':' + vk; if (!w) delete this.vertex_weights[k]; else this.vertex_weights[k] = w; }
}
const armature = { getAllBones: () => [head, lid] };
const head = new ArmatureBone('head', armature), lid = new ArmatureBone('lid_l', null);
lid.parent = head;
ArmatureBone.selected = [lid];
const mesh = { uuid: 'eyelid-1', vertices: { back: [0], front: [1] }, getArmature: () => armature };
const bbEvents = {};
let current = null;
const Undo = {
	get current_save() { return current; },
	initEdit(a) { current = { elements: Object.fromEntries(a.elements.map(b => [b.uuid, { vertex_weights: { ...b.vertex_weights } }])) }; },
	finishEdit(message) { (bbEvents.finish_edit || []).forEach(f => f({ message })); current = null; },
};
// One dab per call: copy of Blockbench's per-point formula, influence from Math.hermiteBlend.
function dab(points, subtract, falloff = 1) {
	for (const vk of points) {
		let influence = Math.hermiteBlend(Math.min(1, Math.max(0, falloff)));
		let value = lid.getVertexWeight(mesh, vk);
		value = subtract ? value * (1 - influence) : value + (1 - value) * influence;
		if (!subtract) { const o = head.getVertexWeight(mesh, vk); if (o) head.setVertexWeight(mesh, vk, Math.max(0, o - influence)); }
		lid.setVertexWeight(mesh, vk, value < 0.04 ? 0 : value);
	}
}
let strokeSpec = null;
const weightBrush = {
	onCanvasClick(data) {
		if (ctx.Preview.selected.controls.hasMoved) { this.skipped = true; } // first dab skipped, like Blockbench
		Undo.initEdit({ elements: [head, lid] });
		const stop = () => { document.removeEventListener('pointerup', stop); Undo.finishEdit('Paint vertex weights'); };
		document.addEventListener('pointerup', stop);
		for (let i = this.skipped ? 1 : 0; i < strokeSpec.dabs; i++) dab(strokeSpec.points, strokeSpec.subtract);
		this.skipped = false;
	},
};
const toolbar = { children: [], add(s, i) { this.children.splice(i, 0, s); }, remove(s) { this.children.splice(this.children.indexOf(s), 1); } };
let sliderValue = 25, registered, settingObj;
const ctx = {
	Plugin: { register: (id, o) => { registered = { id, o }; } }, BARS: {}, document, ArmatureBone, Undo,
	Mesh: { all: [mesh], preview_controller: { updateGeometry() {} } },
	Preview: { selected: { controls: { hasMoved: true } } },
	BarItems: { weight_brush: weightBrush }, Toolbars: { weight_brush: toolbar }, Toolbox: { selected: { id: 'weight_brush' } },
	NumSlider: class { constructor(id, o) { this.id = id; Object.assign(this, o); } get() { return sliderValue; } delete() { this.deleted = true; } },
	Setting: class { constructor(id, o) { this.id = id; Object.assign(this, o); settingObj = this; } delete() { this.deleted = true; } },
	Blockbench: { on: (e, f) => { (bbEvents[e] = bbEvents[e] || []).push(f); }, removeListener: (e, f) => { bbEvents[e] = bbEvents[e].filter(x => x !== f); } },
};
new Function(...Object.keys(ctx), fs.readFileSync(FILE, 'utf8'))(...Object.values(ctx));
const origHermite = Math.hermiteBlend;
registered.o.onload();
ok(toolbar.children[0].id === 'slider_weight_brush_strength' && settingObj.value === true, 'strength slider in the Weight Brush toolbar; hand-off on by default');
ok(Math.hermiteBlend(1) === 1, 'outside a stroke, hermiteBlend is untouched (other tools unaffected)');

// Before: one click at full falloff sets red (1) straight to... with Blockbench alone:
lid.vertex_weights = { 'eyelid:back': 1, 'eyelid:front': 1 };
ctx.Preview.selected.controls.hasMoved = true; // mouse just entered the view / camera was orbited
strokeSpec = { points: ['back'], subtract: true, dabs: 1 };
weightBrush.onCanvasClick({ event: {}, element: null });
const afterOne = lid.getVertexWeight(mesh, 'back');
pointerUp();
ok(near(afterOne, 0.75), 'one Ctrl-click at 25%: 1 → 0.75 (not straight to black)');
ok(Math.hermiteBlend(1) === 1, 'strength only applies during the stroke');
ok(near(head.getVertexWeight(mesh, 'back'), 0.25) && near(lid.getVertexWeight(mesh, 'back') + head.getVertexWeight(mesh, 'back'), 1), 'erased 0.25 handed to head: the point stays fully attached');

// Keep erasing until black: the back ends up fully on head.
strokeSpec = { points: ['back'], subtract: true, dabs: 12 };
weightBrush.onCanvasClick({ event: {}, element: null }); pointerUp();
ok(lid.getVertexWeight(mesh, 'back') === 0 && near(head.getVertexWeight(mesh, 'back'), 1), 'erased to black on lid_l = fully on head');
ok(lid.getVertexWeight(mesh, 'front') === 1, 'other points untouched');

// Adding (Set mode) moves weight between bones itself: no extra hand-off.
strokeSpec = { points: ['back'], subtract: false, dabs: 1 };
weightBrush.onCanvasClick({ event: {}, element: null }); pointerUp();
ok(near(lid.getVertexWeight(mesh, 'back'), 0.25) && near(head.getVertexWeight(mesh, 'back'), 0.75), 'painting back on at 25%: lid 0.25, head 0.75');

// Hand-off off: erased weight just disappears (Blockbench behaviour).
settingObj.value = false;
lid.vertex_weights = { 'eyelid:x': 1 }; head.vertex_weights = {};
mesh.vertices.x = [0];
strokeSpec = { points: ['x'], subtract: true, dabs: 1 };
weightBrush.onCanvasClick({ event: {}, element: null }); pointerUp();
ok(!head.getVertexWeight(mesh, 'x'), 'setting off: Blockbench\'s own erase');
settingObj.value = true;

// Alt-click (select bone) isn't a stroke.
weightBrush.onCanvasClick({ event: { altKey: true }, element: null }); pointerUp();

registered.o.onunload();
ok(Math.hermiteBlend === origHermite && weightBrush.onCanvasClick.name === 'onCanvasClick' && !toolbar.children.length && !bbEvents.finish_edit.length, 'unload restores everything');
console.log(`\n${pass} checks passed`);

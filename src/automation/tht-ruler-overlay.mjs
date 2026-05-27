import { AuraLayer } from "../layers/aura-layer/aura-layer.mjs";
import { isTerrainHeightToolsActive } from "../utils/misc-utils.mjs";

const _LINE_WIDTH = 4;
const _ALPHA = 0.75;
const _SAMPLE_PX = 10;
const _OVERLAY_NAME = "gaa-tht-ruler-overlay";

let _overlay = null;
let _activeRays = [];

function _getLosLayer() {
	return canvas?.terrainHeightLosRulerLayer
		?? canvas?.terrainHeightLosRulerLayer$
		?? canvas?.layers?.find?.(l => l?.constructor?.name === "LineOfSightRulerLayer")
		?? null;
}

function _ensureOverlay() {
	const layer = _getLosLayer();
	if (!layer) return null;
	if (!_overlay || _overlay.destroyed) {
		_overlay = new PIXI.Graphics();
		_overlay.name = _OVERLAY_NAME;
	}
	if (_overlay.parent !== layer) {
		try { _overlay.parent?.removeChild(_overlay); } catch { /* */ }
	}
	// Re-add every draw so we stay above newly-created ruler groups.
	layer.addChild(_overlay);
	return _overlay;
}

function _parseColor(hex) {
	if (typeof hex !== "string") return 0xffffff;
	const m = /#?([0-9a-f]{6})/i.exec(hex);
	return m ? parseInt(m[1], 16) : 0xffffff;
}

function* _interactingAuras() {
	const mgr = AuraLayer.current?._auraManager;
	if (!mgr?.getAllAuras) return;
	for (const { aura } of mgr.getAllAuras({ preview: false })) {
		const cfg = aura?.config;
		if (!cfg?.terrainHeightTools?.interactWithThtRuler) continue;
		if (!aura?.isVisible) continue;
		if (typeof aura.isWorldPointInside !== "function") continue;
		yield aura;
	}
}

function _paintRay(g, ax, ay, bx, by) {
	const dx = bx - ax;
	const dy = by - ay;
	const len = Math.hypot(dx, dy);
	if (len < 1) return;
	const steps = Math.max(2, Math.ceil(len / _SAMPLE_PX));
	const auras = [..._interactingAuras()];
	if (auras.length === 0) return;
	for (const aura of auras) {
		const color = _parseColor(aura.config?.lineColor ?? "#ffffff");
		g.lineStyle(_LINE_WIDTH, color, _ALPHA);
		let inside = false;
		let segStartX = 0;
		let segStartY = 0;
		for (let i = 0; i <= steps; i++) {
			const t = i / steps;
			const x = ax + dx * t;
			const y = ay + dy * t;
			const here = aura.isWorldPointInside(x, y);
			if (here && !inside) {
				segStartX = x;
				segStartY = y;
				inside = true;
			} else if (!here && inside) {
				g.moveTo(segStartX, segStartY);
				g.lineTo(x, y);
				inside = false;
			}
		}
		if (inside) {
			g.moveTo(segStartX, segStartY);
			g.lineTo(bx, by);
		}
	}
}

function _toCenterPoint(end) {
	if (!end) return null;
	if (end instanceof Token || end?.document) {
		return { x: end.x + (end.w ?? 0) / 2, y: end.y + (end.h ?? 0) / 2 };
	}
	if (typeof end.x === "number" && typeof end.y === "number") return { x: end.x, y: end.y };
	return null;
}

function _redraw() {
	const g = _ensureOverlay();
	if (!g) return;
	g.clear();
	for (const ray of _activeRays) {
		const a = _toCenterPoint(ray?.a);
		const b = _toCenterPoint(ray?.b);
		if (!a || !b) continue;
		_paintRay(g, a.x, a.y, b.x, b.y);
	}
}

function _onRulerDraw(rulers) {
	_activeRays = Array.isArray(rulers) ? rulers.slice() : [];
	_redraw();
}

function _onRulerClear() {
	_activeRays = [];
	const g = _ensureOverlay();
	g?.clear?.();
}

export function setupThtRulerOverlay() {
	if (!isTerrainHeightToolsActive()) return;
	Hooks.on("canvasReady", () => {
		const layer = _getLosLayer();
		if (!layer) return;
		const proto = Object.getPrototypeOf(layer);
		if (proto._gaaWrapped) return;
		const origDraw = proto._drawLineOfSightRays;
		const origClear = proto._clearLineOfSightRays;
		if (typeof origDraw === "function") {
			proto._drawLineOfSightRays = function patched(rulers, ...rest) {
				const result = origDraw.call(this, rulers, ...rest);
				try { _onRulerDraw(rulers); } catch (e) { console.warn("grid-aware-auras | THT ruler overlay draw failed", e); }
				return result;
			};
		}
		if (typeof origClear === "function") {
			proto._clearLineOfSightRays = function patched(...args) {
				const result = origClear.apply(this, args);
				try { _onRulerClear(); } catch (e) { console.warn("grid-aware-auras | THT ruler overlay clear failed", e); }
				return result;
			};
		}
		proto._gaaWrapped = true;
	});
	Hooks.on("canvasTearDown", () => {
		_overlay = null;
		_activeRays = [];
	});
	Hooks.on("refreshToken", () => _redraw());
}

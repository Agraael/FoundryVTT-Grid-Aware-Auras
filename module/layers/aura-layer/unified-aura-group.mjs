/** @import { Aura } from "./aura.mjs" */
/** @import { PathCommand } from "../../utils/pixi-utils.mjs" */
import { auraDefaults } from "../../data/aura.mjs";
import { LINE_TYPES } from "../../consts.mjs";
import { drawComplexPath, drawDashedComplexPath } from "../../utils/pixi-utils.mjs";

/**
 * @typedef {{ token: Token; aura: Aura; }} AuraEntry
 */

export class UnifiedAuraGroup {

	/** @type {string} */
	#name;

	/** @type {PIXI.Container} */
	#container;

	/** @type {AuraEntry[]} */
	#entries = [];

	/** @type {PIXI.RenderTexture[]} */
	#renderTextures = [];

	/** @type {PIXI.Graphics | null} */
	#lineGfx = null;

	/** @type {PathCommand[]} */
	#boundaryPath = [];

	/** @type {PathCommand[][]} */
	#innerBoundaryPaths = [];

	/** @type {import("../../data/aura.mjs").AuraConfig | null} */
	#lineConfig = null;

	/** @type {Aura | null} */
	#leadAura = null;
	#animating = false;
	#boundTick;

	/** @type {PIXI.Graphics | null} */
	#animFillGfx = null;

	/** @type {PIXI.Container | null} */
	#animFillContainer = null;

	/** @type {PIXI.RenderTexture | null} */
	#animFillRt = null;

	#animFillParams = null;

	/** @param {string} name */
	constructor(name) {
		this.#name = name;
		this.#container = new PIXI.Container();
		this.#container.sortLayer = 689;
		canvas.primary.addChild(this.#container);
		this.#boundTick = this.#tick.bind(this);
	}

	get name() { return this.#name; }

	/**
	 * @param {AuraEntry[]} entries
	 */
	async update(entries) {
		if (this.#animating) {
			canvas.app.ticker.remove(this.#boundTick);
			this.#animating = false;
		}

		for (const { aura } of this.#entries) {
			try { aura.suppressed = false; } catch (_) { /* aura may have been destroyed */ }
		}
		this.#entries = entries;

		for (const rt of this.#renderTextures) rt.destroy(true);
		this.#renderTextures = [];
		this.#container.removeChildren().forEach(c => c.destroy({ children: true }));
		this.#lineGfx = null;

		if (this.#animFillContainer) {
			this.#animFillContainer.destroy({ children: true });
			this.#animFillContainer = null;
			this.#animFillGfx = null;
		}
		this.#animFillRt = null;
		this.#animFillParams = null;

		const visibleEntries = entries.filter(({ aura }) => aura.isVisible);

		this.#container.visible = visibleEntries.length >= 2;
		this.#leadAura = null;
		if (visibleEntries.length < 2) return;

		this.#leadAura = visibleEntries[0].aura;

		for (const { aura } of visibleEntries) {
			aura.suppressed = true;
		}

		const worldPaths = visibleEntries.map(({ aura }) => [...aura.getWorldPath()]);
		const innerWorldPaths = visibleEntries.map(({ aura }) => [...aura.getInnerWorldPath()]);
		if (worldPaths.every(p => p.length === 0)) return;

		const config = { ...auraDefaults(), ...visibleEntries[0].aura.config };

		await this.#drawFill(worldPaths, innerWorldPaths, config);
		this.#drawOutline(worldPaths, innerWorldPaths, visibleEntries, config);

		if ((config.animation && this.#lineGfx) || (config.fillAnimation && this.#animFillGfx)) {
			canvas.app.ticker.add(this.#boundTick);
			this.#animating = true;
		}
	}

	updateVisibility() {
		const visibleCount = this.#entries.filter(({ aura }) => aura.isVisible).length;
		this.#container.visible = visibleCount >= 2;
	}

	destroy() {
		if (this.#animating) {
			canvas.app.ticker.remove(this.#boundTick);
			this.#animating = false;
		}
		for (const { aura } of this.#entries) {
			try { aura.suppressed = false; } catch (_) { /* aura may have been destroyed */ }
		}
		this.#entries = [];
		for (const rt of this.#renderTextures) rt.destroy(true);
		this.#renderTextures = [];
		if (this.#animFillContainer) {
			this.#animFillContainer.destroy({ children: true });
			this.#animFillContainer = null;
			this.#animFillGfx = null;
		}
		canvas.primary.removeChild(this.#container);
		this.#container.destroy({ children: true });
	}

	#tick() {
		if (!this.#leadAura) return;

		const config = this.#lineConfig;
		if (config && this.#lineGfx) {
			const animOffset = this.#leadAura.animationOffset;

			if (config.animationType === "pulse") {
				const baseOpacity = config.lineOpacity ?? 1;
				const sinVal = (Math.sin(animOffset * 0.1) + 1) / 2;
				const alpha = config.pulseToMax
					? baseOpacity + (sinVal * (1 - baseOpacity))
					: 0.2 + (sinVal * (baseOpacity - 0.2));
				this.#lineGfx.alpha = alpha;
			} else if (config.lineType === LINE_TYPES.DASHED) {
				this.#lineGfx.clear();
				this.#lineGfx.lineStyle({
					color: Color.from(config.lineColor ?? "#000000"),
					alpha: config.lineOpacity ?? 0,
					width: config.lineWidth ?? 0,
					alignment: 0
				});
				const dashOpts = {
					dashSize: config.lineDashSize ?? 15,
					gapSize: config.lineGapSize ?? 10,
					offset: animOffset
				};
				drawDashedComplexPath(this.#lineGfx, this.#boundaryPath, dashOpts);
				for (const innerPath of this.#innerBoundaryPaths) {
					drawDashedComplexPath(this.#lineGfx, innerPath, dashOpts);
				}
			}
		}

		if (this.#animFillGfx && this.#animFillParams) {
			const { worldPaths, innerWorldPaths, texture, fillConfig, containerX, containerY } = this.#animFillParams;
			const animOffset = this.#leadAura.fillAnimationOffset;
			const { x: xOffset, y: yOffset } = fillConfig.fillTextureOffset ?? { x: 0, y: 0 };
			const { x: xScale, y: yScale } = fillConfig.fillTextureScale ?? { x: 100, y: 100 };
			const matrix = new PIXI.Matrix(
				xScale / 100, 0, 0, yScale / 100,
				xOffset + animOffset.x + containerX,
				yOffset + animOffset.y + containerY
			);
			// Render each aura's donut individually with OVER compositing (same logic as #drawFill).
			let isFirst = true;
			for (let i = 0; i < worldPaths.length; i++) {
				if (worldPaths[i].length === 0) continue;
				this.#animFillGfx.clear();
				this.#animFillGfx.beginTextureFill({
					texture,
					color: Color.from(fillConfig.fillColor ?? "#ffffff"),
					alpha: 1.0,
					matrix
				});
				drawComplexPath(this.#animFillGfx, worldPaths[i]);
				if (innerWorldPaths[i]?.length > 0) {
					this.#animFillGfx.beginHole();
					drawComplexPath(this.#animFillGfx, innerWorldPaths[i]);
					this.#animFillGfx.endHole();
				}
				this.#animFillGfx.endFill();
				canvas.app.renderer.render(this.#animFillContainer, { renderTexture: this.#animFillRt, clear: isFirst });
				isFirst = false;
			}
		}
	}

	/**
	 * @param {PathCommand[][]} worldPaths
	 * @param {PathCommand[][]} innerWorldPaths
	 * @param {import("../../data/aura.mjs").AuraConfig} config
	 */
	async #drawFill(worldPaths, innerWorldPaths, config) {
		if (config.fillType === CONST.DRAWING_FILL_TYPES.NONE) return;
		if ((config.fillOpacity ?? 0) <= 0) return;

		const bounds = this.#computeBounds(worldPaths);
		if (!bounds) return;

		const padding = 2;
		const rtW = Math.max(1, Math.ceil(bounds.width) + padding * 2);
		const rtH = Math.max(1, Math.ceil(bounds.height) + padding * 2);

		const rt = PIXI.RenderTexture.create({ width: rtW, height: rtH, resolution: 1 });
		this.#renderTextures.push(rt);

		const containerX = -(bounds.x - padding);
		const containerY = -(bounds.y - padding);

		// Render each aura's donut (outer with inner hole) individually, compositing with OVER blend.
		// This way the outer fill of aura B naturally fills the inner hole of aura A where they overlap,
		// rather than punching a global hole through the combined shape.
		if (config.fillType === CONST.DRAWING_FILL_TYPES.SOLID) {
			let isFirst = true;
			for (let i = 0; i < worldPaths.length; i++) {
				if (worldPaths[i].length === 0) continue;
				const tmpContainer = new PIXI.Container();
				tmpContainer.x = containerX;
				tmpContainer.y = containerY;
				const tmpGfx = new PIXI.Graphics();
				tmpGfx.beginFill(0xffffff, 1.0);
				drawComplexPath(tmpGfx, worldPaths[i]);
				if (innerWorldPaths[i]?.length > 0) {
					tmpGfx.beginHole();
					drawComplexPath(tmpGfx, innerWorldPaths[i]);
					tmpGfx.endHole();
				}
				tmpGfx.endFill();
				tmpContainer.addChild(tmpGfx);
				canvas.app.renderer.render(tmpContainer, { renderTexture: rt, clear: isFirst });
				isFirst = false;
				tmpContainer.destroy({ children: true });
			}

		} else if (config.fillType === CONST.DRAWING_FILL_TYPES.PATTERN) {
			const texture = config.fillTexture ? await loadTexture(config.fillTexture) : null;
			if (!texture) return;
			const { x: xOffset, y: yOffset } = config.fillTextureOffset ?? { x: 0, y: 0 };
			const { x: xScale, y: yScale } = config.fillTextureScale ?? { x: 100, y: 100 };
			const matrix = new PIXI.Matrix(
				xScale / 100, 0, 0, yScale / 100,
				xOffset + containerX,
				yOffset + containerY
			);
			let isFirst = true;
			for (let i = 0; i < worldPaths.length; i++) {
				if (worldPaths[i].length === 0) continue;
				const tmpContainer = new PIXI.Container();
				tmpContainer.x = containerX;
				tmpContainer.y = containerY;
				const tmpGfx = new PIXI.Graphics();
				tmpGfx.beginTextureFill({
					texture,
					color: Color.from(config.fillColor ?? "#ffffff"),
					alpha: 1.0,
					matrix
				});
				drawComplexPath(tmpGfx, worldPaths[i]);
				if (innerWorldPaths[i]?.length > 0) {
					tmpGfx.beginHole();
					drawComplexPath(tmpGfx, innerWorldPaths[i]);
					tmpGfx.endHole();
				}
				tmpGfx.endFill();
				tmpContainer.addChild(tmpGfx);
				canvas.app.renderer.render(tmpContainer, { renderTexture: rt, clear: isFirst });
				isFirst = false;
				tmpContainer.destroy({ children: true });
			}

			if (config.fillAnimation) {
				this.#animFillGfx = new PIXI.Graphics();
				this.#animFillContainer = new PIXI.Container();
				this.#animFillContainer.x = containerX;
				this.#animFillContainer.y = containerY;
				this.#animFillContainer.addChild(this.#animFillGfx);
				this.#animFillRt = rt;
				this.#animFillParams = { worldPaths, innerWorldPaths, texture, fillConfig: config, containerX, containerY };
			}
		}

		const sprite = new PIXI.Sprite(rt);
		sprite.x = bounds.x - padding;
		sprite.y = bounds.y - padding;
		sprite.alpha = config.fillOpacity ?? 0;
		if (config.fillType === CONST.DRAWING_FILL_TYPES.SOLID) {
			sprite.tint = Color.from(config.fillColor ?? "#ffffff").valueOf();
		}
		this.#container.addChild(sprite);
	}

	/**
	 * @param {PathCommand[][]} worldPaths
	 * @param {PathCommand[][]} innerWorldPaths
	 * @param {AuraEntry[]} entries
	 * @param {import("../../data/aura.mjs").AuraConfig} config
	 */
	#drawOutline(worldPaths, innerWorldPaths, entries, config) {
		if (config.lineType === LINE_TYPES.NONE) return;
		if ((config.lineOpacity ?? 0) <= 0) return;

		this.#lineGfx = new PIXI.Graphics();
		this.#lineGfx.lineStyle({
			color: Color.from(config.lineColor ?? "#000000"),
			alpha: config.lineOpacity ?? 0,
			width: config.lineWidth ?? 0,
			alignment: 0
		});
		this.#lineConfig = config;
		this.#boundaryPath = [];
		this.#innerBoundaryPaths = [];

		const nudge = canvas.grid.size * 0.5;

		// Outer boundary — only draw edges that aren't interior to another aura
		for (let i = 0; i < worldPaths.length; i++) {
			const verts = this.#pathToVerts(worldPaths[i]);
			if (verts.length < 2) continue;

			const token = entries[i].token;
			const icx = token.x + token.document.width * canvas.grid.size / 2;
			const icy = token.y + token.document.height * canvas.grid.size / 2;

			let inRun = false;
			for (let e = 0; e < verts.length - 1; e++) {
				const p1 = verts[e];
				const p2 = verts[e + 1];
				const mx = (p1.x + p2.x) / 2;
				const my = (p1.y + p2.y) / 2;

				const dx = mx - icx;
				const dy = my - icy;
				const len = Math.sqrt(dx * dx + dy * dy);
				const tx = len > 0 ? mx + (dx / len) * nudge : mx;
				const ty = len > 0 ? my + (dy / len) * nudge : my;

				let isInterior = false;
				for (let j = 0; j < entries.length; j++) {
					if (j === i) continue;
					if (entries[j].aura.isWorldPointInside(tx, ty)) {
						isInterior = true;
						break;
					}
				}

				if (!isInterior) {
					if (!inRun) {
						this.#boundaryPath.push({ type: "m", x: p1.x, y: p1.y });
						inRun = true;
					}
					this.#boundaryPath.push({ type: "l", x: p2.x, y: p2.y });
				} else {
					inRun = false;
				}
			}
		}

		// Inner borders — only draw edges where the hole side is NOT filled by another aura's outer ring.
		// The "hole side" of an inner border edge is the inward direction (toward the token center).
		for (let i = 0; i < innerWorldPaths.length; i++) {
			const innerPath = innerWorldPaths[i];
			if (innerPath.length === 0) continue;

			const verts = this.#pathToVerts(innerPath);
			if (verts.length < 2) continue;

			const token = entries[i].token;
			const icx = token.x + token.document.width * canvas.grid.size / 2;
			const icy = token.y + token.document.height * canvas.grid.size / 2;

			/** @type {PathCommand[]} */
			const innerBoundPath = [];
			let innerRun = false;

			for (let e = 0; e < verts.length - 1; e++) {
				const p1 = verts[e];
				const p2 = verts[e + 1];
				const mx = (p1.x + p2.x) / 2;
				const my = (p1.y + p2.y) / 2;

				// Nudge toward token center — this is the "hole side" of the inner border
				const dx = icx - mx;
				const dy = icy - my;
				const len = Math.sqrt(dx * dx + dy * dy);
				const tx = len > 0 ? mx + (dx / len) * nudge : mx;
				const ty = len > 0 ? my + (dy / len) * nudge : my;

				// If another aura's outer fill covers the hole side, this edge is not a visible boundary
				let isCovered = false;
				for (let j = 0; j < entries.length; j++) {
					if (j === i) continue;
					if (entries[j].aura.isWorldPointInside(tx, ty)) {
						isCovered = true;
						break;
					}
				}

				if (!isCovered) {
					if (!innerRun) {
						innerBoundPath.push({ type: "m", x: p1.x, y: p1.y });
						innerRun = true;
					}
					innerBoundPath.push({ type: "l", x: p2.x, y: p2.y });
				} else {
					innerRun = false;
				}
			}

			if (innerBoundPath.length > 0) {
				this.#innerBoundaryPaths.push(innerBoundPath);
			}
		}

		const dashOpts = config.lineType === LINE_TYPES.DASHED
			? { dashSize: config.lineDashSize ?? 15, gapSize: config.lineGapSize ?? 10 }
			: null;

		if (dashOpts) {
			drawDashedComplexPath(this.#lineGfx, this.#boundaryPath, dashOpts);
			for (const innerPath of this.#innerBoundaryPaths) {
				drawDashedComplexPath(this.#lineGfx, innerPath, dashOpts);
			}
		} else {
			drawComplexPath(this.#lineGfx, this.#boundaryPath);
			for (const innerPath of this.#innerBoundaryPaths) {
				drawComplexPath(this.#lineGfx, innerPath);
			}
		}

		this.#container.addChild(this.#lineGfx);
	}

	/**
	 * @param {PathCommand[]} path
	 * @returns {{ x: number; y: number }[]}
	 */
	#pathToVerts(path) {
		/** @type {{ x: number; y: number }[]} */
		const verts = [];
		for (const cmd of path) {
			if (cmd.type === "m" || cmd.type === "l" || cmd.type === "a") {
				verts.push({ x: cmd.x, y: cmd.y });
			}
		}
		return verts;
	}

	/**
	 * @param {PathCommand[][]} worldPaths
	 */
	#computeBounds(worldPaths) {
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const path of worldPaths) {
			for (const cmd of path) {
				if ("x" in cmd) { minX = Math.min(minX, cmd.x); maxX = Math.max(maxX, cmd.x); }
				if ("y" in cmd) { minY = Math.min(minY, cmd.y); maxY = Math.max(maxY, cmd.y); }
			}
		}
		return isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
	}
}

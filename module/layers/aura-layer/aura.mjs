/** @import { AuraConfig, AuraConfigWithRadius } from "../../data/aura.mjs" */
/** @import { AuraGeometry } from "./geometry/index.mjs" */
import { LINE_TYPES, MODULE_NAME, SQUARE_GRID_MODE_SETTING } from "../../consts.mjs";
import { auraDefaults, auraVisibilityDefaults } from "../../data/aura.mjs";
import { isKeyPressed } from "../../main.mjs";
import { pickProperties } from "../../utils/misc-utils.mjs";
import { drawComplexPath, drawDashedComplexPath } from "../../utils/pixi-utils.mjs";
import { GridlessAuraGeometry, HexagonalAuraGeometry, SquareAuraGeometry } from "./geometry/index.mjs";

/**
 * Class that manages a single aura.
 */
export class Aura {

	/** @type {Token} */
	#token;

	/** @type {AuraConfig} */
	#config;

	/** @type {number | undefined} */
	#radius;

	/** @type {number | undefined} */
	#innerRadius;

	#isVisible = false;

	#animationOffset = 0;
	#fillAnimationOffset = { x: 0, y: 0 };
	#animating = false;
	#boundTick;

	#suppressed = false;

	/** @type {PIXI.Graphics} */
	#graphics;

	/** @type {PIXI.Graphics} */
	#fillGraphics;

	/** @type {PIXI.Graphics} */
	#lineGraphics;

	/**
	 * The geometry of the aura, relative to the token position.
	 * Will be null if there is no valid geometry.
	 * @type {AuraGeometry | null}
	 */
	#geometry = null;

	/**
	 * The inner geometry of the aura (its hole), relative to the token position.
	 * Will be null if there is no hole.
	 * @type {AuraGeometry | null}
	 */
	#innerGeometry = null;

	/** @param {Token} token */
	constructor(token) {
		this.#token = token;
		this.#graphics = new PIXI.Graphics();
		this.#graphics.sortLayer = 690; // Render just below tokens

		this.#fillGraphics = new PIXI.Graphics();
		this.#lineGraphics = new PIXI.Graphics();
		this.#graphics.addChild(this.#fillGraphics);
		this.#graphics.addChild(this.#lineGraphics);

		this.#boundTick = this.#tick.bind(this);
	}

	get graphics() {
		return this.#graphics;
	}

	get config() {
		return this.#config;
	}

	get isVisible() {
		return this.#isVisible;
	}

	set suppressed(value) {
		this.#suppressed = value;
		this.updateVisibility();
	}

	isWorldPointInside(wx, wy) {
		if (!this.#geometry?._isPointInside) return false;
		const lx = wx - this.#graphics.x - this.#fillGraphics.position.x;
		const ly = wy - this.#graphics.y - this.#fillGraphics.position.y;
		if (!this.#geometry._isPointInside(lx, ly)) return false;
		// Points inside the inner hole are not actually filled
		if (this.#innerGeometry?._isPointInside?.(lx, ly)) return false;
		return true;
	}

	/**
	 * Yields the geometry path translated to world coordinates.
	 * @yields {import("../../utils/pixi-utils.mjs").PathCommand}
	 */
	*getWorldPath() {
		if (!this.#geometry) return;
		const ox = this.#graphics.x + this.#fillGraphics.position.x;
		const oy = this.#graphics.y + this.#fillGraphics.position.y;
		for (const cmd of this.#geometry.getPath()) {
			if (cmd.type === "a") {
				yield { type: "a", x: cmd.x + ox, y: cmd.y + oy, tx: cmd.tx + ox, ty: cmd.ty + oy, r: cmd.r };
			} else {
				yield { type: cmd.type, x: cmd.x + ox, y: cmd.y + oy };
			}
		}
	}

	/**
	 * Yields the inner geometry (hole) path translated to world coordinates.
	 * Returns nothing if this aura has no inner radius.
	 * @yields {import("../../utils/pixi-utils.mjs").PathCommand}
	 */
	*getInnerWorldPath() {
		if (!this.#innerGeometry) return;
		const ox = this.#graphics.x + this.#fillGraphics.position.x;
		const oy = this.#graphics.y + this.#fillGraphics.position.y;
		for (const cmd of this.#innerGeometry.getPath()) {
			if (cmd.type === "a") {
				yield { type: "a", x: cmd.x + ox, y: cmd.y + oy, tx: cmd.tx + ox, ty: cmd.ty + oy, r: cmd.r };
			} else {
				yield { type: cmd.type, x: cmd.x + ox, y: cmd.y + oy };
			}
		}
	}

	/**
	 * Updates this aura graphic, and redraws it if required.
	 * @param {AuraConfigWithRadius} config
	 * @param {Object} [options]
	 * @param {Record<string, any>} [options.tokenDelta] If provided, uses the properties from this instead of the token
	 * @param {boolean} [options.force] Force a redraw, even if no aura properties have changed.
	*/
	update(config, { tokenDelta, force = false } = {}) {
		const shouldRedraw = force ||
			this.#config !== config ||
			this.#radius !== config.radiusCalculated ||
			this.#innerRadius !== config.innerRadiusCalculated ||
			(tokenDelta && (
				"width" in tokenDelta ||
				"height" in tokenDelta ||
				"hexagonalShape" in tokenDelta
			));

		this.#config = config;
		this.#radius = config.radiusCalculated;
		this.#innerRadius = config.innerRadiusCalculated;

		this.updatePosition({ tokenDelta });

		// If a relevant property has changed, do a redraw
		if (shouldRedraw || force) {
			const { width, height, hexagonalShape } = pickProperties(["width", "height", "hexagonalShape"], tokenDelta, this.#token.document);
			this.#redraw(width, height, config.radiusCalculated, config.innerRadiusCalculated, hexagonalShape);
		}

		this.updateVisibility();
	}

	/**
	 * @param {Object} [options]
	 * @param {Record<string, any>} [options.tokenDelta] If provided, uses the properties from this instead of the token
	 */
	updatePosition({ tokenDelta } = {}) {
		Object.assign(this.#graphics, this.#getOffset(tokenDelta, this.#token));
		this.#graphics.elevation = tokenDelta?.elevation ?? this.#token.document.elevation;
	}

	get animationOffset() { return this.#animationOffset; }
	get fillAnimationOffset() { return this.#fillAnimationOffset; }

	updateVisibility() {
		this.#isVisible = this.#getVisibility();
		this.#graphics.alpha = (this.#isVisible && !this.#suppressed) ? 1 : 0;

		// Handle animation state - suppressed auras still tick to advance offset for the unified group
		let shouldAnimate = this.#isVisible && (this.#config.animation === true || this.#config.fillAnimation === true);
		if (shouldAnimate && !this.#suppressed && this.#config.animationWhenSelected && !this.#token.controlled) {
			shouldAnimate = false;
		}

		if (shouldAnimate && !this.#animating) {
			canvas.app.ticker.add(this.#boundTick);
			this.#animating = true;
		} else if (!shouldAnimate && this.#animating) {
			canvas.app.ticker.remove(this.#boundTick);
			this.#animating = false;
			// Reset opacity to base value when animation stops
			this.#lineGraphics.alpha = this.#config.lineOpacity ?? 1;
		}
	}

	#tick(_dt) {
		if (!this.#isVisible) return;

		if (this.#config.animation) {
			const speed = this.#config.animationSpeed ?? 1;
			const type = this.#config.animationType ?? "scroll";

			if (type === "pulse") {
				this.#animationOffset -= speed;
				if (!this.#suppressed) {
					const baseOpacity = this.#config.lineOpacity ?? 1;
					const sinVal = (Math.sin(this.#animationOffset * 0.1) + 1) / 2;

					let alpha;
					if (this.#config.pulseToMax) {
						alpha = baseOpacity + (sinVal * (1 - baseOpacity));
					} else {
						alpha = 0.2 + (sinVal * (baseOpacity - 0.2));
					}

					this.#lineGraphics.alpha = alpha;
				}
			} else {
				// Scroll
				this.#animationOffset -= speed;
				if (!this.#suppressed) {
					this.#lineGraphics.alpha = 1;
				}
			}
		}

		if (this.#config.fillAnimation) {
			const speed = this.#config.fillAnimationSpeed ?? 0;
			const angle = (this.#config.fillAnimationAngle ?? 0) * (Math.PI / 180);

			this.#fillAnimationOffset.x += Math.cos(angle) * speed;
			this.#fillAnimationOffset.y += Math.sin(angle) * speed;
		}

		if (this.#suppressed) return;

		if (this.#geometry) {
			const width = this.#token.document.width;
			const height = this.#token.document.height;
			const radius = this.#radius;
			const hexagonalShape = this.#token.document.hexagonalShape;

			const type = this.#config.animationType ?? "scroll";
			if ((this.#config.animation && type === "scroll") || this.#config.fillAnimation) {
				this.#redraw(width, height, radius, this.#innerRadius, hexagonalShape);
			}
		}
	}

	/**
	 * Determines whether the given coordinate is inside this aura or not.
	 * @param {Token} targetToken
	 * @param {Object} [options]
	 * @param {{ x?: number; y?: number; }} [options.sourceTokenPosition] If provided, treats the token that owns the
	 * aura as being at this position. If not provided, falls back to the Token or TokenDocument position.
	 * @param {boolean} [options.useActualSourcePosition] If false (default), uses the position of the token document.
	 * If true, uses the actual position of the token on the canvas.
	 * @param {{ x: number; y: number }} [options.targetTokenPosition] If provided, treats the target token as if it
	 * were at these coordinates instead.
	 */
	isInside(targetToken, { sourceTokenPosition, useActualSourcePosition = false, targetTokenPosition } = {}) {
		if (!this.#geometry) return false;

		// Need to offset by token position, as the geometry is relative to token position, not relative to canvas pos
		const auraOffset = this.#getOffset(sourceTokenPosition, useActualSourcePosition ? this.#token : this.#token.document);

		// Token is inside the aura if it is partially inside the outer geometry and not totally inside the inner geometry.
		return this.#geometry.isInside(targetToken, { auraOffset, tokenAltPosition: targetTokenPosition, mode: "partial" })
			&& !this.#innerGeometry?.isInside(targetToken, { auraOffset, tokenAltPosition: targetTokenPosition, mode: "total" });
	}

	destroy() {
		canvas.app.ticker.remove(this.#boundTick);
		this.#graphics.destroy();
	}

	/**
	 * @param {number} width
	 * @param {number} height
	 * @param {number} radius
	 * @param {number} innerRadius
	 * @param {number} hexagonalShape
	 */
	async #redraw(width, height, radius, innerRadius, hexagonalShape) {
		const auraConfig = { ...auraDefaults(), ...this.#config };

		// If there is a positional offset (i.e. aura is non-central), then use 0 as the effective token width/height.
		if (this.#getPositionOffset()) {
			width = 0;
			height = 0;
		} else {
			width ??= this.#token.document.width;
			height ??= this.#token.document.height;
		}

		hexagonalShape ??= this.#token.document.hexagonalShape;

		// Auras with negative radii are not rendered, neither are those where the innerRadius >= radius.
		if (typeof radius !== "number" || radius < 0 || (typeof innerRadius === "number" && innerRadius >= radius)) {
			this.#fillGraphics.clear();
			this.#lineGraphics.clear();
			this.#geometry = null;
			this.#innerGeometry = null;
			return;
		}

		// Set an upper limit for radius.
		// This is fairly arbitrary, but if it's too high, the browser can crash trying to generate geometry.
		radius = Math.min(radius, 1000);

		// Calculate modified grid size for pixel offset scaling (radiusOffset feature)
		const offset = this.#config.radiusOffset ?? 0;
		const effectiveRadius = radius + (Math.max(width, height) / 2);
		const scaleFactor = effectiveRadius > 0 ? (offset / effectiveRadius) : 0;
		const modifiedGridSize = canvas.grid.size + scaleFactor;

		this.#geometry = createGeometry(radius, modifiedGridSize);
		this.#innerGeometry = typeof innerRadius === "number" && innerRadius >= 0
			? createGeometry(innerRadius, modifiedGridSize)
			: null;

		// Compensate for center shift due to scaling from top-left (0,0)
		const dx = -(width / 2) * scaleFactor;
		const dy = -(height / 2) * scaleFactor;
		this.#fillGraphics.position.set(dx, dy);
		this.#lineGraphics.position.set(dx, dy);

		if (!this.#geometry) {
			this.#fillGraphics.clear();
			this.#lineGraphics.clear();
			return;
		}

		// Handle Glow
		if (auraConfig.lineGlow) {
			const strength = auraConfig.lineGlowStrength ?? 10;
			if (!this.#lineGraphics.filters?.length) {
				this.#lineGraphics.filters = [new PIXI.filters.BlurFilter(strength)];
			} else {
				const filter = this.#lineGraphics.filters[0];
				if (filter instanceof PIXI.filters.BlurFilter) {
					filter.blur = strength;
				}
			}
		} else {
			this.#lineGraphics.filters = null;
		}

		// Load the texture BEFORE clearing, otherwise there's a noticeable flash every time something is changed.
		const texture = auraConfig.fillType === CONST.DRAWING_FILL_TYPES.PATTERN
			? await loadTexture(auraConfig.fillTexture)
			: null;

		this.#fillGraphics.clear();
		this.#lineGraphics.clear();

		// 1. Fill (with inner radius hole if applicable)
		const fillConfig = { ...auraConfig, fillTexture: texture };
		if (this.#config.fillAnimation) {
			fillConfig.fillTextureOffset = {
				x: auraConfig.fillTextureOffset.x + this.#fillAnimationOffset.x,
				y: auraConfig.fillTextureOffset.y + this.#fillAnimationOffset.y
			};
		}

		this.#configureFillStyle(fillConfig);
		drawComplexPath(this.#fillGraphics, this.#geometry.getPath());
		if (this.#innerGeometry) {
			this.#fillGraphics.beginHole();
			drawComplexPath(this.#fillGraphics, this.#innerGeometry.getPath());
			this.#fillGraphics.endHole();
		}
		this.#fillGraphics.endFill();

		// 2. Borders
		this.#configureLineStyle(auraConfig);
		if (auraConfig.lineType === LINE_TYPES.DASHED) {
			const dashConfig = { dashSize: auraConfig.lineDashSize, gapSize: auraConfig.lineGapSize, offset: this.#animationOffset };
			drawDashedComplexPath(this.#lineGraphics, this.#geometry.getPath(), dashConfig);
			if (this.#innerGeometry)
				drawDashedComplexPath(this.#lineGraphics, this.#innerGeometry.getPath(), dashConfig);
		} else if (auraConfig.lineType === LINE_TYPES.SOLID) {
			drawComplexPath(this.#lineGraphics, this.#geometry.getPath());
			if (this.#innerGeometry)
				drawComplexPath(this.#lineGraphics, this.#innerGeometry.getPath());
		}

		return;

		/**
		 * Creates a geometry of the specified radius for the current grid type and scoped token size/shape.
		 * @param {number} r
		 * @param {number} gridSize
		 */
		function createGeometry(r, gridSize) {
			switch (canvas.grid.type) {
				case CONST.GRID_TYPES.GRIDLESS:
					return new GridlessAuraGeometry(width, height, r, gridSize);

				case CONST.GRID_TYPES.SQUARE:
					return new SquareAuraGeometry(
						width,
						height,
						r,
						game.settings.get(MODULE_NAME, SQUARE_GRID_MODE_SETTING),
						gridSize
					);

				default: // hexagonal
					return new HexagonalAuraGeometry(
						width,
						height,
						r,
						hexagonalShape,
						[CONST.GRID_TYPES.HEXEVENQ, CONST.GRID_TYPES.HEXODDQ].includes(canvas.grid.type),
						gridSize
					);
			}
		}
	}

	/**
	 * Gets the render offset for the aura graphics.
	 * Will use the first X and Y positions found in the positions array as the token's current position.
	 * @param {...{ x?: number; y?: number; }?} positions
	 */
	#getOffset(...positions) {
		/** @type {{ x: number; y: number }} */
		let { x, y } = pickProperties(["x", "y"], ...positions);

		// If the token has a size of < 1 on a non-gridless scene, snap the aura to the nearest grid cell
		const { width, height } = this.#token.document;
		if ((width < 1 || height < 1) && canvas.grid.type !== CONST.GRID_TYPES.GRIDLESS) {
			const gridCoords = canvas.grid.getOffset({
				x: x + (this.#token.w / 2),
				y: y + (this.#token.h / 2)
			});

			({ x, y } = canvas.grid.getTopLeftPoint(gridCoords));
		}

		// If the position of the aura is non-central, then apply the relevant offset
		const positionOffset = this.#getPositionOffset();
		if (positionOffset !== undefined) {
			x += Math.max(width, 1) * positionOffset.x * canvas.grid.sizeX;
			y += Math.max(height, 1) * positionOffset.y * canvas.grid.sizeY;
		}

		return { x, y };
	}

	/** Gets the x and y offset as determined by the "position" config alone. */
	#getPositionOffset() {
		if (canvas.grid.type !== CONST.GRID_TYPES.SQUARE)
			return;

		const position = this.#config?.position;
		switch (position) {
			case "TOP_LEFT": return { x: 0, y: 0 };
			case "TOP_RIGHT": return { x: 1, y: 0 };
			case "BOTTOM_RIGHT": return { x: 1, y: 1 };
			case "BOTTOM_LEFT": return { x: 0, y: 1 };
		}
	}

	/**
	 * Determines whether this aura should be visible, based on it's config and assigned token.
	 */
	#getVisibility() {
		// If token is hidden or set as invisible in config, then it is definitely not visible
		if (!this.#token.visible || this.#token.hasPreview || !this.#config.enabled) {
			return false;
		}

		// If aura should only be enabled in combat, hide it when there's no active combat
		if (this.#config.onlyEnabledInCombat) {
			const isCombatActive = game.combat?.started ?? false;
			if (!isCombatActive) return false;
		}

		// Check if key is pressed
		const keyPressed = isKeyPressed(this.#config.keyToPress);

		// ONLY_WHEN_PRESSED: if the key is not held, never show regardless of any other condition
		if (this.#config.keyPressMode === "ONLY_WHEN_PRESSED" && !keyPressed) {
			return false;
		}

		// ALSO_WHEN_PRESSED: if the key is held, always show regardless of other conditions
		if (this.#config.keyPressMode === "ALSO_WHEN_PRESSED" && keyPressed) {
			return true;
		}

		// Otherwise, determine the visibility based on either ownerVisibility or nonOwnerVisibility, depending on the
		// user's relationship to the token.
		//
		// For all flags other than default (e.g. targeted, hovered, etc.), we see if any of them are relevant now.
		// If any of the relevant ones are true, then the aura should be visible (OR logic).
		// Otherwise, if there are no relevant states (i.e. the token is not targeted AND not hovered, etc.) then use
		// the default visibility.
		// We use mergeObject so that if new states are added in future, they have their defaults handled correctly.
		const visibility = foundry.utils.mergeObject(
			auraVisibilityDefaults,
			this.#token.isOwner ? this.#config.ownerVisibility : this.#config.nonOwnerVisibility,
			{ inplace: false }
		);

		let hasRelevantNonDefaultState = false;

		if (this.#token.hover) {
			if (visibility.hovered) return true;
			hasRelevantNonDefaultState = true;
		}

		if (this.#token.controlled) {
			if (visibility.controlled) return true;
			hasRelevantNonDefaultState = true;
		}

		if (this.#token.isPreview) {
			if (visibility.dragging) return true;
			hasRelevantNonDefaultState = true;
		}

		if (this.#token.isTargeted) {
			if (visibility.targeted) return true;
			hasRelevantNonDefaultState = true;
		}

		if (this.#token.inCombat && this.#token.combatant?.combat?.current?.tokenId === this.#token.id) {
			if (visibility.turn) return true;
			hasRelevantNonDefaultState = true;
		}

		return !hasRelevantNonDefaultState && visibility.default;
	}

	/**
	 * Configures the line style for this graphics instance based on the given values.
	 */
	#configureLineStyle({
		lineType = LINE_TYPES.NONE, lineWidth = 0, lineColor = "#000000", lineOpacity = 0
	} = {}) {
		this.#lineGraphics.lineStyle({
			color: Color.from(lineColor),
			alpha: lineOpacity,
			width: lineType === LINE_TYPES.NONE ? 0 : lineWidth,
			alignment: 0
		});
	}

	/**
	 * Configures the fill style for this graphics instance based on the given values.
	 */
	#configureFillStyle({
		fillType = CONST.DRAWING_FILL_TYPES.NONE, fillColor = "#000000", fillOpacity = 0, fillTexture = undefined, fillTextureOffset = { x: 0, y: 0 }, fillTextureScale = { x: 0, y: 0 }
	} = {}) {
		const color = Color.from(fillColor ?? "#000000");
		if (fillType === CONST.DRAWING_FILL_TYPES.SOLID) {
			this.#fillGraphics.beginFill(fillColor, fillOpacity);
		} else if (fillType === CONST.DRAWING_FILL_TYPES.PATTERN && fillTexture) {
			const { x: xOffset, y: yOffset } = fillTextureOffset;
			const { x: xScale, y: yScale } = fillTextureScale;
			this.#fillGraphics.beginTextureFill({
				texture: fillTexture,
				color,
				alpha: fillOpacity,
				matrix: new PIXI.Matrix(xScale / 100, 0, 0, yScale / 100, xOffset, yOffset)
			});
		} else { // NONE
			this.#fillGraphics.beginFill(0x000000, 0);
		}
	}
}

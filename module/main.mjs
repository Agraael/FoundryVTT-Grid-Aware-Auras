import * as api from "./api.mjs";
import { addAuraConfigItemHeaderButton } from "./applications/item-aura-config.mjs";
import { tokenConfigClose, v12TokenConfigRenderInner, v13TokenConfigRender } from "./applications/token-aura-config.mjs";
import { setupAutomation } from "./automation/index.mjs";
import { DOCUMENT_AURAS_FLAG, END_MOVE_INSIDE_AURA_HOOK, MODULE_NAME, SOCKET_NAME, START_MOVE_INSIDE_AURA_HOOK, TOGGLE_EFFECT_FUNC } from "./consts.mjs";
import { canTargetToken, initialiseAuraTargetFilters } from "./data/aura-target-filters.mjs";
import { getPresets } from "./data/preset.mjs";
import { AuraLayer } from "./layers/aura-layer/aura-layer.mjs";
import { registerSettings } from "./settings.mjs";
import { setupSystemIntegration } from "./system-integrations/index.mjs";
import { isTerrainHeightToolsActive, pickProperties, toggleEffect } from "./utils/misc-utils.mjs";

// Token properties (flattened) to trigger an aura check on
const watchedTokenProperties = [
	"x",
	"y",
	"width",
	"height",
	"hexagonalShape",
	"flags.grid-aware-auras.auras"
];

// Track active ruler groups for Alt-pressed rulers (so we can clean them even if preview token is gone)
const activeAltPressedRulers = new Set();

// Track last known state of keys to detect changes
const lastKeyState = new Map();

// Key press detection
document.addEventListener("keydown", (event) => {
	const wasPressed = lastKeyState.get(event.code);
	lastKeyState.set(event.code, true);

	// Only update if state actually changed
	if (!wasPressed) {
		// Update THT rulers when key is pressed
		updateTerrainHeightToolsForControlledToken();
	}
});

document.addEventListener("keyup", (event) => {
	const wasPressed = lastKeyState.get(event.code);
	lastKeyState.set(event.code, false);

	// Only update if state actually changed
	if (wasPressed) {
		updateTerrainHeightToolsForControlledToken();
	}
});

// Export function to check if a key is pressed
// Uses Foundry's keyboard system which handles focus loss correctly
export function isKeyPressed(keyCode) {
	// Check Foundry's keyboard state which is more reliable
	const isActuallyPressed = game.keyboard?.downKeys?.has(keyCode) ?? false;

	// Update our tracking if it's out of sync
	const wasTrackedAsPressed = lastKeyState.get(keyCode);
	if (isActuallyPressed !== wasTrackedAsPressed) {
		lastKeyState.set(keyCode, isActuallyPressed);
	}

	return isActuallyPressed;
}

// Update Terrain Height Tools rulers for controlled token
function updateTerrainHeightToolsForControlledToken() {
	// game may not be ready if keys are pressed before Foundry initializes
	if (!game.modules) return;
	// Check if Terrain Height Tools is active
	if (!isTerrainHeightToolsActive()) return;
	if (!AuraLayer.current || !canvas.tokens) return;

	// Clear all previously stored ruler groups first
	for (const group of activeAltPressedRulers) {
		terrainHeightTools.clearLineOfSightRays({ group });
	}
	activeAltPressedRulers.clear();

	const controlled = canvas.tokens.controlled;

	// If no token or multiple tokens are controlled, we're done (already cleaned up)
	if (controlled.length !== 1) return;
	const token = controlled[0];

	// Find the preview token if it exists (during drag)
	// The preview token is in canvas.tokens.preview.children
	let activeToken = token;
	if (canvas.tokens.preview?.children?.length > 0) {
		for (const previewToken of canvas.tokens.preview.children) {
			if (previewToken.document?.id === token.document.id) {
				activeToken = previewToken;
				break;
			}
		}
	}

	// Get the auras for the base token (auras are always on the base token)
	const auras = AuraLayer.current._auraManager.getTokenAuras(token);

	// Get user's targeted tokens (excluding the controlled token itself)
	const userTargets = Array.from(game.user.targets).filter(t => t.document.id !== token.document.id);

	// Determine which tokens to check: if there are targeted tokens, use only those; otherwise use all tokens
	// const tokensToCheck = userTargets.length > 0 ? userTargets : canvas.tokens.placeables;

	// Check each aura
	for (const aura of auras) {
		const config = aura.config;

		// Determine tokens to check for this specific aura
		let tokensToCheck;
		if (userTargets.length > 0) {
			tokensToCheck = userTargets;
		} else {
			// If no targets, check if we should restrict to targeted only
			const onlyWhenTargeted = config.terrainHeightTools?.onlyWhenTargeted;
			tokensToCheck = onlyWhenTargeted ? [] : canvas.tokens.placeables;
		}

		if (tokensToCheck.length === 0) continue;

		// Check if this aura uses the Alt key for THT
		if (config.terrainHeightTools?.onlyWhenAltPressed &&
			config.terrainHeightTools.rulerOnDrag !== "NONE") {
			// Check if aura should be active based on combat state
			if (config.onlyEnabledInCombat) {
				const isCombatActive = game.combat?.started ?? false;
				if (!isCombatActive) {
					continue;
				}
			}

			const keyPressed = isKeyPressed(config.keyToPress ?? "AltLeft");

			// If Alt is pressed and token is controlled, draw new rulers
			if (keyPressed && token.controlled) {
				// Check which tokens are inside the aura from the active token's position
				// We need to check manually because the manager only knows about the base token position
				for (const targetToken of tokensToCheck) {
					if (targetToken.document.id === token.document.id) continue;

					// Check if target token is inside the aura from activeToken's perspective
					const isInside = aura.isInside(targetToken, {
						sourceTokenPosition: (activeToken?.isPreview && activeToken.x != null && activeToken.y != null)
							? { x: activeToken.x, y: activeToken.y }
							: undefined,
						useActualSourcePosition: activeToken?.isPreview
					});

					const group = [MODULE_NAME, token.document.uuid, config.id, targetToken.document.uuid].join("|");

					if (isInside && canTargetToken(targetToken, token, config, config.terrainHeightTools.targetTokens)) {
						// Draw the ruler from activeToken to targetToken
						terrainHeightTools.drawLineOfSightRaysBetweenTokens(
							activeToken,
							targetToken,
							{
								group,
								drawForOthers: false,
								includeEdges: config.terrainHeightTools.rulerOnDrag === "E2E"
							}
						);
						// Store the group so we can clean it later even if tokens are gone
						activeAltPressedRulers.add(group);
					}
				}
			}
		}
	}
}


Hooks.once("init", () => {
	registerSettings();
	initialiseAuraTargetFilters();
	setupAutomation();
	setupSystemIntegration();

	CONFIG.Canvas.layers.gaaAuraLayer = { group: "interface", layerClass: AuraLayer };

	game.modules.get("grid-aware-auras").api = { ...api };
});

Hooks.once("ready", () => {
	switch (game.release.generation) {
		case 12: {
			// Wrap the default TokenConfig instead of using the renderTokenConfig hook because the latter does not run
			// when the config is re-rendered, and it causes the tab to disappear :(
			libWrapper.register(MODULE_NAME, "TokenConfig.prototype._renderInner", v12TokenConfigRenderInner, libWrapper.WRAPPER);
			Hooks.on("closeTokenConfig", tokenConfigClose);
			Hooks.on("getItemSheetHeaderButtons", addAuraConfigItemHeaderButton);
			break;
		}

		case 13: {
			const patchedTypes = new Set();
			const patchTokenConfig = cls => {
				if (!(cls.prototype instanceof foundry.applications.api.ApplicationV2)) return;
				if (patchedTypes.has(cls)) return;

				cls.TABS.sheet.tabs.push({ id: "gridAwareAuras", icon: "far fa-hexagon" });
				// Delete the footer and re-add it so that it is after GAA's tab. This is so that the part renders in the
				// right place, as Foundry uses the order from Object.entries and doesn't allow an explicit order to be set.
				const footer = cls.PARTS.footer;
				delete cls.PARTS.footer;
				cls.PARTS.gridAwareAuras = { template: `modules/${MODULE_NAME}/templates/v13-token-config-tab.hbs`, scrollable: [] };
				cls.PARTS.footer = footer;
				patchedTypes.add(cls);
			};

			for (const modelType of Object.values(CONFIG.Token.sheetClasses))
				for (const sheetConfig of Object.values(modelType))
					patchTokenConfig(sheetConfig.cls);
			patchTokenConfig(CONFIG.Token.prototypeSheetClass);

			Hooks.on("renderTokenConfig", v13TokenConfigRender);
			Hooks.on("renderPrototypeTokenConfig", v13TokenConfigRender);
			Hooks.on("closeTokenConfig", tokenConfigClose);
			Hooks.on("getItemSheetHeaderButtons", addAuraConfigItemHeaderButton); // For item sheets still using Application v1
			Hooks.on("getHeaderControlsApplicationV2", addAuraConfigItemHeaderButton);
			break;
		}
	}

	game.socket.on(SOCKET_NAME, ({ func, runOn, ...args }) => {
		if (runOn?.length > 0 && runOn !== game.userId)
			return;

		switch (func) {
			case TOGGLE_EFFECT_FUNC: {
				const { actorUuid, effectId, state, effectOptions } = args;
				toggleEffect(actorUuid, effectId, state, effectOptions, false);
				break;
			}
		}
	});
});

// Apply presets when the token is created
Hooks.on("preCreateToken", (tokenDocument, data) => {
	/** @type {import("./data/aura.mjs").AuraConfig[]} */
	const auras = data.flags?.[MODULE_NAME]?.[DOCUMENT_AURAS_FLAG] ?? [];

	/** @type {Actor | undefined} */
	const actor = game.actors.get(data.actorId);
	if (!actor) return;

	const applicablePresets = getPresets().filter(p => p.applyToNew.includes(actor.type));
	for (const preset of applicablePresets) {
		// Don't add any that have the same name
		if (!auras.some(a => a.name.localeCompare(preset.config.name, undefined, { sensitivity: "accent" }) === 0))
			auras.push(preset.config);
	}

	tokenDocument.updateSource({ [`flags.${MODULE_NAME}.${DOCUMENT_AURAS_FLAG}`]: auras });
});

Hooks.on("createToken", (tokenDocument, _options, userId) => {
	const token = game.canvas.tokens.get(tokenDocument.id);
	if (token && AuraLayer.current) {
		AuraLayer.current._updateAuras({ token, userId });
	}
});

Hooks.on("updateToken", (tokenDocument, delta, _options, userId) => {
	if (!AuraLayer.current) return;

	const token = game.canvas.tokens.get(tokenDocument.id);
	if (!token) return;

	// If the update was a move update, then call the hooks for any auras the token was in at the start of the move (i.e
	// before doing _updateAuras)
	const isMovementUpdate = "x" in delta || "y" in delta;
	const startPosition = pickProperties(["x", "y"], tokenDocument);
	const startingAuras = isMovementUpdate ? AuraLayer.current._auraManager.getAurasContainingToken(token) : [];
	for (const aura of startingAuras)
		Hooks.callAll(START_MOVE_INSIDE_AURA_HOOK, token, aura.parent, aura.aura.config, { userId });

	// If the token has moved, or changed shape/size then update the auras.
	// Do not always run this, because some modules (such as token FX) trigger an updateToken, which if it happens while
	// the token is already moving causes problems.
	if (Object.keys(foundry.utils.flattenObject(delta)).some(k => watchedTokenProperties.includes(k))) {
		AuraLayer.current._updateAuras({ token, tokenDelta: delta, userId });
	}

	// If the update was a move update, then call the hooks for any auras the token was in at the end of the move (i.e.
	// after doing _updateAuras)
	const endingAuras = isMovementUpdate ? AuraLayer.current._auraManager.getAurasContainingToken(token) : [];
	for (const aura of endingAuras) {
		const startedInside = startingAuras.some(a => a.aura === aura.aura && a.parent === aura.parent);
		Hooks.callAll(END_MOVE_INSIDE_AURA_HOOK, token, aura.parent, aura.aura.config, { startedInside, startPosition, userId });
	}
});

// When token moves or is made visible/hidden, update the aura position and visibility
Hooks.on("refreshToken", (token, { refreshPosition, refreshVisibility }) => {
	if (refreshPosition || refreshVisibility) {
		// If the token is a drag preview, then we update the auras and test collisions (using the position of the
		// preview). We don't test collisions for non-preview tokens on refresh, because then it will repeatedly check
		// and fire hooks etc. when the token is animating for example.
		if (token.isPreview) {
			AuraLayer.current?._updateAuras({ token });
			AuraLayer.current?._testCollisionsForToken(token, { useActualPosition: true });
			// Clean and update THT rulers during drag
		} else {
			AuraLayer.current?._updateAuraGraphics({ token, updatePosition: !!refreshPosition });
		}
		// Update THT rulers when token position changes (drag, drop, etc.)
		updateTerrainHeightToolsForControlledToken();
	}
});

// When token is hovered/unhovered, we need to check aura visibility
Hooks.on("hoverToken", token => {
	AuraLayer.current?._updateAuraGraphics({ token, updatePosition: false });
});

// When token is controlled/uncontrolled, we need to check aura visibility
Hooks.on("controlToken", token => {
	AuraLayer.current?._updateAuraGraphics({ token });
	// Update THT rulers when token is controlled/uncontrolled (to clean up when deselected)
	updateTerrainHeightToolsForControlledToken();
});

// When token is targeted/untargeted, we need to check aura visibility
Hooks.on("targetToken", (_user, token) => {
	AuraLayer.current?._updateAuraGraphics({ token });
});

// When an actor is updated, update any tokens for that actor as it this might affect auras that have expression radii
Hooks.on("updateActor", (actor, _delta, _options, userId) => {
	AuraLayer.current?._updateActorAuras(actor, { userId });
});

// When an item is created, update auras on any of that actor's tokens
// Do this regardless of whether the item itself has auras, as some aura values may be calculated from the actor's items
Hooks.on("createItem", (item, _options, userId) => {
	if (item.actor) {
		AuraLayer.current?._updateActorAuras(item.actor, { userId });
	}
});

// When an item is updated, update auras on any of that actor's tokens. We don't restrict it to just when the the item's
// auras flag is updated, as there may be a property referenced in one of the auras' radii expressions that has updated.
Hooks.on("updateItem", (item, _delta, _options, userId) => {
	if (item.actor) {
		AuraLayer.current?._updateActorAuras(item.actor, { userId });
	}
});

// When an item is deleted, update auras on any of that actor's tokens
// Do this regardless of whether the item itself has auras, as some aura values may be calculated from the actor's items
Hooks.on("deleteItem", (item, _options, userId) => {
	if (item.actor) {
		AuraLayer.current?._updateActorAuras(item.actor, { userId });
	}
});

// When combat is updated (e.g. if a turn was changed), we need to check aura visibility
Hooks.on("updateCombat", combat => {
	for (const combatant of combat.combatants) {
		// combatant.token returns a TokenDocument, but we need Token
		const token = game.canvas.tokens.get(combatant.tokenId);
		AuraLayer.current?._updateAuraGraphics({ token });
	}
});

Hooks.on("deleteCombat", combat => {
	for (const combatant of combat.combatants) {
		// combatant.token returns a TokenDocument, but we need Token
		const token = game.canvas.tokens.get(combatant.tokenId);
		AuraLayer.current?._updateAuraGraphics({ token: token });
	}
});

Hooks.on("destroyToken", token => {
	AuraLayer.current?._onDestroyToken(token);
});

// Need to set the flag in a canvasTearDown instead of in AuraLayer's own tear-down because the TokenLayer tear-down
// happens before the AuraLayer's.
Hooks.on("canvasTearDown", () => {
	if (AuraLayer.current)
		AuraLayer.current._isTearingDown = true;
});

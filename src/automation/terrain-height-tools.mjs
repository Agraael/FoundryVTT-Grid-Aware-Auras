import { MODULE_NAME } from "../consts.mjs";
import { canTargetToken } from "../data/aura-target-filters.mjs";
import { isTerrainHeightToolsActive } from "../utils/misc-utils.mjs";
import { isKeyPressed } from "../main.mjs";

/**
 * @param {Token} token
 * @param {Token} parent
 * @param {import("../data/aura.mjs").AuraConfig} aura
 * @param {{ hasEntered: boolean; isPreview: boolean; isInit: boolean; userId: string; }} options
 */
export function onEnterLeaveAura(token, parent, aura, { hasEntered, userId }) {
	if (userId !== game.userId || aura.terrainHeightTools.rulerOnDrag === "NONE" || !isTerrainHeightToolsActive()) {
		return;
	}

	const keyPressed = isKeyPressed(aura.keyToPress ?? "AltLeft");

	// Determine if we should show the ruler
	if (aura.terrainHeightTools.onlyWhenAltPressed)
		return;

	const group = [MODULE_NAME, parent.document.uuid, aura.id, token.document.uuid].join("|");
	if (hasEntered && canTargetToken(token, parent, aura, aura.terrainHeightTools.targetTokens))
		terrainHeightTools.drawLineOfSightRaysBetweenTokens(parent, token, { group, drawForOthers: false, includeEdges: aura.terrainHeightTools.rulerOnDrag === "E2E" });
	else
		terrainHeightTools.clearLineOfSightRays({ group });

}

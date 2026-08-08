import { CLIENT_HIDDEN_AURAS_SETTING, MODULE_NAME } from "../consts.mjs";

let _hiddenMapCache = null;

export function isAuraClientHidden(auraId, config) {
	if (!auraId) return false;
	_hiddenMapCache ??= game.settings.get(MODULE_NAME, CLIENT_HIDDEN_AURAS_SETTING) ?? {};
	if (auraId in _hiddenMapCache) return _hiddenMapCache[auraId] === true;
	return !!config?.clientDefaultHidden;
}

export async function setAuraClientHidden(auraId, hidden) {
	if (!auraId) return;
	const current = game.settings.get(MODULE_NAME, CLIENT_HIDDEN_AURAS_SETTING) ?? {};
	const next = { ...current, [auraId]: !!hidden };
	await game.settings.set(MODULE_NAME, CLIENT_HIDDEN_AURAS_SETTING, next);
	_hiddenMapCache = next;
	const { AuraLayer } = await import("../layers/aura-layer/aura-layer.mjs");
	AuraLayer.current?._updateAuraGraphics({ updateVisibility: true });
}

export function toggleAuraClientHidden(auraId, config) {
	return setAuraClientHidden(auraId, !isAuraClientHidden(auraId, config));
}

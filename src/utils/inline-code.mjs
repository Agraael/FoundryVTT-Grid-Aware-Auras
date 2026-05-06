const scriptCache = new Map();
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;

export function compileCode(source) {
	const cached = scriptCache.get(source);
	if (cached) return cached;
	const wrapped = `${source}\n//# sourceURL=modules/grid-aware-auras/dynamic/macro.js`;
	const fn = new AsyncFunction("token", "parent", "aura", "options", "api", wrapped);
	scriptCache.set(source, fn);
	return fn;
}

export async function runInlineCode(macroConfig, token, parent, aura, options) {
	if (!macroConfig.code?.trim()) return;
	try {
		const fn = compileCode(macroConfig.code);
		const api = game.modules.get("grid-aware-auras")?.api ?? null;
		await fn(token, parent, aura, options, api);
	} catch (err) {
		console.warn("[GAA] inline macro error", err);
	}
}

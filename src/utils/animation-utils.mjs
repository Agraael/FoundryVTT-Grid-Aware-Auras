/** @import { EASING_FUNCTIONS } from "../consts.mjs"; */
/** @import { ColorAnimation } from "../data/aura.mjs"; */
import { interpolateColor, interpolateNumber, premultiplyKeyframes, unpremultiply } from "./color-utils.mjs";

// From easings.net

/** @type {Record<EASING_FUNCTIONS, (v: number) => number>} */
export const easingFunctions = {
	linear: v => v,
	easeInCubic: v => Math.pow(v, 3),
	easeOutCubic: v => 1 - Math.pow(1 - v, 3),
	easeInOutCubic: v => v < 0.5 ? 4 * Math.pow(v, 3) : 1 - (Math.pow((-2 * v) + 2, 3) / 2)
};

/**
 * Gets the color and alpha of the animation at the given time.
 * @param {ColorAnimation["keyframes"]} keyframes Animation whose keyframes to search.
 * @param {number} duration
 * @param {EASING_FUNCTIONS} easingFuncName
 * @param {number} time
 */
export function getColorAnimationValue(keyframes, duration, easingFuncName, time) {
	const ease = easingFunctions[easingFuncName] ?? easingFunctions.linear;

	/** Time between 0-1, where 0 is the start of the animation and 1 is the end. */
	const animationTime = ease((time % duration) / duration);

	// If new position is before the first stop or after the last stop, there is nothing to interpolate against, so
	// use that color as-is
	if (animationTime <= keyframes[0].position) {
		return {
			color: keyframes[0].color,
			alpha: keyframes[0].alpha,
			insertIndex: 0
		};
	} else if (animationTime >= keyframes.at(-1).position) {
		return {
			color: keyframes.at(-1).color,
			alpha: keyframes.at(-1).alpha,
			insertIndex: keyframes.length
		};

	// Otherwise, find the two nearest neighbors and interpolate the t between them both
	} else {
		for (let i = 0; i < keyframes.length - 1; i++) {
			const a = keyframes[i];
			const b = keyframes[i + 1];

			if (a.position > animationTime || b.position < animationTime) continue;

			const tAB = (animationTime - a.position) / (b.position - a.position);
			const interpolatedColor = interpolateColor(a.color, b.color, tAB);
			const interpolatedAlpha = interpolateNumber(a.alpha, b.alpha, tAB);
			return { color: interpolatedColor, alpha: interpolatedAlpha, insertIndex: i + 1 };
		}
	}

	return { color: 0, alpha: 0, insertIndex: 0 }; // should never be possible, but just in case
}

/**
 * Creates a function that updates the `tint` and `alpha` properties of the target object based on the given animation.
 * @param {{ tint: number; alpha: number; }} target
 * @param {ColorAnimation} animation
 */
export function createTintAlphaColorAnimationTicker(target, animation) {
	const premultKeyframes = premultiplyKeyframes(animation.keyframes);
	const { duration, easingFunc } = animation;

	return () => {
		// Use global Date.now() instead of delta time so that all animations of the same type are synced
		const { color, alpha } = getColorAnimationValue(premultKeyframes, duration, easingFunc, Date.now());
		target.tint = unpremultiply(color, alpha);
		target.alpha = alpha;
	};
}

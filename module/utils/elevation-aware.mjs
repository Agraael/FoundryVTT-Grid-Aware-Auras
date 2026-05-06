function _sourceElevation(token) {
	return token?.document?.elevation ?? 0;
}

function* _iterCellsInRange(origin, radius) {
	const grid = canvas.grid;
	const isHex = grid.type !== CONST.GRID_TYPES.SQUARE && grid.type !== CONST.GRID_TYPES.GRIDLESS;
	const oi = origin.i;
	const oj = origin.j;

	for (let di = -radius; di <= radius; di++) {
		for (let dj = -radius; dj <= radius; dj++) {
			const i = oi + di;
			const j = oj + dj;
			if (!isHex) {
				if (Math.max(Math.abs(di), Math.abs(dj)) <= radius)
					yield { i, j };
			} else {
				try {
					const targetCenter = grid.getCenterPoint({ i, j });
					const originCenter = grid.getCenterPoint({ i: oi, j: oj });
					const d = grid.measurePath([originCenter, targetCenter]).distance;
					if (d <= radius * grid.distance)
						yield { i, j };
				} catch { /* */ }
			}
		}
	}
}

const _CLIPPER_SCALE = 100;

function _pathToClipperPoly(path) {
	const out = [];
	for (const cmd of path) {
		if (cmd.type === 'm' || cmd.type === 'l')
			out.push({ X: Math.round(cmd.x * _CLIPPER_SCALE), Y: Math.round(cmd.y * _CLIPPER_SCALE) });
	}
	return out;
}

function _shapePolygonToClipper(shape, originTopLeft) {
	const verts = shape?.polygon?.vertices ?? [];
	const out = [];
	for (const v of verts) {
		out.push({ X: Math.round((v.x - originTopLeft.x) * _CLIPPER_SCALE), Y: Math.round((v.y - originTopLeft.y) * _CLIPPER_SCALE) });
	}
	return out;
}

function _clipperPolyToPath(poly) {
	const out = [];
	if (!poly.length)
		return out;
	out.push({ type: 'm', x: poly[0].X / _CLIPPER_SCALE, y: poly[0].Y / _CLIPPER_SCALE });
	for (let i = 1; i < poly.length; i++)
		out.push({ type: 'l', x: poly[i].X / _CLIPPER_SCALE, y: poly[i].Y / _CLIPPER_SCALE });
	out.push({ type: 'l', x: poly[0].X / _CLIPPER_SCALE, y: poly[0].Y / _CLIPPER_SCALE });
	return out;
}

/**
 * @param {Token} token
 * @param {number} radius
 * @param {{ x: number; y: number } | null} [sourceCenter]
 * @returns {Array<any>}
 */
export function findBlockers(token, radius, sourceCenter = null) {
	const thtApi = /** @type {any} */ (globalThis).terrainHeightTools;
	if (!thtApi) return [];
	if (!thtApi.getShapesAtPoint && !thtApi.getCell) return [];
	if (!token || !radius || radius <= 0) return [];

	const ceiling = _sourceElevation(token) + radius;
	const grid = canvas.grid;
	const center = sourceCenter ?? token.center;
	const origin = grid.getOffset(center);
	const blockerSet = new Set();
	for (const cell of _iterCellsInRange(origin, Math.ceil(radius) + 1)) {
		const c = grid.getCenterPoint({ i: cell.i, j: cell.j });
		let shapes = [];
		try {
			shapes = thtApi.getShapesAtPoint?.(c.x, c.y) ?? thtApi.getCell?.(cell.j, cell.i) ?? [];
		} catch { /* */ }
		for (const s of shapes) {
			const typeId = s?.terrainTypeId ?? s?.terrainType?.id ?? s?.shape?.terrainTypeId ?? null;
			let type = null;
			if (typeId) {
				try { type = thtApi.getTerrainType?.({ id: typeId }); } catch { type = null; }
			}
			if (!type && s?.terrainType?.isSolid !== undefined)
				type = s.terrainType;
			if (!type?.isSolid || !type?.usesHeight) continue;
			const elev = s?.elevation ?? s?.bottom ?? s?.shape?.elevation ?? 0;
			const h = s?.height ?? s?.shape?.height ?? 0;
			if ((elev + h) > ceiling)
				blockerSet.add(s);
		}
	}
	return [...blockerSet];
}

/**
 * @param {number} wx
 * @param {number} wy
 * @param {Array<any>} blockers
 */
export function isPointInsideAnyBlocker(wx, wy, blockers) {
	for (const s of blockers) {
		const verts = s?.polygon?.vertices ?? [];
		if (verts.length < 3) continue;
		if (_pointInPolygon(wx, wy, verts)) return true;
	}
	return false;
}

function _pointInPolygon(x, y, verts) {
	let inside = false;
	for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
		const xi = verts[i].x, yi = verts[i].y;
		const xj = verts[j].x, yj = verts[j].y;
		const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi);
		if (intersect) inside = !inside;
	}
	return inside;
}

/**
 * @param {Array<{type:string,x:number,y:number}>} auraPath
 * @param {Token} token
 * @param {{ x: number; y: number }} originTopLeft
 * @param {number} radius
 * @param {{ x: number; y: number } | null} [sourceCenter]
 * @param {Array<{type:string,x:number,y:number}> | null} [innerPath] Inner hole path in graphics-local coords.
 * @returns {{ outers: Array<Array<{type:string,x:number,y:number}>>, holes: Array<Array<{type:string,x:number,y:number}>>, blockers: Array<any> } | null}
 */
export function clipAuraAgainstTerrain(auraPath, token, originTopLeft, radius, sourceCenter = null, innerPath = null) {
	if (typeof ClipperLib === 'undefined') return null;

	const blockers = findBlockers(token, radius, sourceCenter);
	if (!blockers.length) return null;

	const subj = [_pathToClipperPoly(auraPath)];
	if (innerPath) {
		const innerPoly = _pathToClipperPoly(innerPath);
		if (innerPoly.length >= 3) subj.push(innerPoly);
	}
	const clip = blockers.map(s => _shapePolygonToClipper(s, originTopLeft)).filter(p => p.length >= 3);
	if (!clip.length) return null;

	try {
		const co = new ClipperLib.ClipperOffset();
		co.AddPaths(clip, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
		const inflated = new ClipperLib.Paths();
		co.Execute(inflated, _CLIPPER_SCALE * 1.0);
		const finalClip = inflated.length >= 1 ? inflated : clip;

		const cpr = new ClipperLib.Clipper();
		cpr.AddPaths(subj, ClipperLib.PolyType.ptSubject, true);
		cpr.AddPaths(finalClip, ClipperLib.PolyType.ptClip, true);
		const tree = new ClipperLib.PolyTree();
		cpr.Execute(ClipperLib.ClipType.ctDifference, tree, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftNonZero);
		const outers = [];
		const holes = [];
		_walkPolyTree(tree, outers, holes);
		if (!outers.length && !holes.length) return null;
		return { outers, holes, blockers };
	} catch {
		return null;
	}
}

function _walkPolyTree(node, outers, holes) {
	const children = node.Childs?.() ?? node.m_Childs ?? [];
	for (const child of children) {
		const contour = child.Contour?.() ?? child.m_polygon ?? [];
		if (contour.length >= 3) {
			const cleaned = ClipperLib.Clipper.CleanPolygon(contour, _CLIPPER_SCALE * 0.5);
			if (cleaned.length >= 3) {
				const path = _clipperPolyToPath(cleaned);
				if (child.IsHole?.() ?? child.m_IsHole) holes.push(path);
				else outers.push(path);
			}
		}
		_walkPolyTree(child, outers, holes);
	}
}

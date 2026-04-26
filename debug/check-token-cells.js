globalThis.__gaaCheck = (() => {
    const sel = canvas.tokens.controlled;
    if (!sel.length)
        return console.warn('Select at least one token');

    const dbg = canvas.controls.debug;
    dbg.clear();

    const COLOR_MATCH = 0x00ff00;
    const COLOR_FAIL = 0xff0000;
    const COLOR_SHAPE = 0x00ffff;

    const results = [];

    for (const target of sel) {
        const ox = target.document.x;
        const oy = target.document.y;
        const w = target.document.width;
        const h = target.document.height;

        const sp = target.shape?.points;
        if (sp?.length) {
            dbg.lineStyle(2, COLOR_SHAPE, 0.8);
            dbg.moveTo(sp[0] + ox, sp[1] + oy);
            for (let i = 2; i < sp.length; i += 2)
                dbg.lineTo(sp[i] + ox, sp[i + 1] + oy);
            dbg.lineTo(sp[0] + ox, sp[1] + oy);
            dbg.lineStyle(0);
        }

        const UNIT = 1 / Math.sqrt(3);
        const gs = canvas.grid.size;
        const isColumnar = canvas.grid.type === CONST.GRID_TYPES.HEXODDQ
            || canvas.grid.type === CONST.GRID_TYPES.HEXEVENQ;
        const isVariant2 = target.document.hexagonalShape === 1;
        const primary = isColumnar ? h : w;
        const secondary = isColumnar ? w : h;
        const secondaryOffset =
            Math[isVariant2 ? 'ceil' : 'floor']((secondary - 1) / 2) * UNIT * 1.5 + UNIT;

        const points = [];
        let offsetDist = 0;
        let offsetSign = isVariant2 ? 1 : -1;
        for (let i = 0; i < secondary; i++) {
            const primaryOffset = (offsetDist + 1) / 2;
            const secondaryPos = (offsetDist * offsetSign * UNIT * 1.5) + secondaryOffset;
            for (let j = 0; j < primary - offsetDist; j++) {
                const px = isColumnar ? secondaryPos : (j + primaryOffset);
                const py = isColumnar ? (j + primaryOffset) : secondaryPos;
                points.push({ x: ox + px * gs, y: oy + py * gs });
            }
            offsetSign *= -1;
            if (i % 2 === 0)
                offsetDist++;
        }

        const insidePoly = (p) => {
            if (!sp?.length)
                return null;
            const lx = p.x - ox;
            const ly = p.y - oy;
            let inside = false;
            for (let i = 0, j = sp.length - 2; i < sp.length; j = i, i += 2) {
                const xi = sp[i];
                const yi = sp[i + 1];
                const xj = sp[j];
                const yj = sp[j + 1];
                if (((yi > ly) !== (yj > ly))
                    && (lx < (xj - xi) * (ly - yi) / (yj - yi) + xi))
                    inside = !inside;
            }
            return inside;
        };

        let hits = 0;
        let misses = 0;
        for (const p of points) {
            const ok = insidePoly(p);
            dbg.beginFill(ok ? COLOR_MATCH : COLOR_FAIL, 1);
            dbg.drawCircle(p.x, p.y, 7);
            dbg.endFill();
            if (ok)
                hits++;
            else
                misses++;
        }

        results.push({
            name: target.name,
            size: `${w}x${h}`,
            hexagonalShape: target.document.hexagonalShape,
            pointsCount: points.length,
            inside: hits,
            outside: misses,
            verdict: misses === 0 ? '✓ all inside' : '✗ some outside!'
        });
    }

    console.table(results);
    return results;
})();

// Pan and zoom of an svg map by its viewBox. The map is a torus (WORLD.md "Wrapping"): its content repeats in every direction, the view's
// centre is kept inside one copy of it, and the elements use[data-kx][data-ky] (copies shifted by that many content
// widths and heights) are shown where the view reaches them.
import { PROG } from './data.js';

// keep: the view of an earlier draw of the same map; it is restored exactly, so a redraw never moves the view. The
// zoom-out cap acts on the next zoom only.
// opts: { insets() -> {top, bottom} (pixels covered by overlaid controls), home() -> the box of the reset view (Escape;
//   else the cap box), cap() -> the cap box {x, y, w, h} (default: the whole content), pick(event) -> the element a
//   pointer event is on (default: its target; a marker under a double click does not zoom), onView() after every view
//   change, onIdle() when a drag, pinch or eased zoom ends }
// Zooming out stops where the view shows the cap box on both axes (once along the axis that binds), centred on it.
// Targets (fit, reveal, goTo, reset) are moved to the copy of the content nearest the view.
// the closest zoom shows one game screen (the fog grid's cell, 19 x 13 squares), whichever side binds
const minView = () => PROG.fog?.grid.screen || [19, 13];
export const ZOOM_STEP = 1.5;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// the whole number of lengths n nearest the offset d (half a length rounds up): the shift to the copy nearest a point d away
const nearestCopy = (d, n) => Math.round(d / n) * n;
// client rects move with any scroll or window resize; a map measures its svg again after one
let rectEpoch = 0;
addEventListener('scroll', () => rectEpoch++, { capture: true, passive: true });
addEventListener('resize', () => rectEpoch++);
// what a wheel event is (see the wheel handling in panZoom): 'wheel', 'pinch' or 'pan'; lastPan is the time of the last
// trackpad scroll
function classifyWheel(event, lastPan) {
    if (event.deltaMode !== 0) return 'wheel';
    if (event.deltaX === 0 && Math.abs(event.deltaY) >= 40) {
        if (event.timeStamp - lastPan < 80) return 'pan';
        return 'wheel';
    }
    if (event.ctrlKey) return 'pinch';
    return 'pan';
}
export function panZoom(svg, keep, opts = {}) {
    const base = svg.viewBox.baseVal,
        content = { x: base.x, y: base.y, w: base.width, h: base.height };
    let vb = keep?.vb ? { ...keep.vb } : null,
        anim = 0,
        moved = !!vb,
        zt = null,
        zanim = 0,
        px = 0,
        cr = null,
        crAt = -1;
    // the content shifts by whole widths and heights when the view's centre is moved back into the first copy, so a
    // world point kept across a gesture is corrected by the shift made since it was taken
    const shift = { x: 0, y: 0 },
        copies = [...svg.querySelectorAll('use[data-kx][data-ky]')].map((el) => ({
            el,
            kx: +el.dataset.kx,
            ky: +el.dataset.ky,
            on: el.style.display !== 'none',
        }));
    // whether the view was panned or zoomed by hand, kept with the view
    const setMoved = (v) => {
        moved = v;
        if (keep) keep.moved = v;
    };
    const touch = () => setMoved(true);
    const rect = () => {
        if (!(cr?.width > 0) || crAt !== rectEpoch) {
            cr = svg.getBoundingClientRect();
            crAt = rectEpoch;
        }
        return cr;
    };
    const scale = () => {
        const r = rect();
        return { r, s: Math.max(vb.w / r.width, vb.h / r.height) };
    };
    // the world point at the svg's top-left corner: the view is letterboxed inside the svg's box (r) at s per pixel
    const corner = (r, s) => ({ x: vb.x - (r.width * s - vb.w) / 2, y: vb.y - (r.height * s - vb.h) / 2 });
    const set = () => {
        if (!(vb.w > 0 && vb.h > 0)) return;
        const nx = Math.floor((vb.x + vb.w / 2 - content.x) / content.w) * content.w,
            ny = Math.floor((vb.y + vb.h / 2 - content.y) / content.h) * content.h;
        vb.x -= nx;
        vb.y -= ny;
        shift.x -= nx;
        shift.y -= ny;
        const { r, s } = scale();
        // a copy is shown when the view, widened by the overhang of markers and labels, reaches it
        const m = 130 * s + 2,
            c0 = corner(r, s),
            x0 = c0.x - m,
            y0 = c0.y - m,
            x1 = x0 + r.width * s + 2 * m,
            y1 = y0 + r.height * s + 2 * m;
        for (const c of copies) {
            const cx = content.x + c.kx * content.w,
                cy = content.y + c.ky * content.h,
                on = cx < x1 && cx + content.w > x0 && cy < y1 && cy + content.h > y0;
            if (on !== c.on) {
                c.on = on;
                c.el.style.display = on ? '' : 'none';
            }
        }
        svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
        if (keep) keep.vb = { ...vb };
        // markers follow the zoom through --px; a change under 2% is not worth restyling them
        if (s > 0 && isFinite(s) && !(Math.abs(s - px) <= px * 0.02)) {
            px = s;
            svg.style.setProperty('--px', s);
        }
        opts.onView?.();
    };
    // cancels the eased pan and the eased zoom
    const stop = () => {
        cancelAnimationFrame(anim);
        cancelAnimationFrame(zanim);
        zt = null;
    };
    // view that puts the box in the middle of the area left free by the pixel insets {top, right, bottom, m (margin)}; s0 keeps the zoom
    const place = (box, ins = {}, s0) => {
        const r = rect(),
            t = ins.top || 0,
            m = ins.m || 0,
            w = Math.max(40, r.width - (ins.right || 0) - 2 * m),
            h = Math.max(40, r.height - t - (ins.bottom || 0) - 2 * m);
        const [mw, mh] = minView(),
            s = Math.max(
                s0 || Math.max(box.w / w, box.h / h),
                r.width > 0 ? mw / r.width : 0,
                r.height > 0 ? mh / r.height : 0,
            );
        return {
            x: box.x + box.w / 2 - (m + w / 2) * s,
            y: box.y + box.h / 2 - (t + m + h / 2) * s,
            w: r.width * s,
            h: r.height * s,
        };
    };
    // the box the zoom-out cap fits on both axes and centres on
    const capBox = () => opts.cap?.() || content;
    const home = () => {
        const i = opts.insets?.() || {};
        return place(opts.home?.() || capBox(), { top: i.top || 0, bottom: i.bottom || 0 });
    };
    // the copy of a box (positioned in the first copy of the content) whose centre is nearest the view's centre
    const nearest = (box) => ({
        ...box,
        x: box.x + nearestCopy(vb.x + vb.w / 2 - box.x - box.w / 2, content.w),
        y: box.y + nearestCopy(vb.y + vb.h / 2 - box.y - box.h / 2, content.h),
    });
    const animTo = (to) => {
        stop();
        if (!(to.w > 0 && to.h > 0)) return;
        if (document.hidden) {
            vb = { ...to };
            set();
            return;
        }
        const from = { ...vb },
            t0 = performance.now();
        const step = (now) => {
            const k = Math.max(0, Math.min(1, (now - t0) / 280)),
                e = 1 - (1 - k) ** 3;
            vb = {
                x: from.x + (to.x - from.x) * e,
                y: from.y + (to.y - from.y) * e,
                w: from.w + (to.w - from.w) * e,
                h: from.h + (to.h - from.h) * e,
            };
            set();
            if (k < 1) anim = requestAnimationFrame(step);
        };
        anim = requestAnimationFrame(step);
    };
    if (!vb) vb = home();
    set();
    // the world point under a client position, in the frame of the view as it is now
    const worldAt = (cx, cy) => {
        const { r, s } = scale(),
            c0 = corner(r, s);
        return {
            x: c0.x + (cx - r.left) * s,
            y: c0.y + (cy - r.top) * s,
            sx: shift.x,
            sy: shift.y,
        };
    };
    // moves the view by client pixels
    const panBy = (dx, dy) => {
        const { s } = scale();
        vb.x += dx * s;
        vb.y += dy * s;
        set();
    };
    // the widest view (keeping the aspect of the current one) that is the zoom-out cap: the cap box shows whole on both
    // axes, and along the axis with room to spare the neighbouring copies show
    const capW = () => {
        const r = rect(),
            c = capBox();
        return r.width > 0 && r.height > 0
            ? Math.max(c.w / r.width, c.h / r.height) / Math.max(1 / r.width, vb.h / (vb.w * r.height))
            : vb.w;
    };
    // clamps a view width to those the view may take from here: never forced in or out from where it is, otherwise
    // between the closest zoom and the zoom-out cap
    const limits = () => {
        const [mw, mh] = minView(),
            lo = Math.min(vb.w, Math.max(mw, (mh * vb.w) / vb.h)),
            hi = Math.max(vb.w, capW());
        return (w) => Math.min(hi, Math.max(lo, w));
    };
    // sizes the view to width w (keeping its aspect) with the world point p (from worldAt) under the client position
    // (cx, cy); false while the svg has no size
    const anchor = (w, p, cx, cy) => {
        const r = rect();
        if (!(r.width > 0 && r.height > 0)) return false;
        const h = (w * vb.h) / vb.w,
            s = Math.max(w / r.width, h / r.height),
            cap = capW();
        const out = w > vb.w;
        vb = {
            x: p.x + shift.x - p.sx - (cx - r.left) * s + (r.width * s - w) / 2,
            y: p.y + shift.y - p.sy - (cy - r.top) * s + (r.height * s - h) / 2,
            w,
            h,
        };
        // zooming out over the last quarter of the way to the cap draws the view's centre to the cap box's, so the cap
        // shows the whole box centred
        if (out && w > cap * 0.75) {
            const t = Math.min(1, (w - cap * 0.75) / (cap * 0.25)),
                c = capBox(),
                mx = c.x + c.w / 2,
                my = c.y + c.h / 2,
                vx = vb.x + w / 2,
                vy = vb.y + h / 2;
            vb.x += t * (mx + nearestCopy(vx - mx, content.w) - vx);
            vb.y += t * (my + nearestCopy(vy - my, content.h) - vy);
        }
        set();
        return true;
    };
    const zoomNow = (cx, cy, f) => {
        stop();
        touch();
        anchor(limits()(vb.w * f), worldAt(cx, cy), cx, cy);
    };
    // zoom steps accumulate into a target width; the view eases towards it with the anchored point held under (cx, cy)
    const zoomBy = (cx, cy, f) => {
        if (document.hidden || reducedMotion.matches) return zoomNow(cx, cy, f);
        cancelAnimationFrame(anim);
        touch();
        const run = !zt;
        zt = { w: limits()((zt ? zt.w : vb.w) * f), p: worldAt(cx, cy), cx, cy, t: zt ? zt.t : performance.now() };
        if (run) zanim = requestAnimationFrame(zstep);
    };
    const zstep = (now) => {
        if (!zt) return;
        const dt = Math.min(100, Math.max(0, now - zt.t));
        zt.t = now;
        let w = vb.w + (zt.w - vb.w) * (1 - Math.exp(-dt / 50));
        const done = Math.abs(zt.w - w) < zt.w * 0.004;
        if (done) w = zt.w;
        if (!anchor(w, zt.p, zt.cx, zt.cy) || done) {
            zt = null;
            opts.onIdle?.();
        } else zanim = requestAnimationFrame(zstep);
    };
    // Wheel devices are told apart by what they send. A ctrlKey wheel with small deltas is a trackpad pinch (zooms 1:1, gently).
    // Pixel deltas that are small or horizontal are a trackpad scroll (pans 1:1). Line or page deltas, and vertical steps of
    // 40+ pixels (fractional at a browser zoom other than 100%), are a mouse wheel (zooms, eased); such steps within 80 ms
    // of a trackpad scroll belong to its momentum.
    let lastPan = -1e9;
    const wheelKind = (ev) => {
        const kind = classifyWheel(ev, lastPan);
        if (kind === 'pan') lastPan = ev.timeStamp;
        return kind;
    };
    // the wheel acts anywhere over the map box, except inside a panel that can still scroll that way itself
    const scrolls = (el, ev) => {
        const [size, client, pos, overflow, d] =
            Math.abs(ev.deltaX) > Math.abs(ev.deltaY)
                ? ['scrollWidth', 'clientWidth', 'scrollLeft', 'overflowX', ev.deltaX]
                : ['scrollHeight', 'clientHeight', 'scrollTop', 'overflowY', ev.deltaY];
        return (
            el[size] > el[client] + 1 &&
            /auto|scroll/.test(getComputedStyle(el)[overflow]) &&
            (d < 0 ? el[pos] > 0 : el[pos] + el[client] < el[size] - 1)
        );
    };
    svg.parentElement.addEventListener(
        'wheel',
        (ev) => {
            const kind = wheelKind(ev);
            if (kind !== 'pinch')
                for (let el = ev.target; el && el !== svg.parentElement; el = el.parentElement) {
                    if (scrolls(el, ev)) return;
                    if (el.classList.contains('sel') && getComputedStyle(el).position === 'static') return;
                }
            ev.preventDefault();
            if (kind === 'pinch')
                zoomNow(ev.clientX, ev.clientY, Math.exp(Math.max(-25, Math.min(25, ev.deltaY)) * 0.01));
            else if (kind === 'pan') {
                stop();
                touch();
                panBy(ev.deltaX, ev.deltaY);
            } else
                zoomBy(
                    ev.clientX,
                    ev.clientY,
                    Math.exp(Math.max(-300, Math.min(300, ev.deltaY * [1, 33, rect().height][ev.deltaMode])) * 0.0015),
                );
        },
        { passive: false },
    );
    // One pointer pans, two pinch around their midpoint and pan with it. A double click or tap off the markers zooms in.
    const pointers = new Map(),
        isMarker = (el) => el?.closest?.('[data-i],[data-tw],[data-gate],[data-sign],[data-gtw]');
    let drag = null,
        pinch = null,
        lastTap = null;
    // distance and midpoint of the two pointers
    const two = () => {
        const [p1, p2] = [...pointers.values()];
        return { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    };
    const dragFrom = (id, p) => {
        drag = { id, x: p.x, y: p.y, x0: p.x, y0: p.y };
    };
    const pmove = (e) => {
        const p = pointers.get(e.pointerId);
        if (!p) return;
        p.x = e.clientX;
        p.y = e.clientY;
        if (pinch) {
            const t = two();
            if (t.d < 1) return;
            anchor(pinch.cw((pinch.w * pinch.d) / t.d), pinch.p, t.x, t.y);
        } else if (drag && drag.id === e.pointerId) {
            if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) > 3) {
                svg.wasDragged = true;
                svg.classList.add('drag');
                touch();
            }
            panBy(drag.x - e.clientX, drag.y - e.clientY);
            drag.x = e.clientX;
            drag.y = e.clientY;
        }
    };
    const pend = (e) => {
        if (!pointers.delete(e.pointerId)) return;
        if (pinch) {
            pinch = null;
            const rest = [...pointers];
            if (rest.length) dragFrom(rest[0][0], rest[0][1]);
        } else if (drag?.id === e.pointerId) drag = null;
        if (pointers.size) return;
        svg.classList.remove('drag');
        removeEventListener('pointermove', pmove);
        removeEventListener('pointerup', pend);
        removeEventListener('pointercancel', pend);
        opts.onIdle?.();
        if (e.type !== 'pointerup' || svg.wasDragged) return;
        const now = performance.now();
        if (lastTap && now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
            lastTap = null;
            if (!isMarker(opts.pick ? opts.pick(e) : e.target)) zoomBy(e.clientX, e.clientY, 0.5);
        } else lastTap = { t: now, x: e.clientX, y: e.clientY };
    };
    svg.addEventListener('pointerdown', (ev) => {
        if (ev.button || pointers.size >= 2) return;
        stop();
        cr = null;
        const p = { x: ev.clientX, y: ev.clientY };
        if (!pointers.size) {
            svg.wasDragged = false;
            addEventListener('pointermove', pmove);
            addEventListener('pointerup', pend);
            addEventListener('pointercancel', pend);
        }
        pointers.set(ev.pointerId, p);
        if (pointers.size === 1) dragFrom(ev.pointerId, p);
        else {
            const t = two();
            pinch = { d: Math.max(1, t.d), w: vb.w, p: worldAt(t.x, t.y), cw: limits() };
            drag = null;
            svg.wasDragged = true;
            svg.classList.add('drag');
            touch();
        }
    });
    return {
        scale,
        toWorld: (ev) => worldAt(ev.clientX, ev.clientY),
        // a drag, pinch or eased zoom is running
        get busy() {
            return pointers.size > 0 || !!zt;
        },
        // world coordinates of the view's top-left corner and squares per pixel; null while the svg has no size
        view() {
            const { r, s } = scale();
            if (!(s > 0 && isFinite(s))) return null;
            const c0 = corner(r, s);
            return { x0: c0.x, y0: c0.y, s, r };
        },
        reset() {
            setMoved(false);
            animTo(nearest(home()));
        },
        // eases to a view that getView of the map kept (a viewBox); moved: whether it was panned or zoomed by hand
        goTo(box, wasMoved) {
            setMoved(wasMoved);
            animTo(nearest(box));
        },
        // a view nobody panned or zoomed follows the box size and the overlay insets
        resize() {
            cr = null;
            if (!moved) {
                cancelAnimationFrame(anim);
                vb = home();
            }
            set();
        },
        zoom(f) {
            const r = rect();
            zoomBy(r.left + r.width / 2, r.top + r.height / 2, f);
        },
        // brings the box into the free area: pans when it fits at the current zoom, zooms out when it does not
        fit(box, ins) {
            touch();
            animTo(place(nearest(box), ins, 0));
        },
        reveal(box, ins) {
            box = nearest(box);
            const { r, s } = scale(),
                { x: x0, y: y0 } = corner(r, s),
                m = ins.m || 0;
            const L = (box.x - x0) / s,
                R = (box.x + box.w - x0) / s,
                T = (box.y - y0) / s,
                B = (box.y + box.h - y0) / s;
            if (
                L >= m &&
                R <= r.width - (ins.right || 0) - m &&
                T >= (ins.top || 0) + m &&
                B <= r.height - (ins.bottom || 0) - m
            )
                return;
            touch();
            const fits =
                R - L <= r.width - (ins.right || 0) - 2 * m &&
                B - T <= r.height - (ins.top || 0) - (ins.bottom || 0) - 2 * m;
            animTo(place(box, ins, fits ? s : 0));
        },
    };
}

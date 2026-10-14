// Unlock plans: what is still to do before a level, ice gate, tower or sign opens up (VIEWER.md "Planning")
import { requirementGraph } from './requirements.js';

// A min-heap of [weight, id] pairs
class Heap {
    constructor() {
        this.items = [];
    }
    get size() {
        return this.items.length;
    }
    push(weight, id) {
        const a = this.items;
        a.push([weight, id]);
        let n = a.length - 1;
        while (n > 0) {
            const up = (n - 1) >> 1;
            if (a[up][0] <= weight) break;
            [a[up], a[n]] = [a[n], a[up]];
            n = up;
        }
    }
    pop() {
        const a = this.items,
            top = a[0],
            last = a.pop();
        if (a.length) {
            a[0] = last;
            let n = 0;
            for (;;) {
                const l = 2 * n + 1,
                    r = l + 1;
                let m = n;
                if (l < a.length && a[l][0] < a[m][0]) m = l;
                if (r < a.length && a[r][0] < a[m][0]) m = r;
                if (m === n) break;
                [a[m], a[n]] = [a[n], a[m]];
                n = m;
            }
        }
        return top;
    }
}

// Every requirement's cheapest plan, worked out once for all of them (a Knuth-style shortest path over the AND/OR
// graph): a plan's weight is its number of steps, then the levels in it the walk cannot reach yet. Requirements are
// settled cheapest first; one gets a plan only from parts already settled, so a plan never runs through itself. An OR
// takes its first settled part (the cheapest), a k of n its first k, an AND waits for all its parts. A plan is never
// cheaper than a part of it, which keeps the order. A requirement left unsettled has no plan (its parts run in a cycle
// or have none); one that may be a step of its own (a level no way-in gate leads into) becomes one at the end, and the
// settling goes on from it.
export function planAll(progress) {
    const graph = requirementGraph(progress),
        nodeCount = graph.keys.length,
        blocked = (id) => graph.node[id]?.t === 'l' && progress.state[graph.node[id].id] === 'blocked';
    const parents = Array.from({ length: nodeCount }, () => []),
        waiting = new Int32Array(nodeCount),
        chosen = Array.from({ length: nodeCount }, () => null),
        steps = Array.from({ length: nodeCount }, () => null),
        settled = new Int32Array(nodeCount).fill(-1);
    let order = 0;
    const heap = new Heap();
    // the plan of a requirement from the parts it took: the union of their steps, and itself when it is a step
    const offer = (id, parts) => {
        const set = new Set();
        let nb = 0;
        for (const part of parts)
            for (const s of steps[part])
                if (!set.has(s)) {
                    set.add(s);
                    if (blocked(s)) nb++;
                }
        if (graph.node[id] && !set.has(id)) {
            set.add(id);
            if (blocked(id)) nb++;
        }
        chosen[id] = parts;
        steps[id] = set;
        heap.push(set.size * 1e4 + nb, id);
    };
    for (let id = 0; id < nodeCount; id++) {
        if (graph.met[id]) {
            settled[id] = order++;
            steps[id] = new Set();
            chosen[id] = [];
            continue;
        }
        const parts = graph.parts[id];
        for (const part of parts) parents[part].push(id);
        if (graph.kind[id] === 'or') waiting[id] = 1;
        else if (graph.kind[id] === 'k') waiting[id] = Math.min(graph.k[id], parts.length);
        else waiting[id] = parts.length;
    }
    // the requirements whose parts are settled already (met ones), parts settled in id order
    const taken = Array.from({ length: nodeCount }, () => []);
    const partSettled = (part) => {
        for (const id of parents[part]) {
            if (settled[id] >= 0 || waiting[id] <= 0) continue;
            taken[id].push(part);
            if (--waiting[id] === 0) offer(id, taken[id]);
        }
    };
    for (let id = 0; id < nodeCount; id++) if (settled[id] < 0 && waiting[id] === 0) offer(id, []);
    for (let id = 0; id < nodeCount; id++) if (graph.met[id]) partSettled(id);
    // each requirement is offered once, when its parts are settled
    const settle = () => {
        while (heap.size) {
            const id = heap.pop()[1];
            // a late step of its own can be offered again from a part settled before it
            if (settled[id] >= 0) continue;
            settled[id] = order++;
            partSettled(id);
        }
    };
    settle();
    for (;;) {
        const late = [];
        for (let id = 0; id < nodeCount; id++)
            if (settled[id] < 0 && graph.fallback[id] && chosen[id] === null) late.push(id);
        if (!late.length) break;
        for (const id of late) offer(id, []);
        settle();
    }
    return { G: graph, chosen, steps, settled, parents };
}

const EMPTY_PLAN = { nodes: new Map(), edges: [], steps: 0 };
// The plan of a level, ice gate, sign or tower (root [kind, index]) as nodes and edges: an edge [a, b] means a comes
// before b. null when it has none.
export function unlockPlan(progress, root) {
    const plans = progress.plans || planAll(progress),
        { G: graph, chosen, steps, settled } = plans;
    const prefix = { level: 'l', gate: 'g', sign: 's', tower: 't' }[root[0]],
        rootKey = prefix + root[1],
        id = graph.index.get(rootKey);
    if (id === undefined || settled[id] < 0) return null;
    if (graph.met[id]) return { ...EMPTY_PLAN, rootKey };
    const ids = [...steps[id]].toSorted((a, b) => settled[a] - settled[b]),
        nodes = new Map(ids.map((s) => [graph.keys[s], graph.node[s]]));
    // a step comes after the steps its parts lead with: a part's own step, or the steps a part with none took
    const heads = (part, out) => {
        if (graph.met[part]) return out;
        if (graph.node[part]) out.push(part);
        else for (const p of chosen[part]) heads(p, out);
        return out;
    };
    const edges = [],
        seen = new Set();
    for (const s of ids)
        for (const part of chosen[s])
            for (const h of heads(part, [])) {
                const edge = graph.keys[h] + '>' + graph.keys[s];
                if (seen.has(edge)) continue;
                seen.add(edge);
                edges.push([graph.keys[h], graph.keys[s]]);
            }
    return { nodes, edges, rootKey, steps: nodes.size - (nodes.has(rootKey) ? 1 : 0) };
}

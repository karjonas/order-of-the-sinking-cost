// Roles relative to a goal, from the requirement graph of the plans (VIEWER.md "Goal roles (viewer)")
import { PROG } from '../data.js';

// The requirements a requirement's plan runs through when it asks for one of its parts: itself when it is a step, else
// the steps that have it as a part (a rank, the options of an OR level)
function askers(graph, parents, id) {
    if (graph.node[id]) return [id];
    const out = [];
    for (const parent of parents[id]) {
        if (graph.node[parent]) out.push(parent);
        else out.push(...askers(graph, parents, parent));
    }
    return out;
}

// The routes of a requirement: its parts that have a plan that does not run back through it (a rank's ASCEND needs the
// way onto the sky, which needs that rank)
export function goalRoutes(plans, id) {
    const { G, steps, settled, parents } = plans,
        through = askers(G, parents, id);
    return G.parts[id].filter((part) => {
        if (settled[part] < 0) return false;
        return !through.some((asker) => steps[part].has(asker));
    });
}

// The parts every route needs: the parts each route needs all of (an AND route), shared by every route
function sharedParts(graph, routes) {
    if (routes.some((route) => graph.kind[route] !== 'and')) return [];
    let shared = graph.parts[routes[0]];
    for (let r = 1; r < routes.length && shared.length; r++) {
        const parts = graph.parts[routes[r]];
        shared = shared.filter((part) => parts.includes(part));
    }
    return shared;
}

// Per OR and k of n requirement not met: its routes and the parts every route needs. They do not depend on the goal, so
// every goal's marking reads the same ones.
export function routeGraph(plans) {
    const { G: graph } = plans,
        n = graph.keys.length;
    const routes = Array.from({ length: n }, () => null),
        shared = Array.from({ length: n }, () => null);
    for (let id = 0; id < n; id++) {
        if (graph.kind[id] === 'and' || graph.met[id]) continue;
        // an OR with a part met needs nothing more
        if (graph.parts[id].some((part) => graph.met[part])) continue;
        routes[id] = goalRoutes(plans, id);
        shared[id] = routes[id].length > 1 ? sharedParts(graph, routes[id]) : [];
    }
    return { routes, shared };
}

// Roles relative to a goal (VIEWER.md "Goal roles (viewer)"): the requirement graph of the plans (planAll) walked back
// from the goal's targets (requirement ids), so that every goal's roles come from the one static roles pass the graph
// reads. need per requirement: 2 Required (on every route to a target), 1 Required as one of several (on some routes),
// 0 not needed. An AND passes its strength to every part; an OR to its only route, else as one of several to each route
// and in full to the parts every route needs; a k of n to its routes in full only when it needs all of them, else like
// an OR. Met requirements need nothing. from: the requirement that marked each one first, nearest the targets; weakAt:
// the OR or k of n nearest it where its chain toward the targets is one of several (-1 while Required). l and g: need
// per level and ice gate. `graph` is routeGraph(plans).
export function goalRoles(plans, routeMap, targets) {
    const { G: graph } = plans,
        n = graph.keys.length;
    const need = new Uint8Array(n),
        from = new Int32Array(n).fill(-1),
        weakAt = new Int32Array(n).fill(-1),
        queue = [];
    const mark = (id, strong, by, junction) => {
        if (graph.met[id]) return;
        const value = strong ? 2 : 1;
        if (need[id] >= value) return;
        need[id] = value;
        from[id] = by;
        if (strong) weakAt[id] = -1;
        else weakAt[id] = junction;
        queue.push(id);
    };
    for (const id of targets) mark(id, true, -1, -1);
    // breadth first, so a requirement's `from` is the nearest to the targets
    for (let head = 0; head < queue.length; head++) {
        const id = queue[head],
            strong = need[id] === 2,
            kind = graph.kind[id],
            parts = graph.parts[id];
        // a weak requirement's parts are weak from where it became weak
        const inherited = weakAt[id];
        if (kind === 'and') {
            for (const part of parts) mark(part, strong, id, inherited);
            continue;
        }
        const routes = routeMap.routes[id];
        if (!routes) continue;
        const needsAll = kind === 'or' ? routes.length === 1 : routes.length <= graph.k[id];
        if (needsAll) {
            for (const part of routes) mark(part, strong, id, inherited);
            continue;
        }
        for (const part of routeMap.shared[id]) mark(part, strong, id, inherited);
        for (const part of routes) mark(part, false, id, id);
    }
    const levelBase = graph.index.get('l0') ?? 0,
        gateBase = graph.index.get('g0') ?? 0;
    return {
        need,
        from,
        weakAt,
        l: need.subarray(levelBase, levelBase + PROG.levels.length),
        g: need.subarray(gateBase, gateBase + PROG.freezers.length),
    };
}

// A goal's role for a level ('l') or ice gate ('g'): 'req' on every route to it, 'one' on some routes, else 'optional';
// null before the goal has roles
export function roleFor(goal, kind, id) {
    const need = goal?.roles?.[kind];
    if (!need) return null;
    if (need[id] === 2) return 'req';
    if (need[id] === 1) return 'one';
    return 'optional';
}

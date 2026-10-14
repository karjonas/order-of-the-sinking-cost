// Percentages and progress bars as the page shows them
export function pct(done, total) {
    return total ? Math.floor((1000 * done) / total) / 10 + '%' : '—';
}
export function bar(done, total, partial = 0) {
    const widthOf = (x) => (total ? ((100 * x) / total).toFixed(2) : 0);
    return `<div class="bar${total && done >= total ? ' done' : ''}" title="${done} of ${total}"><i style="width:${widthOf(done)}%"></i>${partial ? `<i class="part" style="width:${widthOf(partial)}%"></i>` : ''}</div>`;
}

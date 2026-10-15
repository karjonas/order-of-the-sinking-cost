/** Percentages and progress bars as the page shows them. */
export function percent(done: number, total: number): string {
    if (!total) return '—';
    return Math.floor((1000 * done) / total) / 10 + '%';
}

/** A bar of done out of total, with the partially done part drawn after it. */
export function progressBarHtml(done: number, total: number, partial = 0): string {
    const widthOf = (amount: number): string => {
        if (!total) return '0';
        return ((100 * amount) / total).toFixed(2);
    };

    let doneClass = '';
    if (total && done >= total) doneClass = ' done';

    let partialBar = '';
    if (partial) partialBar = `<i class="part" style="width:${widthOf(partial)}%"></i>`;

    const doneBar = `<i style="width:${widthOf(done)}%"></i>`;
    return `<div class="bar${doneClass}" title="${done} of ${total}">${doneBar}${partialBar}</div>`;
}

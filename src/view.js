// The page's redraw. page.js gives it the drawing; the modules page.js draws (the save files, the folder, the
// sidebar) call show() without importing page.js (VIEWER.md "The page (viewer)").
let drawPage = null;
export function setPageDrawing(draw) {
    drawPage = draw;
}
export function show() {
    drawPage?.();
}

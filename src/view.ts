// The page's redraw. page.ts gives it the drawing; the modules page.ts draws (the save files, the folder, the
// sidebar) call show() without importing page.ts (VIEWER.md "The page (viewer)").
let drawPage: (() => void) | null = null;

export function setPageDrawing(draw: () => void): void {
    drawPage = draw;
}

export function show(): void {
    drawPage?.();
}

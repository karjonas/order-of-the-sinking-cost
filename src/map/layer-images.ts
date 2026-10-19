// The thumbnail of each map layer (DATAFILES.md "The map images"): one pixel per square, embedded in the page as a data
// URL and drawn pixelated until the layer's full image (assets/map-<layer>.avif next to the page) has loaded

const THUMBNAIL_URLS = import.meta.glob('./thumbs/*.avif', { query: '?inline', import: 'default', eager: true });

const THUMBNAILS = new Map<string, string>();
for (const [path, url] of Object.entries(THUMBNAIL_URLS)) {
    const fileName = path.slice(path.lastIndexOf('/') + 1);
    const layer = fileName.slice(0, fileName.lastIndexOf('.'));
    THUMBNAILS.set(layer, url);
}

/** The data URL of a layer's thumbnail, undefined when it has none. */
export function layerThumbnail(layer: string): string | undefined {
    return THUMBNAILS.get(layer);
}

/** The URL of a layer's full image. */
export function layerImageUrl(layer: string): string {
    return `assets/map-${layer}.avif`;
}

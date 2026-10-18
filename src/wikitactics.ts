// Links to each level's page on WikiTactics. data/wikitactics.txt is a copy of
// https://github.com/joric/ootss/blob/main/data/wt.txt, one `level,area,anchor` row per level.
import LIST from '../data/wikitactics.txt?raw';

const SITE = 'https://sinkingstar.wikitactics.com/areas/';

const pages = new Map<string, string>();
for (const line of LIST.split('\n')) {
    const [level, area, anchor] = line.trim().split(',');
    if (!level || !area || !anchor) continue;
    pages.set(level, `${SITE}${area}/#${anchor}`);
}

/** The WikiTactics page of a level, by its name, or undefined for a level the list does not have. */
export function wikiTacticsUrl(levelName: string): string | undefined {
    return pages.get(levelName);
}

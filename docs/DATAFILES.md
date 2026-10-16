# Derived data and the map image

The schema of every data file the viewer is built from (`schema.json`, `levels.json`, `level_areas.json`, `fog.json`,
`map.json`, `world.json`, `progress.json`, `walk.json`) and how the map image is drawn.

## Derived data files

The pipeline turns the game data into these files in `data/`, and the viewer embeds `schema.json`, `progress.json` and
`walk.json`.
Positions are world units; a cell is (i, j) = ((x − corner.x) mod W, (y − corner.y) mod H) with the overworld grid
corner (−24, −2) and W × H = 190 × 156. The world, fog and map scripts fill a field a blob leaves out with its type
default: the first value stored for that field in any level of the package (no two levels disagree), not the
overworld's alone. A row's trailing `(, exists)` column is described under
[data/world.json](#dataworldjson).

### data/schema.json

`{base: {name: "Undoable_Entity_Data", fields}, types: {<type>: {version, size, fields}}, enums: {<key>: {flags, values}}}`.

- `types` has every entity type. A type the exporter could not find is `{missing: true}`.
- A field: `i` index, `n` name (flattened, `position.x`), `v` [first, last] version (−1 = none), `k` kind, `sz` size
  in bytes (plain data), `t` type name (`f32`, `u8`, `bool`, `Vector3`, `enum <name>`, `[]u8`, `*Material`, ...),
  `enum` the enum key and `enum_t` its integer type (enum fields), `e` the element description and `at` the
  `Array_Type` (arrays), `notes` (`NoUndo`, `NoEditorUndo`, `NoEditorSave`).
- `k`: `p` plain data (raw `sz` bytes), `s` string, `r` resource pointer (by name), `a` dynamic array, `x` anything else.
- Enum keys: the enum's name when it is unique, else the first field that uses it (`Settings.special_level`,
  `Rock.properties`), else `<name>#2`, `#3`. `values` = [[name, value]]. `flags` = an `enum_flags` type.
- The exported enums are the ones fields use, plus a fixed list: `Level_State_Flags`, `Level_State_Misc_Flags`,
  `Move_Type`, `Direction`, `Action_Type`, `Character_Index`, `Character_Rank`, `Status_Flags`, `Entity_Flags`,
  `Transition_Glyph_Flags`, `Tower_Flags`, `End1_Flags`, `Skill_Flags`, `Inventory_Flags`, `One_Time_Bark_Flags`,
  `Achievement`, `Language`, `Promesst_Power`, `Render_Resolution`, `Graphics_Mode`, `Msaa_Mode`. `Action_Icon` and
  the undo record `Flags` are not exported; their values are above.

### data/levels.json and data/level_entities/

`levels.json` = `{level_sets: {<set>: [level names]}, levels: [...]}`, one row per level in the package:

- `name`, `level_sets` (the sets that list it), `entity_count`, `namespaces` (the 6 most common, [namespace, count]),
  `type_counts` (progression types only);
- `settings`: these `Settings` fields, type defaults filled in: `grid.squares_x`, `grid.squares_y`, `grid.num_squares`,
  `grid.wrapping`, `grid.corner.x`, `grid.corner.y`, `grid.corner.z`, `squares_z`, `story_tag`, `special_level`,
  `fast_travel_corner.x`, `fast_travel_corner.y`, `fast_travel_extents.x`, `fast_travel_extents.y`, `level_data_version`, `designers`, `intro_cutscene`,
  `outro_cutscene`, `story_proc`, `story_proc_arg_string`, `story_proc_arg_int`, `sound_level_name`;
- `entities`: `{<type>: [{id, pid, fields}]}` for `Level_Entry`, `Level_Connector`, `Overworld_Unlock`, `Area_Pin`,
  `Gem_Slot`, `Treasure`, `Treasure_Display`, `Level_State`, `Checkpoint`, `Teleporter`, `Artifact`, `Voice_Log`,
  `Marker`, `Switch`, `Freezer`, `Tower`, `Sign`, `Door`.

Entity `fields` hold only what the blob stores (a missing field is the type default). Base fields are prefixed `base.`
and only position, `orientation.z/w`, `entity_flags`, `entity_name`, `group_id` and `mesh` are kept. Floats are rounded
to 4 places. Enums are value names; a flags enum is a list of names, plus an int for unnamed bits. Reference fields
(`*_id`, `*_id2..4`, `group_id`, `target_id`, `also_discover`, `map_label_marker_id`, ...) are `["#ns-serial", pid]`, or
0 for none.

`level_entities/<level>.json` = `{level, columns: ["pid", "type", "x", "y", "z", "mesh"], types: [type names], meshes:
[mesh names], ents: [[pid, type index, x, y, z, mesh index or −1]]}` for every entity of the level.

### data/level_areas.json

The current-area rule applied at each overworld Level_Entry (the rule itself is in [Areas](STATE.md#areas) and
[Level areas (viewer)](VIEWER.md#level-areas-viewer)).

- `rule`: the rule text.
- `areas`: `{<local_area_name>: {pin, pin_id, local_area_name, display_name (en), local_area_image, position,
  map_label_marker, map_label_position, local_area_markers: [Marker pid], local_area_boxes: [{p, q, s, e, f, w}],
  level_count, level_count_with_fallback}}`. A box: `p` position, `q` orientation quaternion (x, y, z, w), `s` scale,
  `e` `props.box_extents`, `f` `float_parameter` (priority, lower wins), `w` the wrap widths used for x and y (the grid
  size, or the fast-travel extents for boxes at map-room height).
- `levels`: `{<level_name>: {entry, position, ...}}`. Inside a box: `area_pin`, `local_area_name`, `display_name`,
  `exact: true`, `marker`, `candidates` (how many boxes hold it), and for an entry in boxes of more than one area
  `overlap`: [[local_area_name, float_parameter]] of every box holding it, in record order. Outside every box: `exact: false`,
  `nearest_area_pin`, `nearest_local_area_name`, `nearest_display_name`, `nearest_marker`, `margin` (distance outside
  the nearest box, the largest per-axis value).
- `unassigned`: the levels outside every box.

### data/fog.json

- `level` "overworld"; `grid` {corner (−24, −2), screen (19, 13), count (10, 12), wrapping}: region = sx + 10 × sy,
  sx = ⌊(x − corner.x) / 19⌋, sy = ⌊(y − corner.y) / 13⌋, wrapped; −1 outside.
- `layers`: [{index, name, zmin, zmax}] the ground layer table (ONGROUND, UNDERGROUND, SKYGROUND,
  FAST_TRAVEL_UNDERGROUND, FAST_TRAVEL_ONGROUND, FAST_TRAVEL_SKYGROUND; null = unbounded).
- `states`: {0 FILLED, 1 PARTIAL, 2 CLEARED}.
- `primary`: [{pid, id, name, layer, z, zmin, zmax, z_overrides: [[region, zmin, zmax, Fog_Of_War_Z id]]}], one per
  layer. zmin / zmax = z − `descent` / z + `ascent` (defaults 4.5 / 6.5). The first Fog_Of_War_Z per region wins.
- `boxes`: [{pid, id, name, layer, min, max, regions (0 with `clear_as_part_of_room`, else 1), only_overhang}].
- `clears`: [{id, layer, region, dir (`clear_neighboring_screen`), to (the neighbour region, −1 for none), radius}].
- `level_entries`: [[level_name, layer, region]] for the overworld Level_Entries that are not broken or disfavored.
- `area_pins`: [[id, local_area_name, layer, region]].
- `start`: {hero, regions: {Fog_Of_War pid: [region]}, pins: [Area_Pin pid]}: a fresh campaign whose hero walked
  everywhere reachable at the start, taken as the fog before a save is loaded. It is a fixed value in `build-fog.js`,
  read once from such a save ([Fog of war](STATE.md#fog-of-war)).

### data/map.json

`{corner, size, layers, water_rgb, oceans}`, built as in "Drawing the map".

- `corner` is the world position of square (0, 0)'s centre. Square (i, j) covers x in [corner.x + i − 0.5, +1) and
  y in [corner.y + j − 0.5, +1).
- `layers`: [{key, name, z: [z0, z1], zbase, zscale, cells}] in the order underworld (−57, −4.001), ground (−4,
  9.999), sky (10, 75.156). `cells` = base64 of W × H × 4 bytes, row-major, row 0 = north (j = H − 1). Each square is
  R, G, B (sRGB) and a height byte h: 0 = nothing there (RGB 0), else the surface is at z = zbase + (h − 1) × zscale.
- `water_rgb`: the displayed open-water colour.
- `oceans`: [{pid, layer (index into `layers`), x0, y0, sx, sy, zw, water}] for every drawn Ocean_Map that is not
  PLAYER_BLOCKING_ONLY: square k is world square (x0 + k % sx, y0 + ⌊k / sx⌋), the drawn surface is at `zw` (z −
  `sink`), and `water` = base64 of the initial bit-0 mask, holes applied (bit k % 8 of byte k >> 3). Only an unrotated
  map fits this row; the build refuses a rotated one (the overworld has none).

### data/world.json

`{world, teleporters, treasure_displays, gold_rooms}`: the overworld as walkable cells, for the walk model
([The walk model (viewer)](VIEWER.md#the-walk-model-viewer)). `l` and `zlayer` values are ground-layer table indices:
0 ground, 1 underworld, 2 sky, 3-5 the fast-travel map rooms (underworld, ground, sky).

**`exists` column.** A row whose entity can be absent ends in `exists`: its state when the level loads. On load every
existence Group (`is_existence_group`) takes its `exists_by_default`; its stored `exists` is ignored. Its direct members
(other than `EXISTS_FOR_COSMETIC_TRANSITION_PURPOSES_ONLY` ones) get IN_EXISTENCE_GROUP and a CURRENTLY_EXISTS that
follows it, whatever flags they store, and the change passes into existence subgroups. So `exists` is:
- for a direct member of an existence Group: that Group's `exists_by_default`;
- for another entity flagged IN_EXISTENCE_GROUP: its stored CURRENTLY_EXISTS;
- 0 for an entity the cell lookup skips: `EXISTS_FOR_COSMETIC_TRANSITION_PURPOSES_ONLY`, `NOT_SNAPPED_TO_GRID` (no
  Door is in these lists) or `PLAYABLE_IN_PRELUDE` (the overworld has no prelude).

Rows without the column always exist. The save overrides it: member `entity_flags` CHANGEs, a Group's saved `exists`
(applied to its members and subgroups when it differs from the default) and CREATION_OR_DESTRUCTION records.

| Key | Shape |
|---|---|
| `world.grid` | {corner [−24, −2], size [190, 156], zoff 64, ft}. A z byte is z + zoff. ft = {corner [35, 104], size [50, 36], z 75}: Settings `fast_travel_corner` / `fast_travel_extents`, and the first integer z at or above the lowest FAST_TRAVEL Camera_Marker box (its centre z − extent − 0.5, rounded up). Cells at that z and above wrap inside the ft box instead of the grid |
| `world.zlayer` | [256] ground layer of each integer z = index − zoff: −64..−5 → 1, −4..9 → 0, 10..75 → 2, 76..84 → 3, 85..95 → 4, 96..191 → 5 |
| `world.solid` | zlib + base64 (JS `DecompressionStream('deflate')`). Per column j × W + i: u8 n, then n u8 (z + zoff), ascending. Wall_Set voxels of Wall_Sets without an `exists` entry, `OCEAN_HOLE` ones excluded, placed by the Wall_Set's position and orientation ([Wall_Set `wall_data` (voxels)](GAMEDATA.md#wall_set-wall_data-voxels)). A voxel at z fills the cell z |
| `world.groups`, `world.group_cells` | [{pid, exists, n}]: the Wall_Sets with an `exists` entry. `group_cells` = zlib + base64 of u8 triplets (i, j, z + zoff), n per Wall_Set in list order |
| `world.egroups` | [[pid, exists_by_default, [subgroup], [unexisted by], [member pid]]], the existence Groups sorted by pid (few exist by default). subgroup: its child existence Groups. unexisted by: the existence Groups whose `unexist_this_id`/`2`/`3` names it. Both are indices into `egroups`. member pid: its direct members other than Groups and the skipped kinds above. Making a Group exist makes its members and its subgroups exist, except a subgroup that an existing Group unexists; a Group that already exists stops the recursion (depth cap 21) |
| `world.floors` | [[pid, i, j, z(, exists)]] Fences with `blocking` and `is_floor`: a floor at the bottom of their own cell. It holds the hero at z and blocks vertical moves through it |
| `world.fences` | [[pid, i, j, z, side(, exists)]] blocking non-floor Fences on the grid axes. side 0 east, 1 north, 2 west, 3 south: the cell edge its +x axis points to. It blocks a move out of its cell across that edge and a move into its cell against it. Fences off the axes block nothing |
| `world.gates` | [[pid, i, j, z, open, notted, flavor, monster, closes(, exists)]] every Gate with its level-data `open`; a closed one blocks its cell and holds up the cell above (none is FLAT) until its switches or a hero in an OPEN beam open it ([Moves](VIEWER.md#moves)). monster = `is_monster_gate`. closes: the way the Gate pushes what stands in its cell as it closes, its local −z axis (local −x with `sideways`), reversed by `negate_direction`, as a side (0 east, 1 north, 2 west, 3 south), 4 up or 5 down ([Gates, switches and buttons](MOVEMENT.md#gates-switches-and-buttons)). A few are monster gates and a few stand open; many are notted |
| `world.switches` | [[pid, flavor, pressed, i, j, z(, exists)]] every Switch with its level-data `pressed` (all unpressed; most flavors have a single Switch). Gates of the same flavor follow them ([Cells](VIEWER.md#cells), [Moves](VIEWER.md#moves)) |
| `world.oceans` | [[pid, z, l, i, j, sx, sy(, exists)]] every Ocean_Map, all kinds. z = the map's z, the surface the movement rules use. Square k is cell ((i + k % sx) mod W, (j + ⌊k / sx⌋) mod H). A save's OCEAN_CHANGE `index` is k. Only unrotated maps fit this row; the build refuses a rotated one (the overworld has none) |
| `world.water` | zlib + base64. Per column j × W + i: u8 n, then n u16 indices into `oceans`, ascending: the maps with water (bit 0, after `detect_holes`) at that square in the level data |
| `world.rivers` | [[i, j, z, dir]] water squares with a flow `Direction` (1 E, 2 N, 3 W, 4 S) in the level data, in the maps the overhead map draws (not PLAYER_BLOCKING_ONLY, existing at load); z = the map's z rounded |
| `world.elevators` | [[i, j, zb, i2, j2, zt, mask, bottom pid, bottom exists, top pid, top exists]] per Elevator_Platform: its `bottom_owner` and `top_owner` Stairs frames (exists −1 when the frame has no `exists` entry), sorted by zb, j, i. mask bit 1: rides up from the bottom frame; bit 2: down from the top. 0 when a static solid voxel lies in the bottom frame's column between the frames, or when two or more Rocks stack on the platform. A single Rock on the platform clears the bit of the end the platform rests at, and the other end's bit stays only when that frame cell has two opposite open sides (to push the rock off). Most work both ways |
| `world.rocks` | [[pid, i, j, z(, exists)]] every Rock at its level-data position. The save moves them (position CHANGE), destroys them and creates others (CREATION_OR_DESTRUCTION) |
| `world.bridges` | [[rock or Gem pid, push i, j, z, water i, j, z]]. A non-SKIPPABLE Rock or a Gem standing on support, pushed by the hero from the push cell behind it (not solid, supported, no fence on that edge). It travels straight over supported cells that hold no solid, Gate, Freezer or other Rock and have no fence on the edge crossed (at most 40). The first unsupported cell must be water (a map surface within 0.6 of z) with no solid at z − 1. The rock stops one cell under the surface at any depth and holds the hero up |
| `world.movables` | [[pid, i, j, z, kind(, exists)]] what the hero pushes besides Rocks and Monsters: kind 0 Gem, 1 Promesst_Light, 2 Mirror, 3 Rover, 4 Friendly_Dragon. They stop dragon fire, and beams unless mirrorable |
| `world.blockers` | [[pid, i, j, z(, exists)]] Signs (`demo_phase` FULL_GAME), Treasure_Displays and Judges (none on the overworld): they cannot be pushed, block the hero, hold up what stands on them, and stop fire and beams |
| `world.mirrorable` | [pid]: the Rocks whose `properties` hold MIRRORABLE and the Rovers with `mirrorable`. Beams pass them |
| `world.magic_mirrors` | [[pid, i, j, z, ax, ay, bx, by, vertical, freezer(, exists)]] every Mirror with `is_magic` at its level-data position. (ax, ay) and (bx, by): a flat one's two open sides as grid steps, (0, 0) for a vertical one. freezer: the pid of the Freezer in its cell, else 0. The walk's hops ([Magic-mirror hops](VIEWER.md#magic-mirror-hops)) |
| `world.mirror_facings` | [[pid, quarter turns, shape]] every Mirror: its level-data `theta_target` in quarter turns (the save holds its changes) and shape 0 flat, 1 vertical, 2 `is_vertical_downward`. They give the open sides a TELEPORT line meets ([Moves](VIEWER.md#moves)) |
| `world.skippable` | [pid]: the SKIPPABLE Rocks, the skipping stones. The walk's skip lanes ([Skip lanes and the TELEPORT swap](VIEWER.md#skip-lanes-and-the-teleport-swap)) |
| `world.teleport` | [pid]: the Wardrobes whose `skill_flags` hold TELEPORT |
| `world.charm` | [pid]: the Wardrobes whose `skill_flags` hold CHARM. The walk's stones launched with CHARM ([Moves](VIEWER.md#moves)) |
| `world.transmute` | [pid]: the Wardrobes whose `skill_flags` hold TRANSMUTE |
| `world.trees` | [[pid, i, j, z(, exists)]] Trees. They stop dragon fire and beams while they exist; TRANSMUTE turns one into a crystal Rock (a CREATION record destroys the Tree) |
| `world.lilies` | [[pid, i, j, z(, exists)]] Lily pads at their level-data position; standable in their own cell over water. Those absent at load are all in the map rooms |
| `world.rover_facings` | [[pid, quarter turns]] per Rover: its level-data `theta_target`; even runs the Rover east-west, odd north-south ([Rovers](MOVEMENT.md#rovers)). The save's `theta_target` replaces it |
| `world.rock_spawns` | the same rows for the Spawners whose `spawned_entity_id` is a Rock. The walk puts a Rock the save left elsewhere back at the Spawner's cell once it reaches one of the Activators ([Rocks a Spawner puts back](VIEWER.md#moves)) |
| `world.lily_spawns` | [[spawner pid, i, j, z, lily pid, [[activator pid, i, j, z(, exists)]](, exists)]] the Spawners whose `spawned_entity_id` is a Lily, at their own cell, with the Activators whose `spawner_1` to `spawner_16` name them ([Activators and Spawners](MOVEMENT.md#activators-and-spawners)). The walk drifts the Lily from the Spawner's cell when it is a river cell ([Skip lanes and the TELEPORT swap](VIEWER.md#skip-lanes-and-the-teleport-swap)) |
| `world.area_pins` | [[pid, x, y, z]] world positions |
| `world.mechs` | [[kind, pid, i, j, z(, exists)]] what the walk models only in part, named in a level's "why": 0 DRAGON Monster, 1 beam blocker Rock (named `*beam_blocker` or `*beam_barrier*`), 2 Mirror or MIRRORABLE Rock, 3 SKIPPABLE Rock without FLIPPING_TARGET (a sunk stone carries it). Rock `properties` bits: MIRRORABLE 1, SKIPPABLE 2, SKIPPING 4, FLIPPING_TARGET 8. The walk adds every existing light's cell and its powered beam's cells as kind 1 |
| `world.monsters` | [[pid, i, j, z, kind(, exists)]] every Monster at its level-data position; each one stops dragon fire. kind = a DRAGON's facing side (its +x axis, as `fences`), −1 a GOBLIN, −2 neither ([Goblins, dragons and PROTECTION](MOVEMENT.md#goblins-dragons-and-protection), [Attacks](VIEWER.md#attacks)) |
| `world.beam_stops` | [[i, j, z]] cells of Eggs (none on the overworld). A beam also ends in `movables`, `blockers`, Trees, Rocks, shut Gates and frozen Freezers. Guys, Monsters, MIRRORABLE Rocks and mirrorable Rovers do not stop it ([Promesst beams and powers](MOVEMENT.md#promesst-beams-and-powers), [Beams](VIEWER.md#beams)) |
| `world.lights` | [[pid, i, j, z, side, up, down, powered, color(, exists)]] every Promesst_Light at its level-data position. side (as `fences`) is the beam's direction, its +x axis; −1 off the grid axes. up / down = `vertical_up` / `vertical_down`. powered = the level-data `powered` (0 for all; the save holds its changes; the walk computes power from `gem_slots` instead, [Beams](VIEWER.md#beams)). color = its `Promesst_Power` value: OPEN 0, THROUGH 1, SMASH 2, DOUBLE 3, STRONG 4, ENDPOINT 5, ALTER 7, GEM 8, SQUEEZE 9 |
| `world.gem_slots` | [[pid, i, j, z, beam_powered(, exists)]] every Gem_Slot; beam_powered = its level-data `flags` hold BEAM_POWERED (the save holds its changes). A room's lights are powered when its existing slots are all filled ([Promesst beams and powers](MOVEMENT.md#promesst-beams-and-powers)) |
| `world.held_gems` | [pid]: the Gems whose level-data `attached_to_entity_id` names a holder. Only a free Gem fills a slot |
| `world.wardrobes` | [[pid, i, j, z, side, skill(, exists)]] Wardrobes on the grid axes. side (as `fences`) is the door edge, its +x axis; fire does not cross it. skill 1 PROTECTION, 2 another skill, 0 none, inventory only |
| `world.guy` | [pid, protection]: the overworld Guy; protection = its level-data `skill_flags` hold PROTECTION (0) |
| `teleporters[]` | {pid, p: [x, y, z], l, major (1 MAJOR, else MINOR), target (`target_id` pid), en (level-data `enabled_t_target` > 0), and when set: also / also2 (`also_discover` / `also_discover2` pid), disc (`discovered`), gold (`gold_room_endpoint`), ex (as the `exists` column), g / ag (the `egroups` index of the pad's own Group and of its `also_exist_this_group_id` Group: enabling the pad makes both exist), to (the position of a target that is not a pad, a Marker, where the pad sends the mover)}. l follows a Group's `bind_to_layer`. Most pads are MAJOR, and most start enabled |
| `treasure_displays[]` | {pid, p, i = `treasure_index`}, sorted by i |
| `gold_rooms[]` | {tower (Tower pid), pad (teleporter index of the tower's `teleporter_id`, a MINOR pad), endpoint (teleporter index of its target, a `gold_room_endpoint` pad in the gold hub)}, one per ground tower |

### data/progress.json

Everything the viewer knows about the overworld in one file: progression rows, `world.json` merged in whole, `map.json`
as `map`, and fog. Level roles (Required / Optional, the Freezers each level sits behind) are not in it; they are in
[data/walk.json](#datawalkjson).

| Key | Shape |
|---|---|
| `levels[]` | the overworld Level_Entries that are not `currently_broken` or `currently_disfavored`, in level-data order: {n (level_name), p, req (indices into `levels` of `unlocked_by_id`..`id3`; may be empty), or (`unlock_is_or_gate` with 2+ ids), en (gated but `enabled_t_target` 1 in the data, so open from the start), t (`tower_flags` bits: HEROES 1, MIRRORS 2, SKIPPING 4, PROMESST 8, UPSTAIRS 16, DOWNSTAIRS 32), d (dropdown), a (achievement name), set: [index into `sets`, place in the set from 1], area (index into `areas`), areaNear (outside every area box, grouped with the nearest), overlap (in boxes of more than one area: [[index into `areas`, float_parameter]] in record order; the viewer picks among them by activated pins, [Level areas (viewer)](VIEWER.md#level-areas-viewer))} |
| `sets[]` | {name, n (levels in the set that exist)}: each level's first level set by set name, a `drafts*` set only when it has no other |
| `towers[]` | {pid, t (tower_flags bits), req (`levels_required`, type default filled in), p}, sorted ground first, then sky, then underworld, then by t |
| `freezers[]` | {pid, p, l (ground layer by z), req (indices into `levels` of `unlocked_by_id`..`id4`), or, partial (`partial_solve_count` set), judge (`judge_unlock_level`), doorway (model B, `base.mesh` `GAME_OVER_Freezer_B`), signs when some unlock ids are not levels: [{pid, rank} \| {pid, tower: index into towers} \| {pid, gold: 4} \| {pid}]} |
| `signs[]` | {pid, p, l, rank \| tower (index) \| gold: 4, status (a TOWER_STATUS sign), gates (indices into `freezers` that list it)}: the Signs that open gates by rank, tower or gold rooms, and the tower status signs |
| `treasures` | the number of Treasure_Displays |
| `voice_logs[]` | {pid, p, l, name, author, d (already `played` in the level data)} |
| `view_givers[]` | {pid, p, l}: the map scrolls |
| `areas[]` | {local_area_name, display (en name, else the key), p (label position: the `map_label_marker_id` Marker, else the pin), pin (Area_Pin pid), boxes (as `level_areas.json`), layer (ground / sky / underworld from the name's g/s/u), order}. order sorts by layer (ground, sky, underworld), then by the wrapped distance from that layer's hub area (`area_g_crossroads`, `area_s_upper_crossroads`, `area_u_crossroads_low`) |
| `fog` | {grid, primary: [{pid, layer}], boxes: [{pid, layer, min, max}] (boxes with `only_overhang` left out), levels: {level name: [layer, region]}, start} from `fog.json` |
| `map` | `map.json`, plus `main_box`: {underworld \| ground \| sky: {c: centre, e: extents}} of each layer's MAIN_MAP Camera_Marker box, the overhead map's view of the whole layer. Ground: c (79, 76, 2), e (94.57, 78.94, 4.62) |
| `endgame_way_ins` | [[level, [freezer index], replace]]: the way-in gates of the endgame levels, which the walk does not find, from the gate unlockers and positions ([Unlock plans and next steps (viewer)](VIEWER.md#unlock-plans-and-next-steps-viewer)). replace 1: the gates stand in for the walk's; 0: they fill in where the walk finds none. Rows: `end1` (the gold-room Sign's gates, 1); the end2 room's levels (the sky tower gates under the room, 0); `all_together_now` (the set's gates above the room, 1); every `endgame3` level (the chain in set order, 1) |
| `world`, `teleporters`, `treasure_displays`, `gold_rooms` | from `world.json`; `gold_rooms[].tower` becomes an index into `towers` (−1 if none) |

### data/walk.json

What the walk model ([The walk model (viewer)](VIEWER.md#the-walk-model-viewer)) works out from the level data alone,
so the page doesn't redo it on every load. `scripts/build-walk.js` runs the room search (`searchRooms()`), then the
page's own `staticRoles()` and `floorHeights()` with the room answers in use, over `progress.json`, and writes it last
in the pipeline.

| Key | Shape |
|---|---|
| `inputs` | {`progress.json`, `world.json`}: the SHA-256 (hex) of each input file's bytes. `tests/walk-data.test.js` fails when they no longer match, or when the walk on the current code gives other roles, floors or room answers |
| `roles.need` | {l, g}: one digit per level (`progress.json` `levels` order) and per Freezer (`freezers` order): 2 Required, 1 Required as one of several, 0 Optional ([Level roles (viewer)](VIEWER.md#level-roles-viewer)) |
| `roles.bg` | {l, g}: per level and per Freezer, the indices into `freezers` of the Freezers it sits behind, ascending |
| `floors` | {underworld, ground, sky}: per map layer key, zlib + base64 of one byte per map column (W × H = 29640, row-major, row 0 = north, as `map.json`): the highest z where the walk on the level data stands the hero there, plus 128; 0 where it stands him nowhere. The flood: gates as stored, no Freezer closed, every teleporter enabled and discovered, seeded at every Level_Entry, pad and Area_Pin. All values are whole numbers |
| `rooms` | {searched, variants, answered, empty, states, capped, data}: the exhaustive push search of the screen rooms ([Room answers](VIEWER.md#room-answers)) on the level data, with every Freezer closed and, for a room with up to three Freezers around it, with each other combination of them open. `searched`: rooms with an object and a place for the hero to start, searched with every Freezer closed; `variants`: rooms searched with some Freezers open (a merged room counts once for each combination that makes it); `answered`: answers stored that have entries; `empty`: answers stored with no entries, for rooms with no start, nothing to tell or too many positions (a walker that finds such a room as the level data has it does not search it again); `states`: positions visited in all; `capped`: the first cell of each room (or merged room) that hit the cap of 200 000 positions (no entries). `data`: zlib + base64 of JSON, a list of rooms `[cells, attackers, entries, opens]`: `cells` the room's cells (grid cell keys, ascending, each as the difference from the one before, the first from 0); `attackers` the pids of the Monsters whose attacks cross the room or the cells beside it, with the Freezers of `opens` open; `entries` the answers, one per start and one for all starts together, each `[reps, bridges, holders, filled, dead]`: `reps` a cell of each start piece of ground; `bridges`, `holders` and `filled` flat lists of `key, count, values…` (per Rock its water cells, per Switch cell its objects, per Gem_Slot cell its Gems, a Rock, object or Gem by the cell the level data puts it in); `dead` the cells of the Monsters that die; `opens` the states of the Freezers around the room (the Freezers in its cells or beside them, above or below, ascending by index) the answer holds for, each a bit set with bit n set when the nth of those Freezers is open (0: all closed). A cell key is `(z + 80) × W × H + row × W + column` on the walk's grid |

## Drawing the map

### The colour and height grid (map.json)

- **What is drawn.** Entities of type Inanimate, Rock, Procedurally_Animating, Tree, Stairs and Elevator_Platform with a
  mesh. Left out: `INVISIBLE` ones, Inanimates with HIDDEN_IN_MAP_VIEW (`overhead_map_flags` bit 1), pure black
  materials (shadow casters) and everything in the map rooms. Puzzle and progress entities are not drawn: their look
  changes at runtime. The layer comes from the ground layer table by z; a Group's `bind_to_layer` overrides it.
- **Rasterizing.** The LOD 1 triangles are drawn from above into quarter-metre sub-squares (4 × 4 per square) with a
  z-buffer: each layer keeps the highest sample per sub-square. A triangle covers the sub-squares whose centres lie
  inside it; one too small to cover any centre still leaves one sample at its centroid. A triangle that winds
  clockwise seen from above faces down and is not drawn (front faces wind counter-clockwise,
  [Render assets](GAMEDATA.md#render-assets); a mirrored placement, with a negative determinant, swaps that). The
  `foliage` and `foliage_masked` shaders are drawn from both sides.
- **Colour.** A sample gets the albedo its material's shader computes at its UV, interpolated from the triangle's
  corners: texture × material tint × entity tint (the shader table in
  [data/materials.package](GAMEDATA.md#datamaterialspackage)). Surface textures are read at their 64-pixel mip,
  tint maps at 512. The two layers blend by the red paint, interpolated from the corners too (`all_paint_data`, else
  the mesh's own vertex colours). For `ground_general` the tint maps are read at the sample's world position. In a
  cut-out material (`basic_masked`, `foliage`, `foliage_masked`) a texel whose opacity (`OPAC_tex`, else `MASKS_tex`,
  else the diffuse alpha) is below 0.5 is a hole. The 0.5 cutoff and the two-sided foliage are the builder's choices.
- **Walls.** Each visible voxel of a Wall_Set (not `OCEAN_HOLE`) is 4 × 4 points at its top (z + 1), colour
  0.75 × `tint_color_a`.
- **Water.** Every Ocean_Map in a drawn layer that exists at the start (by its stored flags) paints its water squares
  (bit 0, holes applied) at z − `sink` over anything lower. Colour, linear: 0.34 × `depth_color` of material
  `Ocean_Basic~overworld` + (0.018, 0.002, 0.016). Geometry within 1.2 m under the surface lightens it toward foam
  (0.11, 0.23, 0.39), up to half, keeping a tenth of the floor colour. All overworld water draws alike, though the
  mirror-isle materials differ.
- **Squares.** A square is filled when at least 4 of its 16 sub-squares hold a point. Its colour is the mean of those,
  its height the highest. Displayed colour = sRGB(tone(EXPOSURE × albedo)), EXPOSURE = (1.85, 1.72, 1.5), tone = a soft
  shoulder above 0.8: c → 0.8 + 0.2 × (1 − e^(−(c − 0.8) / 0.2)). EXPOSURE stands in for the game's lighting; it was
  fitted to one in-game full-map screenshot, so the colours are an approximation.
- **Height byte.** h = 1 + round((z − zbase) / zscale), clamped to 1..255; zscale = (z1 − zbase) / 254 over the layer's
  z range (the underworld's lower end comes from the data: −57).

### The viewer's base image

Per layer, 4 × 4 pixels per square, north up. Inputs: the `map.json` layer and `oceans`; `world` floors and lilies
(those whose `exists` is not 0), rivers, rocks, fences and Wall_Set voxels (solid, plus Wall_Sets whose `exists` is
not 0; a voxel at z has its top at z + 1); and the walk floors, `walk.json` `floors`: the highest z per square that a
flood of the level data reaches in that layer ([data/walk.json](#datawalkjson)). River Lilies add their whole drift
there.

Per square with a height byte, with wz = the highest drawn water surface there:
- *water* = a drawn map has water there. *wet* = water and (the square's z ≤ wz + zscale + 0.01, or its colour lies
  within OKLab distance 0.06 of `water_rgb`). *walk* = the walk floors have the square.
- Its kind, first match: LILY (a lily in the layer); BRIDGE (a floor Fence over water); FLOOR (walk and not wet);
  RIVER (water, no voxel top above wz + 0.05, and a `rivers` square); SHALLOW (walk); WALL (no water); WALL (a voxel
  top above wz + 0.5); FLOOR (a voxel top above wz + 0.05); DEEP.
- A DEEP square whose z is at least wz + 0.5 next to a FLOOR (4 neighbours) becomes WALL: a shore cliff.

Colours are OKLab:
- Smoothing: each channel is the median over the 3 × 3 squares of the same group (FLOOR, LILY and BRIDGE together;
  SHALLOW; DEEP; WALL; RIVER) whose colour lies within distance 0.07.
- band(lo, hi, ch): L' = lo + lift + (hi − lo) × clamp((L − 0.3) / 0.6), a and b times ch; lift = 0.1 ×
  clamp((chroma − 0.08) / 0.1) + 0.6 × max(0, L − 0.8), so strongly coloured and near-white squares keep some
  brightness.
- Fill: DEEP `water_rgb`; RIVER water with L + 0.07; SHALLOW and LILY water with L + 0.12, a and b × 0.8; WALL
  band(0.22, 0.32, 0.8); FLOOR and BRIDGE band(0.4, 0.56, 0.95).
- Edge lines, the outer pixel row on a side: a WALL next to an empty square band(0.4, 0.5, 0.6), next to a walkable
  square (FLOOR, SHALLOW, LILY, BRIDGE) band(0.14, 0.2, 0.6). A BRIDGE next to water: the SHALLOW colour. A RIVER next
  to a non-river square, unless that square is a lily or bridge on a river square: water with L + 0.33, a and b × 0.4.
  A FLOOR next to an empty square, or next to a walkable square whose floor is 1 or more lower: band(0.32, 0.46, 0.95).
- A blocking Fence in the layer, within 1 of the walk floor: RGB (30, 34, 38) on its side.
- A lily: inner pixels RGB (104, 168, 92), rim the river or deep colour. A level-data Rock in a DEEP, RIVER or SHALLOW
  square: inner pixels RGB (112, 100, 90).

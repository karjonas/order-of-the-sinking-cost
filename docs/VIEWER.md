# The viewer's model

The viewer's own model built on the game's rules: the walk, level states, roles, unlock plans, goals, level areas, the
page and the spoiler rules. The game does none of those; they are how the viewer approximates what the player can
reach.

## The walk model (viewer)

The viewer's own approximation of where the hero can go: `walker()` and `reachability()`, data from
`data/world.json` and `data/progress.json` ([Derived data files](DATAFILES.md#derived-data-files)). What the walk
gives on the level data alone (the static roles and the map's floor heights) is worked out at build time and stored in
`data/walk.json` ([data/walk.json](DATAFILES.md#datawalkjson)). It is fitted to the game's rules but is not the game's
walk code. Every simplification is listed at the end of this section.

### Cells

- One cell per integer (i, j, z), i, j = grid indices (`round(x) − corner`), z from −79 up to the top of the world.json z range (z bytes there are z + `zoff`); a position outside that range has no cell. Neighbours wrap: below z 75 inside 190 × 156; at z ≥ 75 (the map rooms) inside the fast-travel box (`grid.ft`: corner (35, 104), size (50, 36)). A position at z ≥ 75 is wrapped into the box first.
- Each cell has bits: SOLID, SUPPORT (holds up the cell above), FLOOR (holds the hero in its own cell), GATE (a shut Gate), ROCK, MONSTER, MOVABLE, BEAMSTOP; and beside them fence sides (one bit per side), FIRE (attacked), THRU (a THROUGH beam's wall cell), BEAM (a THROUGH beam cell).
- Filled from:
  - Wall_Set voxels: SOLID | SUPPORT. Group members only while they exist ([Existence](#existence)).
  - Rocks at their latest positions: SUPPORT | ROCK, plus BEAMSTOP unless the Rock's latest `properties` (else level data) hold MIRRORABLE. Rocks the save created (TRANSMUTE crystals) are added at their latest position; destroyed ones left out.
  - Fences with `blocking` and `is_floor`: FLOOR. Other blocking Fences: the side bit (0 E, 1 N, 2 W, 3 S) on their cell.
  - Trees (while they exist, created ones too), Signs of FULL_GAME, Treasure_Displays, Judges: SOLID | SUPPORT | BEAMSTOP.
  - Movables (Gem, Promesst_Light, Mirror, Rover, Friendly_Dragon) at their latest positions: MOVABLE, plus BEAMSTOP unless it is a `mirrorable` Rover (listed in `world.mirrorable`).
  - Eggs: BEAMSTOP (none on the overworld).
  - Lilies, while they exist (`exists`, Groups as in [Existence](#existence)): FLOOR at their level-data cell and their latest cell.
  - Lily drifts: a Lily whose latest cell is a river square is taken to be at every cell of its drift at once, and each of those cells holds the hero ([Lilies](MOVEMENT.md#lilies)). The drift starts at the latest cell and follows the river's flow, coasting on in its last direction over still water. It enters a cell with water within 0.5 of z that is not blocked and holds no pushable or beam stop. It ends at a blocked step or when a cell and heading repeat (at most 4 (W + H) steps). An absent Lily drifts nowhere. On a loop this matches the game, since the Lily comes round again.
  - Living Monsters (latest position, `dead_t` = 0): MONSTER.
  - Shut Gates: GATE | SUPPORT. A shut Gate holds up what stands on it (none of the 177 overworld Gates is FLAT); once a flood opens it (a switch press or an OPEN beam, [Moves](#moves)) it holds up nothing. A switch gate follows its flavor's existing Switches: open = (all latest `pressed`) xor `notted`. A monster gate and a gate whose flavor has no Switch keep their latest stored `open`. An open notted Gate that a flood's switch press shuts blocks its own cell and holds up the cell above from then on.
  - Elevator frames of linked elevators: FLOOR on both frame cells.
  - Closed ice gates (`frozen`): not entered.
- Water per column: the Ocean_Maps with water there (level data, plus every map whose latest OCEAN_CHANGE sets bit 0 at the square), sorted by map z, highest first. `waterAt(column, z)` = the surface of the first existing map in z's ground layer with map z ≤ z + 2.1.

### Existence

An entity is left out (the game's cell lookup skips it) when:

- its latest CREATION_OR_DESTRUCTION destroyed it;
- its latest `entity_flags` hold EXISTS_FOR_COSMETIC_TRANSITION_PURPOSES_ONLY, NOT_SNAPPED_TO_GRID (no Door is modelled) or PLAYABLE_IN_PRELUDE (the overworld has no prelude);
- it is a direct member of existence Group G and G's state differs from its default: then the Group decides. G's state = its latest `exists`, else `exists_by_default`;
- else by its latest `entity_flags`: IN_EXISTENCE_GROUP without CURRENTLY_EXISTS;
- else by the level data's default (`world.json` gives a Group member its Group's `exists_by_default`).

`withGroups(G…)` makes Groups exist for one walk the game's way ([Existence groups](ENTITIES.md#existence-groups)): each Group, then its existence
subgroups up to depth 21, skipping a subgroup that an existing Group unexists, stopping at a Group that already exists.
Members' cell writes are applied for that walk and undone after. A horizontal THROUGH light that the Groups power casts
its beam then too ([Beams](#beams)). Fire, other beams, pads, Wardrobes, elevators and switch latches are not
re-derived inside it.

### Support and open cells

- Supported (`supported`): SOLID in the cell itself, as the game holds an entity inside a wall voxel ([Support](MOVEMENT.md#support)); such a cell is entered only as a THRU cell, along a THROUGH beam, so a hero who steps into a floating wall voxel stays in it, over water or air; FLOOR in the cell; a cell of a Lily's drift ([Cells](#cells)); a notted Gate the flood has shut in the cell below; SUPPORT in the cell below, unless that is a Gate the flood has opened; a bridged water cell ([Moves](#moves)), and in a pocket flood every rock bridge's water cell; a powered DOUBLE beam cell over water with z within 0.6 of the surface; else the implicit ground floor, ground layer only: z ≤ 0 on a dry column, z < 0 in water. The map rooms' implicit floor is left out: a fall that starts in a map room lands inside that room's layer or nowhere.
- The walk does not model the column mask ([Support](MOVEMENT.md#support)). On the overworld the Annihilator makes every column count as inside, so the mask makes no cell solid, and the ground floor above is the game's implicit-floor rule.
- Blocked: SOLID or GATE, unless the cell is a THROUGH beam's wall cell (THRU); a GATE without SOLID also passes when a switch press has opened it or a hero in an OPEN beam has bumped it open ([Moves](#moves)). An open notted Gate that a switch press has shut is blocked. A closed ice gate is always blocked.
- Open = not blocked and supported.
- `land(k)`: the cell itself if open, else the cell above (except for an Area_Pin or a kept hero position: not above), else the cell below.

### Attacks

- A living existing goblin attacks its 4 neighbours and the cells above and below, except cells with SOLID, SUPPORT, GATE or MONSTER.
- A living existing dragon fires from its latest cell along its facing (latest `theta_target` rounded to 90°, else its level-data side), one cell at a time, at most W + H steps, until it returns to its cell, crosses a Wardrobe door edge (out of the cell or into a door cell from its front), or meets SOLID, SUPPORT, GATE, MONSTER, MOVABLE or a closed ice gate. Each cell before the stop is attacked. Mirrors stop the fire (no reflections).
- A Monster that only a Group makes exist blocks its cell; its attacks are left out.

### Beams

- Room power, the game's rule ([Promesst beams and powers](MOVEMENT.md#promesst-beams-and-powers)). A room is a 19 × 13 screen of the ground, underworld or sky layer, or a whole map-room layer. Its lights are powered when it has at least one existing Gem_Slot and every existing one is filled: an existing free Gem stands in its cell (latest `attached_to_entity_id` 0, else not held in the level data), or its latest `flags` (else the level data's) hold BEAM_POWERED. A light's room is the room of its latest cell. The saved `powered` is not read.
- Every existing Promesst_Light, at its latest cell and not in a closed ice gate's cell, is a lit cell. A powered one casts a beam from its cell along its facing, or up or down for `vertical_up` / `vertical_down`, at most W + H steps, until it returns to its light, meets GATE or BEAMSTOP, or a closed ice gate. Solid voxels never stop it, so a vertical beam leaves its layer: one that starts below the map rooms climbs no higher than z 74, half a cell under them; one going down runs to the bottom of the grid. Mirrors stop it.
- Horizontal THROUGH beam cells get BEAM; their SOLID cells get THRU (walkable).
- At infinity: a beam is at infinity when it ends because its next cell would leave the level volume: below or above the grid, or, for one that starts below the map rooms, into them (z 75 and up). The grid wraps in x and y, so only a vertical beam ends there.
- Per beam cell: ENDPOINT beams (horizontal only) record their side, their cells in order (the light's own cell left out), the cell's place among them and whether the beam is at infinity (never, for a horizontal beam); DOUBLE beams count; ALTER, SQUEEZE and OPEN mark. Vertical beams count and mark too.
- A horizontal THROUGH light that is unpowered only because an existence Group keeps it, or a Gem_Slot or Gem of its room, from existing, casts its beam inside `withGroups` for that Group ([Existence](#existence)).

### Moves

Three layers per cell: 0 = the default skill or another one (the hero pushes), 1 = PROTECTION, 2 = TELEPORT (from a
TELEPORT Wardrobe's door). A flood pops a cell k with layer p and tries the four sides:

1. OPEN: a hero at k in an OPEN beam and in no ALTER beam opens the shut Gate in the neighbour cell that way, if that cell holds no SOLID, is not a closed ice gate and has no fence on the edge (unless SQUEEZE is at k). The Gate stays open for the rest of the flood. In the game the mover bumps and the Gate opens; he steps in on the next press ([Gates, switches and buttons](MOVEMENT.md#gates-switches-and-buttons)). With ALTER at k nothing opens.
2. Destination n: with an ENDPOINT beam at k along that axis, the beam's last cell when moving with it, its first when moving against. With ALTER at k as well, the midpoint of the way there: of the beam's c cells, with k at place i, towards the end the cell at i + ⌈(c − 1 − i) / 2⌉, towards the light the cell at ⌊i / 2⌋. A move along a beam at infinity, with or without ALTER, gives no destination and that side is skipped: in the game the hero leaves the map and is destroyed ([Promesst beams and powers](MOVEMENT.md#promesst-beams-and-powers)). A move against it jumps as usual. Only vertical beams end at infinity and ENDPOINT moves follow horizontal ones, so today this never applies. Without an ENDPOINT beam, the neighbour, repeated 2^d times for d DOUBLE beams at k, 3^d with ALTER at k. n = k is skipped.
3. A fence on the edge (k's side or n's opposite side) refuses the step, unless SQUEEZE is at k.
4. If n holds ROCK, MONSTER or MOVABLE: refused in layers 1 and 2 (a Wardrobe skill replaces SINGLE_PUSH, so a PROTECTION or TELEPORT hero pushes nothing). Else the cell b beyond n must not be k, not be blocked, not hold another pushable, and have no fence between n and b (one push; no chains, MULTIPUSH or PULL). The pushed thing is not moved in the model.
5. If n is blocked: refused; a closed ice gate there joins the walk's front, unless its cell is also SOLID or GATE.
6. A THRU cell is entered only from a BEAM cell.
7. The new layer p2: leaving k through a PROTECTION Wardrobe's door → 1, from layer 2 too (he loses TELEPORT); through a TELEPORT Wardrobe's door → 2; through another skill's door → p (that skill adds to his own); entering n through any skill Wardrobe's door → 0; an inventory Wardrobe changes nothing.
8. Fall: from n down, with no height limit: stop at a blocked cell; an attacked cell (FIRE) takes the hero only in layer 1 and ends the fall either way; a cell more than 0.1 under a water surface ends it (he would drown); the first open cell is reached. A fall that starts in a map room ends with no landing where it would leave that room's layer. A pocket flood keeps every fall inside the layer it starts in: a fall into a lower layer is not walked back, so what lies below is no part of the pocket.

After the four sides:

9. TELEPORT swaps from k, layer 2 only. Along each side, at k's z, the line wraps (inside the fast-travel box at map-room z) and crosses water and air. It ends at the first target, an existing Rock, a living Monster or a movable other than a Mirror: the hero lands in its cell, then falls as in step 8, in layer 2. It ends with no swap at a blocked cell (a solid voxel outside a THROUGH beam, a Tree, Sign, Treasure_Display or Judge, a shut Gate, a closed ice gate), a Mirror (its turn is not modelled), a Wardrobe door edge, or back at k.
10. Magic-mirror hops from k, also in walks on foot: each landing cell of k ([Magic-mirror hops](#magic-mirror-hops)) that is not blocked, reached by the fall of step 8, in layer p.
11. Travel from k (skipped by walks "on foot"):
   - an elevator frame cell reaches the far frame cell if it is not blocked (per `world.elevators` mask: bit 1 bottom → top, bit 2 top → bottom);
   - a pad in k or the cell below, enabled: a MINOR pad reaches its target pad's landing cell, or for a Marker target (`to`) a search down from the Marker's cell inside its ground layer (no fall cap): a blocked cell or water deeper than 0.1 ends it with no landing; an attacked cell ends it, with the hero standing there in layer 1 (support not needed) and nowhere in layer 0; else the first open cell;
   - a discovered, enabled, existing MAJOR pad reaches every other such MAJOR pad (once per layer);
   - an enabled MAJOR pad also reaches the world pads its discovery reveals ([Pads revealed through the map rooms](#pads-revealed-through-the-map-rooms)).
   Pads keep the layer.

Rock bridges (`world.bridges`, 194 rows: [rock, push cell, water cell]): a non-SKIPPABLE Rock on support, still at its
level-data cell, that the hero pushes in a straight line from a standable push cell over supported, fence-free cells
(no solid, Gate, ice gate or other Rock) into a water cell (a surface within 0.6 of z) with nothing at z − 1. When the
queue drains, each rock whose push cell was reached bridges once: its water cell becomes supported and the walk resumes
from the reached cells beside its column, at its height and above, up to the first cell over it that a step from the
side would stop in or bump into. A bridge is one-way: only the push side can make it. A pocket flood
([Pockets, leads and why](#pockets-leads-and-why)) looks for the ways into its pocket, so there every bridge's water
cell holds the hero from the start, whichever side the push cell is on.

Switch presses. A Switch is pressed only while something stands on it, and the overworld has one Guy, so the walk
presses a flavor only with objects ([Gates, switches and buttons](MOVEMENT.md#gates-switches-and-buttons)). The hero
alone opens nothing. One latch per flavor with an existing Switch not pressed: a press opens the flavor's shut gates
and shuts its open notted gates together. An opened Gate no longer holds up the hero above it; a shut notted Gate
blocks its own cell and holds up the cell above.

When the queue drains, a flavor is pressed once the walk has reached every unpressed existing Switch of it and can
bring a separate object onto each one. Then its gates open and shut and the walk resumes beside each, as for a bridge
(above a shut one). Flavors go in the order of their first such gate in `world.gates`.

- Objects: a Rock, a living Monster or a movable, at its latest cell; not a Friendly_Dragon.
- The search walks back from the Switch, nearest first, over at most 256 states (a cell, and whether the way on from it
  skips). From a cell the object is pushed one cell into the next one by a hero standing behind it, in a cell the
  flood reached without a Wardrobe skill (layer 0), or in the reached cells a pocket or lead flood stays out of. A cell the object stands in holds it
  (FLOOR, SUPPORT below, a notted Gate below that a press has shut, or the dry implicit ground floor). SUPPORT below
  counts even where the flood has opened that Gate: a Gate shut at any point in the flood holds an object, though an
  opened one holds up no hero ([Support and open cells](#support-and-open-cells)).
- The ways onto a cell: a push onto it; a push off a ledge above it, with a fall of at most 8 cells through open air
  (no wall, Gate, closed ice gate, pushable, water or cell that holds it on the way); a skip, for a skipping stone
  only: it is pushed into level water and its landings ([Skip lanes and the TELEPORT swap](#skip-lanes-and-the-teleport-swap))
  hold the cell. A stone on a drifting Lily can be pushed off it into a skip too.
- Walls, shut Gates and closed ice gates stop the object, as they stand when the walk runs: it passes a Gate the
  flood has opened (by a press or an OPEN beam) and stops at a notted Gate a press has shut.
- A Switch already pressed in the save needs nothing.

When its queue drains, a flood tries the rock bridges, then the Switch flavors, then the skip lanes, and goes on while
one of them adds cells. Each walker indexes them by the cells that can fire them (`triggerIndex`: bridges by push
cell; flavors by unpressed Switch cell; lanes by launch push cell and the cells next to the stone in layer 0, line
cells in layer 2, and ride cells in any layer for a pocket flood), so a flood looks only at what the cells reached
since its last look touched. That changes no result.

### Magic-mirror hops

ACTIVATE swaps every target of a room's magic Mirrors with its mirage, all or nothing
([Magic mirrors](MOVEMENT.md#magic-mirrors)). The walk models the one case that needs no other target: a hero on one
open arm of a flat magic Mirror alone in its room lands on the cell as far down the other arm.

- Mirrors: `world.magic_mirrors`, at their latest cells, existing, not in the cell of a closed ice gate. Every listed
  Mirror counts towards its room (a 19 × 13 screen in its ground layer), vertical ones too. A Mirror is used when it
  is flat, the only one in its room, below the map rooms (z < 75) and both arms lie on grid axes.
- A ray along an arm runs at most max(100, W, H) cells. It stops at SOLID, a shut Gate, a closed ice gate's cell, or
  a Rock or movable that a beam does not pass. It finds a target at a Monster, a MIRRORABLE Rock or a `mirrorable`
  Rover.
- For each arm the hero may stand on: the other arm's first stop, first target and first Fence are found. The hero
  stands d cells out on his arm, past no Fence, stop or target; d must be less than the other arm's first target, stop
  and Fence. He lands d cells out on the other arm. Each hop is one-way: arm cell → landing cell.
- A Mirror standing on a Lily's cell hops too. Those hops hold only while the Lily stays where the save last left it
  (`driftHops`). The page does not yet show which plans depend on them.
- The game processes a mirage only while the Mirror's room holds a Guy of the active hero. The walk does not check
  that the arm cell lies in the Mirror's room; an arm can run out of it.

### Skip lanes and the TELEPORT swap

A TELEPORT hero swaps with the first target on his line, at any distance and over water
([TELEPORT and PULL](SKILLS.md#teleport-and-pull)); the walk does this in layer 2 ([Moves](#moves)). A skipping stone
carries him across water this way: it is pushed into the water, skips to a cell that holds it, and the hero swaps onto
it from a line cell. The stone is pushed before he takes TELEPORT, and it may land on a Lily and ride it. The walk lays
these out as lanes once per walker.

- Stones: the SKIPPABLE Rocks (`world.skippable`) that exist, at their latest cells, whose latest `properties` still
  hold SKIPPABLE and not FLIPPING_TARGET, and that are not more than 0.1 under a water surface.
- Pushes: from its cell the stone is pushed over dry cells, one cell at a time, from a push cell behind it that is
  standable, not blocked and not the stone's first cell, with no fence on either edge, into a cell that is not blocked
  and holds no pushable. A cell that holds it (FLOOR, SUPPORT below, or the dry implicit ground floor) is a new place
  for the stone, up to 200 places. A cell with water level with the stone (a surface in [z − 0.5, z + 0.5)) is a
  launch: [side, push cell, first water cell].
- Skips: from the first water cell the stone goes on one cell at a time, at most W + H. It can stop on each cell of a
  Lily's drift ([Cells](#cells)) it crosses, the launch timed for the Lily to be there, and lands on the first other
  cell that holds it: each of those is a landing. It is lost at a fence on the edge, a blocked cell, a pushable, or a
  cell without level water.
- The ride ([Lilies](MOVEMENT.md#lilies)): a landing cell that holds an existing Lily (at its level-data or latest
  cell, or on its drift) starts one. The stone kicks the Lily along its own heading. From the next step on, the river flow under the Lily steers
  it; over still water it coasts on in its last direction. It enters a cell with water within 0.5 of z that is not
  blocked and holds no pushable or beam stop. The ride ends at a blocked step or when a cell and heading repeat (at most
  4 (W + H) steps). The ride is the landing cell plus every cell the Lily enters; without a Lily it is the landing
  cell alone.
- The line: from each ride cell in each direction, until a blocked cell, a pushable, a Wardrobe door edge or the start
  cell again (at most W + H). Cells on it that are open and not more than 0.1 under a surface are where the hero can
  stand to swap; those of them that come after a cell he can't stand in are past a gap. The Lily under the stone
  carries no hero: a cell held up only by that Lily (one Lily lies under the landing, the cell holds that one alone,
  and nothing below holds it up) is no line cell.
- One lane per ride cell the hero swaps into. He rides from there to the end of the ride, or, when the line cell he
  swapped from lies further along the ride, to the cell just before it: the stone, swapped into that cell, stops the
  Lily there. A lane's line cells are those whose ride ends at the same cell.
- The swap, when the queue drains: the stone is not in a closed ice gate's cell, the launch push cell and a cell next
  to the stone are reached in layer 0, and one of the lane's line cells is reached in layer 2. Then every cell of the
  lane's ride is reached in layer 2: the hero rides with the stone and steps off anywhere along it. The walk resumes.
  Lanes go in one pass in their order; a lane that a swap in the pass brings due fires in the same pass only when it
  comes later in the order. That is the order the
  skills allow: a TELEPORT hero can't push ([Pushing and pulling](MOVEMENT.md#pushing-and-pulling)), so the stone goes
  first.
- A pocket flood walks a lane backwards only: when it reaches any cell of the lane's ride, it reaches the launch push
  cell and the lane's line cells past a gap, in layer 0. A forward swap inside a pocket flood would follow a one-way
  edge the wrong way.
- Left out: the walk from the Wardrobe to the line is not checked for a door-in that would reset the skill; pushes are
  single ([Routes that need these mechanics](MOVEMENT.md#routes-that-need-these-mechanics)).

### Pads revealed through the map rooms

- `reveals(T)`: discovering pad i discovers its `target_id`, then its `also_discover`, each with its own chain (a pad already in the set ends it), then its `also_discover2` alone. Of those, the world-layer pads (layers 0-2) other than i are its reveals.
- A revealed pad q counts for MAJOR pad i only when q exists and a walk on foot (no pads, no elevators) joins i's twin (its `target`) to some twin targeting q, with the Groups of the four pads (`g` own Group, `ag` = `also_exist_this_group_id`) made to exist (`withGroups`). Twins are not asked to exist: discovery makes them.
- Twin `also_discover` links walkable this way: 132 of 156 in the level data, 149 with every twin Group on.

### Seeds and the reached cells

`reachability()` floods once from every place the save shows the hero has been:

- the current hero position, in one layer: 1 when the latest Guy `skill_flags` hold PROTECTION, else 2 when they hold TELEPORT, else 0. In layer 1 inside an attacked cell, that cell; else `land` (not above); none if inside a wall no THROUGH beam runs through;
- every kept hero position: a protected one (the PROTECTION rule in [Overworld state from the save](STATE.md#overworld-state-from-the-save)) inside an attacked cell seeds that cell in layer 1; otherwise `land` (not above), in layer 1 for a protected one, else in layer 0 and, where he held TELEPORT, in layer 2 as well; dropped when it lands in water deeper than 0.1 or inside a wall no beam runs through (a dead seed);
- every Level_Entry with Status state (`land`);
- every activated Area_Pin (`land`, not above: a pin is touched, not stood on, and the new-game pin stands inside a wall);
- every discovered teleporter (its pad cell).

The result R is the set of reached cells. A level is reached when its cell or `land` of it is in R and it is not frozen
in a closed ice gate (its Level_Entry on the gate's square: 16 overworld levels). A frozen level is reached only once that gate opens.

### Pockets, leads and why

- Leads: each closed ice gate the walk bumped into (`front`) is opened alone; the levels not entered that a walk from it (outside R) reaches are its leads. A level frozen in another gate is left out.
- A level not reached sits in its own pocket: a walk from it that never enters R (no reveals). The closed gates that walk bumps into are the gates it sits behind. This pocket flood walks the one-way edges backwards, since it looks for the ways in: every rock bridge holds the hero from either side ([Moves](#moves)), and skip lanes run from the landing back to the push side ([Skip lanes and the TELEPORT swap](#skip-lanes-and-the-teleport-swap)). Magic-mirror hops stay one-way.
- A level frozen in a closed ice gate starts its pocket walk in the gate's own cell, where the hero stands once the gate opens. The pocket's gates and levels go to the other levels in it; the frozen level itself sits behind its own gate alone.
- A pocket holding a pad that another pad reveals is also entered from the revealing pad's pocket: its gates and levels join (`viaPads`).
- `from`: for a level a closed gate needs, the levels behind that gate a walk from the level reaches.
- `mech`: per pocket, the mechanics the walk leaves out (world.mechs: 0 dragon, 1 beam, 2 mirror, 3 skipping stone), marked in the 3 × 3 × 3 cells around each existing one (a Mirror or MIRRORABLE Rock at its latest cell, a smashed or destroyed one not at all; a stone at its latest cell unless it sank: FLIPPING_TARGET or under the surface; beams: lit cells; dragons: fire cells). A pocket has one when a marked cell is in it or next to one of its cells.
- Why (per blocked level): its gates (those that lead in, without the ones `inner()` rules out), the gates leading only to a revealing pad (`pad`), the levels by such a pad (`via`), and the mechanics. A level with no gate and no mechanic has "no known route", even when it carries an access mark (below).
- `inner(gate, level)`: a closed gate is no way in when what it still needs is the level itself, levels from which the walk reaches the level without it, or levels whose own requirements need the level. For an OR gate with more than one option: every remaining option is such a level, and it has no Sign.
- Levels whose requirements need level L (`levelsNeedingLevel`): walking back along `unlocked_by`, every unsolved level still waiting on its requirements (not enabled in the level data, and for an OR level no option solved) that requires L or such a level. An AND level needs L through any one requirement; an OR level with more than one option only once every option is L or such a level. A gate that waits on them waits on L: a requirement cycle, no way in.
- Way in (`P.wayIn`): per blocked level, its why-gates; when no gate leads in, the closed gates it sits behind in the static roles ([Level roles (viewer)](#level-roles-viewer)), minus the `inner` ones. In the endgame areas the level data's table stands in for these or fills in where there are none ([Endgame way-in gates](#endgame-way-in-gates)). Last, the gates behind themselves are dropped ([Next steps](#next-steps)).
- A pocket flood never walks a fall backwards: a pocket that the hero enters only by falling into it from outside gets no way in from that fall, except from the sky (below).
- Sky entrances (`skyEntrances()`, per level `fromSky`): a sky ledge is a cell over a solid voxel of the sky layer (static, or of an existing Group) that is not blocked, attacked or under a water surface (a hero there drowns, so it is no ledge). The hero steps off it to a side with no fence on the edge and no pushable in the cell, and falls down that column. A cell lets him fall on when it is not blocked or attacked and nothing holds him there. Per column the walk keeps the lowest such step, and drops the column when anything between that step and the bottom of the sky layer would stop the fall. A pocket is entered from the sky when one of its cells below the sky has a clear fall up to the bottom of the sky layer in such a column. That covers a hole in a sky floor above the pocket and a step off a sky floor's edge.
- Access (`P.access`): a blocked level on a layer where the walk reaches no cell at all (the sky or the underworld) is marked with that layer. A blocked level whose pocket is entered from the sky is marked with the sky while the walk reaches no sky cell, so its plan waits on the way onto the sky ([The requirement graph](#the-requirement-graph)).
- So a sky hub ringed by ice gates that all need levels inside the ring gives its first level no way-in gate: while the walk reaches no sky cell that level waits on the way onto the sky, otherwise it is a step of its own ([The requirement graph](#the-requirement-graph)). The levels frozen in the ring follow from the ring's levels.

### What the walk leaves out

- Mirrors: no reflections of fire, beams or the TELEPORT line (each ends at the Mirror), so no lift by a beam turned up. Magic-mirror teleports only as the hops of a flat magic Mirror alone in its room below the map rooms ([Magic-mirror hops](#magic-mirror-hops)): no vertical magic Mirrors, no rooms with several, none in the map rooms, no swaps of other targets, no reflected rays, no check that the hero's cell is in the Mirror's room. A hop's ray stops at every Gate cell the save left shut, also one the flood opens later, where the game stops only at a Gate shut at the time (inferred). A Mirror riding a Lily hops as if the Lily stayed where the save last left it.
- One-way edges in pocket floods: they count every rock bridge from either side and walk skip lanes backwards, from the landing to the push side; they keep falls inside the layer they start in, and walk no fall backwards but the sky entrances, so a drop into a ground pocket from the z 1 wall tops beside it is no way in ([Pockets, leads and why](#pockets-leads-and-why)).
- Skills: one push of one cell; no MULTIPUSH rows, PULL, CHARM, TRANSMUTE (only its saved results), SWAP_WITH_DRAGON. Layer 0 can't tell MULTIPUSH from PULL, CHARM or another skill, so every hero outside layers 1 and 2 pushes. Skills don't stack on PROTECTION or TELEPORT: a PROTECTION + MULTIPUSH hero is treated as unable to push, a PROTECTION door taken in layer 2 drops TELEPORT, and a TELEPORT door taken in layer 1 drops PROTECTION. In the game that holds only when the hero enters that Wardrobe through its door, which resets him to QUEEN | SINGLE_PUSH; entered through its back or a side, he leaves it with both skills ([Wardrobes](SKILLS.md#wardrobes)).
- TELEPORT ([Moves](#moves)): the line runs at his own z only (no wait on a FALLING hit at z + 1 or z + 2), is not scaled by DOUBLE beams (the game scales it 2ⁿ, 3ⁿ with ALTER), and doesn't turn at a Mirror; no swap with another Guy or in an ENDPOINT jump; the flood takes both the step and the swap where the game swaps whenever the line finds a target. The walk from the Wardrobe to a skip line is not checked for a door-in reset.
- Beams: SMASH, STRONG; OPEN only for the Gate next to a hero standing in the beam (no pushed, falling or skipping movers, and ALTER only keeps the Gate shut: an open Gate is never shut); vertical THROUGH and vertical ENDPOINT beams; beams of lights that moved before being powered; a room losing power when a Group makes an unfilled slot exist (in the game its lights go off, [Promesst beams and powers](MOVEMENT.md#promesst-beams-and-powers)); colours other than THROUGH inside `withGroups`.
- Gates shutting on what stands in them (push or crush, [Gates, switches and buttons](MOVEMENT.md#gates-switches-and-buttons)), so also the closing Gate that lifts the hero onto the step of the sky hub's south way.
- Switches: an object brought onto a Switch by CHARM, PULL, MULTIPUSH or TRANSMUTE (a crystal made on the Switch), or a Monster that walks onto it; a closed ice gate on the object's way counted as a way in. An object counts as held by a Gate below it that was shut at any point in the flood, even once the flood has opened it; in the game an open Gate holds nothing. Magic-mirror rays, skip lanes and lily drifts are laid out before any press, so they see each Gate as the save left it, and an OPEN beam never bumps open a notted Gate a press has shut.
- Lilies: a river Lily counts at every cell of its drift at once ([Cells](#cells)): the hero may board it anywhere along the drift and walk up it against the current, and a stone may land on it there. On a loop that matches the game; on a drift that ends, the walk does not check that the hero reaches a cell before the Lily has passed it. Kicks from stones skipping past are left out; a Lily off a river counts only at its data and latest cells. Rover rides, river redirects, ocean resets, Activator respawns, elevator cargo changes at run time (the rock on the map-room copy of the hub elevator, which `SmashFastTravelRock` destroys).
- Monster rooms (monster gates keep their stored `open`), monster drowning, goblins that move.
- The map rooms' implicit floor; walls the hero can't see over. In the game every map-room layer has a dry floor at its base, z 78, 89 and 104 ([Ground layers](WORLD.md#ground-layers)), above the layer's bottom, so a dry fall there ends inside the layer, never nowhere.
- The DOUBLE support probe 2 cells down; the Elevator_Platform drowning exemption; PLAYER_BLOCKING_ONLY maps in the drown check.
- The endgame areas: the walk does not find its way into the end2 room and its deck, or into the end3 rooms; the plans take their way-in gates from the level data ([Endgame way-in gates](#endgame-way-in-gates)).

## Level states (viewer)

Per overworld level, first match wins:

| State | When |
|---|---|
| solved | Status flags & SOLVED |
| partial | flags & PARTIALLY_SOLVED |
| visited (Entered) | any Status entry |
| locked | not enabled in the level data (`enabled_t_target` 0) and its unlock gate is not met ([Level_Entry unlocking and state](PROGRESSION.md#level_entry-unlocking-and-state)) |
| unlocked (Reachable) | the walk reaches it, or there is no walk (no history) |
| blocked | the walk does not reach it |

Ice gates are open when listed in Status list A or satisfied now
([Level_Entry unlocking and state](PROGRESSION.md#level_entry-unlocking-and-state)). Without a history file there is no walk and
"unlocked" reads "Not entered".

## Level roles (viewer)

A level is **Optional** only when it is provably not needed for any goal (it then counts only for Completionist). Every
other level is **Required**, including the ones whose use the model can't see. Goals are the tower levels that are not
dropdowns and the levels with an `achievement` (156). An achievement level is always Required. A tower needs N of its M
normal levels, so a tower level is Required as one of several, unless the tower needs every normal level or something
Required needs that level. Dropdowns are not goals (they only give gold), so a dropdown is Optional unless something
Required needs it.

Needs, from the goals:

- a level needs its `unlocked_by` levels (none for a level enabled in the level data). With an OR gate of more than one option, every option is needed, but only as "one of", and so is everything they need in turn;
- a level or ice gate needs the ice gates it sits behind. Behind several gates = any one of them, so they are needed as "one of". A level frozen in an ice gate sits behind that gate alone, even where the walk reaches the squares next to it;
- an ice gate needs its `unlocked_by` levels (Sign rules are not levels), and an ice gate is needed by itself unless it is provably a shortcut (below).

So a non-goal level is Optional when everything it opens is optional: every level that lists it in `unlocked_by` is
Optional and every ice gate that lists it is a shortcut with nothing Required behind it. A level that opens nothing is
Optional.

"Provable" means the walk ([The walk model (viewer)](#the-walk-model-viewer)) shows it, run on the level data: no
history (Gates, Switches, existence Groups and Lilies at their data state; every teleporter at its data `enabled` / `discovered`), seeded with the hero and the Area_Pins of
a new game (`data/fog.json` `start`), every ice gate closed and level unlocks ignored. Pads keep their level-data
state: the walk discovers none. Then rounds: the closed gates on the edge of the reached cells (in Pid order) open
together. A level or gate first reached in a round is behind the gates of that round whose opening alone reaches it
(all of that round's gates when only opening them together does).
An ice gate is a **shortcut** when the walk reaches it, opening it reaches no cell that isn't reached without it (in an
earlier round, or the same round through another gate), and the walk goes through it: from a cell that reached it,
across its cell, to a reached cell on the opposite side. Every other gate is needed: one the walk never reaches, one
that alone opens new cells ("one of" when several gates of the round open the same cells), and a dead end, pit or step
up whose far side the walk never sees.

These are the static roles: `staticRoles()`, run at build time by `scripts/build-walk.js` and
stored in `data/walk.json` (`need`, and `bg`: the ice gates each level and gate sits behind). The page reads them
synchronously at load, so they are there from the first draw. They feed the way-in fallback (`bg`, [Pockets, leads and
why](#pockets-leads-and-why)) and the Next steps label ([Next steps](#next-steps)), and stand in for the roles of a
goal that has none.
The lists and the map go by the selected goal's roles ([Goal roles (viewer)](#goal-roles-viewer)).

Result (level data, 2026-10-14): levels 608 Required, 163 Required as one of several, 149 Optional; gates 745
Required, 6 one of, 6 Optional; 2 of 12 dropdowns Required. Of the 149 normal tower levels, 42 are Required and 107
Required as one of several.

Limits: on the level data the walk reaches 81 level entrances and 40 gates in all. What stops it is state a played game has and
the level data lacks: discovered pads, moved rocks, pressed switches, Groups made to exist, filled Gem_Slots. So most gates come out needed, which errs towards Required. It errs towards Optional
only where it walks somewhere the game doesn't allow, or misses a second route the game doesn't have.

## Unlock plans and next steps (viewer)

A plan is what is still to do before a level, ice gate, sign or tower opens, walked back to the levels playable now.
`planAll(P)` works out every plan at once; `unlockPlan(P, root)` reads one off as nodes and edges.
An edge [a, b] means a comes before b. Solved levels and open gates have empty plans.

### The requirement graph

A requirement is met (nothing to do), a step (a node of the plans) or a part (an option list with no step of its own).
It needs all its parts (AND), the cheapest one (OR), or the cheapest k of them (k of n). Steps: levels (l), ice gates
(g), signs (s), towers (t), gold rooms (p), the way onto a layer (a) and the rank markers ASCEND and DESCEND (e).

- Level, solved: met. Playable now (entered, partly solved or reachable): a step with no parts, a front.
- Level, locked: its unsolved requirements, all of them, or for an OR gate of more than one the cheapest of them; and
  the closed ice gate it is frozen in.
- Level, not reachable: the cheapest of its way-in gates (`P.wayIn`) and the levels by a pad that reveals one in its
  pocket (`why.via`; none where the endgame table replaces the walk). With none of them and an access mark (`P.access`:
  its layer, which the walk reaches nowhere, or the sky its pocket is entered from): the way onto that layer. With none of them, or when every way-in gate only leads to such a pad,
  it may become a step of its own (below).
- Ice gate, open: met. Closed: its unmet levels and signs, all of them, or for an OR gate of more than one the
  cheapest. An OR gate with one of them met is a step with no parts: it opens at the next overworld load.
- Sign, met: met. A tower sign needs its tower; a rank sign rank r; the gold-room sign the cheapest k of the gold rooms
  still to find, k = 4 − the rooms found.
- Gold room: met once its `gold_room_endpoint` pad is discovered; else a step after its tower: the step onto the
  tower's MINOR pad ([Endgame](PROGRESSION.md#endgame)).
- Rank r, a part: the cheapest source of r or more: the ENDGAME levels (1, 3, 5), ASCEND (2) and DESCEND (4)
  ([Achievements and ranks](PROGRESSION.md#achievements-and-ranks)). Met when the rank is r already.
- ASCEND and DESCEND are steps after the way onto their layer, the sky and the underworld. Met at their rank. As 1-step
  leaves they would always win the rank's OR.
- The way onto the sky comes after rank 1: the lift's pieces wait in rank-1 ice gates. The way into the underworld
  comes after the sky: DESCEND is out of reach before it ([Endings](PROGRESSION.md#endings)). Each is a step of its own
  after that. A level waits on it only through its access mark. Because DESCEND counts for rank 3, it can
  serve a rank-3 gate.
- Tower, active: met. Else the cheapest k of its unsolved normal levels, k = the levels it still needs.

### Planning

- A plan's weight is its number of steps, then the levels in it the walk cannot reach.
- Requirements settle cheapest first. One is offered a plan only from parts already settled: an AND once all of them
  have, an OR with its first settled part, a k of n with its first k. So a plan never runs through itself. Ties go to
  the part settled first.
- Its plan is the union of its parts' steps, plus itself when it is a step. A plan is never cheaper than a part of it,
  which keeps the order.
- A requirement left unsettled has no plan: its parts run in a cycle, or it has none. When nothing is left to settle,
  each unsettled level that may be a step of its own becomes one, and settling goes on from it. That repeats until
  none is left.
- `unlockPlan` lists a plan's steps in settling order. Each step gets an edge from the first steps of the parts it took
  (through parts with no step of their own).

### Endgame way-in gates

The walk does not find its way into the endgame areas. `data/progress.json` `endgame_way_ins`
([data/progress.json](DATAFILES.md#dataprogressjson)) gives their way-in gates, built from the gate unlockers and
positions ([Endings](PROGRESSION.md#endings)):

- `end1`: the gold-room Sign's five gates, in place of the walk's.
- The end2 room's levels: the four ice gates ringing the sky hub elevator under the room, one per sky tower
  ([Second Endgame](PROGRESSION.md#second-endgame)), only where the walk finds none, so the walk's pockets inside the room
  stay.
- `all_together_now`: the set's gates above the room, in place of the walk's.
- The `endgame3` levels: one chain in set order, in place of the walk's. A level sits behind the gates opened only by
  levels before it in the set (the latest of those), leaving out a gate whose levels need the level itself. The first
  room has none, so it needs the way into the underworld.

A row that stands in for the walk's gates also drops the levels by a revealing pad.

### Next steps

Next steps (`nextSteps`, `P.needed`) say what each unsolved level opens; the goals' lists are sorted by them
([Goals (viewer)](#goals-viewer)). They are worked out once, for no goal in particular. The things still to do: every
tower not activated, every unsolved level whose achievement is not earned, every locked or blocked level, every
closed ice gate (not a Judge's). Every playable or unreachable level in the plan of one of those is a next step. Per
next step:

- the towers whose levels' plans hold it, with the levels each still needs;
- the levels and gates whose plans hold it, the ones after it;
- the next ending not earned yet, when that ending's level's plan holds it.

Order (`orderNextSteps`): playable, then unreachable, then locked; then the steps toward the next ending; then by the
tower brought closest to done; then by more levels and gates after it that the goal needs (Required or Required as
one of several by the goal's roles, by the static roles for a goal without roles); then by distance from the hero's
latest position, wrapped in x and y, levels on his layer first (no tiebreak without a history). Towers, levels and
gates under fog don't count.

Label (`goalOf`, what a level leads to under Completionist): "Toward Endgame" (the ending's Steam name), with the
tower brought closest to done: "Toward Endgame · HxM tower · 3 to go". An ending is named only while its achievement
may show ([The spoiler model (viewer)](#the-spoiler-model-viewer)); else the label is the tower, then the achievement
of the level or of a level after it that is not earned, then the first Required level or ice gate after it
("Required `name` +2", "Required ice gate · `area` +2"), then "Required level" when the level itself is Required,
else nothing. Required here is the static role Required, not Required as one of several. The label names no tower,
level or gate under fog.

Gates behind themselves (`gatesBehindThemselves`): a way-in gate is dropped from `P.wayIn` when its own requirements
can be met only from behind it, through any chain of gates and levels. The requirements form a graph over levels and
ice gates: a blocked level needs one of its way-in gates or of its levels by a pad; a locked level needs all of its
unsolved requirements (one of them for an OR level) and the closed ice gate it is frozen in; a closed ice gate needs
all of its unmet levels (one of them for an OR gate; an OR gate with a met option or a Sign needs none). A gate can
need itself only inside a strongly connected component of that graph (Tarjan). For each way-in gate inside one,
"can't be met without this gate" spreads back from it inside the component: to a node that needs all of a list that
holds a held node, or one of a list that lies inside the component with every member held. The gate is behind itself
when what it needs is held that way. This generalises `inner()`: a gate whose requirements wait on the level
behind it is the shortest such cycle.

Every level gets a plan. A group reached only over a rock bridge gets its plan because a pocket flood walks the
bridge from either side, and a group whose levels wait on each other gets its plan through the requirement-cycle rule
in [Planning](#planning).

A way-in gate is ruled out when its unsolved requirements need the level itself (for an OR gate, every option must):
`inner()` in [Pockets, leads and why](#pockets-leads-and-why).

## Goals (viewer)

The goals ladder: what the page counts down and lists. `goalLadder()` builds it per save without
fog; `goalsView()` adds the labels, counts and lists with fog applied.

- Order: the three endings in rank order (Endgame, Second Endgame, Final Endgame), Towers (one child per tower, 16),
  Achievements (one child per achievement other than COMPLETIONIST, 31), Completionist.
- Done: an ending, a tower child or an achievement child when its achievement is earned or the tower activated;
  Towers and Achievements when every child is; Completionist when COMPLETIONIST is earned or no level is left
  unsolved. The active goal is the first goal not done; among the children, the first child not done.
- Targets, the requirements ([The requirement graph](#the-requirement-graph)) a goal asks for: an ending its
  ENDGAME level; a tower its tower; an achievement its tower's (the TOWER_* ones), its unsolved levels, or its rank
  marker (ASCEND, DESCEND); Towers and Achievements their children's; Completionist every unsolved level. A goal done
  asks for nothing.
- Progress: an ending, its plan steps left that fog does not hide, its own level counted; a tower, its solved normal
  levels of the number it needs; an achievement, its tower's count, its levels solved, or 0 / 1; Towers and
  Achievements, the children done of the children shown; Completionist, the levels solved of the levels not under
  fog. `fogged`: more of it is under fog.
- Labels: an ending by its Steam name. With spoilers hidden an ending is listed only once every ending before it is
  earned ([The spoiler model (viewer)](#the-spoiler-model-viewer)).

A goal's levels (`goalLevels`): the unsolved levels not under fog that serve it. An ending's are the levels its roles
mark ([Goal roles (viewer)](#goal-roles-viewer)). A tower's are its unsolved normal levels and the levels in their
plans. An achievement's are the levels in its targets' plans (a tower's as for the tower). Towers and Achievements
gather their unfinished children's; Completionist takes every level. Each level carries:

- its group: playable now (entered, partly solved or reachable), not reachable (blocked) or locked;
- its role for the goal;
- `onPlan`: it lies on the cheapest plan of one of the goal's targets (every level, for Completionist);
- `leadsTo`: the nearest thing not under fog on its chain toward the goal (the `from` links of the goal roles): a
  tower ("HxM tower · 3 to go"), an ice gate ("opens ice gate" and its area, else "at x, y"), a level ("unlocks
  `name`" when that level lists the one before it on the chain in `unlocked_by`, else "opens the way to `name`") or a
  rank marker; else the goal's label. At the nearest OR on its chain where it is one of several, " · one of N routes"
  follows, N counting the routes not under fog, or " · one of several routes" when fewer than 2 show. Under
  Completionist it is the Next steps label ([Next steps](#next-steps)).

They are listed in the Next steps order. `goalSolved(goal)`: the solved levels not under fog in the goal's scope (a
tower's or an achievement's own levels, every level for the rest). The page shows the goal picked, else the active
one, else the last.

## Goal roles (viewer)

A level's or ice gate's role for one goal (`goalRoles()` and `roleFor()`): Required (on every route
to the goal's targets), Required as one of several (on some routes), or Optional (on none). It is marked over the
requirement graph of the plans, which already holds the static roles' gates (through `P.wayIn`), the gold-room k of n,
rank Signs, access steps and the endgame way-ins, so every goal's roles come from the one static roles pass.

- Marking starts at the targets, Required, and runs breadth first. An AND passes its strength to every part.
- An OR or k of n passes it to its routes: its parts that have a plan that doesn't run back through the requirement
  asking for them (that requirement itself when it is a step, else the steps that have it as a part). So a rank's
  ASCEND, which needs the way onto the sky, which needs that rank, is no route to it.
- An OR with one route, or a k of n with no more routes than k, passes its strength to them in full. Otherwise each
  route is one of several, and the parts every route needs (when every route is an AND) get its strength in full.
- Met requirements need nothing, and an OR or k of n with a part met needs nothing more.
- `from`: the requirement that marked each one first, nearest the targets; `weakAt`: the OR or k of n nearest it
  where its chain became one of several.
- A TOWER_* achievement takes its tower's roles, an ENDGAME one its ending's. Towers and Achievements mark over all
  their children, fog or not; only their children and levels are filtered by fog.

A list for a goal without roles uses the static roles ([Level roles (viewer)](#level-roles-viewer)).

## The page (viewer)

The sidebar, top to bottom: the save (campaign, rank, play time, last saved), No spoilers and the search box, Goals,
Find on the map (ice gates, teleporters, voice logs, and a Treasures count with no map action, since treasures are
picked up inside a level), Areas (collapsed by default, its open state remembered; a layer subhead only when more than
one layer has areas shown) and the save's Stats. The sidebar fits the window: the open area list, then Goals, give up
height and scroll inside under their headers.

- Goals: one row per goal ([Goals (viewer)](#goals-viewer)) with a check when done, a ◆ on the active goal, and a
  count. An ending reads "23 left", or "under fog" when nothing is left to show; the rest read "3 / 16". A trailing
  `+` says more is under fog. Towers and Achievements open inline; picking a tower also sets the tower chip and frames
  the tower on the map. Under the first ending a Gold rooms row: with spoilers hidden the count of gold rooms visited,
  shown once there is one; with spoilers shown found / total, framed on the map on a click.
  Treasures are not a goal: they drive nothing ([Treasures and gold rooms](PROGRESSION.md#treasures-and-gold-rooms)).
  Achievements has a Details link to the full list.
- The pick is kept per campaign. Picking the active top-level goal stores none, so the default follows progress.

The list shows the picked goal's levels (`goalLevels`, plus `goalSolved` while the Solved chip is on), on the map's
layer unless All layers is on or a search runs.

- Chips: the tower and area chips, each removable; the state chips Playable (reachable or entered), Partially solved,
  Not reachable (only with a walk), Locked and Solved. State chips that are on join (union); with none on, the list
  holds the unsolved levels. Each counts the goal's levels the search and the tower and area chips keep, on the
  layers listed; a chip with 0 is disabled.
- Groups, each with its count: Play now, Not reachable yet, Locked, Solved. Within a group the levels Required as one
  of several and off the goal's cheapest plans go last, under "N more on other routes", closed by default. That fold is skipped while a search runs, and in a group with nothing on the cheapest
  plans.
- A row: state dot, role dot, name, then what it leads to and its area. The tooltip adds the state, role and why.
- Empty list: "No levels match." with Clear filters, and while a search runs outside Completionist, "Search every
  level", which picks Completionist; "`goal` is done."; "No more on this layer."; "Nothing to show yet; more is under
  fog."; "No levels left for `goal`."
- Show in list (from a level's panel): the chips are cleared and the Solved chip turned on for a solved level; when
  the goal doesn't hold the level, the list switches to Completionist.

The map draws the list's levels. Solved, locked and blocked ones by state; playable ones by their role for the goal:
Required (triangle), One of several (square), Optional (circle). Playable levels on the goal's cheapest plans are
drawn above the others, and the level the save is in on top. Overlays show what is left for the goal: open ice gates,
ice gates Optional for the goal, satisfied signs and found pads, gold rooms, voice logs, map scrolls and treasures are
left out unless the Solved chip is on. The key lists the colours drawn, with Clear filters when nothing matches. A
level's or gate's panel names its role for the goal ("One of several for Endgame"), none for a solved level. The
floor heights the base image draws come from `data/walk.json` ([The viewer's base image](DATAFILES.md#the-viewers-base-image)).

## Level areas (viewer)

The game stores no level → area link ([Areas](STATE.md#areas)). The data build (`npm run data:areas`) applies the game's
current-area rule at each Level_Entry's position, with every pin counted as activated: `data/level_areas.json`, and per
level `area` in `data/progress.json`.

- Boxes: Markers with `script_name` `local_area`, a target that is an Area_Pin, not a point marker, non-zero extents. A point is inside when, after moving x and y to the copy nearest the box (period 190 × 156, or the fast-travel box for boxes at z ≥ the threshold 74.66) and rotating by the inverse orientation, |local / scale| − extent ≤ 0 on every axis.
- The containing box with the strictly lowest `float_parameter` wins; on a tie the first in package record order. 4 levels lie in two boxes of equal priority 0 (`priest_button_3d_revised`, `fire_stairs_part_2`, `priest_3d_goblin_pass`, `priest_descent_simpler`); record order gives `area_s_heroes_3d` over `area_s_vertical_priestess`. The game's strict `<` and array walk give the same: its Marker array is in record order ([Areas](STATE.md#areas)).
- 9 entries lie in boxes of more than one area (the 5 cross-area overlaps and the 4 ties). In the game their named area depends on which pins are activated. They carry `overlap`: every area box holding them, with its `float_parameter`, in record order. The viewer names each by the save's activated pins (`levelAreaOf`): the box with the lowest `float_parameter` among those whose pin is activated, the first on a tie; with none of them activated, the area from the all-pins rule above. Neither reference save has activated the pins that would move one.
- 147 of 920 entries are outside every box. The game names no area for them; the fallback below (`nearest_*`) is the viewer's own grouping.
- A level outside every box (147) gets a fallback: the box with the smallest outside distance (max over axes), then the lower `float_parameter`, then record order. Margins run 0.25..14.9, median 4.35. Nearest-box agrees with a same-set neighbour more often than Euclid-nearest pins (44 vs 32 of 63).
- 7 pins have no level: `area_g_crossroads`, `area_u_antipode_low`, `area_g_heroes_together`, `area_s_beam_way`, `area_g_exit`, `area_s_skipping_way`, `area_s_heroes_way`.
- z is the fragile axis: shifting the test point −0.5 moves 52 entries, +0.5 moves 5.
- The game's own grouping is the level set ([Levels, level sets and saves](WORLD.md#levels-level-sets-and-saves)), not the area. Level sets cross areas by design (45 of 773 in-box levels).

## The spoiler model (viewer)

With "No spoilers" on (the default), nothing under fog shows: no names, counts, totals, layers, labels or mechanic
names. Fog is the game's own ([Fog of war](STATE.md#fog-of-war)), read from the save.

- A level is hidden unless it is solved, the level the save is in, revealed by the viewer (a click on its fog chip, for the visit), or not under fog: its Level_Entry's fog region on its layer is cleared and it is outside every FILLED fog box. Without fog data only entered and solved levels count as uncovered.
- A tower is hidden while not activated and its position is under fog. A tower status sign of a hidden tower is hidden.
- An area is named only while its pin is activated (the game names an area only then). A level shows its area only while that area is shown. An ice gate is named by the area it stands in (by the box rule over activated pins), else by its position.
- Totals (ice gates, MAJOR pads, gold rooms, treasures, voice logs, map scrolls, signs) list only things not under fog, or already found (gold rooms only once visited). "Ground 70 / 90 · Sky 17 / 35" style splits cover only the layers the fog has uncovered.
- The map paints fogged squares in the fog colour in the base image and leaves them out of the Reachable overlay, so the images hold nothing the fog hides.
- An unearned achievement is hidden when what earns it is hidden: all its levels are hidden, its tower is hidden, or its layer has no cleared fog (ENDGAME2 and ASCEND: the sky; ENDGAME3 and DESCEND: the underworld). The sidebar and the plans share this rule.
- Endings go by their Steam names ("Endgame", "Second Endgame", "Final Endgame"), which are public. An ending is shown (in the ladder and the achievements) only once every ending before it is earned, so the ladder never counts the endings ahead.
- Gold rooms are known only once visited: until then a gold room's endpoint is a pad like any other, so the totals, the map's gold-room rings and the plan steps leave unvisited ones out.
- A totals row whose remaining things are all under fog says "None left outside the fog", which doesn't say whether the fog holds any.
- Goals ([Goals (viewer)](#goals-viewer)): every count is over what fog leaves (an ending's plan steps, the towers and achievements not hidden, the levels not under fog), and a count with more under fog carries a `+`. A goal with nothing to show says "Nothing to show yet; more is under fog." No `leadsTo` names a fogged level, gate, tower or hidden achievement, and its route count leaves out the routes under fog.
- Plan steps without a chip of their own: a gold room shows where the totals show it (once visited); the way onto a layer only once that layer has cleared fog; ASCEND and DESCEND only while their achievement is not hidden.
- Mechanics in a level's "why" are named only once the save has that world's achievement (dragon fire: HEROES, beams: PROMISE, mirrors: MIRRORS, skipping stones: SKIPPING); else "may need something the map does not model".
- The page source may hold spoilers: only what the page shows must be spoiler-free.

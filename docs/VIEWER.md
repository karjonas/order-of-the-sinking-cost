# The viewer's model

The viewer's own model built on the game's rules: the walk, level states, roles, unlock plans, goals, level areas, the
page and the spoiler rules. The game does none of those; they are how the viewer approximates what the player can
reach.

## The walk model (viewer)

The viewer's own approximation of where the hero can go: `walker()` and `reachability()`, data from
`data/world.json` and `data/progress.json` ([Derived data files](DATAFILES.md#derived-data-files)). What the walk
gives on the level data alone (the static roles, the map's floor heights and the room answers) is worked out at build time and stored in
`data/walk.json` ([data/walk.json](DATAFILES.md#datawalkjson)). It is fitted to the game's rules but is not the game's
walk code. Every simplification is listed at the end of this section.

### Level geometry and the walker

`walker()` builds its grid in two parts.

- The level geometry (`levelGeometry()`, `src/walk/geometry.ts`) is everything the grid takes from the level data
  alone, which no save changes. It is built once per page load or program run, from `data/progress.json` and
  `data/world.json`, and is plain data (numbers, strings, arrays, typed arrays, Maps and Sets of those):
  - the grid's size, corner and fast-travel box, and the grid's cell count;
  - the static solid voxels and the level data's beam stops, one byte per cell;
  - the Wall_Sets' voxel cells, the existence Groups and their member pids;
  - the cell of each list of entities (Rocks, Floors, Trees, blockers, movables, Fences, Switches, Gates, Lilies, rock
    bridges' push and water cells, elevator frames, Wardrobes, Gem_Slots with their rooms, pads and Freezers), parallel to
    the level data's lists;
  - the Ocean_Maps per column, the river flow sides, the pads' reveal lists and their map-room twins.
- The walker adds what a save decides: which entities exist ([Existence](#existence)), where Rocks, movables,
  Monsters and Lilies stand, Switch and Gate state, the closed Freezers, the pads' states, the beams and everything
  built from those (fire, pad linkage, hops, skip lanes, trigger indexes, mechanics). It copies the voxel bytes into its
  own grid and the water columns when the save changes the water, and never writes to the geometry, so any number of
  walkers (one per save state) share one geometry.

A program that swaps the level data (the tests do) gets a new geometry the next time `walker()` is called; `walker()`
also takes a geometry as its last argument.

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
  - Lily drifts: a Lily whose latest cell is a river square is taken to be at every cell of its drift at once, and each of those cells holds the hero ([Lilies](MOVEMENT.md#lilies)). The drift starts at the latest cell and follows the river's flow, coasting on in its last direction over still water. It enters a cell with water within 0.5 of z that is not blocked and holds no pushable or beam stop, but for its latest cell: what stands there rides the Lily and moves with it. It ends at a blocked step or when a cell and heading repeat (at most 4 (W + H) steps). An absent Lily drifts nowhere. On a loop this matches the game, since the Lily comes round again.
  - Kicked Lilies: a Lily whose level-data cell is off the rivers and whose latest cell is a river square was kicked off its start. The side of the first `moving_direction` the history records for it is the way the kick went. If the ride from the start on that side ([Skip lanes and the TELEPORT swap](#skip-lanes-and-the-teleport-swap)) comes to the latest cell, every cell of the ride holds the hero too, since he may have boarded the Lily on the way. A first move that does not lead to the latest cell, or a Lily with no recorded move, adds nothing.
  - Living Monsters (latest position, `dead_t` = 0): MONSTER.
  - Shut Gates: GATE | SUPPORT. A shut Gate holds up what stands on it (no overworld Gate is FLAT); once a flood opens it (a switch press or an OPEN beam, [Moves](#moves)) it holds up nothing. A switch gate follows its flavor's existing Switches: open = (all latest `pressed`) xor `notted`. A monster gate and a gate whose flavor has no Switch keep their latest stored `open`, but for the monster Gates a flood opens ([Moves](#moves)). An open notted Gate that a flood's switch press shuts blocks its own cell and holds up the cell above from then on.
  - Elevator frames of linked elevators: FLOOR on both frame cells.
  - Closed Freezers (`frozen`): not entered.
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

- Supported (`supported`): SOLID in the cell itself, as the game holds an entity inside a wall voxel ([Support](MOVEMENT.md#support)); such a cell is entered only as a THRU cell, along a THROUGH beam, so a hero who steps into a floating wall voxel stays in it, over water or air; FLOOR in the cell; a cell of a Lily's drift ([Cells](#cells)); a cell over the track of a Rover under water ([Moves](#moves)); a notted Gate the flood has shut in the cell below; a closed Freezer in the cell below, except in the floods of pockets, where only a fall lands on one ([Pockets, leads and why](#pockets-leads-and-why)); SUPPORT in the cell below, unless that is a Gate the flood has opened; a living Monster in the cell below (not one the flood has pushed to its death, [Moves](#moves)) or a movable there, a Gem, Promesst_Light, Rover, Friendly_Dragon or vertical Mirror, which hold up whatever stands above them as a Rock does, wherever the walk leaves them ([Support](MOVEMENT.md#support)); a flat Mirror holds up nothing; a bridged water cell ([Moves](#moves)), and in a pocket flood every rock bridge's water cell; a powered DOUBLE beam cell over water with z within 0.6 of the surface; else the implicit ground floor, ground layer only: z ≤ 0 on a dry column, z < 0 in water. The map rooms' implicit floor is left out: a fall that starts in a map room lands inside that room's layer or nowhere.
- The walk does not model the column mask ([Support](MOVEMENT.md#support)). On the overworld the Annihilator makes every column count as inside, so the mask makes no cell solid, and the ground floor above is the game's implicit-floor rule.
- Blocked: SOLID or GATE, unless the cell is a THROUGH beam's wall cell (THRU); a GATE without SOLID also passes when a switch press has opened it or a hero in an OPEN beam has bumped it open ([Moves](#moves)). An open notted Gate that a switch press has shut is blocked. A closed Freezer is always blocked.
- Open = not blocked and supported.
- `land(k)`: the cell itself if open, else the cell above (except for an Area_Pin or a kept hero position: not above), else the cell below.

### Attacks

- A living existing goblin attacks its own cell, its 4 neighbours and the cells above and below. A Fence on the edge to a neighbour spares it (a floor Fence, for the cells above and below), unless the goblin stands in a SQUEEZE beam; a cell with SOLID is spared unless the goblin stands in a THROUGH beam. Gates and Monsters beside the goblin shield nothing. The attacks are cast once the beams are. A Rock's cell is attacked: the attack does not hit the Rock, but a hero who pushes it away stands there at the next attack pass ([Goblins, dragons and PROTECTION](MOVEMENT.md#goblins-dragons-and-protection)).
- A living existing dragon fires from its latest cell along its facing (latest `theta_target` rounded to 90°, else its level-data side), one cell at a time, at most W + H steps, until it returns to its cell, crosses a Wardrobe door edge (out of the cell or into a door cell from its front), or meets SOLID, SUPPORT, GATE, MONSTER, MOVABLE or a closed Freezer. Each cell before the stop is attacked. Mirrors stop the fire (no reflections).
- A Monster that only a Group makes exist blocks its cell; its attacks are left out.

### Beams

- Room power, the game's rule ([Promesst beams and powers](MOVEMENT.md#promesst-beams-and-powers)). A room is a 19 × 13 screen of the ground, underworld or sky layer, or a whole map-room layer. Its lights are powered when it has at least one existing Gem_Slot and every existing one is filled: an existing free Gem stands in its cell (latest `attached_to_entity_id` 0, else not held in the level data), or its latest `flags` (else the level data's) hold BEAM_POWERED. A light's room is the room of its latest cell. The saved `powered` is not read.
- Every existing Promesst_Light, at its latest cell and not in a closed Freezer's cell, is a lit cell. A powered one casts a beam from its cell along its facing (its latest `theta_target` rounded to 90°, else its level-data side; one off the grid axes in the level data stays so), or up or down for `vertical_up` / `vertical_down`, at most W + H steps, until it returns to its light, meets GATE or BEAMSTOP, or a closed Freezer. Solid voxels never stop it, so a vertical beam leaves its layer: one that starts below the map rooms climbs no higher than z 74, half a cell under them; one going down runs to the bottom of the grid. Mirrors stop it.
- Horizontal THROUGH beam cells get BEAM; their SOLID cells get THRU (walkable).
- At infinity: a beam is at infinity when it ends because its next cell would leave the level volume: below or above the grid, or, for one that starts below the map rooms, into them (z 75 and up). The grid wraps in x and y, so only a vertical beam ends there.
- Per beam cell: ENDPOINT beams (horizontal only) record their side, their cells in order (the light's own cell left out), the cell's place among them and whether the beam is at infinity (never, for a horizontal beam); DOUBLE beams count; ALTER, SQUEEZE and OPEN mark. Vertical beams count and mark too.
- A horizontal THROUGH light that is unpowered only because an existence Group keeps it, or a Gem_Slot or Gem of its room, from existing, casts its beam inside `withGroups` for that Group ([Existence](#existence)).

### Moves

Four layers per cell: 0 = the default skill or another one (the hero pushes), 1 = PROTECTION, 2 = TELEPORT (from a
TELEPORT Wardrobe's door), 3 = TRANSMUTE (from a TRANSMUTE Wardrobe's door). A flood pops a cell k with layer p and
tries the four sides:

1. OPEN: a hero at k in an OPEN beam and in no ALTER beam opens the shut Gate in the neighbour cell that way, if that cell holds no SOLID, is not a closed Freezer and has no fence on the edge (unless SQUEEZE is at k). The Gate stays open for the rest of the flood. In the game the mover bumps and the Gate opens; he steps in on the next press ([Gates, switches and buttons](MOVEMENT.md#gates-switches-and-buttons)). With ALTER at k nothing opens.
2. Destination n: with an ENDPOINT beam at k along that axis, the beam's last cell when moving with it, its first when moving against. With ALTER at k as well, the midpoint of the way there: of the beam's c cells, with k at place i, towards the end the cell at i + ⌈(c − 1 − i) / 2⌉, towards the light the cell at ⌊i / 2⌋. A move along a beam at infinity, with or without ALTER, gives no destination and that side is skipped: in the game the hero leaves the map and is destroyed ([Promesst beams and powers](MOVEMENT.md#promesst-beams-and-powers)). A move against it jumps as usual. Only vertical beams end at infinity and ENDPOINT moves follow horizontal ones, so today this never applies. Without an ENDPOINT beam, the neighbour, repeated 2^d times for d DOUBLE beams at k, 3^d with ALTER at k. n = k is skipped. Where a flood's pushes laid optional powers at k ([Beams moved by pushes](#beams-moved-by-pushes)), the four sides are tried twice: with the walker's own powers alone, then with the optional ones added (their ENDPOINT beams first).
3. A fence on the edge (k's side or n's opposite side) refuses the step, unless SQUEEZE is at k.
4. If n holds ROCK, MONSTER or MOVABLE: refused in layers 1, 2 and 3 (a Wardrobe skill replaces SINGLE_PUSH, so a PROTECTION, TELEPORT or TRANSMUTE hero pushes nothing). Else the cell b beyond n must not be k, not be blocked, not hold another pushable, and have no fence between n and b (one push; no chains, MULTIPUSH or PULL). The pushed thing is not moved in the model.
5. If n is blocked: refused; a closed Freezer there joins the walk's front, unless its cell is also SOLID or GATE.
6. A THRU cell is entered only from a BEAM cell.
7. The new layer p2: leaving k through a PROTECTION Wardrobe's door → 1, from layer 2 too (he loses TELEPORT); through a TELEPORT Wardrobe's door → 2; through a TRANSMUTE Wardrobe's door from layer 0 → 3; through another skill's door → p (that skill adds to his own); entering n through any skill Wardrobe's door → 0; an inventory Wardrobe changes nothing.
8. Fall: from n down, with no height limit: stop at a blocked cell; an attacked cell (FIRE) takes the hero only in layer 1 and ends the fall either way; a cell more than 0.1 under a water surface ends it (he would drown); the first open cell is reached. A fall that starts in a map room ends with no landing where it would leave that room's layer. A pocket flood keeps every fall inside the layer it starts in: a fall into a lower layer is not walked back, so what lies below is no part of the pocket.

After the four sides:

9. TELEPORT swaps from k, layer 2 only. Along each side, at k's z, the line wraps (inside the fast-travel box at map-room z) and crosses water and air. It steps by the hero's powered move from k, as step 2 gives it: the jump to the endpoint (to the midpoint in an ALTER beam) in an ENDPOINT beam parallel to the press, else 2ⁿ cells (3ⁿ with ALTER) in n DOUBLE beams, else one cell; it tests only the cells at multiples of that distance and skips the ones between, and a move with no landing has no line. With the powers a flood's pushes laid down, he swaps with those too. It ends at the first target, an existing Rock, a living Monster, a movable other than a Mirror, or a Mirror the line meets on its back or a closed side: the hero lands in its cell, then falls as in step 8, in layer 2. A Mirror's open sides come from its latest `theta_target`, else the level data's (`world.mirror_facings`): a flat one has two, a vertical one a single horizontal side ([Mirrors turning fire and beams](MOVEMENT.md#mirrors-turning-fire-and-beams)). It ends with no swap at a blocked cell (a solid voxel outside a THROUGH beam, a Tree, Sign, Treasure_Display or Judge, a shut Gate, a closed Freezer), a Mirror met on an open side (the line turns there; its turn is not modelled), a Wardrobe door edge, or back at k. The target lands in k (Swapped targets, below).
10. Magic-mirror hops from k, also in walks on foot: each landing cell of k ([Magic-mirror hops](#magic-mirror-hops)) that is not blocked, reached by the fall of step 8, in layer p; for a cell between two facing Mirrors, both landings of a pair when neither is blocked.
11. Travel from k (skipped by walks "on foot"):
   - an elevator frame cell reaches the far frame cell if it is not blocked (per `world.elevators` mask: bit 1 bottom → top, bit 2 top → bottom);
   - a pad in k or the cell below, enabled: a MINOR pad reaches its target pad's landing cell, or for a Marker target (`to`) a search down from the Marker's cell inside its ground layer (no fall cap): a blocked cell or water deeper than 0.1 ends it with no landing; an attacked cell ends it, with the hero standing there in layer 1 (support not needed) and nowhere in layer 0; else the first open cell. A trip enables the target pad for the rest of the flood, as discovering the sending pad does in the game ([Teleporter pads and fast travel](MOVEMENT.md#teleporter-pads-and-fast-travel)): a MINOR pad that the save leaves disabled sends the hero on once a trip has brought him to it, and a hero already standing on it from earlier in the flood takes it then. A target held by a closed Freezer stays disabled, since the hero stays on his pad;
   - a discovered, enabled, existing MAJOR pad reaches every other such MAJOR pad (once per layer);
   - an enabled MAJOR pad also reaches the world pads its discovery reveals ([Pads revealed through the map rooms](#pads-revealed-through-the-map-rooms)).
   Pads keep the layer. A pad frozen in a closed Freezer leads nowhere while the Freezer stays closed: a hero on the Freezer's top doesn't take it, and a pad that sends the hero to it (a MINOR pad's target, a MAJOR pad, a reveal) leaves him where he is, since a target cell holding a frozen Freezer keeps him on his pad ([Teleporter pads and fast travel](MOVEMENT.md#teleporter-pads-and-fast-travel)). A discovered pad in a closed Freezer seeds no walk ([Seeds and the reached cells](#seeds-and-the-reached-cells)).

Rock bridges (`world.bridges`, rows of [rock or Gem, push cell, water cell]): a non-SKIPPABLE Rock or a spare Gem on
support, still at its level-data cell, that the hero pushes in a straight line from a standable push cell over
supported, fence-free cells (no solid, Gate, Freezer or other Rock) into a water cell (a surface within 0.6 of z) with
nothing at z − 1. A Gem sinks like a Rock ([Objects in water](MOVEMENT.md#objects-in-water)), but a Gem is spare only
when it is free (held by nobody and not in a Gem_Slot) and the Gems of its room are not all needed for the room's open
Gem_Slots: its room has no Promesst_Light with a beam, or more such free Gems than open slots ([Beams moved by
pushes](#beams-moved-by-pushes)). When the queue drains, each rock whose push cell was reached bridges once: its water cell becomes supported and the walk resumes
from the reached cells beside its column, at its height and above, up to the first cell over it that a step from the
side would stop in or bump into. A bridge is one-way: only the push side can make it. A pocket flood
([Pockets, leads and why](#pockets-leads-and-why)) looks for the ways into its pocket, so there every bridge's water
cell holds the hero from the start, whichever side the push cell is on.

Rocks a Spawner puts back (`world.rock_spawns`). An Activator resets what its Spawners respawn ([Activators and
Spawners](MOVEMENT.md#activators-and-spawners)), so a Rock the save left anywhere but at its Spawner's cell, sunk in
water included, stands there again once a hero has reached the cell of an existing Activator that runs the Spawner (in
any walk layer, as a kick of a Lily, [Skip lanes and the TELEPORT swap](#skip-lanes-and-the-teleport-swap)). From then
on the Rock is one more Rock that may turn (below) from the Spawner's cell, and when the Spawner's
cell is the Rock's level-data cell its straight bridges (`world.bridges`) sink as well, each once, when both their push
cell and an Activator are reached, in whichever order. A skipping stone is not put back. The Rock the save left is not
taken away: it keeps its cell and whatever it holds up, and a Rock that also sank by itself counts twice. Spawners and
Activators that do not exist, and Rocks the save left at the Spawner's cell, change nothing.

Rocks that turn on the way to the water. Once the queue has drained and nothing else adds cells, a Rock (or spare Gem)
the hero has reached a cell beside, which is no skipping stone and has not bridged yet, is pushed on, one cell at a time, over at
most 2048 positions, nearest first, from cells the flood reached in layer 0 (the cells a pocket or lead flood stays out of
do not count). The hero steps into the cell the object leaves, so no push from an attacked cell is made, in this
search or in the Switch, Gem, Mirror and Monster searches. A push moves the Rock one cell onto a cell that holds it, or off a ledge, and it falls through open air
and water by the rules of the Switch search above (at most 8 cells, none through a wall, Gate, closed Freezer or
pushable, and none past a cell the water cancels the step into); in water level with its height it sinks, which makes the water cell above its resting cell hold the hero,
as a bridge does. A Rock bridges at the nearest such water cell that joins ground the flood has reached to a standable
cell it has not; it bridges once, and not after its straight bridge did. The search is walked forward from the Rock,
unlike the Switch search, since open sea has far more water cells than there are Rocks. The sunk Rock is not placed:
its old cell still holds it. A water cell that a Rock sank in, by a straight bridge or after turns, holds up a pushed
object for the rest of the flood ([Objects in water](MOVEMENT.md#objects-in-water)), so a second Rock is pushed over it, and
so is a magic Mirror, a Gem, or the object of a Switch search. The pocket floods make these bridges only from the Rocks
their own cells reach, and count no turned bridge's water cell as floor from the far side.

Rocks that sink side by side. When the Rocks that turn have bridged what they can alone, a gap of two or three water
cells in a row closes if that many Rocks sink one after another, each pushed over the water cells the Rocks before it
sank in. The search starts from each Rock a hero has reached a cell beside, nearest water cell first: it looks for a
Rock that sinks in a water cell beside reached ground, that open water (at most as many cells in a row as the Rocks
still to come) leads on from to ground the flood has not reached, and then for another Rock, not one already in the
chain, that sinks the same way with that water cell bridged and the hero standing in it, at most three Rocks in all. A
chain whose last Rock sinks where it joins new ground makes all its Rocks sink; any shorter chain sinks nothing, since
a Rock sunk in a gap's first cell alone would join no new ground. Each Rock bridges once, and none after its straight
bridge did. A Rock whose search found no chain is searched again only once a push cell it turned down is reached, the
flood has bridged another water cell or opened or shut a Gate or moved an object for the beams, or another Rock is
due.

Rovers that sink (`world.rover_facings`, `world.movables` kind 3). A Rover that sank in water drives on under it along
its axis and turns round at the ends of its track ([Rovers](MOVEMENT.md#rovers)). Its track is the run of cells, at the
hero's height, through the cell over where it rests, on to each end: a cell where the water is level with that height,
no Fence lies across the step, the cell is not solid, shut or frozen and nothing sank there, and under it nothing is
solid and no Rock or movable stands. A Rover's axis is its latest `theta_target`, else its level-data one. Every cell of the track holds the
hero at once, as the cells of a Lily's drift do: he boards from a reached cell beside any of them and steps off onto
ground beside any of them. A Rover the save left resting in water has its track from the start (`rideCells`, marked
like the drift cells, and left out of the map's reached cells likewise when the hero only rides through). A Rover resting on dry land is pushed like a
Rock that turns: once the queue has drained, a Rover the hero has reached a cell beside is pushed on from its cell over at
most 2048 positions, nearest first, from cells the flood reached in layer 0, by the landing rules of the Rocks, and
sinks at the nearest water cell where its track joins ground the flood reached to ground it has not, with a cell of the
track beside a reached cell and another beside a standable cell not reached. Its track then holds the hero for the rest
of the flood, and the walk goes on from the reached cells beside it. Each Rover sinks once and its old cell still
holds it. A Rover whose search found no such cell is searched again only once what the search reads has changed.

Magic Mirrors that turn. Once the queue has drained and nothing else adds cells, a flat magic Mirror the hero has
reached a cell beside, that is pushable, below the map rooms and rides no Lily, is pushed on like a Rock above: one cell
at a time over at most 2048 positions, nearest first, from cells the flood reached in layer 0, by the same landing rules
(a push that sinks it in water ends it there). Every position other than its own cell is a place it hops from
([Magic-mirror hops](#magic-mirror-hops)), and its hops hold for the rest of the flood. Unlike a Rock, which bridges once,
a Mirror's search is walked again whenever a push cell it turned down is reached or the flood has opened or shut a Gate
or moved an object for the beams, since each new position can hop somewhere new. The walk goes on from a hop's landing
in every walk layer the flood reached its arm cell in, and from every arm cell it reaches later.

Stones launched with CHARM. A hero who has left a CHARM Wardrobe by its door holds CHARM ([CHARM](SKILLS.md#charm)): a
flood notes it when it steps out of one in layer 0, and starts with it when the current hero holds CHARM in the save
or the cells it stays out of hold such a Wardrobe. Such a hero launches a MIRRORABLE skipping stone, from the cell the
save left it in and from each cell it lands on, as a way onto a cell in the Switch search below. He stands in a cell
the flood reached in layer 0, within 2 cells of the stone along each axis, 2 layers up or down included, and steps one
cell in the direction of the launch. His step must be open, since a charm move pushes nothing: the cell ahead is one he
can stand in, holds no pushable and has no Fence on the edge, or it is the stone's own cell, which the stone leaves. The
stone steps the same way into water level with it and skips on to the landings of a pushed one
([Skip lanes and the TELEPORT swap](#skip-lanes-and-the-teleport-swap)). The cell behind the stone need not be open,
and the stone has to stand on a cell that holds it (a Freezer's cell counts only once open). A stone that lands on an
islet is launched again from there. A Switch on an islet such a stone lands on, with none of the four cells beside it
one the hero can stand in, counts as reached with no hero there, as one under water does. A stone in a closed Freezer
that a search would launch makes the Freezer a lead: the main flood notes it, and the walk is run again from the seeds
with the Freezer open, which may press the Switch.

Crystals. A hero in layer 3 turns the Tree or dragon he bumps into a crystal Rock in place ([TRANSMUTE and the other
skills](SKILLS.md#transmute-and-the-other-skills)): once the flood has reached a cell beside one, from which a step
toward it crosses no Fence. A Tree's cell is then no longer solid and holds a Rock the hero pushes like any other, so a
hero in layer 0 walks into its cell when the Rock can be pushed on, and the search for an object to bring onto a
Switch finds it like a Rock. With the Rocks that turn on the way to water, the crystal of a Tree sinks into water
and bridges it like any Rock. A dragon's cell holds a Rock too, its fire stops, and it counts as gone for the monster
Gate of its room. The crystals last until the flood ends. A hero keeps layer 3 until he enters a Wardrobe by its door;
a TRANSMUTE door taken in another layer than 0 changes nothing.

Monster Gates. A shut monster Gate that is not notted, whose room (a 19 × 13 screen of its layer) holds living existing
Monsters, opens for the rest of the flood once the walk has got rid of every one of them ([Gates, switches and
buttons](MOVEMENT.md#gates-switches-and-buttons)). A Monster the hero has reached a cell beside is pushed on like a Rock
above: one cell at a time over at most 2048 positions, nearest first, from cells the flood reached in layer 0, by the same
landing rules. It is gone when a push ends in water where it sinks, where it drowns ([Water](MOVEMENT.md#water)), or at a
cell that the fire of another living dragon runs through or beside a living goblin, which attacks Monsters too, unless a
Fence parts the two cells ([Goblins, dragons and PROTECTION](MOVEMENT.md#goblins-dragons-and-protection)). A dragon
pushed to a cell breathes from there along its facing,
and the first Monster of a gate's room that its fire meets is gone too, whether or not the dragon is. A goblin is never
pushed: the cells beside it are attacked, which only a hero with PROTECTION enters, and he pushes nothing.

Swapped targets. The target of a TELEPORT swap lands in the cell the hero left ([TELEPORT and
PULL](SKILLS.md#teleport-and-pull)); the hero lands in its cell, and the target stays in that cell in the walk's grid
([Skip lanes and the TELEPORT swap](#skip-lanes-and-the-teleport-swap)). Each swap a flood makes in walk layer 2 from a
cell k to a target t is noted (a pocket flood notes none), when it can matter in one of three places:

- Onto a Switch or a Gem_Slot: k is the cell of a Switch not pressed, or of a Gem_Slot that a Gem turns onto ([Beams
  moved by pushes](#beams-moved-by-pushes)), and holds no object itself. The search for an object onto that cell (the
  Switch presses above, the Gem for its slot) takes t, when no push brings one, if t is an object that search accepts. So
  one hero in layer 2 presses a Switch by swapping with a Rock, Monster, Gem or movable that is the first target on a line
  from it, over water too.
- Rocks that turn: t is a Rock the walk may push into water. The cells k it was swapped into are further places it is
  pushed from, after its own cell, by a hero in layer 0 from the cells the flood reached, as the push search above. The
  hero's cell k holds no object; a Rock bridge joins ground the flood has reached to ground it has not, in any layer.
- A Rock that stops a beam cast when the walker is built: t is swapped away from a cell k off every beam, which the
  longer beam, cast again from its light without the Rock, does not run through. The Rock leaves its cell, and the beam runs on
  as after a push off its line. The Rock is not placed in k.

The swaps are noted as the flood walks its layer 2 cells, so the searches read the cells reached so far and run again when a swap is
new.

Switch presses. A Switch is pressed only while something stands on it, and the overworld has one Guy, so the walk
presses a flavor only with objects ([Gates, switches and buttons](MOVEMENT.md#gates-switches-and-buttons)). The hero
alone opens nothing, but for the Gate lifts (below) and a magic-mirror hop off the Switch he holds
([Magic-mirror hops](#magic-mirror-hops)). One latch per flavor with an existing Switch not pressed: a press opens the flavor's shut gates
and shuts its open notted gates together. An opened Gate no longer holds up the hero above it; a shut notted Gate
blocks its own cell and holds up the cell above.

When the queue drains, a flavor is pressed once the walk has reached every unpressed existing Switch of it and can
bring a separate object onto each one. A Switch under water (more than 0.1 below the surface) is never reached, since
no hero stands there; the search for an object alone decides it. Then its gates open and shut and the walk resumes
beside each, as for a bridge (above a shut one). Flavors go in the order of their first such gate in `world.gates`.

- Objects: a Rock, a living Monster or a movable, at its latest cell; not a Friendly_Dragon. One object rests on one
  Switch: once a flavor is pressed with it, no other flavor's press, Gate lift or hop uses it in that flood.
- The search walks back from the Switch, nearest first, over at most 2048 states (a cell, and whether the way on from it
  skips). From a cell the object is pushed one cell into the next one by a hero standing behind it, in a cell the
  flood reached without a Wardrobe skill (layer 0), or in the reached cells a pocket or lead flood stays out of. A cell the object stands in holds it
  (FLOOR, SUPPORT below, a closed Freezer below, a notted Gate below that a press has shut, a water cell the flood
  bridged, or the dry implicit ground floor). SUPPORT below counts even where the flood has opened that Gate: a Gate shut at any point in the flood holds an object, though an
  opened one holds up no hero ([Support and open cells](#support-and-open-cells)).
- The ways onto a cell: a push onto it; a push off a ledge above it, with a fall of at most 8 cells through open air
  (no wall, Gate, closed Freezer, pushable or cell that holds it on the way). Water stops the fall at a cell 2 below
  its surface, which cancels the step into it ([Falling](MOVEMENT.md#falling)); above the surface a fall passes, also in
  a column with water, so an object pushed off a ledge lands on what stands below the dry air over the water. A Rock
  sinks to the surface − 1 of water it falls into ([Objects in water](MOVEMENT.md#objects-in-water)), so a push into
  that water, at its surface or above it, sinks the object onto the cell; a skip, for a skipping stone
  only: it is pushed into level water and its landings ([Skip lanes and the TELEPORT swap](#skip-lanes-and-the-teleport-swap))
  hold the cell. A stone on a drifting Lily can be pushed off it into a skip too. A MIRRORABLE stone is also launched
  by a hero with CHARM (the paragraph above on stones launched with CHARM), from any cell he reached in layer 0 beside it.
- Walls, shut Gates and closed Freezers stop the object, as they stand when the walk runs: it passes a Gate the
  flood has opened (by a press or an OPEN beam) and stops at a notted Gate a press has shut.
- A Switch already pressed in the save needs nothing.

Gate lifts. A closing Gate pushes what stands in it one cell its `closes` way (`world.gates`, [Gates, switches and
buttons](MOVEMENT.md#gates-switches-and-buttons)); the walk models only the upward push of a shut switch gate beside a
Switch of its flavor not pressed, at the same z. A hero on that Switch, with an object on every other unpressed Switch
of the flavor, holds the Gate open; he steps off the Switch into it, the Switch is released and the closing Gate lifts
him onto the cell above, where it holds him up. So once the walk has reached the Switch and every other unpressed
Switch of the flavor and can bring a separate object onto each of those (the search above), it reaches the cell above
the Gate in the walk layers it reached the Switch in. Not when a Fence parts the two cells, the Gate is frozen in a
closed Freezer or the cell above is blocked.

When its queue drains, a flood tries the crystals of a TRANSMUTE hero first, then the rock bridges, then the hops off a held Switch, the Switch flavors and the Gate lifts, then the pushes for
the beams, then the skip lanes, then the Rocks that turn on the way to water, then the Rocks that sink side by side, then the hops of the magic Mirrors that turn, then the monster Gates, and goes on while one of them adds cells. Each walker indexes them by the cells that can fire them
(`triggerIndex`: bridges by push cell; flavors, and the Gate lifts and the hops off a held Switch with them, by unpressed Switch cell not under water; beam pushes by the push cells of the Gems and
lights, the cells next to the Gems that turn onto a slot and the cells next to the Rocks that stop the beams cast when the walker is built; lanes by launch push cell and
the cells next to the stone in layer 0, line cells in layer 2, and ride cells in any layer for a pocket flood; Rocks, magic Mirrors and the Monsters of monster Gates that turn, and the Trees and dragons a TRANSMUTE hero bumps in layer 3, by the cells next to them), so a
flood looks only at what the cells reached since its last look touched. The swaps of layer 2 are noted as its cells are walked
and read by those searches, which add no trigger of their own. A flavor, Gate lift or hop off a held Switch whose search found no
object is searched again only once a push cell it turned down is reached, the flood has opened or shut a Gate or moved an object
by a push for the beams, has noted a swap onto a Switch or a Gem_Slot, or a THROUGH beam it laid runs through a wall that stopped one of the search's skips. That
changes no result.

### Beams moved by pushes

Three pushes change the beams ([Promesst beams and powers](MOVEMENT.md#promesst-beams-and-powers)). The flood makes
them when its queue drains and the hero has reached a push cell in layer 0, or one lies in the reached cells a flood
stays out of while a closed Freezer is opened for it (a lead). With the Freezers as they were for the walk that reached
those cells, their pushes are that walk's own, so a pocket flood or a walk from a level makes none from them; an opened
Freezer lets beams and pushed objects through its cell, so a lead makes them again. What they change lasts until the
flood ends; the next flood starts from the save's state.

- A Gem onto a Gem_Slot: a free existing Gem pushed in a straight line, inside its screen room, onto an existing slot
  that is not filled. Each cell it enters is not blocked, holds no other pushable and holds it up, and the hero can
  stand in each cell behind it. The slot counts as filled from then on, so its room may now be powered; the Gem's old
  cell stops no beam.
- A Gem onto a Gem_Slot with turns: the same Gem and slot, by any pushes, found by the walk back from the slot that
  the Switch search makes ([Moves](#moves)): from cells the flood reached in layer 0 (the cells a lead flood stays out
  of count while a closed Freezer is opened for it), each cell the Gem passes inside the slot's screen room. Only for a
  slot of a room with a Promesst_Light and as many free Gems as open slots, and for a Gem not on
  a slot. A hero in layer 2 standing in the slot's cell also brings the Gem by a swap ([Moves](#moves)). A search that
  found no Gem is looked at again only once a push cell it turned down is reached or the flood has opened or shut a
  Gate or moved an object for the beams, or noted a swap onto the slot.
- A Promesst_Light along a line: an existing light pushed in a straight line inside its screen room, as far as the
  same checks allow. Each cell it gets to is a spot: once its room is powered and the spot is not a closed Freezer's
  cell, the light casts its beam from there, the cell it left not stopping it. The beams of every spot count at once.
- A Rock that stops a beam: a non-MIRRORABLE Rock in the cell after a beam's last cell, pushed one cell from a cell the
  hero reaches: off the beam's line first, else on along a horizontal beam, away from its light. It goes onto a cell
  that holds it and that no beam runs through. The beam then runs on, and the Rock may be pushed again where the
  longer beam ends. When no push moves it, a hero in layer 2 swaps it away ([Moves](#moves)).

A beam a push makes or lengthens is laid into the grid as at the start ([Beams](#beams)), but its ENDPOINT, DOUBLE and
ALTER powers are optional: the hero may take them or step as before ([Moves](#moves)), since in the game he can still
leave the light, Gem or Rock where it was. A beam that lies wholly in the reached cells a pocket or lead flood stays out
of gives that flood no move and is not laid. When anything changes, the reached cells in the beam are walked again, and
those next to it too when the beam is DOUBLE, THROUGH or OPEN (it changes the moves into its cells, or opens a Gate next
to it) or the flood has opened a Gate from an OPEN beam (a cell walked before may step into it now). A light spot left
uncast is tried again only once more Gems are on slots.

### Magic-mirror hops

ACTIVATE swaps every target of a room's magic Mirrors with its mirage, all or nothing
([Magic mirrors](MOVEMENT.md#magic-mirrors)). The walk models two cases that need no other target: a hero on one
open arm of a flat magic Mirror alone in its room lands on the cell as far down the other arm, and a hero between the
only two magic Mirrors of a room that face each other is cloned onto both ([Hops between two facing
Mirrors](#hops-between-two-facing-mirrors), below).

- Mirrors: `world.magic_mirrors`, at their latest cells, existing, not in the cell of a closed Freezer. Every listed
  Mirror counts towards its room (a 19 × 13 screen in its ground layer), vertical ones too. A Mirror is used when it
  is flat, the only one in its room, below the map rooms (z < 75) and both arms lie on grid axes.
- A ray along an arm runs at most max(100, W, H) cells. It stops at SOLID, a shut Gate, a closed Freezer's cell, or
  a Rock or movable that a beam does not pass. It finds a target at a Monster, a MIRRORABLE Rock or a `mirrorable`
  Rover. The walk's hops stop at every Gate the save left shut. The game reads a Gate as shut when the ray is cast, so the two differ only for a Gate the flood opens later, which the game still reads as shut at that moment.
- For each arm the hero may stand on: the other arm's first stop, first target and first Fence are found. The hero
  stands d cells out on his arm, past no Fence, stop or target; d must be less than the other arm's first target, stop
  and Fence. He lands d cells out on the other arm. Each hop is one-way: arm cell → landing cell.
- A hop off a Switch not pressed: the hero standing on it holds it down while he ACTIVATEs
  ([Gates, switches and buttons](MOVEMENT.md#gates-switches-and-buttons)). When he holds its flavor alone, every
  other Switch of the flavor pressed or holding an object the walk brings there (the search of the Switch presses in
  [Moves](#moves)), the rays of his hop are laid with the flavor's gates as a press leaves them: its shut gates open,
  its notted gates shut. Once he has teleported, the Switch is released, so he lands only where the Gates as the flood
  has them leave the landing free, and walks on from it so. The flood tries these hops when its queue drains, before
  it presses any flavor, since a press changes the flavor's gates for the rest of the flood.
- A Mirror standing on a Lily's cell hops too. Those hops hold only while the Lily stays where the save last left it
  (`driftHops`). The page does not yet show which plans depend on them.
- A Mirror the walk pushes to another cell ([Moves](#moves)) hops from there when no other magic Mirror stands in the
  room of that cell, laid like the hops above with the cell it left ending no ray, and Gates as the save left them.
  The hero hops only from an arm cell in the Mirror's room. The hops of the cell it left stay, since the hero may use
  them before he pushes it.
- The game processes a mirage only while the Mirror's room holds a Guy of the active hero. The walk does not check
  that the arm cell lies in the Mirror's room, but for a Mirror it pushed; an arm can run out of it.

#### Hops between two facing Mirrors

When two magic Mirrors reflect the hero to different mirages, he is cloned: a copy appears at each landing, the copies
share one turn group and move together, and a copy that dies is survivable while another lives
([Magic mirrors](MOVEMENT.md#magic-mirrors)). The walk models the case of a room with exactly two magic Mirrors, both
flat, riding no Lily, below the map rooms, whose arms face each other along one grid line:

- The gap between them holds no target, stop or Fence (a ray along it from the first Mirror ends at the second). Every
  Fence on it counts, since the hero's path to either Mirror crosses part of it.
- A hero d cells from the first Mirror stands e = gap − d cells from the second. Both Mirrors reflect him, so he lands
  d cells down the first Mirror's other arm and e cells down the second's. Each other arm must be clear (no target,
  stop or Fence) nearer than the cell he reflects to, as for a single Mirror.
- All or nothing: both landings must be free, else the activation does nothing. Nothing else in the room moves, since
  no other magic Mirror exists there.
- The walk goes on from each landing in the layer the flood reached the arm cell in. The copies are not kept together:
  the walk treats them as independent heroes after the hop, so a cell is reached when either copy could walk there.
- A pocket flood also steps from a landing back to the arm cell it came from, since the hero reaches a landing only
  by this hop. Single hops stay one-way.

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
  blocked and holds no pushable or beam stop, but for the latest cell of a Lily under the landing, whose rider moves
  with it. The ride ends at a blocked step or when a cell and heading repeat (at most
  4 (W + H) steps). The ride is the landing cell plus every cell the Lily enters; without a Lily it is the landing
  cell alone.
- Kicks ([Lilies](MOVEMENT.md#lilies)): a stone skipping past kicks the Lilies beside it. Each cell a stone hops out of
  (the first water cell, and each cell on from it as far as a hop goes: onto a cell of a Lily's drift, onto a cell that
  holds it, onto level water, into a cell without level water, or where the stone sinks in place against a fence, a
  blocked cell or a pushable) kicks the Lily whose latest cell is next to it on either side of the heading, away from
  the lane. That Lily drifts as a ride does, from its latest cell and in the kick's direction. Its cells hold the hero
  once the flood has reached the launch's push cell in layer 0 and the stone is not in a closed Freezer's cell; they
  are not in the build-time drift of the Lilies, so the lanes above skip over them. A Lily on a river already, which
  drifts at every cell of its drift, is not kicked.
- Respawns ([Activators and Spawners](MOVEMENT.md#activators-and-spawners)): a Spawner that respawns a Lily in a river
  cell (`world.lily_spawns`) puts it on the drift from that cell. Its cells hold the hero once the flood has reached the
  cell of an existing Activator that runs the Spawner, in layer 0, as for a kick; they are not in the build-time drift of
  the Lilies. The Lily the save left stays where it is, and the walk does not take the old one away: each Spawner of a
  Lily counts, though only one Lily exists. A Spawner off a river changes nothing.
- The line: from each ride cell in each direction, until a blocked cell, a pushable, a Wardrobe door edge or the start
  cell again (at most W + H). Cells on it that are open and not more than 0.1 under a surface are where the hero can
  stand to swap; those of them that come after a cell he can't stand in are past a gap. The Lily under the stone
  carries no hero: a cell held up only by that Lily (one Lily lies under the landing, the cell holds that one alone,
  and nothing below holds it up) is no line cell.
- One lane per ride cell the hero swaps into. He rides from there to the end of the ride, or, when the line cell he
  swapped from lies further along the ride, to the cell just before it: the stone, swapped into that cell, stops the
  Lily there. A lane's line cells are those whose ride ends at the same cell.
- The swap, when the queue drains: the stone is not in a closed Freezer's cell, the launch push cell and a cell next
  to the stone are reached in layer 0, and one of the lane's line cells is reached in layer 2. Then every cell of the
  lane's ride is reached in layer 2: the hero rides with the stone and steps off anywhere along it. The walk resumes.
  Lanes go in one pass in their order; a lane that a swap in the pass brings due fires in the same pass only when it
  comes later in the order. That is the order the
  skills allow: a TELEPORT hero can't push ([Pushing and pulling](MOVEMENT.md#pushing-and-pulling)), so the stone goes
  first.
- A pocket flood walks a lane backwards only: when it reaches any cell of the lane's ride, it reaches the launch push
  cell and the lane's line cells past a gap, in layer 0. A forward swap inside a pocket flood would follow a one-way
  edge the wrong way.
- A skill Wardrobe's door-in on the way to the line resets the skill, so such a walk is no lane.
- Left out: pushes are single ([Routes that need these mechanics](MOVEMENT.md#routes-that-need-these-mechanics)). A swap
  onto the stone puts it in the hero's line cell, from where the walk does not push it on to another launch.

### Room answers

The walk's searches for Rocks, Switch objects, Gems and Monsters push one object at a time and take the hero's push
cells from the cells the flood reached ([Moves](#moves)), with caps on the cells they visit. The build searches every
screen room of the level data exhaustively instead, with all its objects moving, and `data/walk.json` `rooms` stores what
it finds (`searchRooms()`, `src/walk/room-search.ts`; [data/walk.json](DATAFILES.md#datawalkjson)). A walker uses the
answer of a room whose save leaves it as the level data has it, and runs the same search on its own grid for every other
room that holds an object (`searchTouchedRooms()`); only the inputs differ.

- A room is a 4-connected set of cells in one z and one screen (19 × 13 squares) where the hero stands or an object
  rests, cut at Fences, Gates (shut or not, so the room does not depend on a Gate's state) and closed Freezers,
  water-level cells nothing holds up, Lily, drifting-Lily and bridge cells, the map rooms, and, below the ground, cells
  only the implicit floor holds up. What holds up a cell is the ground, so a room is cut with the objects out of the
  grid. Only rooms with an object are searched.
- Freezers: the build searches each room with every Freezer closed. A room with up to three Freezers around it (in its
  cells or beside them, above or below) is searched again for every other combination of those Freezers open. An open
  Freezer's square is ground like any other cell: the hero and the objects use it if something holds it up, and it holds
  up nothing above it ([Support and open cells](#support-and-open-cells)). The rooms on the far side of an open Freezer
  join the room on that screen, so the search is of the merged room, and the cells that lose their support, if any, leave
  it. An answer is stored for the merged room and the state of the Freezers around it (their open and closed states),
  and rooms with the same cells and the same answer are stored once, for each state they hold in. A room with more
  Freezers around it than the search allows keeps its all-closed answer only. A walker picks the answer whose state
  matches the Freezers of its save. The attacked cells are worked out again with the Freezers open: a dragon's fire runs
  through an open Freezer and stops at a closed one ([Goblins, dragons and PROTECTION](MOVEMENT.md#goblins-dragons-and-protection)),
  and a goblin's six cells do not depend on Freezers.
- The objects are the room's Rocks, skipping stones, Gems, Promesst_Lights, Mirrors, Rovers, Friendly_Dragons and
  Monsters, in the cells the grid has them: the level data's for the stored answers, the save's latest cells for a room
  the walker searches. The grid holds the rest as it does for the walk (the other rooms' objects stand still).
- A room with no start, nothing to tell or too many positions is stored with no entries, so that a walker which finds it
  as the level data has it knows it was searched and does not search it again.
- The hero walks over the room's cells and the cells beside it (its halo) that he stands in: not an attacked cell, a
  cell under the water, or a cell only an object holds up while the object is away. A cell holding an object blocks
  him. His start is the pieces of ground that reach into the halo (up to six, the largest; all pieces for a room the halo
  does not touch). Each start has its own search, and a room with several has one for all of them together as well,
  which keeps only what the single starts do not find. A start is used once the walk has reached its cell in layer 0.
- A push is the walk's own ([Moves](#moves)): the hero stands in the cell behind the object, no Fence is on either edge,
  the object stands on a floor, and it lands as a Rock does (one cell on, falling through open air and water at most 8
  cells, none through a wall, Gate, closed Freezer or pushable). The hero then stands in the cell it left, so an object
  in an attacked cell is not pushed. Positions are told apart by where each object is and by the lowest cell of each piece of ground the hero walks over; an object that
  ends where the hero has no cell behind it is not pushed on, wherever it lands, so an object that leaves the room is
  not followed once he cannot reach it.
- Where an object sinks: a Rock or spare Gem bridges the water cell, a skipping stone is gone (its skips stay with the
  skip lanes, [Skip lanes and the TELEPORT swap](#skip-lanes-and-the-teleport-swap)), a Monster drowns, and a Gem
  that a room's light needs, a Promesst_Light, a Mirror, a Rover or a Friendly_Dragon is not pushed into water. A Monster
  pushed to a cell dies in the fire of another dragon (one off the cell the level data puts it in burns nothing there) or
  beside a living goblin, and a dragon pushed to a cell kills the first Monster of the room its fire hits, as in
  [Moves](#moves).
- An answer holds, per start: for each Rock (by the cell its grid puts it in) the water cells it sinks in; for
  each Switch the objects that stand on it; for each Gem_Slot the Gems that stand on it; and the Monsters that die. Each
  fact is reachable alone. Facts about different objects may not be reachable together, as with the walk's
  one-object searches (a flavor takes each Switch's object once, [Moves](#moves)).
- A room that needs more than 200 000 positions has no stored answer and keeps the walk's searches (`rooms.capped`); so
  does one state of the Freezers around a room whose merged room needs more, while the other states keep theirs. A room
  the walker searches on its grid has a cap of 20 000 positions and keeps the walk's searches above it.

A walker uses a room's answer when the save leaves the room as the level data has it: every entity in the room or
beside it (a cell beside it, above or below) is where the level data puts it and in its state (its position, existence,
facing, properties, pressed, open, `dead_t`, a Gem's holder, a Gem_Slot's flags), the Monsters whose attacks cross the room
are as well, no Rock or Tree the save created stands in it, none of its Groups or Wall_Sets or the Ocean_Maps over it
differs from the level data, and the Freezers around it are in a state the answer holds for. A walker searches every
other room that holds an object on its own grid, from the objects, Freezers, Gates, water and attacks the save leaves
(the rooms are cut as above, on that grid), and uses the answer in the same way as a stored one; a room that needs more
than the cap keeps the walk's searches alone.

The answers are asked before the walk's own searches and add to them: a Rock that turns takes the first water cell of
the answer that joins new ground; a Switch search takes the first object of the answer that no flavor has taken; a Gem
for a Gem_Slot with turns and a Monster that dies are taken from the answer too. What the answer does not hold is still
searched as before, which keeps the searches the answer does not model (TELEPORT swaps, skips, CHARM, objects that leave
a room, Gates and Freezers the flood opens). A room's objects count as due once the walk has reached the answer's start
cells, and a search that found nothing is asked again when one of them is reached.

The walk's searches never push from an attacked cell: the hero steps into the cell the object leaves, and a hero without
PROTECTION dies there in that turn's attack ([Goblins, dragons and PROTECTION](MOVEMENT.md#goblins-dragons-and-protection)).
The answer leaves such pushes out the same way. The walk's searches still read the hero's push cells more loosely than
the answer does: they take every cell reached when the search starts as a push cell, whatever the earlier pushes of the
same search have done to the way there (a Rock pushed out of a one-cell passage shuts the cell behind it). So they can
find a bridge the answer lacks, and `tests/room-answers.test.js` checks that what they find from a room's start is
held by the answer, stored or searched on the walker's grid, but for the few such Rocks it lists. The searched answers
have the same few: it is the same search.

### Pads revealed through the map rooms

- `reveals(T)`: discovering pad i discovers its `target_id`, then its `also_discover`, each with its own chain (a pad already in the set ends it), then its `also_discover2` alone. Of those, the world-layer pads (layers 0-2) other than i are its reveals.
- A revealed pad q counts for MAJOR pad i only when q exists and a walk on foot (no pads, no elevators) joins i's twin (its `target`) to some twin targeting q, with the Groups of the four pads (`g` own Group, `ag` = `also_exist_this_group_id`) made to exist (`withGroups`). Twins are not asked to exist: discovery makes them. Twins in different ground layers are never joined: a walk on foot never changes ground layer (a step keeps z, a fall from the fast-travel box stays in its layer, and a walk from the world never reaches the fast-travel box), so a map-room pad, whose `target` lies in the world, reveals nothing, and the walk is not run for it. The walk from i's twin ends as soon as it reaches the twin it looks for.
- Twin `also_discover` links walkable this way: most in the level data, nearly all with every twin Group on.

### Seeds and the reached cells

`reachability()` floods once from every place the save shows the hero has been:

- the current hero position, in one layer: 1 when the latest Guy `skill_flags` hold PROTECTION, else 2 when they hold TELEPORT, else 0. In layer 1 inside an attacked cell, that cell; else `land` (not above); none if inside a wall no THROUGH beam runs through;
- every kept hero position: a protected one (the PROTECTION rule in [Overworld state from the save](STATE.md#overworld-state-from-the-save)) inside an attacked cell seeds that cell in layer 1; otherwise `land` (not above), in layer 1 for a protected one, else in layer 0 and, where he held TELEPORT, in layer 2 as well; dropped when it lands in water deeper than 0.1 or inside a wall no beam runs through (a dead seed);
- every Level_Entry with Status state (`land`);
- every activated Area_Pin (`land`, not above: a pin is touched, not stood on, and the new-game pin stands inside a wall);
- every discovered teleporter (its pad cell), unless it is frozen in a closed Freezer.

The result R is the set of reached cells. A level is reached when its cell or `land` of it is in R and it is not frozen
in a closed Freezer (its Level_Entry on the Freezer's square). A frozen level is reached only once that Freezer opens.

### Pockets, leads and why

- Leads: each closed Freezer the walk bumped into (`front`) is opened alone; the levels not entered that a walk from it (outside R) reaches are its leads. A level frozen in another Freezer is left out. A Freezer that holds a stone launched with CHARM ([Moves](#moves)) is a lead too: the walk from the seeds is run with it open, and the levels not entered that it reaches are its leads.
- A level not reached sits in its own pocket: a walk from it that never enters R (no reveals). The closed gates that walk bumps into are the gates it sits behind. This pocket flood walks the one-way edges backwards, since it looks for the ways in: every rock bridge holds the hero from either side ([Moves](#moves)), and skip lanes run from the landing back to the push side ([Skip lanes and the TELEPORT swap](#skip-lanes-and-the-teleport-swap)). Magic-mirror hops stay one-way, but for the landings of two facing Mirrors, which lead back to their arm cell ([Hops between two facing Mirrors](#hops-between-two-facing-mirrors)).
- A walk from one level can reach another level not reached across a one-way edge (a fall, a hop), so that level lies in more than one pocket. A way into any of them leads on to it: it sits behind the gates of every pocket that holds it and takes the mechanics, the sky entrance and the pad ways (`viaPads`, less the gates and levels any of those pockets holds itself) of each. A level that an earlier pocket holds starts no walk of its own.
- A level frozen in a closed Freezer starts its pocket walk in the Freezer's own cell, where the hero stands once the Freezer opens. The pocket's gates and levels go to the other levels in it; the frozen level itself sits behind its own Freezer alone.
- A pocket holding a pad that another pad reveals is also entered from the revealing pad's pocket: its gates and levels join (`viaPads`).
- A MINOR pad that lands the hero outside the reached cells (in its target pad's cell, or the cell a search down from its target point stops in, [Moves](#moves)) is a way into every level he walks on to from the landing, with the pads but not the pads' reveals: the closed gates on the edge of the pocket that reaches the pad on foot, and that pocket's levels, join (`viaPads`), less what the level's own pockets hold. A level frozen in a closed Freezer takes none. A MINOR pad the save leaves disabled counts only when it is a ground Tower's `teleporter_id`, which the Tower's activation enables ([Teleporter pads and fast travel](MOVEMENT.md#teleporter-pads-and-fast-travel)): the Tower joins (`viaPads` towers) while it is inactive, and the pad's own pocket too while the pad lies outside the reached cells.
- A closed Freezer holding a Rover that a pocket bumps into is walked once from its own cell with it open: the Rover then ferries the hero over water the pocket's own walk does not cross ([Moves](#moves)), and the levels that walk holds, other than those frozen in a Freezer, sit behind the Freezer, whichever pocket bumps it. Only a Freezer that holds a Rover is opened this way; a Freezer that holds anything else leads only to the pocket's own levels.
- `from`: for a level a closed gate needs, the levels behind that gate a walk from the level reaches.
- `mech`: per pocket, the mechanics the walk leaves out (world.mechs: 0 dragon, 1 beam, 2 mirror, 3 skipping stone), marked in the 3 × 3 × 3 cells around each existing one (a Mirror or MIRRORABLE Rock at its latest cell, a smashed or destroyed one not at all; a stone at its latest cell unless it sank: FLIPPING_TARGET or under the surface; beams: lit cells; dragons: fire cells). A pocket has one when a marked cell is in it or next to one of its cells.
- Why (per blocked level): its gates (those that lead in, without the ones `inner()` rules out), the gates leading only to a revealing pad (`pad`), the levels by such a pad (`via`), the inactive Towers whose pad leads in (`viaTowers`), and the mechanics. A level with no gate and no mechanic has "no known route", even when it carries an access mark (below). The page reads "from the Sky" instead when the level has no access mark and a pocket that holds it is entered from the sky, or a walk on from a landing off a sky ledge reaches it (`fromSky`, below), once fog shows the sky ([The spoiler model (viewer)](#the-spoiler-model-viewer)).
- `inner(gate, level)`: a closed gate is no way in when what it still needs is the level itself, levels from which the walk reaches the level without it, or levels whose own requirements need the level. For an OR gate with more than one option: every remaining option is such a level, and it has no Sign.
- Levels whose requirements need level L (`levelsNeedingLevel`): walking back along `unlocked_by`, every unsolved level still waiting on its requirements (not enabled in the level data, and for an OR level no option solved) that requires L or such a level. An AND level needs L through any one requirement; an OR level with more than one option only once every option is L or such a level. A gate that waits on them waits on L: a requirement cycle, no way in.
- Way in (`P.wayIn`): per blocked level, its why-gates; when no gate leads in, the closed gates it sits behind in the static roles ([Level roles (viewer)](#level-roles-viewer)), minus the `inner` ones. When that leaves none, a gate that `inner` ruled out only because it waits on a level the walk reaches the level from stays a way in if that level has a way in of its own (a why-gate that is no gate the level sits behind): the walk leads on from that level to this one. Gates that wait on the level itself, on levels that need it, or on levels with no way in of their own stay ruled out. In the endgame areas the level data's table stands in for these or fills in where there are none ([Endgame way-in gates](#endgame-way-in-gates)). Last, the gates behind themselves are dropped ([Next steps](#next-steps)).
- A pocket flood never walks a fall backwards: a pocket that the hero enters only by falling into it from outside gets no way in from that fall, except from the sky (below).
- The pocket floods, of a level and of a revealing pad, take no step onto a closed Freezer's top from the side, which would walk the hero across the Freezer as if it were floor and so leave it no gate between the two halves. A fall does land on a top: the hero drops from the pocket onto it and off it again, and what he reaches that way (a strip below a row of Freezers, say) belongs to the pocket, so the Freezers on its edge are ways in. The walk does not check that the way past the top leads back to the pocket. The other floods walk the tops ([Support and open cells](#support-and-open-cells)).
- Sky entrances (`skyEntrances()`, per level `fromSky`): a sky ledge is a cell over a solid voxel of the sky layer (static, or of an existing Group) that is not blocked, attacked or under a water surface (a hero there drowns, so it is no ledge). The hero steps off it to a side with no fence on the edge and no pushable in the cell, and falls down that column. A cell lets him fall on when it is not blocked or attacked and nothing holds him there. Per column the walk keeps the lowest such step, and drops the column when anything between that step and the bottom of the sky layer would stop the fall. A pocket is entered from the sky when one of its cells below the sky has a clear fall up to the bottom of the sky layer in such a column. That covers a hole in a sky floor above the pocket and a step off a sky floor's edge. A level is also entered from the sky when the hero reaches it by walking on from where such a fall lands him: the walk from every landing cell (the first cell that holds him below a column's clear fall, outside the reached cells, with the gates as the save has them) reaches the cell the level stands in. That is how the ground's z 1 wall tops are entered: the fall lands on a wall top and the hero walks on and steps down.
- Access (`P.access`): a blocked level on a layer where the walk reaches no cell at all (the sky or the underworld) is marked with that layer. A blocked level in a pocket entered from the sky is marked with the sky while the walk reaches no sky cell, so its plan waits on the way onto the sky ([The requirement graph](#the-requirement-graph)).
- So a sky hub ringed by Freezers that all need levels inside the ring gives its first level no way-in gate: while the walk reaches no sky cell that level waits on the way onto the sky, otherwise it is a step of its own ([The requirement graph](#the-requirement-graph)). The levels frozen in the ring follow from the ring's levels.

### What the walk leaves out

- Mirrors: no reflections of fire, beams or the TELEPORT line (each ends at the Mirror; the TELEPORT line only swaps with a Mirror met on its back or a closed side, [Moves](#moves)), so no lift by a beam turned up. Magic-mirror teleports only as the hops of a flat magic Mirror alone in its room below the map rooms, or of the two flat magic Mirrors of a room that face each other ([Magic-mirror hops](#magic-mirror-hops)): no vertical magic Mirrors, no other rooms with several, none in the map rooms, no other clones, no lockstep of a pair's copies, no swaps of other targets, no reflected rays, no check that the hero's cell is in the Mirror's room. A hop's ray stops at every Gate cell the save left shut, also one the flood opens later, where the game stops only at a Gate shut at the time (inferred); only a hop off a Switch the hero holds sees that Switch's flavor as pressed. A Mirror riding a Lily hops as if the Lily stayed where the save last left it.
- Magic Mirrors pushed with turns ([Moves](#moves)): the walk searches each Mirror alone and from the cells the flood reached in layer 0, so a push cell that only the push itself opens is not used. Pushing a Mirror out of a room does not make the Mirror left in it alone there, and a hop's landing is not checked against Wardrobe door edges. Hops off a Switch the hero holds are laid only for a Mirror where the save left it, and a pushed Mirror's cell is not a Switch press. A pushed Mirror is not placed, so nothing else sees it in its new cell (rays, lanes, swaps).
- One-way edges in pocket floods: they count every rock bridge from either side and walk skip lanes backwards, from the landing to the push side; they keep falls inside the layer they start in, and walk no fall backwards but the sky entrances and no step onto a closed Freezer's top from the side, so a drop into a ground pocket from the z 1 wall tops beside it is no way in ([Pockets, leads and why](#pockets-leads-and-why)).
- Rocks sunk with turns ([Moves](#moves)): one bridge per Rock, at the nearest water cell that joins reached ground to unreached ground (a Rock in a room with a [room answer](#room-answers) tries the answer's water cells first, with the room's other objects moving too), so a Rock that could bridge either of two gaps bridges one. A gap of two or three water cells in a row closes only with that many Rocks, each found by its own search from the cells the flood reached; a gap of four or more water cells never closes, and neither does one that needs a Rock to be pushed in a row with another or pulled. A spare Gem sinks like a Rock, but how many Gems of a room may sink is not counted: with one Gem more than the open slots, two Gems of the room can both sink, and a Gem that sank can still be pushed onto a slot. A Mirror sinking is no bridge (a flat one holds nothing, [Objects in water](MOVEMENT.md#objects-in-water)); a Promesst_Light or a Rover that sinks would hold the hero up, and the walk does not push them into water. Every Rock of a chain stays in its old cell too, so a Rock pushed later does not pass that cell. A pocket flood counts a turned bridge only from its own side.
- Rovers that sink ([Moves](#moves)): only a Rover under water carries the hero; a Rover on land (many shuttle on their tracks) carries nobody. The whole track holds the hero at once: the walk does not check that he reaches a cell before the Rover has passed it, the timer (the Rover steps about every 7 hero moves) or a stall. A track ends where the water does and at a solid cell, a Fence, a Rock or a movable: the game's Rover pushes what is in its way, which the walk does not model. A Rover sinks once, at the nearest water cell where its track joins reached ground to unreached ground, as a Rock does, so a track that joins nothing new is not made. A pocket walk that bumps into a Freezer holding a Rover opens it once more to find the levels the Rover ferries it to; the Rover's ride past that is the one described here ([Pockets, leads and why](#pockets-leads-and-why)). The track of a Rover the flood sinks is not left out of the map's reached cells when the hero only rides through, as a Lily's drift is ([Skip lanes and the TELEPORT swap](#skip-lanes-and-the-teleport-swap)).
- Rocks a Spawner puts back ([Moves](#moves)): the reset destroys the Rock the save left and the walk keeps it, and a reset again after the Rock has sunk is not walked (it would take the bridge away). A respawned Rock sinks, like any Rock that turns, only where it joins reached ground to unreached ground, so a bridge to a water cell with no new ground beside it is not made, and a Rock the Spawner puts back in a cell other than its level-data cell has no straight bridges. A Spawner whose cell is blocked skips its respawn in the game; the walk does not check that.
- CHARM ([Moves](#moves)): only the launch of a MIRRORABLE skipping stone into water. A charm move takes everything within 2 cells along, so the hero's other steps near a stone move it too, and a charmed Guy, Monster, Mirror or other stone takes each step with him; the walk moves none of them, and takes the cells the hero reached in layer 0 as cells he stands in with CHARM, though a hero with CHARM pushes nothing (his press is a charm move), so the cells include ones only a pushing hero reaches. A stone moved by a charm step over dry cells, kicks of the Lilies a charmed stone passes, and a TELEPORT swap onto a charmed stone (the skills stack only through two Wardrobes) are not laid. A stone skipping from an earlier launch is left out of a charm move; the walk lets the next launch follow at once. The CHARM Wardrobes' door-ins are not tracked: a Wardrobe entered by its door resets the skills, which the walk applies to PROTECTION, TELEPORT and TRANSMUTE only.
- Skills: one push of one cell; no MULTIPUSH rows, PULL, SWAP_WITH_DRAGON. Layer 0 can't tell MULTIPUSH from PULL, CHARM or another skill, so every hero outside layers 1, 2 and 3 pushes. MULTIPUSH rows and PULL would each need a walk layer of their own, with the door-out gains and door-in resets of [Wardrobes](SKILLS.md#wardrobes). Skills don't stack on PROTECTION or TELEPORT: a PROTECTION + MULTIPUSH hero is treated as unable to push, a PROTECTION door taken in layer 2 drops TELEPORT, and a TELEPORT door taken in layer 1 drops PROTECTION. In the game that holds only when the hero enters that Wardrobe through its door, which resets him to QUEEN | SINGLE_PUSH; entered through its back or a side, he leaves it with both skills ([Wardrobes](SKILLS.md#wardrobes)).
- TAKE_GEMS and Guys as supporters: no overworld Wardrobe or Guy holds TAKE_GEMS, so every Gem is a pushable that holds up what stands above it, and a hero who walks into a Gem's cell is not modelled. The overworld has the one Guy, the hero, so no other Guy holds anything up. The flood does not move what the hero pushes, so a pushed Gem or Monster keeps holding up the cells above its old cell, as a pushed Rock does; a room answer moves its objects and holds up the cells above each one where it stands.
- TELEPORT ([Moves](#moves)): the line runs at his own z only (no wait on a FALLING hit at z + 1 or z + 2), tests only the cells at the stride of his powered move ([TELEPORT and PULL](SKILLS.md#teleport-and-pull)) and looks for a Wardrobe door edge only at the cells it tests, and doesn't turn at a Mirror's open side; a swapped target stays in its cell in the grid, but for where Swapped targets in [Moves](#moves) read it; no swap with another Guy; the flood takes both the step and the swap where the game swaps whenever the line finds a target.
- Swapped targets ([Moves](#moves)): only a swap onto the Switch or the slot cell itself brings an object there (a swapped object pushed on from another cell is searched for a Rock that turns and not for a Switch or a slot), and only from the first swap with each object: a target that a swap moved is met where the save left it by every later swap and line. A Mirror swapped to the hero's cell hops from nothing there, a light casts no beam from it, a Gem fills a slot only in the slot's cell, and no swapped Rock is placed: it stops no beam in the cell it lands in (a swap that would is not taken) and blocks no step. A Rock swapped into water sinks there only by the pushes of the Rocks that turn. A swap from a cell a lead flood stays out of, or in a pocket flood, is not noted.
- Beams: SMASH, STRONG; OPEN only for the Gate next to a hero standing in the beam (no pushed, falling or skipping movers, and ALTER only keeps the Gate shut: an open Gate is never shut); vertical THROUGH and vertical ENDPOINT beams; beams of lights that moved before being powered; a room losing power when a Group makes an unfilled slot exist (in the game its lights go off, [Promesst beams and powers](MOVEMENT.md#promesst-beams-and-powers)); colours other than THROUGH inside `withGroups`.
- Beams moved by pushes ([Beams moved by pushes](#beams-moved-by-pushes)): a Gem or Promesst_Light is pushed in a straight line, and a Gem that needs a turn goes by the walk back from its slot only, which keeps it inside its room and takes no Gem from a slot; a Rock pushed back toward its light or into another beam; a Gem that lands in another beam does not cut it, and a light's spots all shine at once; a light, Gem or Rock moved this way is still met where the save left it by what was laid out when the walker was built (magic-mirror rays, skip lanes, lily drifts, TELEPORT swap targets). The walks of the build-time pad pockets make these pushes too.
- Gates shutting on what stands in them (push or crush, [Gates, switches and buttons](MOVEMENT.md#gates-switches-and-buttons)), but for the Gate lifts ([Moves](#moves)): a Gate that closes upward lifts the hero only when he steps into it off a Switch of its flavor beside it, never when something else releases a Switch. So the closing Gate that lifts the hero onto the step of the sky hub's south way lifts nobody in the walk: its Switch is fenced in and not beside it.
- TRANSMUTE ([Moves](#moves)): only Trees and dragons are turned, and only by a hero who left a TRANSMUTE Wardrobe by its door from layer 0. He pushes nothing, so he walks only where the save left no Rock, Monster or movable, even in a cell a hero in layer 0 pushed one out of; Skills do not stack on TRANSMUTE either (a TRANSMUTE door taken in another layer is ignored, and in layer 3 another skill's door changes nothing, so a TRANSMUTE + MULTIPUSH hero is treated as unable to push). A crystal is not turned back into what it was, no other kind of target is turned (a Rover, a mirrorable Rock or Mirror, a Friendly_Dragon, a Guy), a crystal made on a Switch from something that presses none (a Friendly_Dragon) is not counted, and a Tree's root Fences stay. The beams are not laid again for a crystal, so a Tree that stopped a beam still does. The crystals of dragons do not bridge water. A hero whose latest skills hold TRANSMUTE and no push starts in layer 3.
- Switches: an object brought onto a Switch by CHARM (but for a launched skipping stone), PULL or MULTIPUSH, or a Monster that walks onto it (no Monster is known to walk by itself); a closed Freezer on the object's way counted as a way in. A pressed flavor keeps its gates changed for the rest of the flood, as if its objects stayed on their Switches and the hero never took one off: they are not placed, and no other flavor uses them. Flavors take their objects in latch order, the nearest first, so a later flavor may find none where another order would give it one. An object counts as held by a Gate below it that was shut at any point in the flood, even once the flood has opened it; in the game an open Gate holds nothing. Magic-mirror rays, skip lanes and lily drifts are laid out before any press, so they see each Gate as the save left it, and an OPEN beam never bumps open a notted Gate a press has shut.
- Lilies: a river Lily counts at every cell of its drift at once ([Cells](#cells)): the hero may board it anywhere along the drift and walk up it against the current, and a stone may land on it there. On a loop that matches the game; on a drift that ends, the walk does not check that the hero reaches a cell before the Lily has passed it. A Lily off a river counts only at its data and latest cells, plus the ride of the kick that took it onto a river when its first recorded move leads there ([Cells](#cells)), plus the drift of a kick ([Skip lanes and the TELEPORT swap](#skip-lanes-and-the-teleport-swap)); a kick needs only the launch's last push cell reached, not the pushes that bring the stone there, and a Lily on a river is never kicked off it. Rover rides but for those of a Rover that sank in water (below), river redirects, ocean resets, Activator respawns other than those of Lilies on a river ([Skip lanes and the TELEPORT swap](#skip-lanes-and-the-teleport-swap)) and of Rocks (below), elevator cargo changes at run time (the rock on the map-room copy of the hub elevator, which `SmashFastTravelRock` destroys).
- Attacks ([Attacks](#attacks)): a goblin's SQUEEZE and THROUGH beams are those cast with the walker's grid, so a beam that a push lays down does not change what a goblin attacks ([Goblins, dragons and PROTECTION](MOVEMENT.md#goblins-dragons-and-protection)). A goblin stuck inside a wall attacks nothing in the game unless it stands in a THROUGH beam; the walk lets it attack the cells around it.
- Activator resets: a reset takes away a Rock that sank, so the bridge cell is water again; the walk keeps the bridge.
- The Rod (WAND) and the Torc, which the overworld's inventory-only Wardrobes give ([TRANSMUTE and the other skills](SKILLS.md#transmute-and-the-other-skills)): the walk gives the hero no items, so an inventory Wardrobe changes nothing and the Rod's use on the cell ahead is not walked.- Monster Gates ([Moves](#moves)): the walk opens a monster Gate only by pushing every Monster of its room to its death, each Monster alone, from cells the flood reached in layer 0, so a push cell that another death opens is not used. A Monster that dies leaves its cell and its attacks in the grid but holds nothing up, so the cells a drowned dragon's fire or a dead goblin's attack leaves free are not opened, and the Monster is not placed where it dies. The fire of a pushed dragon runs over the cells of the save (a Rock the flood pushes does not stop it), the first Monster it meets dies, and a dragon at a cell where another dragon burns it is taken to burn that dragon in turn. Left out: a goblin in a SQUEEZE beam, whose attack on a Monster pushed beside it crosses Fences ([Goblins, dragons and PROTECTION](MOVEMENT.md#goblins-dragons-and-protection)), a Rock that falls on a Monster, the weight crush, a closing Gate that kills, a Monster that only a Group makes exist, a notted monster Gate, a Gate that shuts again when a living Monster is in its room again, and a Monster that walks by itself or is charmed (no Monster is known to move by itself, and the walk's CHARM launches only skipping stones).
- Room answers ([Room answers](#room-answers)): each room is searched alone, from the level data for the stored answers
  and from the save's grid for the rooms the save changed, with the Freezers around it closed or open in the
  combinations the search allows (up to three Freezers around a room for the stored answers; a room with more has its
  all-closed answer only, and an open state whose merged room needs too many positions has none; a searched room has the
  Freezers as the save has them). An object that leaves its room is not followed (a Rock pushed through a border is not
  pushed on to water across it, a Monster that leaves is not counted dead), and the hero walks only over the room and the
  cells beside it, never around by another room. His walk does not model Wardrobe door edges (skill changes), pads,
  elevators or Lilies, and takes the attacked cells and a dragon's fire as the grid puts them, also after the dragon is
  pushed. Beams, skip lanes, CHARM and the TELEPORT swap are not in the answers; a Freezer that stopped a beam still
  does in an answer with it open. A Gate or a Freezer that the flood opens does not join two rooms in an answer, nor does
  a Freezer open in the save when the state of the Freezers around the room has no stored answer (the walker then
  searches the room itself). A Freezer farther down a column that a pushed object falls through, or farther along a
  dragon's fire line than the room, is not among the Freezers around the room, so a stored answer does not read its
  state. The few rooms and states over the position cap have no answer. Across several objects the answer holds facts
  that are each reachable but not always together. The answers are asked before the walk's searches and add to them, so
  the push cells those searches read loosely ([Room answers](#room-answers)), from cells the earlier pushes of a search
  have cut off, stay in the walk. The searches are kept for the rooms that have an answer too: leaving them out of a room
  with an answer loses ways in that the answer lacks (TELEPORT swaps, skips, CHARM, objects that leave a room, Gates and
  Freezers the flood opens).
- Pads as ways into a pocket ([Pockets, leads and why](#pockets-leads-and-why)): a MINOR pad that the save leaves disabled counts only when it is a ground Tower's pad; the level data does not link the Low towers' pad pairs to their Towers, so they lead in through nothing. A Tower pad outside the reached cells adds its Tower and its pocket's gates as alternatives, where the game needs both. A pad leads in through its own pocket only: a way that takes several pads is not followed. The pads that another pad reveals are found by looking for their cells in the pocket floods, which take pads forward, so a revealed pad's cell can lie in a pocket whose levels it does not lead back to.
- `FastTravelEnableGroup` Markers ([Teleporter pads and fast travel](MOVEMENT.md#teleporter-pads-and-fast-travel)): a Marker the hero touches makes its Group exist, which the walk does not do; a save already holds the Groups touched so far. The lift's Marker enables the map-room copy of the ruby lift, whose pieces are a vertical ENDPOINT beam and a vertical Mirror (left out under Beams), so it would change nothing in the walk; what `FTEnd1`, which the hub Markers enable, holds is not documented. The page does not read these Markers' positions (they are not in `world.json`).
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

Freezers are open when listed in Status list A or satisfied now
([Level_Entry unlocking and state](PROGRESSION.md#level_entry-unlocking-and-state)). Without a history file there is no walk and
"unlocked" reads "Not entered".

## Level roles (viewer)

A level is **Optional** only when it is provably not needed for any goal (it then counts only for Completionist). Every
other level is **Required**, including the ones whose use the model can't see. Goals are the tower levels that are not
dropdowns and the levels with an `achievement`. An achievement level is always Required. A tower needs N of its M
normal levels, so a tower level is Required as one of several, unless the tower needs every normal level or something
Required needs that level. Dropdowns are not goals (they only give gold), so a dropdown is Optional unless something
Required needs it.

Needs, from the goals:

- a level needs its `unlocked_by` levels (none for a level enabled in the level data). With an OR gate of more than one option, every option is needed, but only as "one of", and so is everything they need in turn;
- a level or Freezer needs the Freezers it sits behind. Behind several Freezers = any one of them, so they are needed as "one of". A level frozen in a Freezer sits behind that Freezer alone, even where the walk reaches the squares next to it;
- a Freezer needs its `unlocked_by` levels (Sign rules are not levels), and a Freezer is needed by itself unless it is provably a shortcut (below).

So a non-goal level is Optional when everything it opens is optional: every level that lists it in `unlocked_by` is
Optional and every Freezer that lists it is a shortcut with nothing Required behind it. A level that opens nothing is
Optional.

"Provable" means the walk ([The walk model (viewer)](#the-walk-model-viewer)) shows it, run on the level data: no
history (Gates, Switches, existence Groups and Lilies at their data state; every teleporter at its data `enabled` / `discovered`), seeded with the hero and the Area_Pins of
a new game (`data/fog.json` `start`), every Freezer closed and level unlocks ignored. Pads keep their level-data
state: the walk discovers none. Then rounds: the closed Freezers on the edge of the reached cells (in Pid order) open
together. A level or Freezer first reached in a round is behind the Freezers of that round whose opening alone reaches
it (all of that round's Freezers when only opening them together does).
A Freezer is a **shortcut** when the walk reaches it, opening it reaches no cell that isn't reached without it (in an
earlier round, or the same round through another Freezer), and the walk goes through it: from a cell that reached it,
across its cell, to a reached cell on the opposite side. Every other Freezer is needed: one the walk never reaches, one
that alone opens new cells ("one of" when several Freezers of the round open the same cells), and a dead end, pit or
step up whose far side the walk never sees.

These are the static roles: `staticRoles()`, run at build time by `scripts/build-walk.js` and
stored in `data/walk.json` (`need`, and `bg`: the Freezers each level and Freezer sits behind). The page reads them
synchronously at load, so they are there from the first draw. They feed the way-in fallback (`bg`, [Pockets, leads and
why](#pockets-leads-and-why)) and the Next steps label ([Next steps](#next-steps)), and stand in for the roles of a
goal that has none.
The lists and the map go by the selected goal's roles ([Goal roles (viewer)](#goal-roles-viewer)).

Result on the level data: most levels come out Required, the rest split between Required as one of several and
Optional; nearly every gate is Required; few dropdowns are Required. Most normal tower levels are Required as one of
several, the rest Required.

Limits: on the level data the walk reaches only a small share of the level entrances and gates. What stops it is state a played game has and
the level data lacks: discovered pads, moved rocks, pressed switches, Groups made to exist, filled Gem_Slots. So most gates come out needed, which errs towards Required. It errs towards Optional
only where it walks somewhere the game doesn't allow, or misses a second route the game doesn't have.

## Unlock plans and next steps (viewer)

A plan is what is still to do before a level, Freezer, sign or tower opens, walked back to the levels playable now.
`planAll(P)` works out every plan at once; `unlockPlan(P, root)` reads one off as nodes and edges.
An edge [a, b] means a comes before b. Solved levels and open Freezers have empty plans.

### The requirement graph

A requirement is met (nothing to do), a step (a node of the plans) or a part (an option list with no step of its own).
It needs all its parts (AND), the cheapest one (OR), or the cheapest k of them (k of n). Steps: levels (l), Freezers
(g), signs (s), towers (t), gold rooms (p), the way onto a layer (a) and the rank markers ASCEND and DESCEND (e).

- Level, solved: met. Playable now (entered, partly solved or reachable): a step with no parts, a front.
- Level, locked: its unsolved requirements, all of them, or for an OR gate of more than one the cheapest of them; and
  the closed Freezer it is frozen in.
- Level, not reachable: the cheapest of its way-in gates (`P.wayIn`), the levels by a pad that leads into its pocket
  (`why.via`) and the Towers whose pad does (`why.viaTowers`); none of the last two where the endgame table replaces
  the walk. With none of them and an access mark (`P.access`:
  its layer, which the walk reaches nowhere, or the sky its pocket is entered from): the way onto that layer. With none of them, or when every way-in gate only leads to such a pad,
  it may become a step of its own (below).
- Freezer, open: met. Closed: its unmet levels and signs, all of them, or for an OR gate of more than one the
  cheapest. An OR gate with one of them met is a step with no parts: it opens at the next overworld load.
- Sign, met: met. A tower sign needs its tower; a rank sign rank r; the gold-room sign the cheapest k of the gold rooms
  still to find, k = 4 − the rooms found.
- Gold room: met once its `gold_room_endpoint` pad is discovered; else a step after its tower: the step onto the
  tower's MINOR pad ([Endgame](PROGRESSION.md#endgame)).
- Rank r, a part: the cheapest source of r or more: the ENDGAME levels (1, 3, 5), ASCEND (2) and DESCEND (4)
  ([Achievements and ranks](PROGRESSION.md#achievements-and-ranks)). Met when the rank is r already.
- ASCEND and DESCEND are steps after the way onto their layer, the sky and the underworld. Met at their rank. As 1-step
  leaves they would always win the rank's OR.
- The way onto the sky comes after rank 1: the lift's pieces wait in rank-1 Freezers. The way into the underworld
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

- `end1`: the gold-room Sign's gates, in place of the walk's.
- The end2 room's levels: the four Freezers ringing the sky hub elevator under the room, one per sky tower
  ([Second Endgame](PROGRESSION.md#second-endgame)), only where the walk finds none, so the walk's pockets inside the room
  stay.
- `all_together_now`: the set's gates above the room, in place of the walk's.
- The `endgame3` levels: one chain in set order, in place of the walk's. A level sits behind the gates opened only by
  levels before it in the set (the latest of those), leaving out a gate whose levels need the level itself. The first
  room has none, so it needs the way into the underworld.

A row that stands in for the walk's gates also drops the levels by a revealing pad and the Towers whose pad leads in.

### Next steps

Next steps (`nextSteps`, `P.needed`) say what each unsolved level opens; the goals' lists are sorted by them
([Goals (viewer)](#goals-viewer)). They are worked out once, for no goal in particular. The things still to do: every
tower not activated, every unsolved level whose achievement is not earned, every locked or blocked level, every
closed Freezer (not a Judge's). Every playable or unreachable level in the plan of one of those is a next step. Per
next step:

- the towers whose levels' plans hold it, with the levels each still needs;
- the levels and gates whose plans hold it, the ones after it;
- the next ending not earned yet, when that ending's level's plan holds it.

Order (`orderNextSteps`): playable, then unreachable, then locked; then the steps toward the next ending; then by the
tower brought closest to done; then by more levels and gates after it that the goal needs (Required or Required as
one of several by the goal's roles, by the static roles for a goal without roles); then by distance from the hero's
latest position, wrapped in x and y, levels on his layer first (no tiebreak without a history). Towers, levels and
gates under fog don't count.

Label (`goalOf`, what a level leads to under Completionist): "Toward Endgame" (the ending's name, [The page's words](#the-pages-words)), with the
tower brought closest to done: "Toward Endgame · Antipode HxM · 3 to go". An ending is named only while its achievement
may show ([The spoiler model (viewer)](#the-spoiler-model-viewer)); else the label is the tower, then the achievement
of the level or of a level after it that is not earned, then the first Required level or Freezer after it
("Required `name` +2", "Required ice cage · `area` +2" or "Required ice gate · `area` +2"), then "Required level"
when the level itself is Required, else nothing. Required here is the static role Required, not Required as one of
several. The label names no tower, level or gate under fog.

Gates behind themselves (`gatesBehindThemselves`): a way-in gate is dropped from `P.wayIn` when its own requirements
can be met only from behind it, through any chain of gates and levels. The requirements form a graph over levels and
Freezers: a blocked level needs one of its way-in gates or of its levels by a pad; a locked level needs all of its
unsolved requirements (one of them for an OR level) and the closed Freezer it is frozen in; a closed Freezer needs
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

- Order: the three endings in rank order (Endgame, Endgame High, Endgame Low), Towers, Achievements (one child per
  achievement other than COMPLETIONIST), Completionist. Endgame has one child per ground tower, the towers with an
  Antipode teleporter, whose visits its Sign counts ([Endgame](PROGRESSION.md#endgame)); Towers one child per other
  tower (the sky and underworld towers), and no row while every one of them is under fog.
- Done: an ending, a tower child or an achievement child when its achievement is earned or the tower activated; a
  ground tower under Endgame once its Antipode teleporter is visited (its `gold_room_endpoint` pad discovered), so an
  activated tower is not done until the hero steps onto its pad; Towers and Achievements when every child is;
  Completionist when COMPLETIONIST is earned or no level is left unsolved. The active goal is the first goal not done;
  among the children, the first child not done in the order listed.
- Targets, the requirements ([The requirement graph](#the-requirement-graph)) a goal asks for: an ending its
  ENDGAME level; a tower its tower; a ground tower under Endgame its gold room, which waits on the tower and then on
  the step onto its pad; an achievement its tower's (the TOWER_* ones), its unsolved levels, or its rank marker
  (ASCEND, DESCEND); Towers and Achievements their children's; Completionist every unsolved level. A goal done asks
  for nothing. Endgame's own targets leave its children out: they are a view of the gold-room k of n on its plan.
- Progress: an ending, its plan steps left that fog does not hide, its own level counted; Endgame, until its Sign
  has the teleporters it needs, the Antipode teleporters visited of that need (4), the in-game bar on the Sign, then
  its plan steps left; a tower, its solved normal levels of the number it needs; a ground tower under Endgame the
  same, and once activated its next step, the step onto its pad ("Antipode teleporter · Antipode HxM"); an
  achievement, its tower's count, its levels solved, or 0 / 1; Towers and Achievements, the children done of the
  children shown; Completionist, the levels solved of the levels not under fog. `fogged`: more of it is under fog.
- Endgame's children: the ones whose gold room is on Endgame's cheapest plan (the cheapest four still needed), or
  visited, are listed first and the rest after them (`onPlan`). When the plan runs through no gold room while the Sign
  still needs some (a save without a walk, where `end1` reads as playable), every child counts as on the plan.
- Labels: an ending by its name, a tower by its tower name, an achievement and Completionist by the achievement's
  name ([The page's words](#the-pages-words)). With spoilers hidden an ending is listed only once every ending before
  it is earned ([The spoiler model (viewer)](#the-spoiler-model-viewer)).

A goal's levels (`goalLevels`): the unsolved levels not under fog that serve it. An ending's are the levels its roles
mark ([Goal roles (viewer)](#goal-roles-viewer)). A tower's, and a ground tower's under Endgame, are its unsolved
normal levels and the levels in their plans. An achievement's are the levels in its targets' plans (a tower's as for the tower). Towers and Achievements
gather their unfinished children's; Completionist takes every level. Each level carries:

- its group: playable now (entered, partly solved or reachable), not reachable (blocked) or locked;
- its role for the goal;
- `onPlan`: it lies on the cheapest plan of one of the goal's targets (every level, for Completionist);
- `leadsTo`: the nearest thing not under fog on its chain toward the goal (the `from` links of the goal roles): a
  tower ("Antipode HxM · 3 to go"), a Freezer ("opens ice cage" or "opens ice gate", and its area, else "at x, y"), a
  level ("unlocks `name`" when that level lists the one before it on the chain in `unlocked_by`, else "opens the way
  to `name`") or a rank marker; else the goal's label. At the nearest OR on its chain where it is one of several, " · one of N routes"
  follows, N counting the routes not under fog, or " · one of several routes" when fewer than 2 show. Under
  Completionist it is the Next steps label ([Next steps](#next-steps)).

They are listed in the Next steps order. `goalSolved(goal)`: the solved levels not under fog in the goal's scope (a
tower's or an achievement's own levels, every level for the rest). The page shows the goal picked, else the active
one, else the last.

## Goal roles (viewer)

A level's or Freezer's role for one goal (`goalRoles()` and `roleFor()`): Required (on every route
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

The page names a Freezer by its model: model A (`GAME_OVER_Freezer_A`, the pod) is an ice cage, model B
(`GAME_OVER_Freezer_B`, the doorway, `doorway` in `progress.json`) an ice gate. Panel titles, chips, map tooltips and
the why and leads-to lines use the Freezer's own word. A list of Freezers says "ice cages" or "ice gates" when they are
all one model, and "ice cages and gates" when they mix ("behind one of 3 ice cages and gates"). The map's Ice overlay
switch covers both models and the signs that open them.

The sidebar, top to bottom: the save (campaign, rank, play time, last saved), No spoilers and the search box, Goals,
Find on the map (an Ice cages row and an Ice gates row, each with its own counts and left out when its total is 0,
then teleporters, voice logs, and a Treasures count with no map action, since treasures are picked up inside a
level), Areas (collapsed by default, its open state remembered; a layer subhead only when more than one layer has
areas shown) and the save's Stats (with spoilers hidden, only the counters above 0). The sidebar fits the window: the open area list, then Goals, give up height and
scroll inside under their headers.

- Goals: one row per goal ([Goals (viewer)](#goals-viewer)) with a check when done, a ◆ on the active goal, and a
  count. An ending reads "23 left", or "under fog" when nothing is left to show; Endgame reads "1 / 4", the Antipode
  teleporters visited of its Sign's need with a bar, until the need is met; the rest read "3 / 16". A trailing `+`
  says more is under fog (not on Endgame's "1 / 4", whose total is the Sign's need; its tooltip says it). Endgame,
  Towers and Achievements open inline; picking a tower, under Endgame too, also sets the tower chip and frames the
  tower on the map. A ground tower activated whose teleporter is not visited reads "teleporter", its tooltip naming
  the step; one off Endgame's cheapest plan has a muted name. Treasures are not a goal: they drive nothing
  ([Treasures and gold rooms](PROGRESSION.md#treasures-and-gold-rooms)). Achievements has a Details link to the full
  list.
- The pick is kept per campaign. Picking the active top-level goal stores none, so the default follows progress.

The list shows the picked goal's levels (`goalLevels`, plus `goalSolved` while the Solved chip is on), on the map's
layer unless All layers is on or a search runs.

- Chips: the tower and area chips, each removable; the state chips Playable (reachable or entered), Partially solved,
  Not reachable (only with a walk), Locked and Solved. State chips that are on join (union); with none on, the list
  holds the unsolved levels. Each counts the goal's levels the search and the tower and area chips keep, on the
  layers listed; a chip with 0 is disabled.
- Groups, each with its count: Play now, Not reachable yet, Locked, Solved. Within a group the levels Required as one
  of several and off the goal's cheapest plans go last.
- A row: state dot, role dot, name, then what it leads to and its area. The tooltip adds the state, role and why.
- Empty list: "No levels match." with Clear filters, and while a search runs outside Completionist, "Search every
  level", which picks Completionist; "`goal` is done."; "No more on this layer."; "Nothing to show yet; more is under
  fog."; "No levels left for `goal`."
- Show in list (from a level's panel): the chips are cleared and the Solved chip turned on for a solved level; when
  the goal doesn't hold the level, the list switches to Completionist.

The map draws the list's levels. Solved, locked and blocked ones by state; playable ones by their role for the goal:
Required (triangle), One of several (square), Optional (circle). Playable levels on the goal's cheapest plans are
drawn above the others, and the level the save is in on top. Overlays show what is left for the goal: open Freezers,
Freezers Optional for the goal, satisfied signs and found pads, gold rooms, voice logs, map scrolls and treasures are
left out unless the Solved chip is on. The key lists the colours drawn, with Clear filters when nothing matches. A
level's or gate's panel names its role for the goal ("One of several for Endgame"), none for a solved level. The
floor heights the base image draws come from `data/walk.json` ([The viewer's base image](DATAFILES.md#the-viewers-base-image)).

### The page's words

The page names things as the game and Steam do; where neither has a name it uses a plain word, never an internal
type or enum name ([Localisation and display names](GAMEDATA.md#localisation-and-display-names)).

| Thing | The page says | From |
|---|---|---|
| Areas | "The Antipode", "Antipode High", "Antipode Low", "Crossroads High", ... | the English localization's `area_*` text, read by the data build (`display` in `data/progress.json`) |
| Ranks | Visitor, Egressant, Pusher, Arranger, Intrepid, Sokoban | the localization's `rank_*` text |
| Achievements | "Antipode HxM", "High Mirrors", "Low SxB", "Gold HxB", "Ascend", "Endgame High", "Completionist", "Beamcasters", ... | Steam's English achievement names, a table by the `Achievement` value name |
| Endings | "Endgame", "Endgame High", "Endgame Low" | the names of their achievements |
| Worlds | Heroes, Mirror Isles, Skipping Stones, Beamcasters; a pair by its letters joined by x ("HxB", B for Beamcasters) | Steam's achievement names |
| Mechanics in "why" | Dragon fire, Beams, Mirrors, Skipping Stones | the game's words, capitalised as the game capitalises its objects |
| Towers | "Antipode HxM", "High Heroes", "Low HxM" | Steam's name of the tower's achievement; "tower" is the plain word for the kind, since the game has none |
| Levels | `simplify_skipping` | the level name: levels have no display names |
| Level sets, voice logs | not named: a voice log is "Voice log" | the level data's names are internal and some name a layer or an ending |
| Layers | Ground, Sky, Underworld | plain words: the game only qualifies places as "High" and "Low" |
| Gold rooms | "Antipode teleporter" | a ground tower's pad and its endpoint in The Antipode; Steam's descriptions call the pad "the HxM teleporter to the Antipode" |
| The rest | ice gate, teleporter, voice log, map scroll, treasure plinth, sign, dropdown | plain words; "Teleporters" is also the game's |

With spoilers hidden, the rules in [The spoiler model (viewer)](#the-spoiler-model-viewer) decide whether a thing is
named at all.

## Level areas (viewer)

The game stores no level → area link ([Areas](STATE.md#areas)). The data build (`npm run data:areas`) applies the game's
current-area rule at each Level_Entry's position, with every pin counted as activated: `data/level_areas.json`, and per
level `area` in `data/progress.json`.

- Boxes: Markers with `script_name` `local_area`, a target that is an Area_Pin, not a point marker, non-zero extents. A point is inside when, after moving x and y to the copy nearest the box (period 190 × 156, or the fast-travel box for boxes at z ≥ the threshold 74.66) and rotating by the inverse orientation, |local / scale| − extent ≤ 0 on every axis.
- The containing box with the strictly lowest `float_parameter` wins; on a tie the first in package record order. 4 levels lie in two boxes of equal priority 0 (`priest_button_3d_revised`, `fire_stairs_part_2`, `priest_3d_goblin_pass`, `priest_descent_simpler`); record order gives `area_s_heroes_3d` over `area_s_vertical_priestess`. The game's strict `<` and array walk give the same: its Marker array is in record order ([Areas](STATE.md#areas)).
- Some entries lie in boxes of more than one area (the cross-area overlaps and the ties above). In the game their named area depends on which pins are activated. They carry `overlap`: every area box holding them, with its `float_parameter`, in record order. The viewer names each by the save's activated pins (`levelAreaOf`): the box with the lowest `float_parameter` among those whose pin is activated, the first on a tie; with none of them activated, the area from the all-pins rule above. Neither reference save has activated the pins that would move one.
- Some entries are outside every box. The game names no area for them; the fallback below (`nearest_*`) is the viewer's own grouping.
- A level outside every box gets a fallback: the box with the smallest outside distance (max over axes), then the lower `float_parameter`, then record order. Nearest-box agrees with a same-set neighbour more often than Euclid-nearest pins.
- 7 pins have no level: `area_g_crossroads`, `area_u_antipode_low`, `area_g_heroes_together`, `area_s_beam_way`, `area_g_exit`, `area_s_skipping_way`, `area_s_heroes_way`.
- z is the fragile axis: shifting the test point −0.5 moves far more entries than +0.5.
- The game's own grouping is the level set ([Levels, level sets and saves](WORLD.md#levels-level-sets-and-saves)), not the area. Level sets cross areas by design.

## The spoiler model (viewer)

With "No spoilers" on (the default), nothing under fog shows: no names, counts, totals, layers, labels or mechanic
names. Fog is the game's own ([Fog of war](STATE.md#fog-of-war)), read from the save.

- A level is hidden unless it is solved, the level the save is in, revealed by the viewer (a click on its fog chip, for the visit), or not under fog: its Level_Entry's fog region on its layer is cleared and it is outside every FILLED fog box. Without fog data only entered and solved levels count as uncovered.
- A tower is hidden while not activated and its position is under fog. A tower status sign of a hidden tower is hidden.
- An area is named only while its pin is activated (the game names an area only then). A level shows its area only while that area is shown. A Freezer is named by the area it stands in (by the box rule over activated pins), else by its position.
- Totals (Freezers, MAJOR pads, gold rooms, treasures, voice logs, map scrolls, signs) list only things not under fog, or already found (gold rooms only once visited). "Ground 70 / 90 · Sky 17 / 35" style splits cover only the layers the fog has uncovered.
- The map paints fogged squares in the fog colour in the base image and leaves them out of the Reachable overlay, so the images hold nothing the fog hides.
- An unearned achievement is hidden when what earns it is hidden: all its levels are hidden, its tower is hidden, or its layer has no cleared fog (ASCEND: the sky; DESCEND: the underworld). The sidebar and the plans share this rule.
- Endings go by their achievements' names ("Endgame", "Endgame High", "Endgame Low"). An ending's achievement is hidden by the endings' order alone: it is shown (in the ladder and the achievements) only once every ending before it is earned, so the ladder never counts the endings ahead.
- A rank sign names its rank only while the achievement that gives that rank (an ending, ASCEND or DESCEND) is shown; otherwise it asks for "A higher rank".
- Gold rooms are known only once visited: until then a gold room's endpoint is a pad like any other, so the totals, the map's gold-room rings and the plan steps leave unvisited ones out. One exception: an activated ground tower under Endgame names the step onto its own pad ("Antipode teleporter · Antipode HxM"), since Steam's description of that tower's achievement names that teleporter.
- A totals row whose remaining things are all under fog says "None left outside the fog", which doesn't say whether the fog holds any.
- Goals ([Goals (viewer)](#goals-viewer)): every count is over what fog leaves (an ending's plan steps, the towers and achievements not hidden, the levels not under fog), and a count with more under fog carries a `+`. Endgame lists the ground towers not hidden; its Antipode teleporter count is the visited ones (known, as the totals know them) of the Sign's need, shown only while that Sign is not under fog, else its plan steps. A goal with nothing to show says "Nothing to show yet; more is under fog." No `leadsTo` names a fogged level, gate, tower or hidden achievement, and its route count leaves out the routes under fog.
- Plan steps without a chip of their own: a gold room shows where the totals show it (once visited; its tower's row under Endgame names it before, as above); the way onto a layer only once that layer has cleared fog; ASCEND and DESCEND only while their achievement is not hidden.
- Mechanics in a level's "why" are named only once the save has that world's achievement (Dragon fire: HEROES, Beams: PROMISE, Mirrors: MIRRORS, Skipping Stones: SKIPPING); else "may need something the map does not model".
- The page source may hold spoilers: only what the page shows must be spoiler-free.

import { APPROACHES, COUNTER_GOALS, SUPPLY_GOALS } from './layout.ts';
import { routeCosts } from './navigation.ts';
import type { Food, Player } from './simulation.ts';

type Recipe = readonly [Food, Food];
type OrderCard = { recipe: Recipe; next?: Recipe };
type Rush = { station: number; rival: number };

// These two inward-facing trays have the closest matched spawn routes for the local seat.
const OPENINGS = [
  { station: 1, seats: [0, 1] },
  { station: 2, seats: [0, 3] },
] as const;

export function createSharedOrders(
  supplies: readonly Food[], recipes: readonly Recipe[], draw: () => number, hz: number, speed: number,
) {
  const supplyGoals = SUPPLY_GOALS.map(([goal]) => goal);
  const decks = COUNTER_GOALS.map(goals => {
    const near = new Set(supplyGoals.map((goal, station) => ({
      food: supplies[station], distance: Math.min(...routeCosts(APPROACHES[goal].position, goals, -1)),
    })).sort((a, b) => a.distance - b.distance).slice(0, 2).map(tray => tray.food));
    const split = recipes.filter(([a, b]) => near.has(a) !== near.has(b));
    return split.flatMap(recipe => {
      const next = split.find(other => other.every(food => !recipe.includes(food)));
      return next ? [{ recipe, next }] : [];
    });
  });
  const following: (Recipe | undefined)[] = [];
  let nextRushAt = 0;
  const rushInterval = 8 * hz;
  const maxRouteGap = 0.55 * speed;

  function options(seat: number): readonly OrderCard[] {
    const recipe = following[seat];
    return recipe ? [{ recipe }] : decks[seat];
  }

  function deal(seat: number, cards: readonly OrderCard[], first?: Food, avoid?: Food): Food[] {
    const { recipe, next } = cards[Math.floor(draw() * cards.length)];
    following[seat] = next;
    const [a, b] = recipe;
    return first === b || (first === undefined && a === avoid) ? [b, a] : [a, b];
  }

  function open(players: readonly Player[], tick: number, roll: number) {
    const opening = OPENINGS[Math.floor(roll * OPENINGS.length)];
    const food = supplies[opening.station];
    for (const player of players) {
      const paired = player.id === opening.seats[0] || player.id === opening.seats[1];
      const cards = options(player.id);
      player.recipe = paired
        ? deal(player.id, cards.filter(card => card.recipe.includes(food)), food)
        : deal(player.id, cards, undefined, food);
    }
    nextRushAt = tick + rushInterval;
    return opening;
  }

  function findRush(player: Player, players: readonly Player[], cards: readonly OrderCard[]): Rush | undefined {
    let closestGap = maxRouteGap;
    let rush: Rush | undefined;
    for (const rival of players) {
      const food = rival.recipe[0];
      if (rival === player || !food || rival.carried || !cards.some(card => card.recipe.includes(food))) continue;
      const station = supplies.indexOf(food);
      const goal = supplyGoals[station];
      const route = (chef: Player) => routeCosts(chef.position, [goal], -1)[0];
      const ownDistance = route(player), rivalDistance = route(rival);
      const gap = Math.abs(ownDistance - rivalDistance);
      if (!(gap <= closestGap)) continue;
      const earlier = Math.min(ownDistance, rivalDistance) - maxRouteGap;
      const headStart = players.some(other => other !== player && other !== rival && !other.carried &&
        (other.recipe[0] === food || (other.goal === goal && other.recipe.includes(food))) && route(other) < earlier);
      if (headStart) continue;
      closestGap = gap;
      rush = { station, rival: rival.id };
    }
    return rush;
  }

  function next(player: Player, players: readonly Player[], tick: number) {
    const cards = options(player.id);
    const rush = tick >= nextRushAt ? findRush(player, players, cards) : undefined;
    if (!rush) return { recipe: deal(player.id, cards) };
    const food = supplies[rush.station];
    nextRushAt = tick + rushInterval;
    return { recipe: deal(player.id, cards.filter(card => card.recipe.includes(food)), food), rush };
  }

  return { open, next };
}

type MatchupRow = {
  home_user_id: string;
  away_user_id: string;
};

type MatchupPair = {
  home_user_id: string;
  away_user_id: string;
};

const pairKey = (a: string, b: string) => [a, b].sort().join("|");

const hashWeek = (value: string) =>
  value.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);

export function buildMatchupsForWeek(
  members: string[],
  history: MatchupRow[],
  weekId: string,
  benchmarkUserId?: string | null
) {
  const uniqueMembers = [...new Set(members)].sort();
  const pairCounts = new Map<string, number>();
  const gamesByUser = new Map<string, number>();
  const benchmarkCounts = new Map<string, number>();
  const pairs: MatchupPair[] = [];

  history.forEach((matchup) => {
    const isBenchmarkMatch =
      benchmarkUserId &&
      (matchup.home_user_id === benchmarkUserId ||
        matchup.away_user_id === benchmarkUserId);

    if (isBenchmarkMatch && benchmarkUserId) {
      const opponent =
        matchup.home_user_id === benchmarkUserId
          ? matchup.away_user_id
          : matchup.home_user_id;
      benchmarkCounts.set(opponent, (benchmarkCounts.get(opponent) ?? 0) + 1);
      gamesByUser.set(opponent, (gamesByUser.get(opponent) ?? 0) + 1);
      return;
    }

    const key = pairKey(matchup.home_user_id, matchup.away_user_id);
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    gamesByUser.set(
      matchup.home_user_id,
      (gamesByUser.get(matchup.home_user_id) ?? 0) + 1
    );
    gamesByUser.set(
      matchup.away_user_id,
      (gamesByUser.get(matchup.away_user_id) ?? 0) + 1
    );
  });

  const remaining = new Set(uniqueMembers);
  const weekHash = hashWeek(weekId);

  if (uniqueMembers.length % 2 === 1) {
    if (benchmarkUserId) {
      const candidates = [...remaining].sort((a, b) => {
        const benchDiff =
          (benchmarkCounts.get(a) ?? 0) - (benchmarkCounts.get(b) ?? 0);
        if (benchDiff !== 0) {
          return benchDiff;
        }
        const gamesDiff = (gamesByUser.get(a) ?? 0) - (gamesByUser.get(b) ?? 0);
        if (gamesDiff !== 0) {
          return gamesDiff;
        }
        return a.localeCompare(b);
      });
      const lowestCount =
        candidates.length > 0 ? benchmarkCounts.get(candidates[0]) ?? 0 : 0;
      const tied = candidates.filter(
        (candidate) => (benchmarkCounts.get(candidate) ?? 0) === lowestCount
      );
      const pick = tied.length
        ? tied[weekHash % tied.length]
        : candidates[0];
      if (pick) {
        remaining.delete(pick);
        pairs.push({
          home_user_id: pick,
          away_user_id: benchmarkUserId
        });
      }
    } else {
      const byeCandidate = [...remaining].sort((a, b) => {
        const gamesDiff = (gamesByUser.get(b) ?? 0) - (gamesByUser.get(a) ?? 0);
        if (gamesDiff !== 0) {
          return gamesDiff;
        }
        return a.localeCompare(b);
      })[0];
      if (byeCandidate) {
        remaining.delete(byeCandidate);
      }
    }
  }

  while (remaining.size >= 2) {
    const [user] = [...remaining].sort();
    remaining.delete(user);

    const opponents = [...remaining].sort((a, b) => {
      const countA = pairCounts.get(pairKey(user, a)) ?? 0;
      const countB = pairCounts.get(pairKey(user, b)) ?? 0;
      if (countA !== countB) {
        return countA - countB;
      }
      return a.localeCompare(b);
    });

    if (!opponents.length) {
      break;
    }

    const opponent = opponents[0];
    remaining.delete(opponent);

    const homeFirst = weekHash % 2 === 0;
    pairs.push(
      homeFirst
        ? { home_user_id: user, away_user_id: opponent }
        : { home_user_id: opponent, away_user_id: user }
    );
  }

  return pairs;
}

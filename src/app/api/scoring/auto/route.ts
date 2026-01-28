import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { scoreWeekIfReady } from "@/lib/scoring-runner";

async function handleAutoScore(request: Request) {
  const secret = process.env.SCORING_CRON_SECRET;
  if (secret) {
    const authHeader = request.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token || token !== secret) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  const supabase = createSupabaseServiceClient();
  const { data: weeks, error: weeksError } = await supabase
    .from("weeks")
    .select("id, week_end, league_id");

  if (weeksError) {
    return NextResponse.json({ error: weeksError.message }, { status: 500 });
  }

  const results = await Promise.all(
    (weeks ?? []).map((week) =>
      scoreWeekIfReady({
        supabase,
        leagueId: week.league_id,
        weekId: week.id,
        weekEnd: week.week_end
      })
    )
  );

  const scored = results.filter((result) => result.scored).length;

  return NextResponse.json({ ok: true, scored });
}

export async function POST(request: Request) {
  return handleAutoScore(request);
}

export async function GET(request: Request) {
  return handleAutoScore(request);
}

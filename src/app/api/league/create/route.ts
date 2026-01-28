import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { generateInviteCode } from "@/lib/leagues";
import { ensureProfile } from "@/lib/profiles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const MIN_SEASON_WEEKS = 4;
const MAX_SEASON_WEEKS = 52;
const MIN_MEMBERS = 2;
const MAX_MEMBERS = 50;

const formatDate = (date: Date) => date.toISOString().slice(0, 10);

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const getNextMondayUtc = (from: Date) => {
  const day = from.getUTCDay();
  const daysUntilMonday = (8 - day) % 7 || 7;
  const base = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  return addDays(base, daysUntilMonday);
};

const getTimezoneOffsetMinutes = (date: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const tz = parts.find((part) => part.type === "timeZoneName")?.value ?? "UTC";
  const match = tz.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!match) {
    return 0;
  }
  const hours = Number.parseInt(match[1], 10);
  const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;
  const sign = hours < 0 ? -1 : 1;
  return hours * 60 + sign * minutes;
};

const makeZonedDate = (
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
) => {
  const utcDate = new Date(Date.UTC(year, monthIndex, day, hour, minute));
  const offsetMinutes = getTimezoneOffsetMinutes(utcDate, timeZone);
  return new Date(utcDate.getTime() - offsetMinutes * 60 * 1000);
};

export async function POST(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const body = await request.json().catch(() => null);
  const name = body?.name?.trim();
  const requestedWeeks = Number(body?.seasonLengthWeeks);
  const requestedMaxMembers = Number(body?.maxMembers);
  const seasonLengthWeeks =
    Number.isFinite(requestedWeeks) && requestedWeeks >= MIN_SEASON_WEEKS && requestedWeeks <= MAX_SEASON_WEEKS
      ? Math.floor(requestedWeeks)
      : 12;
  const maxMembers =
    Number.isFinite(requestedMaxMembers) &&
    requestedMaxMembers >= MIN_MEMBERS &&
    requestedMaxMembers <= MAX_MEMBERS
      ? Math.floor(requestedMaxMembers)
      : 10;
  if (!name) {
    return NextResponse.json({ error: "League name is required." }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  try {
    await ensureProfile(user);
  } catch (profileError) {
    return NextResponse.json(
      { error: (profileError as Error).message },
      { status: 500 }
    );
  }

  let league;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = generateInviteCode();
    const seasonStart = getNextMondayUtc(new Date());
    const { data, error: insertError } = await supabase
      .from("leagues")
      .insert({
        name,
        invite_code: inviteCode,
        created_by: user.id,
        season_length_weeks: seasonLengthWeeks,
        max_members: maxMembers,
        season_start: formatDate(seasonStart)
      })
      .select("id, name, invite_code")
      .single();

    if (!insertError && data) {
      league = data;
      break;
    }

    if (insertError?.code !== "23505") {
      return NextResponse.json({ error: insertError?.message }, { status: 500 });
    }
  }

  if (!league) {
    return NextResponse.json(
      { error: "Could not generate a unique invite code." },
      { status: 500 }
    );
  }

  const { error: memberError } = await supabase
    .from("league_members")
    .insert({ league_id: league.id, user_id: user.id });

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  const seasonStart = getNextMondayUtc(new Date());
  const weeks = Array.from({ length: seasonLengthWeeks }, (_, index) => {
    const weekStart = addDays(seasonStart, index * 7);
    const weekEnd = addDays(weekStart, 4);
    const lockDate = addDays(weekStart, -1);
    const lockTime = makeZonedDate(
      lockDate.getUTCFullYear(),
      lockDate.getUTCMonth(),
      lockDate.getUTCDate(),
      16,
      0,
      "America/New_York"
    );

    return {
      league_id: league.id,
      week_start: formatDate(weekStart),
      week_end: formatDate(weekEnd),
      lock_time: lockTime.toISOString()
    };
  });

  const { error: weeksError } = await supabase.from("weeks").insert(weeks);
  if (weeksError) {
    return NextResponse.json({ error: weeksError.message }, { status: 500 });
  }

  return NextResponse.json({ league });
}

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { ensureProfile } from "@/lib/profiles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const DURATION_OPTIONS: Record<
  string,
  { label: string; days: number }
> = {
  "1_week": { label: "1 week", days: 7 },
  "2_weeks": { label: "2 weeks", days: 14 },
  "3_weeks": { label: "3 weeks", days: 21 },
  "4_weeks": { label: "4 weeks", days: 28 },
  "3_months": { label: "3 months", days: 90 },
  "6_months": { label: "6 months", days: 180 },
  "9_months": { label: "9 months", days: 270 },
  "1_year": { label: "1 year", days: 365 }
};

export async function POST(request: Request) {
  const { user, error, status, powerUser } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  if (powerUser) {
    return NextResponse.json(
      { error: "Power users cannot self-exclude." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const selection = body?.duration;
  const option = DURATION_OPTIONS[selection as keyof typeof DURATION_OPTIONS];

  if (!option) {
    return NextResponse.json(
      { error: "Invalid self-exclusion duration." },
      { status: 400 }
    );
  }

  try {
    await ensureProfile(user);
  } catch (profileError) {
    return NextResponse.json(
      { error: (profileError as Error).message },
      { status: 500 }
    );
  }

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + option.days * 24 * 60 * 60 * 1000);

  const supabase = createSupabaseServiceClient();
  const { error: insertError } = await supabase.from("self_exclusions").insert({
    user_id: user.id,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    duration_label: option.label
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ endsAt: endsAt.toISOString() });
}

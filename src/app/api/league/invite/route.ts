import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { resolveUserIdByIdentifier } from "@/lib/supabase/admin";

const parseIdentifiers = (raw: string) => {
  return Array.from(
    new Set(
      raw
        .split(/[,;\n\s]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
};

const getSiteUrl = () =>
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
  "http://localhost:3000";

export async function POST(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const { leagueId, emails } = (await request.json()) as {
    leagueId?: string;
    emails?: string;
  };

  if (!leagueId) {
    return NextResponse.json({ error: "League is required." }, { status: 400 });
  }

  const identifiers = parseIdentifiers(emails ?? "");
  if (identifiers.length === 0) {
    return NextResponse.json(
      { error: "Provide at least one email or username." },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServiceClient();
  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, name, invite_code, created_by")
    .eq("id", leagueId)
    .maybeSingle();

  if (leagueError) {
    return NextResponse.json({ error: leagueError.message }, { status: 500 });
  }

  if (!league || league.created_by !== user.id) {
    return NextResponse.json(
      { error: "Only the league creator can send invites." },
      { status: 403 }
    );
  }

  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.RESEND_FROM ?? "support@wizyrd.com";
  if (!apiKey) {
    return NextResponse.json(
      { error: "Email sending not configured. Set RESEND_API_KEY." },
      { status: 412 }
    );
  }

  const resolvedEmails: string[] = [];
  const notFound: string[] = [];

  for (const identifier of identifiers) {
    if (identifier.includes("@")) {
      resolvedEmails.push(identifier.toLowerCase());
      continue;
    }
    const { userId } = await resolveUserIdByIdentifier(supabase, identifier);
    if (!userId) {
      notFound.push(identifier);
      continue;
    }
    try {
      const { data: userData } = await supabase.auth.admin.getUserById(userId);
      const email = userData?.user?.email?.toLowerCase() ?? null;
      if (email) {
        resolvedEmails.push(email);
      } else {
        notFound.push(identifier);
      }
    } catch (_error) {
      notFound.push(identifier);
    }
  }

  const list = Array.from(new Set(resolvedEmails));
  if (list.length === 0) {
    return NextResponse.json(
      {
        error:
          notFound.length > 0
            ? `No users found for: ${notFound.join(", ")}.`
            : "Provide at least one email or username."
      },
      { status: 400 }
    );
  }

  const joinLink = `${getSiteUrl()}/league/join?code=${encodeURIComponent(
    league.invite_code
  )}`;
  const subject = `Join ${league.name} on Wizyrd`;
  const html = `<p>You have been invited to join <strong>${league.name}</strong> on Wizyrd.</p>
<p>Invite code: <strong>${league.invite_code}</strong></p>
<p>Join link: <a href="${joinLink}">${joinLink}</a></p>`;

  const sendEmail = async (to: string) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        html
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Failed to send invite.");
    }
  };

  try {
    await Promise.all(list.map((emailAddress) => sendEmail(emailAddress)));
  } catch (sendError) {
    return NextResponse.json(
      { error: sendError instanceof Error ? sendError.message : "Failed to send invites." },
      { status: 500 }
    );
  }

  const inviteRows = list.map((emailAddress) => ({
    league_id: league.id,
    email: emailAddress,
    invited_by: user.id,
    status: "pending",
    responded_at: null
  }));

  const { error: inviteError } = await supabase
    .from("league_invites")
    .upsert(inviteRows, { onConflict: "league_id,email" });

  if (inviteError) {
    return NextResponse.json(
      { error: inviteError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ sent: list.length, notFound });
}

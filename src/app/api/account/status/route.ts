import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: Request) {
  const {
    user,
    error,
    status,
    excludedUntil,
    bannedUntil,
    powerUser,
    owner,
    superAdmin
  } = await getAuthenticatedUser(request);

  if (!user) {
    if (status === 403 && excludedUntil) {
      return NextResponse.json({
        excluded: true,
        banned: false,
        endsAt: excludedUntil,
        bannedUntil: null,
        powerUser,
        owner,
        superAdmin
      });
    }
    if (status === 403 && bannedUntil !== undefined) {
      return NextResponse.json({
        excluded: false,
        banned: true,
        endsAt: null,
        bannedUntil,
        powerUser,
        owner,
        superAdmin
      });
    }
    return NextResponse.json({ error, powerUser, owner, superAdmin }, { status });
  }

  return NextResponse.json({
    excluded: false,
    banned: false,
    endsAt: null,
    bannedUntil: null,
    powerUser,
    owner,
    superAdmin
  });
}

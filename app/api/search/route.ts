import { NextResponse } from "next/server";

export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json(
    {
      error: "Search is served from the static Pagefind index.",
      results: [],
    },
    { status: 410 },
  );
}

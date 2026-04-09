import { auth } from "@/auth";
import { fetchAllFeeds } from "@/lib/rss/fetch";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const sourceIds = searchParams.get("sources")?.split(",").filter(Boolean);

  try {
    const articles = await fetchAllFeeds(sourceIds?.length ? sourceIds : undefined);
    return NextResponse.json({ articles, total: articles.length });
  } catch (err) {
    console.error("[api/admin/feed]", err);
    return NextResponse.json({ error: "Failed to fetch feeds" }, { status: 500 });
  }
}

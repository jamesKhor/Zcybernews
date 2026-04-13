import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const SUBSCRIBERS_FILE = path.join(process.cwd(), "data", "subscribers.json");

interface Subscriber {
  email: string;
  subscribedAt: string;
  locale: string;
}

// Simple in-memory rate limiter: IP -> timestamps
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 3;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(ip) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);
  rateLimitMap.set(ip, recent);
  if (recent.length >= RATE_LIMIT_MAX) return true;
  recent.push(now);
  rateLimitMap.set(ip, recent);
  return false;
}

function readSubscribers(): Subscriber[] {
  try {
    const raw = fs.readFileSync(SUBSCRIBERS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeSubscribers(subscribers: Subscriber[]): void {
  fs.writeFileSync(
    SUBSCRIBERS_FILE,
    JSON.stringify(subscribers, null, 2) + "\n",
    "utf-8",
  );
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";

    if (isRateLimited(ip)) {
      return NextResponse.json(
        {
          error: "rate_limited",
          message: "Too many requests. Please try again later.",
        },
        { status: 429 },
      );
    }

    const body = await request.json();
    const email = (body.email ?? "").trim().toLowerCase();
    const locale = body.locale ?? "en";

    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json(
        {
          error: "invalid_email",
          message: "Please enter a valid email address.",
        },
        { status: 400 },
      );
    }

    const subscribers = readSubscribers();
    const exists = subscribers.some((s) => s.email === email);

    if (exists) {
      return NextResponse.json(
        {
          error: "already_subscribed",
          message: "This email is already subscribed.",
        },
        { status: 409 },
      );
    }

    subscribers.push({
      email,
      subscribedAt: new Date().toISOString(),
      locale,
    });

    writeSubscribers(subscribers);

    return NextResponse.json(
      { success: true, message: "Successfully subscribed!" },
      { status: 201 },
    );
  } catch {
    return NextResponse.json(
      {
        error: "server_error",
        message: "Something went wrong. Please try again.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const email = (body.email ?? "").trim().toLowerCase();

    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json(
        {
          error: "invalid_email",
          message: "Please enter a valid email address.",
        },
        { status: 400 },
      );
    }

    const subscribers = readSubscribers();
    const idx = subscribers.findIndex((s) => s.email === email);

    if (idx === -1) {
      return NextResponse.json(
        { error: "not_found", message: "This email is not subscribed." },
        { status: 404 },
      );
    }

    subscribers.splice(idx, 1);
    writeSubscribers(subscribers);

    return NextResponse.json(
      { success: true, message: "Successfully unsubscribed." },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      {
        error: "server_error",
        message: "Something went wrong. Please try again.",
      },
      { status: 500 },
    );
  }
}

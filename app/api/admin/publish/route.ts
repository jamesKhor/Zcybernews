import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

type PublishRequest = {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  category: string;
  tags: string[];
  locale: "en" | "zh";
  type: "posts" | "threat-intel";
  author?: string;
};

function buildFrontmatter(req: PublishRequest): string {
  const date = new Date().toISOString().split("T")[0];
  const tags = req.tags.length ? `\n  - ${req.tags.join("\n  - ")}` : " []";
  return `---
title: "${req.title.replace(/"/g, '\\"')}"
slug: "${req.slug}"
date: "${date}"
excerpt: "${req.excerpt.replace(/"/g, '\\"').slice(0, 200)}"
category: "${req.category}"
tags:${tags}
language: "${req.locale ?? "en"}"
author: "${req.author ?? "ZCyberNews"}"
draft: false
---

`;
}

const GH_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

async function getFileSha(
  apiUrl: string,
  token: string,
): Promise<string | undefined> {
  const res = await fetch(apiUrl, {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return undefined;
  const data = (await res.json()) as { sha: string };
  return data.sha;
}

async function commitToGitHub(
  path: string,
  content: string,
  message: string,
  retries = 2,
): Promise<{ url: string }> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token || !repo) {
    throw new Error("GITHUB_TOKEN or GITHUB_REPO not configured");
  }

  const encoded = Buffer.from(content, "utf-8").toString("base64");
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}`;
  const branch = process.env.GITHUB_BRANCH ?? "main";

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Re-fetch file SHA on every attempt — a stale SHA causes the 409 conflict
    const sha = await getFileSha(apiUrl, token);

    const body: Record<string, unknown> = { message, content: encoded, branch };
    if (sha) body.sha = sha;

    const res = await fetch(apiUrl, {
      method: "PUT",
      headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = (await res.json()) as { content: { html_url: string } };
      return { url: data.content.html_url };
    }

    const errText = await res.text();

    // 409 = stale SHA conflict — wait then retry with freshly fetched SHA
    if (res.status === 409 && attempt < retries) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      continue;
    }

    throw new Error(`GitHub API error ${res.status}: ${errText}`);
  }

  throw new Error("GitHub commit failed after retries");
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as PublishRequest;
  const { title, slug, content, locale = "en", type = "posts" } = body;

  if (!title || !slug || !content) {
    return NextResponse.json(
      { error: "title, slug and content are required" },
      { status: 400 },
    );
  }

  const date = new Date().toISOString().split("T")[0];
  const filename = `${date}-${slug.replace(/^[\d-]+-/, "")}.mdx`;
  const filePath = `content/${locale}/${type}/${filename}`;
  const fullContent = buildFrontmatter(body) + content;
  const commitMessage = `content: add "${title}" [${locale}]`;

  try {
    const { url } = await commitToGitHub(filePath, fullContent, commitMessage);
    return NextResponse.json({
      success: true,
      path: filePath,
      githubUrl: url,
      message: "Article committed to GitHub. Vercel is deploying shortly.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/publish]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

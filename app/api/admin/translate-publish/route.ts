import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getTranslateModel, getActiveProvider } from "@/lib/ai-provider";

type TranslatePublishRequest = {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  category: string;
  tags: string[];
  type: "posts" | "threat-intel";
  author?: string;
};

const GH_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

async function getFileSha(apiUrl: string, token: string): Promise<string | undefined> {
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
  if (!token || !repo) throw new Error("GITHUB_TOKEN or GITHUB_REPO not configured");

  const encoded = Buffer.from(content, "utf-8").toString("base64");
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}`;
  const branch = process.env.GITHUB_BRANCH ?? "main";

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Always re-fetch the current file SHA before each attempt so we have
    // the latest blob SHA — stale SHAs cause the 409 conflict.
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

    // 409 = branch/blob conflict — wait briefly then retry with fresh SHA
    if (res.status === 409 && attempt < retries) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      continue;
    }

    throw new Error(`GitHub API error ${res.status}: ${errText}`);
  }

  throw new Error("GitHub commit failed after retries");
}

function buildMdx(frontmatter: Record<string, unknown>, body: string): string {
  const date = new Date().toISOString().split("T")[0];
  const tags = Array.isArray(frontmatter.tags) && frontmatter.tags.length
    ? `\n  - ${(frontmatter.tags as string[]).join("\n  - ")}`
    : " []";
  return `---
title: "${String(frontmatter.title).replace(/"/g, '\\"')}"
slug: "${frontmatter.slug}"
date: "${date}"
excerpt: "${String(frontmatter.excerpt).replace(/"/g, '\\"').slice(0, 200)}"
category: "${frontmatter.category}"
tags:${tags}
language: "${frontmatter.language}"
locale_pair: "${frontmatter.slug}"
author: "${frontmatter.author ?? "AleCyberNews"}"
draft: false
---

${body}`;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as TranslatePublishRequest;
  const { title, slug, content, excerpt, category, tags, type = "posts", author } = body;

  if (!title || !slug || !content) {
    return NextResponse.json({ error: "title, slug and content are required" }, { status: 400 });
  }

  if (getActiveProvider() === "none") {
    return NextResponse.json(
      { error: "No AI provider configured. Set OPENROUTER_API_KEY or DEEPSEEK_API_KEY." },
      { status: 500 },
    );
  }

  const translateModel = getTranslateModel();

  // Translate title + excerpt
  const metaRes = await generateText({
    model: translateModel,
    messages: [{
      role: "user",
      content: `Translate these to Simplified Chinese. Keep threat actor names, malware names, ALL-CAPS acronyms (EDR, VPN, APT, CVE, IOC, TTP etc), product names in English. Return ONLY valid JSON: {"title": "...", "excerpt": "..."}\n\nTitle: ${title}\nExcerpt: ${excerpt}`
    }],
  });

  let zhTitle = title;
  let zhExcerpt = excerpt;
  try {
    const clean = metaRes.text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean) as { title: string; excerpt: string };
    zhTitle = parsed.title;
    zhExcerpt = parsed.excerpt;
  } catch { /* fallback to EN */ }

  // Translate body
  const bodyRes = await generateText({
    model: translateModel,
    messages: [{
      role: "system",
      content: `You are a professional cybersecurity translator. Translate English to Simplified Chinese.
NEVER translate: threat actor names (LockBit, APT41, Lazarus Group etc), malware names (Mimikatz, Cobalt Strike etc), ALL-CAPS acronyms (EDR, VPN, RDP, CVE, IOC, TTP, APT, C2, LSASS, DLL, RaaS, WAF, SIEM etc), product/vendor names (Microsoft, Cisco, CrowdStrike etc), CVE IDs, hashes, IPs, domains, code blocks.
Keep all Markdown formatting intact. Output ONLY the translated markdown, no explanation.`
    }, {
      role: "user",
      content: `Translate this article body to Simplified Chinese:\n\n${content}`
    }],
  });

  const date = new Date().toISOString().split("T")[0];
  const filename = `${date}-${slug.replace(/^[\d-]+-/, "")}.mdx`;

  const enFrontmatter = { title, slug, excerpt, category, tags, language: "en", author: author ?? "AleCyberNews" };
  const zhFrontmatter = { title: zhTitle, slug, excerpt: zhExcerpt, category, tags, language: "zh", author: author ?? "AleCyberNews" };

  const enMdx = buildMdx(enFrontmatter, content);
  const zhMdx = buildMdx(zhFrontmatter, bodyRes.text.trim());

  try {
    // Commits must be sequential — parallel commits both read the same branch
    // HEAD, the first succeeds and moves the tip, the second gets a 409 conflict.
    const enResult = await commitToGitHub(
      `content/en/${type}/${filename}`,
      enMdx,
      `content: add "${title}" [en]`,
    );
    const zhResult = await commitToGitHub(
      `content/zh/${type}/${filename}`,
      zhMdx,
      `content: add "${zhTitle}" [zh]`,
    );

    return NextResponse.json({
      success: true,
      enGithubUrl: enResult.url,
      zhGithubUrl: zhResult.url,
      message: "Published EN + ZH. Vercel is deploying.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

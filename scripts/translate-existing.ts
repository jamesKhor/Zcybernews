/**
 * One-time script: translate existing English articles to Chinese using DeepSeek.
 * Usage: npx tsx scripts/translate-existing.ts
 */
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

const deepseek = createOpenAICompatible({
  name: "deepseek",
  baseURL: "https://api.deepseek.com/v1",
  apiKey: process.env.DEEPSEEK_API_KEY!,
});
const model = deepseek("deepseek-chat");

async function translateText(text: string, context: string): Promise<string> {
  const { text: result } = await generateText({
    model,
    messages: [
      {
        role: "system",
        content: `你是一名专业的网络安全技术翻译，专门将英文网络安全内容翻译成简体中文。

严格禁止翻译以下内容（必须保留英文原文）：
- 威胁行为者/APT组织名称：LockBit、APT41、Lazarus Group、Sandworm、Volt Typhoon、REvil、BlackCat、Cl0p、FIN7 等
- 恶意软件/勒索软件/工具名称：Mimikatz、Cobalt Strike、Metasploit、BloodHound、Emotet、TrickBot 等
- 全大写缩写词：EDR、XDR、SOC、SIEM、VPN、RDP、MFA、CVE、IOC、TTP、APT、C2、DNS、TLS、API、BEC、OSINT、LSASS、DLL、RaaS、OT、ICS、SCADA、WAF、IDS、IPS、DMARC 等
- 产品和厂商名称：Microsoft、Windows、Linux、macOS、Ivanti、Fortinet、Cisco、CrowdStrike、SentinelOne、Splunk、OpenAI、GPT-5、MITRE ATT&CK 等
- CVE编号、CVSS分数、哈希值、IP地址、域名、文件路径、注册表键
- 代码块和命令行内容（反引号或围栏代码块中的内容不得翻译）
- URL和电子邮件地址

翻译规则：
- 其他所有内容翻译成自然流畅的简体中文
- 保持原文的Markdown格式（标题、列表、代码块、表格等）
- 翻译语气专业、简洁，适合安全研究人员阅读
- 不得增加原文中没有的内容
- ${context}`,
      },
      {
        role: "user",
        content: `请将以下内容翻译成简体中文：\n\n${text}`,
      },
    ],
  });
  return result.trim();
}

async function translateArticle(enFilePath: string, zhFilePath: string) {
  console.log(`\nTranslating: ${path.basename(enFilePath)}`);

  const raw = fs.readFileSync(enFilePath, "utf-8");
  const { data: frontmatter, content } = matter(raw);

  // Translate text fields
  console.log("  → Translating title...");
  const zhTitle = await translateText(
    frontmatter.title,
    "这是文章标题，请简洁翻译",
  );

  console.log("  → Translating excerpt...");
  const zhExcerpt = await translateText(
    frontmatter.excerpt,
    "这是文章摘要，请保持专业简洁",
  );

  console.log("  → Translating body...");
  const zhBody = await translateText(content.trim(), "这是文章正文");

  // Build Chinese frontmatter (keep all technical fields, update text + language)
  const zhFrontmatter = {
    ...frontmatter,
    title: zhTitle,
    excerpt: zhExcerpt,
    language: "zh",
    locale_pair: frontmatter.slug,
  };

  // Serialize
  const zhMdx = matter.stringify(zhBody, zhFrontmatter);

  // Write file
  fs.mkdirSync(path.dirname(zhFilePath), { recursive: true });
  fs.writeFileSync(zhFilePath, zhMdx, "utf-8");
  console.log(`  ✓ Written: ${path.basename(zhFilePath)}`);
}

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("❌ DEEPSEEK_API_KEY not set");
    process.exit(1);
  }

  const enPostsDir = path.join(process.cwd(), "content/en/posts");
  const zhPostsDir = path.join(process.cwd(), "content/zh/posts");

  const files = fs
    .readdirSync(enPostsDir)
    .filter((f) => f.endsWith(".mdx") || f.endsWith(".md"));

  console.log(`Found ${files.length} English articles to translate`);

  for (const file of files) {
    const enPath = path.join(enPostsDir, file);
    const zhPath = path.join(zhPostsDir, file);

    if (fs.existsSync(zhPath)) {
      console.log(`Skipping (already exists): ${file}`);
      continue;
    }

    await translateArticle(enPath, zhPath);
    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log("\n✅ All translations complete!");
}

main().catch(console.error);

// Verification codes from the Gmail you're already signed into in this
// browser, for sites that email a code when JobPilot signs you in or makes
// an account (lib/accounts.js). No setup: it reads Gmail's inbox feed
// (mail.google.com/mail/feed/atom), which lists unread emails with a short
// preview, where codes usually are. Read-only; nothing is sent.
//
// This feed isn't an official API for extensions; if Google changes it,
// JobPilot stops and asks you for the code instead.
import { sleep } from "./clock.js";

// Signed in to several Google accounts? Use the one matching `email`,
// otherwise the first signed-in inbox.
async function feedFor(email) {
  let first = null;
  for (let u = 0; u < 5; u++) {
    let xml;
    try {
      const res = await fetch(`https://mail.google.com/mail/u/${u}/feed/atom`, { credentials: "include", cache: "no-store" });
      if (!res.ok) break;
      xml = await res.text();
    } catch {
      break;
    }
    if (!/<feed/i.test(xml)) break; // signed out: Google returns a login page instead
    const owner = (xml.match(/<title>[^<]*?for ([^<\s]+@[^<\s]+)<\/title>/i) || [])[1] || "";
    const feed = { xml, owner };
    if (!email || owner.toLowerCase() === email.toLowerCase()) return feed;
    first ||= feed;
  }
  return first;
}

const unescape = (s) => String(s || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

function entries(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((m) => {
    const e = m[1];
    const tag = (t) => unescape((e.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, "i")) || [])[1]);
    return { subject: tag("title"), summary: tag("summary"), from: `${tag("name")} ${tag("email")}`, at: Date.parse(tag("issued") || tag("modified")) || 0 };
  });
}

// Is Gmail reachable and whose inbox is it? -> address or "" (Settings).
export async function gmailAccount(email = "") {
  const f = await feedFor(email);
  return f ? f.owner || "(signed in)" : "";
}

// A code near words like "code"/"verification", not a year.
export function extractCode(text) {
  for (const m of String(text).matchAll(/\b([A-Z0-9]{4,8})\b/g)) {
    const c = m[1];
    if (!/\d/.test(c) || /^(19|20)\d\d$/.test(c)) continue;
    const near = text.slice(Math.max(0, m.index - 80), m.index + 40).toLowerCase();
    if (/code|verif|otp|passcode|one[- ]time|security|pin\b|confirm/.test(near)) return c;
  }
  return null;
}

// Wait for a code emailed after sinceMs. hint: site/company words, to
// prefer the right email. -> { code, from, subject } or null.
export async function waitForCode({ email, sinceMs, hint = "", timeoutMs = 180000 }) {
  const words = hint.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const f = await feedFor(email);
    if (!f) return null;
    const found = entries(f.xml)
      .filter((e) => e.at >= sinceMs - 60000)
      .map((e) => ({ ...e, code: extractCode(`${e.subject}\n${e.summary}`), match: words.some((w) => `${e.from} ${e.subject} ${e.summary}`.toLowerCase().includes(w)) }))
      .filter((e) => e.code)
      .sort((a, b) => b.match - a.match || b.at - a.at);
    if (found.length) return { code: found[0].code, from: found[0].from, subject: found[0].subject };
    await sleep(5000);
  }
  return null;
}

// TipuCek — shareable warning card (canvas PNG, no server).
//
// Variant A "Resmi" (chosen by Myuden, 21 Nov 2026): white 1080x1350
// portrait, navy header + gold rule, T logo, big verdict word, score
// box, checked-message quote, summary, red flags, what-to-do box,
// "tipucek.web.app" footer. No "official document" claim anywhere —
// TipuCek is not an official institution; the footer says honestly
// that the document was generated automatically by TipuCek.
// Colours follow the verdict status: scam red, suspicious amber,
// safe green. Downloads as PNG, or uses the device's native share
// sheet (navigator.share with files) when supported.
//
// Overflow rule (documented caps): the card is a fixed 1080x1350.
// Long content is wrapped and capped — quote <= 3 lines, summary
// <= 3 lines, flags <= 4 (<= 2 lines each), what-to-do <= 2 lines —
// and the caps shrink further (next, then summary, then quote, then
// flags) if the total still does not fit the body budget. Anything
// cut off ends with "…". The footer is always drawn; body content
// never passes y = 1260. planCardContent() is the pure planner
// behind this (unit-tested); buildWarningCard() only draws its plan.

const CARD_W = 1080;
const CARD_H = 1350;
const CARD_PAD = 64;
const CARD_RIGHT = CARD_W - CARD_PAD; // 1016
const CARD_FOOTER_TOP = CARD_H - 79; // gold rule of the footer
const CARD_BODY_LIMIT = CARD_FOOTER_TOP - 11;
const CARD_BODY_TOP = 204;

const CARD_COLORS = {
  navy: "#0f2a4d",
  gold: "#c9a227",
  ink: "#1c2333",
  body: "#333a48",
  muted: "#5b6478",
  quoteBg: "#f6f7f9",
  line: "#dfe4ee",
  flagLine: "#e6e9f0",
  actionsBg: "#f2f5fb",
  actionsBorder: "#dbe3f0",
  tagBlue: "#b9c7dd",
};

const STATUS_COLORS = { scam: "#b42318", suspicious: "#854d0e", safe: "#067647" };

const FONT_STACK = '"Plus Jakarta Sans", system-ui, "Segoe UI", Roboto, sans-serif';
const font = (weight, size) => `${weight} ${size}px ${FONT_STACK}`;

// Layout constants (px) — one source of truth for planner + renderer.
const L = {
  eyebrowH: 23,
  eyebrowGap: 18,
  verdictRowH: 139, // score-box height; verdict word + risk line fit inside
  dividerTop: 26,
  dividerH: 1,
  dividerBottom: 22,
  labelH: 24,
  labelGap: 14,
  sectionGap: 22,
  quotePadY: 20,
  quotePadX: 28,
  quoteBarW: 6,
  quoteLineH: 39,
  summaryLineH: 40,
  flagBadge: 44,
  flagGapX: 18,
  flagLineH: 40,
  flagPadY: 11,
  actionsPadY: 18,
  actionsLabelGap: 8,
  actionsLineH: 40,
};

function wrapWith(measure, text, maxWidth, fontStr) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (measure(test, fontStr) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Wrap + cap: at most maxLines lines; a cut line ends with "…".
function wrapCappedWith(measure, text, maxWidth, maxLines, fontStr) {
  const lines = wrapWith(measure, text, maxWidth, fontStr);
  if (lines.length <= maxLines) return { lines, truncated: false };
  const kept = lines.slice(0, maxLines);
  const words = kept[maxLines - 1].split(" ");
  while (words.length > 0 && measure(`${words.join(" ")} …`, fontStr) > maxWidth) words.pop();
  kept[maxLines - 1] = words.length > 0 ? `${words.join(" ")} …` : "…";
  return { lines: kept, truncated: true };
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Pure layout planner: wraps + caps every text block and shrinks the
// caps until the whole card fits the body budget. `measure(text, font)`
// returns the rendered width in px (the canvas context in production,
// a stub in unit tests). Returns the exact lines to draw, the fitted
// verdict size, and the score-box geometry.
export function planCardContent({ quote, summary, flags, next, verdictWord, scoreLabel, scoreText, measure }) {
  const quoteText = String(quote || "").replace(/\s+/g, " ").trim();
  const summaryText = String(summary || "").replace(/\s+/g, " ").trim();
  const nextText = String(next || "").replace(/\s+/g, " ").trim();
  const flagTexts = (flags || []).map((f) => String(f).replace(/\s+/g, " ").trim()).filter(Boolean);

  // Score box width from its own content (min 240, like the mockup).
  const labelW = measure(scoreLabel, font(700, 21));
  const numW = measure(scoreText, font(800, 84)) + measure("/100", font(700, 40));
  const scoreBoxW = Math.max(240, Math.ceil(Math.max(labelW, numW)) + 52);
  const scoreBoxX = CARD_RIGHT - scoreBoxW;

  // Verdict word: 84px, shrunk only if it would hit the score box.
  let verdictSize = 84;
  const wordW = measure(verdictWord, font(800, verdictSize));
  const wordMax = scoreBoxX - CARD_PAD - 24;
  if (wordW > wordMax) verdictSize = Math.max(56, Math.floor((84 * wordMax) / wordW));

  const quoteW = CARD_RIGHT - CARD_PAD - L.quotePadX * 2 - L.quoteBarW;
  const textW = CARD_RIGHT - CARD_PAD;
  const flagW = textW - L.flagBadge - L.flagGapX;
  const budget = CARD_BODY_LIMIT - CARD_BODY_TOP;

  const caps = { quote: 3, summary: 3, flags: 4, next: 2 };
  const shrinkOrder = ["next", "summary", "quote", "flags"];
  const minCaps = { quote: 2, summary: 2, flags: 3, next: 1 };

  const build = () => {
    const q = quoteText
      ? wrapCappedWith(measure, `“${quoteText}”`, quoteW, caps.quote, font(400, 27))
      : { lines: [], truncated: false };
    const s = summaryText
      ? wrapCappedWith(measure, summaryText, textW, caps.summary, font(400, 27))
      : { lines: [], truncated: false };
    const f = flagTexts.slice(0, caps.flags).map((t) =>
      wrapCappedWith(measure, t, flagW, 2, font(600, 30)),
    );
    const n = nextText
      ? wrapCappedWith(measure, nextText, textW - L.quotePadX * 2, caps.next, font(600, 29))
      : { lines: [], truncated: false };
    let total =
      L.eyebrowH + L.eyebrowGap + L.verdictRowH + L.dividerTop + L.dividerH + L.dividerBottom;
    if (q.lines.length > 0)
      total += L.labelH + L.labelGap + (L.quotePadY * 2 + q.lines.length * L.quoteLineH) + L.sectionGap;
    if (s.lines.length > 0) total += L.labelH + L.labelGap + s.lines.length * L.summaryLineH + L.sectionGap;
    if (f.length > 0)
      total +=
        L.labelH + L.labelGap +
        f.reduce((h, r) => h + r.lines.length * L.flagLineH + L.flagPadY * 2, 0) +
        L.sectionGap;
    if (n.lines.length > 0)
      total += L.sectionGap + (L.actionsPadY * 2 + L.labelH + L.actionsLabelGap + n.lines.length * L.actionsLineH);
    return { q, s, f, n, total };
  };

  let plan = build();
  for (let i = 0; i < shrinkOrder.length && plan.total > budget; i++) {
    const key = shrinkOrder[i];
    if (caps[key] > minCaps[key]) {
      caps[key] -= 1;
      plan = build();
    }
  }
  return {
    quoteLines: plan.q.lines,
    summaryLines: plan.s.lines,
    flagRows: plan.f.map((r) => r.lines),
    nextLines: plan.n.lines,
    truncated: {
      quote: plan.q.truncated,
      summary: plan.s.truncated,
      next: plan.n.truncated,
      flags: flagTexts.length > caps.flags,
    },
    verdictSize,
    scoreBoxW,
    scoreBoxX,
    totalHeight: plan.total,
    fits: plan.total <= budget,
  };
}

function loadCardLogo() {
  // The official T logo (white on transparent). 2s timeout, then null
  // and the caller draws the T with canvas paths instead — the tile
  // is never left empty.
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), 2000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = "/logo-mark.svg";
  });
}

function drawLogoTFallback(ctx, x, y, size) {
  // Same geometry as public/logo-mark.svg (64x64 viewBox), drawn
  // in white: the T bar + the stem that ends in a check.
  const s = size / 64;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = "#ffffff";
  rr(ctx, 11, 12, 42, 9.5, 4.75);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 9.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(32, 21.5);
  ctx.lineTo(32, 39);
  ctx.lineTo(45, 26.5);
  ctx.stroke();
  ctx.restore();
}

// Pure geometry for the score-box number (unit-tested): place the
// digit INK inside the score box, centred in the free space below
// the "SKOR RISIKO" label, with a guaranteed bottom margin.
// `ascent`/`descent` are ctx.measureText().actualBoundingBoxAscent/
// Descent at 84px; `smallAscent` the same for "/100" at 40px. All
// values are relative to the box top (rowTop); the renderer adds
// rowTop. Positioning by the "top" baseline is what broke it: Plus
// Jakarta Sans has a tall ascent (~1.08em), so the 84px digit ink
// landed on (and past) the box's bottom edge. If the ink cannot fit
// at 84px (a pathological font), the number shrinks (never below
// 48px) instead of overflowing.
// CONTRACT: ascent/descent/smallAscent MUST be measured with
// textBaseline "alphabetic" — under "top" the ascent comes back
// negative and the layout lands ~60px too high (see the call site).
export function scoreNumberLayout({ ascent, descent, smallAscent, boxH = L.verdictRowH, freeTop = 44, bottomMargin = 10 }) {
  const freeBottom = boxH - bottomMargin;
  const freeH = freeBottom - freeTop;
  let size = 84;
  let inkH = ascent + descent;
  let a = ascent;
  let s = smallAscent;
  if (inkH > freeH) {
    size = Math.max(48, Math.floor((84 * freeH) / inkH));
    const scale = size / 84;
    inkH *= scale;
    a *= scale;
    s *= scale;
  }
  const numberTop = freeTop + (freeH - inkH) / 2;
  return {
    size,
    numberTop,
    numberBaseline: numberTop + a,
    smallBaseline: numberTop + 2 + s,
    inkBottom: numberTop + inkH,
  };
}

export async function buildWarningCard({ status, riskScore, redFlags, summary, message, dateStr, strings }) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  const color = STATUS_COLORS[status] || STATUS_COLORS.safe;

  // Best-effort font wait so the card uses Plus Jakarta Sans (the
  // @font-face in styles.css) instead of the system fallback.
  try {
    if (typeof document !== "undefined" && document.fonts && document.fonts.ready) {
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 800))]);
    }
  } catch {
    /* system fallback is fine */
  }
  const logo = await loadCardLogo();

  const measure = (text, fontStr) => {
    ctx.font = fontStr;
    return ctx.measureText(text).width;
  };
  const plan = planCardContent({
    quote: message,
    summary,
    flags: redFlags,
    next: strings.next,
    verdictWord: String(strings.statusLabel || "").toUpperCase(),
    scoreLabel: strings.riskScoreLabel,
    scoreText: String(riskScore),
    measure,
  });

  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  // Background + navy header.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = CARD_COLORS.navy;
  ctx.fillRect(0, 0, CARD_W, 164);
  // Logo tile.
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  rr(ctx, CARD_PAD, 36, 96, 96, 20);
  ctx.fill();
  ctx.stroke();
  if (logo) {
    ctx.drawImage(logo, CARD_PAD + 17, 36 + 17, 62, 62);
  } else {
    drawLogoTFallback(ctx, CARD_PAD + 17, 36 + 17, 62);
  }
  // Brand + tagline.
  ctx.fillStyle = "#ffffff";
  ctx.font = font(800, 58);
  ctx.fillText("TipuCek", 188, 38);
  ctx.fillStyle = CARD_COLORS.tagBlue;
  ctx.font = font(500, 24);
  ctx.fillText(strings.subtitle, 188, 106);
  // Date, top right.
  const when =
    dateStr ||
    new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  ctx.fillStyle = CARD_COLORS.tagBlue;
  ctx.font = font(400, 23);
  ctx.textAlign = "right";
  ctx.fillText(when, CARD_RIGHT, 70);
  ctx.textAlign = "left";
  // Gold rule.
  ctx.fillStyle = CARD_COLORS.gold;
  ctx.fillRect(0, 164, CARD_W, 6);

  // Eyebrow.
  let y = CARD_BODY_TOP;
  ctx.fillStyle = CARD_COLORS.navy;
  ctx.font = font(700, 23);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "4px";
  ctx.fillText(strings.resultHeading, CARD_PAD, y);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  y += L.eyebrowH + L.eyebrowGap;

  // Verdict word + risk line (left), score box (right).
  const rowTop = y;
  ctx.fillStyle = color;
  ctx.font = font(800, plan.verdictSize);
  ctx.fillText(String(strings.statusLabel || "").toUpperCase(), CARD_PAD, rowTop);
  // The risk line is a fixed translated string, but a future
  // translation could outgrow the space left of the score box —
  // truncate with "…" instead of colliding with it.
  const riskWords = String(strings.riskLine || "").split(" ");
  let riskLine = strings.riskLine;
  while (riskWords.length > 1 && measure(riskLine, font(400, 26)) > plan.scoreBoxX - CARD_PAD) {
    riskWords.pop();
    riskLine = `${riskWords.join(" ")} …`;
  }
  ctx.fillStyle = CARD_COLORS.muted;
  ctx.font = font(400, 26);
  ctx.fillText(riskLine, CARD_PAD, rowTop + plan.verdictSize + 10);
  // Score box.
  const boxX = plan.scoreBoxX;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  rr(ctx, boxX, rowTop, plan.scoreBoxW, L.verdictRowH, 16);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = font(700, 21);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "3px";
  ctx.textAlign = "center";
  ctx.fillText(strings.riskScoreLabel, boxX + plan.scoreBoxW / 2, rowTop + 14);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  // Score number: place by MEASURED ink, not by the "top" baseline.
  // Plus Jakarta Sans has a tall ascent (~1.08em), so drawing the
  // 84px number at rowTop+43 with baseline "top" pushed the digit
  // ink to (and past) the box's bottom edge — "95" visibly crossed
  // the border, "0" nearly touched it. The layout helper centres
  // the ink in the free space below the label with a guaranteed
  // bottom margin, for 0 / 95 / 100 alike. Horizontal placement:
  // numX is the group's LEFT edge (the number + "/100" centred as
  // a group in the box), so the number is drawn LEFT-aligned —
  // the label above leaves textAlign on "center", and centring the
  // number on numX instead shifted the group left by half the
  // number width, pushing "100" ~50px out of the box's left edge.
  // BASELINE TRAP (21 Nov 19:06): measureText's actualBoundingBox*
  // is relative to the CURRENT textBaseline. The canvas is still on
  // "top" here (set for the header/labels), where the ascent comes
  // back NEGATIVE (~-5) and the descent ~67 — feeding those into
  // the layout put the digits ~62px too high, overlapping the
  // "SKOR RISIKO" label (proven by logging the fill calls: "95"
  // drawn at y=295.6 instead of ~362). So the ink is measured
  // inside the same save/restore that draws with "alphabetic".
  const numStr = String(riskScore);
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.font = font(800, 84);
  const numM = ctx.measureText(numStr);
  const numAscent = numM.actualBoundingBoxAscent ?? 84 * 0.72;
  const numDescent = numM.actualBoundingBoxDescent ?? 0;
  ctx.font = font(700, 40);
  const smallM = ctx.measureText("/100");
  const smallAscent = smallM.actualBoundingBoxAscent ?? 40 * 0.72;
  const numLayout = scoreNumberLayout({ ascent: numAscent, descent: numDescent, smallAscent });
  const numW = measure(numStr, font(800, numLayout.size));
  const smallW = measure("/100", font(700, 40));
  const numX = boxX + (plan.scoreBoxW - numW - smallW) / 2;
  ctx.textAlign = "left";
  ctx.fillStyle = color;
  ctx.font = font(800, numLayout.size);
  ctx.fillText(numStr, numX, rowTop + numLayout.numberBaseline);
  ctx.fillStyle = CARD_COLORS.muted;
  ctx.font = font(700, 40);
  ctx.fillText("/100", numX + numW, rowTop + numLayout.smallBaseline);
  ctx.restore();
  ctx.textAlign = "left";
  y = rowTop + L.verdictRowH;

  // Divider.
  y += L.dividerTop;
  ctx.fillStyle = CARD_COLORS.line;
  ctx.fillRect(CARD_PAD, y, CARD_RIGHT - CARD_PAD, L.dividerH);
  y += L.dividerH + L.dividerBottom;

  const sectionLabel = (text) => {
    ctx.fillStyle = CARD_COLORS.navy;
    ctx.font = font(700, 24);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "2px";
    ctx.fillText(text, CARD_PAD, y);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    y += L.labelH + L.labelGap;
  };

  // Checked-message quote.
  if (plan.quoteLines.length > 0) {
    sectionLabel(strings.checkedMessageLabel);
    const boxH = L.quotePadY * 2 + plan.quoteLines.length * L.quoteLineH;
    ctx.fillStyle = CARD_COLORS.quoteBg;
    rr(ctx, CARD_PAD, y, CARD_RIGHT - CARD_PAD, boxH, 12);
    ctx.fill();
    ctx.fillStyle = CARD_COLORS.navy;
    ctx.fillRect(CARD_PAD, y, L.quoteBarW, boxH);
    ctx.fillStyle = CARD_COLORS.ink;
    ctx.font = font(400, 27);
    plan.quoteLines.forEach((line, i) => {
      ctx.fillText(line, CARD_PAD + L.quotePadX + L.quoteBarW, y + L.quotePadY + i * L.quoteLineH);
    });
    y += boxH + L.sectionGap;
  }

  // Summary.
  if (plan.summaryLines.length > 0) {
    sectionLabel(strings.summaryLabel);
    ctx.fillStyle = CARD_COLORS.body;
    ctx.font = font(400, 27);
    plan.summaryLines.forEach((line, i) => {
      ctx.fillText(line, CARD_PAD, y + i * L.summaryLineH);
    });
    y += plan.summaryLines.length * L.summaryLineH + L.sectionGap;
  }

  // Red flags.
  if (plan.flagRows.length > 0) {
    sectionLabel(strings.flagsTitle);
    for (const lines of plan.flagRows) {
      const rowH = lines.length * L.flagLineH + L.flagPadY * 2;
      // Badge, vertically centred on the row.
      ctx.fillStyle = color;
      rr(ctx, CARD_PAD, y + (rowH - L.flagBadge) / 2, L.flagBadge, L.flagBadge, 10);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = font(800, 30);
      ctx.textAlign = "center";
      ctx.fillText("!", CARD_PAD + L.flagBadge / 2, y + (rowH - L.flagBadge) / 2 + 7);
      ctx.textAlign = "left";
      // Flag text.
      ctx.fillStyle = CARD_COLORS.ink;
      ctx.font = font(600, 30);
      lines.forEach((line, i) => {
        ctx.fillText(line, CARD_PAD + L.flagBadge + L.flagGapX, y + L.flagPadY + i * L.flagLineH);
      });
      y += rowH;
      // Divider between flag rows (not after the last one).
      if (lines !== plan.flagRows[plan.flagRows.length - 1]) {
        ctx.fillStyle = CARD_COLORS.flagLine;
        ctx.fillRect(CARD_PAD, y, CARD_RIGHT - CARD_PAD, 1);
      }
    }
    y += L.sectionGap;
  }

  // What to do.
  if (plan.nextLines.length > 0) {
    const boxH = L.actionsPadY * 2 + L.labelH + L.actionsLabelGap + plan.nextLines.length * L.actionsLineH;
    ctx.fillStyle = CARD_COLORS.actionsBg;
    ctx.strokeStyle = CARD_COLORS.actionsBorder;
    ctx.lineWidth = 1;
    rr(ctx, CARD_PAD, y, CARD_RIGHT - CARD_PAD, boxH, 16);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = CARD_COLORS.navy;
    ctx.font = font(700, 24);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "2px";
    ctx.fillText(strings.actionsLabel, CARD_PAD + L.quotePadX, y + L.actionsPadY);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    ctx.fillStyle = CARD_COLORS.ink;
    ctx.font = font(600, 29);
    plan.nextLines.forEach((line, i) => {
      ctx.fillText(
        line,
        CARD_PAD + L.quotePadX,
        y + L.actionsPadY + L.labelH + L.actionsLabelGap + i * L.actionsLineH,
      );
    });
    y += boxH;
  }

  // Footer (fixed band — body content never reaches it).
  ctx.fillStyle = CARD_COLORS.gold;
  ctx.fillRect(CARD_PAD, CARD_FOOTER_TOP, CARD_RIGHT - CARD_PAD, 3);
  ctx.fillStyle = CARD_COLORS.navy;
  ctx.font = font(700, 26);
  ctx.fillText("tipucek.web.app", CARD_PAD, CARD_FOOTER_TOP + 3 + 18);
  ctx.fillStyle = CARD_COLORS.muted;
  ctx.font = font(400, 22);
  ctx.textAlign = "right";
  ctx.fillText(strings.footerNote, CARD_RIGHT, CARD_FOOTER_TOP + 3 + 18);
  ctx.textAlign = "left";

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not render the card image."));
      },
      "image/png",
    );
  });
}

/**
 * Build the card and either share it (native share sheet) or download it.
 * Returns "shared" | "downloaded".
 */
export async function shareWarningCard(verdict, strings) {
  const blob = await buildWarningCard({ ...verdict, strings });
  const filename = `tipucek-warning-${verdict.status}-${verdict.riskScore}.png`;
  const file = new File([blob], filename, { type: "image/png" });
  if (
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  ) {
    await navigator.share({ files: [file], title: "TipuCek" });
    return "shared";
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return "downloaded";
}

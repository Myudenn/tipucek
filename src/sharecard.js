// TipuCek — shareable warning card (canvas PNG, no server).
//
// Draws a square card — brand header, verdict + score ring, summary,
// what to do, red flags, site URL — so the user can forward it to a
// family WhatsApp group ("Hati-hati, ini 92% penipuan karena...").
// Downloads as PNG, or uses the device's native share sheet
// (navigator.share with files) when supported.

function wrapText(ctx, text, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function buildWarningCard({ status, riskScore, redFlags, summary, strings }) {
  const W = 1080;
  const H = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const colors = { scam: "#b42318", suspicious: "#854d0e", safe: "#067647" };
  const color = colors[status] || colors.safe;
  const font = (weight, size) => `${weight} ${size}px system-ui, "Segoe UI", Roboto, sans-serif`;

  // Background + brand header.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, "#1a56db");
  grad.addColorStop(1, "#6d28d9");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 168);
  ctx.fillStyle = "#ffffff";
  ctx.font = font(700, 62);
  ctx.fillText("TipuCek", 64, 105);
  ctx.font = font(400, 30);
  ctx.globalAlpha = 0.9;
  ctx.fillText(strings.subtitle, 64, 148);
  ctx.globalAlpha = 1;

  // Verdict word + score ring (right side).
  ctx.fillStyle = color;
  ctx.font = font(800, 92);
  ctx.fillText(strings.statusLabel, 64, 300);
  const cx = 880;
  const cy = 300;
  const r = 86;
  ctx.lineWidth = 16;
  ctx.strokeStyle = "#dfe4ee";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * riskScore) / 100);
  ctx.stroke();
  ctx.fillStyle = "#1c2333";
  ctx.font = font(800, 64);
  ctx.textAlign = "center";
  ctx.fillText(String(riskScore), cx, cy + 12);
  ctx.font = font(400, 26);
  ctx.fillStyle = "#5b6478";
  ctx.fillText("/ 100", cx, cy + 48);
  ctx.textAlign = "left";

  // Summary.
  let y = 420;
  ctx.fillStyle = "#1c2333";
  ctx.font = font(400, 36);
  for (const line of wrapText(ctx, summary, W - 128)) {
    ctx.fillText(line, 64, y);
    y += 50;
  }

  // What to do.
  y += 24;
  ctx.fillStyle = "#1a56db";
  ctx.font = font(700, 34);
  ctx.fillText(strings.whatToDo, 64, y);
  y += 48;
  ctx.fillStyle = "#1c2333";
  ctx.font = font(400, 34);
  for (const line of wrapText(ctx, strings.next, W - 128)) {
    ctx.fillText(line, 64, y);
    y += 48;
  }

  // Red flags (up to 5).
  const flags = (redFlags || []).slice(0, 5);
  if (flags.length > 0) {
    y += 28;
    ctx.fillStyle = color;
    ctx.font = font(700, 34);
    ctx.fillText(strings.flagsTitle, 64, y);
    y += 48;
    ctx.fillStyle = "#1c2333";
    ctx.font = font(400, 32);
    for (const f of flags) {
      for (const line of wrapText(ctx, `!  ${f}`, W - 128)) {
        ctx.fillText(line, 64, y);
        y += 44;
      }
    }
  }

  // Footer.
  ctx.fillStyle = "#5b6478";
  ctx.font = font(400, 28);
  ctx.fillText(`tipucek.web.app`, 64, H - 56);

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

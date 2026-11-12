import { decideClick } from "./safety.mjs";
import { selectors } from "./selectors.mjs";

const HWP = /hwp|한글/i;
const PDF = /pdf/i;

export function pickDownloadLabel(labels, preferred = selectors.editor.download.menuItems) {
  const usable = [];
  for (const label of labels) {
    const text = String(label ?? "").trim();
    if (!text || text.startsWith("TODO")) continue;
    if (!decideClick(text).allowed) continue;
    usable.push(text);
  }

  const hwp = usable.find((label) => label === preferred.hwp) ?? usable.find((label) => HWP.test(label));
  if (hwp) return { format: "hwp", label: hwp };
  const pdf = usable.find((label) => label === preferred.pdf) ?? usable.find((label) => PDF.test(label));
  if (pdf) return { format: "pdf", label: pdf };
  return null;
}

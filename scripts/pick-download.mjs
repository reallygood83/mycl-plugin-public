import { pickDownloadLabel } from "./lib/download.mjs";

const labels = process.argv.slice(2);
const picked = pickDownloadLabel(labels);
if (!picked) {
  console.log(JSON.stringify({ format: null, label: null }));
  console.error("HWP 또는 PDF 항목을 찾지 못했습니다.");
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(picked));
}

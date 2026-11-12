import { decideClick } from "./lib/safety.mjs";

const args = process.argv.slice(2);
const confirmed = args.includes("--confirmed");
const label = args.find((arg) => !arg.startsWith("--"));

if (!label) {
  console.error('사용법: node scripts/check-click.mjs "버튼 문구" [--confirmed]');
  process.exitCode = 2;
} else {
  const decision = decideClick(label, { confirmed });
  if (!decision.allowed) {
    console.error(decision.reason);
    process.exitCode = 1;
  } else {
    console.log("allowed");
  }
}

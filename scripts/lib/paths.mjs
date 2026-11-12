import os from "node:os";
import path from "node:path";

export function profileDir() {
  const override = process.env.MYCL_PROFILE_DIR;
  if (override) return path.resolve(override);
  return path.join(os.homedir(), ".mycl-profile");
}

// CI only: transfer encrypted GitHub secret into Secret Manager without logging its value.
const { execFileSync } = require("node:child_process");
const key = process.env.PARTNER_STRIPE_DEPLOY_KEY;
if (key) {
  if (!key.startsWith("sk_test_") || !process.env.PROJECT_ID) throw new Error("Expected dedicated sandbox key and project");
  const name = "PARTNER_STRIPE_SECRET_KEY";
  const run = (args, input) => execFileSync("gcloud", [...args, "--project", process.env.PROJECT_ID], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  try { run(["secrets", "describe", name]); }
  catch (e) { if (!String(e.stderr).includes("NOT_FOUND")) throw new Error("Cannot inspect dedicated secret: " + String(e.stderr).slice(0,1200)); run(["secrets", "create", name, "--replication-policy", "automatic"]); }
  let existing;
  try { existing = run(["secrets", "versions", "access", "latest", "--secret", name]); } catch (e) { if (!String(e.stderr).includes("NOT_FOUND")) throw new Error("Cannot inspect dedicated secret version"); }
  if (existing !== key) run(["secrets", "versions", "add", name, "--data-file", "-"], key);
  console.log("Dedicated partner sandbox credential stored securely.");
}

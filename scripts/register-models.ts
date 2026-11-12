import { pathToFileURL } from "node:url";
import { registerNewModels } from "./normalize/register.js";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const registered = await registerNewModels({ dryRun });

  if (registered.length === 0) {
    console.log("No new models to register.");
    return;
  }

  console.log(`${dryRun ? "Would register" : "Registered"} ${registered.length} new model(s):`);
  for (const model of registered) {
    const details = [model.vendor, model.releaseDate, model.openWeights ? "open-weights" : null]
      .filter(Boolean)
      .join(" · ");
    console.log(`  + ${model.name} (${model.id}) — ${details}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

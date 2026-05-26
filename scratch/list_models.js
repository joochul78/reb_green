const fs = require("fs");
const path = require("path");

// Parse functions/.env manually
const envPath = path.join(__dirname, "../functions/.env");
if (!fs.existsSync(envPath)) {
  console.error("No .env file found in functions directory.");
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, "utf-8");
const envVars = {};
envContent.split("\n").forEach((line) => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] ? match[2].trim() : "";
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    }
    envVars[match[1]] = value;
  }
});

const apiKey = envVars.GEMINI_API_KEY;
if (!apiKey || apiKey.startsWith("YOUR_GEMINI_API_KEY")) {
  console.error("GEMINI_API_KEY is not set or still has placeholder value in functions/.env.");
  process.exit(1);
}

console.log("Querying Gemini API for available models...");

async function main() {
  try {
    // Note: listModels is on the genAI client or requires model registry
    // Let's call the API directly or use the SDK's listModels if available.
    // In newer SDKs, listModels is not on the genAI instance directly, 
    // but we can query it using a fetch or standard SDK method if it exists.
    // Let's check:
    // To list models, the REST endpoint is:
    // https://generativelanguage.googleapis.com/v1/models?key=API_KEY
    const response = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
    const data = await response.json();
    
    if (data.error) {
      console.error("API Error:", data.error);
      return;
    }

    console.log("\n--- Available Models ---");
    data.models.forEach((model) => {
      console.log(`- ${model.name} (displayName: ${model.displayName})`);
      console.log(`  Actions: ${model.supportedGenerationMethods.join(", ")}`);
    });

  } catch (err) {
    console.error("Error listing models:", err);
  }
}

main();

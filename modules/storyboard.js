const CAMERA_MOVEMENTS = ["none", "zoom-in", "zoom-out", "pan-left", "pan-right"];

function extractJson(text) {
  const trimmed = String(text || "").trim();
  try { return JSON.parse(trimmed); } catch {}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
  throw new Error("The local model did not return valid JSON. Try again or use a different Ollama model.");
}

function normalizeScene(scene, index, defaultDuration) {
  const cameraMovement = CAMERA_MOVEMENTS.includes(scene?.cameraMovement)
    ? scene.cameraMovement
    : CAMERA_MOVEMENTS[index % CAMERA_MOVEMENTS.length];
  return {
    title: String(scene?.title || `Scene ${index + 1}`).trim().slice(0, 100),
    description: String(scene?.description || scene?.visualNotes || "").trim().slice(0, 500),
    narration: String(scene?.narration || "").trim().slice(0, 2000),
    imagePrompt: String(scene?.imagePrompt || scene?.prompt || scene?.description || "").trim().slice(0, 4000),
    duration: Math.min(15, Math.max(2, Number(scene?.duration) || defaultDuration)),
    cameraMovement
  };
}

export async function generateStoryboard({ ollamaUrl, model, idea, length, style, audience }) {
  const targetSeconds = [15, 30, 60].includes(Number(length)) ? Number(length) : 30;
  const sceneCount = targetSeconds === 15 ? 3 : targetSeconds === 60 ? 8 : 5;
  const defaultDuration = targetSeconds / sceneCount;
  const system = `You are a commercial storyboard director. Return ONLY valid JSON with this shape:
{"title":"...","summary":"...","scenes":[{"title":"...","description":"...","narration":"...","imagePrompt":"...","duration":5,"cameraMovement":"zoom-in"}]}
Use exactly ${sceneCount} scenes totaling about ${targetSeconds} seconds. cameraMovement must be one of: none, zoom-in, zoom-out, pan-left, pan-right. Image prompts must be detailed Stable Diffusion prompts, visually varied, photorealistic unless the requested style says otherwise, and must not contain text, captions, logos, watermarks, or typography. Narration must be concise enough to speak during the scene duration. Maintain visual continuity across scenes.`;
  const prompt = `Create a ${targetSeconds}-second ${style || "cinematic"} storyboard.
Idea: ${idea}
Audience: ${audience || "general audience"}
Keep it practical for a local image-to-video workflow using one still image per scene.`;

  let response;
  try {
    response = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt }
        ],
        options: { temperature: 0.7 }
      })
    });
  } catch (error) {
    throw new Error(`Could not connect to Ollama at ${ollamaUrl}. Start it with: ollama serve`);
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama ${response.status}: ${body || response.statusText}`);
  }
  const payload = await response.json();
  const parsed = extractJson(payload?.message?.content || payload?.response || "");
  if (!Array.isArray(parsed.scenes) || !parsed.scenes.length) throw new Error("Ollama returned no storyboard scenes.");
  const scenes = parsed.scenes.slice(0, sceneCount).map((scene, index) => normalizeScene(scene, index, defaultDuration));
  const total = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  if (total > 0 && Math.abs(total - targetSeconds) > 1) {
    const factor = targetSeconds / total;
    scenes.forEach(scene => { scene.duration = Math.max(2, Math.round(scene.duration * factor * 2) / 2); });
  }
  return {
    title: String(parsed.title || "AI Storyboard").slice(0, 100),
    summary: String(parsed.summary || "").slice(0, 500),
    scenes
  };
}

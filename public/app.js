const state = { projects: [], selectedId: null, editingProjectId: null, dialogImage: null };

const byId = id => document.querySelector(`#${id}`);
const projectList = byId("projectList");
const projectTitle = byId("projectTitle");
const projectDescription = byId("projectDescription");
const projectActions = byId("projectActions");
const workspace = byId("workspace");
const emptyState = byId("emptyState");
const gallery = byId("gallery");
const imageCount = byId("imageCount");
const health = byId("health");
const form = byId("generateForm");
const generateButton = byId("generateButton");
const message = byId("message");
const projectDialog = byId("projectDialog");
const projectForm = byId("projectForm");
const projectError = byId("projectError");
const imageDialog = byId("imageDialog");

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
  return data;
}

function currentProject() {
  return state.projects.find(project => project.id === state.selectedId) || null;
}

function setBusy(button, busy, text = null) {
  if (!button) return;
  if (busy) button.dataset.originalText = button.textContent;
  button.disabled = busy;
  if (text) button.textContent = busy ? text : (button.dataset.originalText || button.textContent);
}

function renderProjects() {
  projectList.innerHTML = "";
  for (const project of state.projects) {
    const button = document.createElement("button");
    button.className = `project-item${project.id === state.selectedId ? " active" : ""}`;
    const name = document.createElement("strong");
    const count = document.createElement("small");
    name.textContent = project.name;
    count.textContent = `${project.images.length} image${project.images.length === 1 ? "" : "s"}`;
    button.append(name, count);
    button.addEventListener("click", () => selectProject(project.id));
    projectList.append(button);
  }
}

function createCardButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", event => {
    event.stopPropagation();
    handler();
  });
  return button;
}

function renderWorkspace() {
  const project = currentProject();
  if (!project) {
    workspace.hidden = true;
    emptyState.hidden = false;
    projectActions.hidden = true;
    projectTitle.textContent = "Create your first project";
    projectDescription.textContent = "Images and generation settings will stay organized here.";
    return;
  }

  workspace.hidden = false;
  emptyState.hidden = true;
  projectActions.hidden = false;
  projectTitle.textContent = project.name;
  projectDescription.textContent = project.description || "Generate images and build this project’s visual library.";
  imageCount.textContent = `${project.images.length} image${project.images.length === 1 ? "" : "s"}`;
  gallery.innerHTML = "";

  if (!project.images.length) {
    gallery.innerHTML = '<div class="gallery-empty">No images yet. Generate the first image for this project.</div>';
    return;
  }

  for (const image of project.images) {
    const card = document.createElement("article");
    card.className = "image-card";
    const img = document.createElement("img");
    img.src = image.url;
    img.alt = "Generated image";
    img.addEventListener("click", () => openImage(image));

    const body = document.createElement("div");
    body.className = "card-body";
    const prompt = document.createElement("p");
    prompt.textContent = image.prompt;
    const meta = document.createElement("div");
    meta.className = "card-meta";
    const seed = document.createElement("span");
    seed.textContent = `Seed ${image.seed}`;
    meta.append(seed);

    const buttons = document.createElement("div");
    buttons.className = "card-buttons";
    buttons.append(
      createCardButton("Use", "text-button", () => useImageSettings(image)),
      createCardButton("Regenerate", "text-button", () => regenerateImage(image, false)),
      createCardButton("Delete", "text-button danger-text", () => deleteImage(image))
    );
    body.append(prompt, meta, buttons);
    card.append(img, body);
    gallery.append(card);
  }
}

async function loadProjects(preferredId = null) {
  state.projects = await jsonFetch("/api/projects");
  if (preferredId && state.projects.some(project => project.id === preferredId)) state.selectedId = preferredId;
  if (!state.selectedId || !state.projects.some(project => project.id === state.selectedId)) {
    state.selectedId = state.projects[0]?.id || null;
  }
  renderProjects();
  renderWorkspace();
}

function selectProject(id) {
  state.selectedId = id;
  message.textContent = "";
  renderProjects();
  renderWorkspace();
}

function showProjectDialog(project = null) {
  state.editingProjectId = project?.id || null;
  projectForm.reset();
  projectError.textContent = "";
  byId("projectDialogEyebrow").textContent = project ? "EDIT PROJECT" : "NEW PROJECT";
  byId("projectDialogTitle").textContent = project ? "Edit project" : "Create a project";
  byId("saveProjectButton").textContent = project ? "Save changes" : "Create project";
  byId("projectName").value = project?.name || "";
  byId("projectDesc").value = project?.description || "";
  projectDialog.showModal();
  setTimeout(() => byId("projectName").focus(), 0);
}

async function saveProject(event) {
  event.preventDefault();
  projectError.textContent = "";
  const editing = Boolean(state.editingProjectId);
  try {
    const project = await jsonFetch(editing ? `/api/projects/${state.editingProjectId}` : "/api/projects", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: byId("projectName").value, description: byId("projectDesc").value })
    });
    projectDialog.close();
    state.editingProjectId = null;
    await loadProjects(project.id);
  } catch (error) {
    projectError.textContent = error.message;
  }
}

async function deleteProject() {
  const project = currentProject();
  if (!project) return;
  const confirmed = confirm(`Delete project “${project.name}” and all ${project.images.length} saved image(s)? This cannot be undone.`);
  if (!confirmed) return;
  try {
    await jsonFetch(`/api/projects/${project.id}`, { method: "DELETE" });
    state.selectedId = null;
    await loadProjects();
  } catch (error) {
    alert(error.message);
  }
}

function generationPayload() {
  const seedText = byId("seed").value.trim();
  const payload = {
    prompt: byId("prompt").value,
    negativePrompt: byId("negativePrompt").value,
    width: Number(byId("width").value),
    height: Number(byId("height").value),
    steps: Number(byId("steps").value),
    cfg: Number(byId("cfg").value)
  };
  if (seedText) payload.seed = Number(seedText);
  return payload;
}

async function generateImage(event) {
  event.preventDefault();
  const project = currentProject();
  if (!project) return;
  setBusy(generateButton, true, "Generating…");
  message.textContent = "Generating and saving… this can take a minute or more.";
  try {
    const result = await jsonFetch(`/api/projects/${project.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(generationPayload())
    });
    byId("seed").value = result.seed;
    message.textContent = "Generation complete and saved to the project.";
    await loadProjects(project.id);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    setBusy(generateButton, false, "Generating…");
    checkHealth();
  }
}

function useImageSettings(image) {
  byId("prompt").value = image.prompt || "";
  byId("negativePrompt").value = image.negativePrompt || "";
  byId("width").value = image.width;
  byId("height").value = image.height;
  byId("steps").value = image.steps;
  byId("cfg").value = image.cfg;
  byId("seed").value = image.seed;
  message.textContent = "Saved settings loaded into the generator.";
  if (imageDialog.open) imageDialog.close();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function regenerateImage(image, randomSeed) {
  const project = currentProject();
  if (!project) return;
  const label = randomSeed ? "Regenerating with a random seed…" : "Regenerating with the same seed…";
  message.textContent = label;
  if (imageDialog.open) imageDialog.close();
  try {
    const result = await jsonFetch(`/api/projects/${project.id}/images/${image.id}/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ randomSeed })
    });
    message.textContent = `Regeneration complete. Seed ${result.seed}.`;
    await loadProjects(project.id);
  } catch (error) {
    message.textContent = error.message;
  }
}

function openImage(image) {
  state.dialogImage = image;
  byId("largeImage").src = image.url;
  byId("imageMetadata").textContent =
`Prompt: ${image.prompt}

Negative prompt: ${image.negativePrompt || "(none)"}

Seed: ${image.seed}
Resolution: ${image.width} × ${image.height}
Steps: ${image.steps}
CFG: ${image.cfg}
Checkpoint: ${image.checkpoint}
Sampler: ${image.sampler || "euler"}
Created: ${new Date(image.createdAt).toLocaleString()}`;
  imageDialog.showModal();
}

async function deleteImage(image) {
  const project = currentProject();
  if (!project || !confirm("Delete this image from the project?")) return;
  try {
    await jsonFetch(`/api/projects/${project.id}/images/${image.id}`, { method: "DELETE" });
    if (imageDialog.open) imageDialog.close();
    state.dialogImage = null;
    await loadProjects(project.id);
  } catch (error) {
    alert(error.message);
  }
}

async function checkHealth() {
  try {
    await jsonFetch("/api/health");
    health.textContent = "ComfyUI connected";
    health.className = "status ok";
  } catch {
    health.textContent = "ComfyUI offline";
    health.className = "status bad";
  }
}

byId("newProjectButton").addEventListener("click", () => showProjectDialog());
byId("emptyCreateButton").addEventListener("click", () => showProjectDialog());
byId("editProjectButton").addEventListener("click", () => showProjectDialog(currentProject()));
byId("deleteProjectButton").addEventListener("click", deleteProject);
byId("cancelProject").addEventListener("click", () => projectDialog.close());
byId("closeImageDialog").addEventListener("click", () => imageDialog.close());
byId("clearSeedButton").addEventListener("click", () => { byId("seed").value = ""; message.textContent = "The next generation will use a random seed."; });
byId("useImageSettingsButton").addEventListener("click", () => state.dialogImage && useImageSettings(state.dialogImage));
byId("regenerateImageButton").addEventListener("click", () => state.dialogImage && regenerateImage(state.dialogImage, false));
byId("regenerateRandomButton").addEventListener("click", () => state.dialogImage && regenerateImage(state.dialogImage, true));
byId("deleteDialogImageButton").addEventListener("click", () => state.dialogImage && deleteImage(state.dialogImage));
projectForm.addEventListener("submit", saveProject);
form.addEventListener("submit", generateImage);

await Promise.all([loadProjects(), checkHealth()]);

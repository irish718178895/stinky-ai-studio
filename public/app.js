const state = { projects: [], selectedId: null };

const projectList = document.querySelector("#projectList");
const projectTitle = document.querySelector("#projectTitle");
const projectDescription = document.querySelector("#projectDescription");
const workspace = document.querySelector("#workspace");
const emptyState = document.querySelector("#emptyState");
const gallery = document.querySelector("#gallery");
const imageCount = document.querySelector("#imageCount");
const health = document.querySelector("#health");
const form = document.querySelector("#generateForm");
const generateButton = document.querySelector("#generateButton");
const message = document.querySelector("#message");
const projectDialog = document.querySelector("#projectDialog");
const projectForm = document.querySelector("#projectForm");
const projectError = document.querySelector("#projectError");
const imageDialog = document.querySelector("#imageDialog");

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
  return data;
}

function currentProject() {
  return state.projects.find(project => project.id === state.selectedId) || null;
}

function renderProjects() {
  projectList.innerHTML = "";
  for (const project of state.projects) {
    const button = document.createElement("button");
    button.className = `project-item${project.id === state.selectedId ? " active" : ""}`;
    button.innerHTML = `<strong></strong><small>${project.images.length} image${project.images.length === 1 ? "" : "s"}</small>`;
    button.querySelector("strong").textContent = project.name;
    button.addEventListener("click", () => selectProject(project.id));
    projectList.append(button);
  }
}

function renderWorkspace() {
  const project = currentProject();
  if (!project) {
    workspace.hidden = true;
    emptyState.hidden = false;
    projectTitle.textContent = "Create your first project";
    projectDescription.textContent = "Images and generation settings will stay organized here.";
    return;
  }

  workspace.hidden = false;
  emptyState.hidden = true;
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
    card.innerHTML = `
      <img alt="Generated image">
      <div class="card-body">
        <p></p>
        <div class="card-meta"><span></span><button class="delete-image" title="Delete image">Delete</button></div>
      </div>`;
    const img = card.querySelector("img");
    img.src = image.url;
    card.querySelector("p").textContent = image.prompt;
    card.querySelector("span").textContent = `Seed ${image.seed}`;
    img.addEventListener("click", () => openImage(image));
    card.querySelector(".delete-image").addEventListener("click", () => deleteImage(image));
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
  renderProjects();
  renderWorkspace();
}

function showProjectDialog() {
  projectForm.reset();
  projectError.textContent = "";
  projectDialog.showModal();
  setTimeout(() => document.querySelector("#projectName").focus(), 0);
}

async function createProject(event) {
  event.preventDefault();
  projectError.textContent = "";
  try {
    const project = await jsonFetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: document.querySelector("#projectName").value,
        description: document.querySelector("#projectDesc").value
      })
    });
    projectDialog.close();
    await loadProjects(project.id);
  } catch (error) {
    projectError.textContent = error.message;
  }
}

async function generateImage(event) {
  event.preventDefault();
  const project = currentProject();
  if (!project) return;

  generateButton.disabled = true;
  message.textContent = "Generating and saving… this can take a minute or more.";
  const seedText = document.querySelector("#seed").value.trim();
  const payload = {
    prompt: document.querySelector("#prompt").value,
    negativePrompt: document.querySelector("#negativePrompt").value,
    width: Number(document.querySelector("#width").value),
    height: Number(document.querySelector("#height").value),
    steps: Number(document.querySelector("#steps").value),
    cfg: Number(document.querySelector("#cfg").value)
  };
  if (seedText) payload.seed = Number(seedText);

  try {
    const result = await jsonFetch(`/api/projects/${project.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    document.querySelector("#seed").value = result.seed;
    message.textContent = "Generation complete and saved to the project.";
    await loadProjects(project.id);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    generateButton.disabled = false;
    checkHealth();
  }
}

function openImage(image) {
  document.querySelector("#largeImage").src = image.url;
  document.querySelector("#imageMetadata").textContent =
`Prompt: ${image.prompt}

Negative prompt: ${image.negativePrompt || "(none)"}

Seed: ${image.seed}
Resolution: ${image.width} × ${image.height}
Steps: ${image.steps}
CFG: ${image.cfg}
Checkpoint: ${image.checkpoint}
Created: ${new Date(image.createdAt).toLocaleString()}`;
  imageDialog.showModal();
}

async function deleteImage(image) {
  const project = currentProject();
  if (!project || !confirm("Delete this image from the project?")) return;
  try {
    await jsonFetch(`/api/projects/${project.id}/images/${image.id}`, { method: "DELETE" });
    await loadProjects(project.id);
  } catch (error) {
    alert(error.message);
  }
}

async function checkHealth() {
  try {
    const result = await jsonFetch("/api/health");
    health.textContent = "ComfyUI connected";
    health.className = "status ok";
  } catch {
    health.textContent = "ComfyUI offline";
    health.className = "status bad";
  }
}

document.querySelector("#newProjectButton").addEventListener("click", showProjectDialog);
document.querySelector("#emptyCreateButton").addEventListener("click", showProjectDialog);
document.querySelector("#cancelProject").addEventListener("click", () => projectDialog.close());
document.querySelector("#closeImageDialog").addEventListener("click", () => imageDialog.close());
projectForm.addEventListener("submit", createProject);
form.addEventListener("submit", generateImage);

await Promise.all([loadProjects(), checkHealth()]);

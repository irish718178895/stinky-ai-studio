const state = {
  projects: [],
  selectedId: null,
  editingProjectId: null,
  editingSceneId: null,
  dialogImage: null,
  imageJobId: null
};

const byId = id => document.querySelector(`#${id}`);
const projectList = byId("projectList");
const projectTitle = byId("projectTitle");
const projectDescription = byId("projectDescription");
const projectActions = byId("projectActions");
const workspace = byId("workspace");
const emptyState = byId("emptyState");
const gallery = byId("gallery");
const imageCount = byId("imageCount");
const videoList = byId("videoList");
const videoCount = byId("videoCount");
const renderVideoButton = byId("renderVideoButton");
const renderMessage = byId("renderMessage");
const renderProgress = byId("renderProgress");
const renderResolution = byId("renderResolution");
const renderFps = byId("renderFps");
const renderTransition = byId("renderTransition");
const renderEncoder = byId("renderEncoder");
const sceneList = byId("sceneList");
const health = byId("health");
const form = byId("generateForm");
const generateButton = byId("generateButton");
const message = byId("message");
const projectDialog = byId("projectDialog");
const projectForm = byId("projectForm");
const projectError = byId("projectError");
const sceneDialog = byId("sceneDialog");
const sceneForm = byId("sceneForm");
const sceneError = byId("sceneError");
const imageDialog = byId("imageDialog");
const storyboardForm = byId("storyboardForm");
const storyboardMessage = byId("storyboardMessage");
const generateStoryboardButton = byId("generateStoryboardButton");
const ollamaStatus = byId("ollamaStatus");
const generateAllImagesButton = byId("generateAllImagesButton");
const cancelImageBatchButton = byId("cancelImageBatchButton");
const imageBatchProgress = byId("imageBatchProgress");
const imageBatchMessage = byId("imageBatchMessage");

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
  return data;
}

function currentProject() {
  return state.projects.find(project => project.id === state.selectedId) || null;
}

function currentScene() {
  const project = currentProject();
  return project?.scenes?.find(scene => scene.id === state.editingSceneId) || null;
}

function selectedSceneImage(scene, project) {
  return project.images.find(image => image.id === scene.imageId) || null;
}

function setBusy(button, busy, busyText = null) {
  if (!button) return;
  if (busy) button.dataset.originalText = button.textContent;
  button.disabled = busy;
  if (busyText) button.textContent = busy ? busyText : (button.dataset.originalText || button.textContent);
}

function renderProjects() {
  projectList.innerHTML = "";
  for (const project of state.projects) {
    const button = document.createElement("button");
    button.className = `project-item${project.id === state.selectedId ? " active" : ""}`;
    const name = document.createElement("strong");
    const count = document.createElement("small");
    name.textContent = project.name;
    const sceneCount = project.scenes?.length || 0;
    count.textContent = `${project.images.length} image${project.images.length === 1 ? "" : "s"} · ${sceneCount} scene${sceneCount === 1 ? "" : "s"}`;
    button.append(name, count);
    button.addEventListener("click", () => selectProject(project.id));
    projectList.append(button);
  }
}

function createCardButton(label, className, handler, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", event => {
    event.stopPropagation();
    handler();
  });
  return button;
}

function renderScenes(project) {
  sceneList.innerHTML = "";
  const scenes = [...(project.scenes || [])].sort((a, b) => a.order - b.order);

  if (!scenes.length) {
    sceneList.innerHTML = '<div class="gallery-empty">No scenes yet. Add the opening shot for this project.</div>';
    return;
  }

  for (const [index, scene] of scenes.entries()) {
    const selectedImage = selectedSceneImage(scene, project);
    const card = document.createElement("article");
    card.className = "scene-card";

    const order = document.createElement("div");
    order.className = "scene-order";
    order.textContent = String(index + 1).padStart(2, "0");

    const preview = document.createElement("div");
    preview.className = "scene-preview";
    if (selectedImage) {
      const image = document.createElement("img");
      image.src = selectedImage.url;
      image.alt = `Selected image for ${scene.title}`;
      image.addEventListener("click", () => openImage(selectedImage));
      preview.append(image);
    } else {
      preview.innerHTML = '<span>No image</span>';
    }

    const content = document.createElement("div");
    content.className = "scene-content";
    const heading = document.createElement("div");
    heading.className = "scene-heading";
    const title = document.createElement("h4");
    title.textContent = scene.title;
    const badges = document.createElement("div");
    badges.className = "scene-badges";
    badges.innerHTML = `<span>${scene.duration}s</span><span>${cameraMovementLabel(scene.cameraMovement)}</span><span class="${selectedImage ? "scene-ready" : "scene-missing"}">${selectedImage ? "Image ready" : "Needs image"}</span>`;
    heading.append(title, badges);

    const description = document.createElement("p");
    description.className = "scene-description";
    description.textContent = scene.description || "No visual notes.";

    const narration = document.createElement("blockquote");
    narration.textContent = scene.narration || "No narration entered.";

    const controls = document.createElement("div");
    controls.className = "scene-controls";
    controls.append(
      createCardButton("Use prompt", "text-button", () => loadScenePrompt(scene)),
      createCardButton("Edit", "text-button", () => showSceneDialog(scene)),
      createCardButton("Move up", "text-button", () => moveScene(scene, "up"), index === 0),
      createCardButton("Move down", "text-button", () => moveScene(scene, "down"), index === scenes.length - 1),
      createCardButton("Delete", "text-button danger-text", () => deleteScene(scene))
    );

    content.append(heading, description, narration, controls);
    card.append(order, preview, content);
    sceneList.append(card);
  }
}

function cameraMovementLabel(value) {
  return ({
    "none": "No movement",
    "zoom-in": "Zoom in",
    "zoom-out": "Zoom out",
    "pan-left": "Pan left",
    "pan-right": "Pan right"
  })[value] || "Zoom in";
}


function renderVideos(project) {
  const videos = project.videos || [];
  videoCount.textContent = `${videos.length} video${videos.length === 1 ? "" : "s"}`;
  videoList.innerHTML = "";
  if (!videos.length) {
    videoList.innerHTML = '<div class="gallery-empty">No rendered videos yet.</div>';
    return;
  }
  for (const video of videos) {
    const card=document.createElement("article"); card.className="video-card";
    const player=document.createElement("video"); player.src=video.url; player.controls=true; player.preload="metadata";
    const info=document.createElement("div"); info.className="card-body";
    const title=document.createElement("strong"); title.textContent=video.filename;
    const meta=document.createElement("p"); meta.className="card-meta"; const mb = video.fileSize ? `${(video.fileSize / 1024 / 1024).toFixed(1)} MB` : "";
    meta.textContent = `${video.duration}s · ${video.sceneCount} scenes · ${video.width}×${video.height} · ${video.fps || 30} fps${video.transition ? ` · ${video.transition}` : ""}${video.encoder ? ` · ${video.encoder}` : ""}${mb ? ` · ${mb}` : ""}`;
    const actions=document.createElement("div"); actions.className="card-buttons";
    const download=document.createElement("a"); download.href=video.url; download.download=video.filename; download.className="text-button link-button"; download.textContent="Download";
    const del=createCardButton("Delete","text-button danger-text",()=>deleteVideo(video));
    actions.append(download,del); info.append(title,meta,actions); card.append(player,info); videoList.append(card);
  }
}



function batchGenerationPayload() {
  return {
    onlyMissing: !byId("regenerateAssignedImages").checked,
    negativePrompt: byId("negativePrompt").value,
    width: Number(byId("width").value),
    height: Number(byId("height").value),
    steps: Number(byId("steps").value),
    cfg: Number(byId("cfg").value)
  };
}

function describeImageJob(job) {
  const current = job.scenes?.find(item => item.sceneId === job.currentSceneId);
  const suffix = current ? ` — ${current.title}` : "";
  return `${job.stage || "Generating"}${suffix} — ${job.completed || 0}/${job.total || 0} scenes`;
}

async function generateAllSceneImages() {
  const project = currentProject();
  if (!project) return;
  const includeAssigned = byId("regenerateAssignedImages").checked;
  const eligible = (project.scenes || []).filter(scene => includeAssigned || !scene.imageId);
  if (!eligible.length) {
    imageBatchMessage.textContent = "Every scene already has an image.";
    return;
  }
  if (includeAssigned && !confirm(`Regenerate and replace the assigned image for ${eligible.length} scene(s)? Existing images stay in the gallery.`)) return;

  setBusy(generateAllImagesButton, true, "Generating scene images…");
  cancelImageBatchButton.hidden = false;
  imageBatchProgress.hidden = false;
  imageBatchProgress.value = 0;
  imageBatchMessage.textContent = `Queuing ${eligible.length} scene(s)…`;

  try {
    const job = await jsonFetch(`/api/projects/${project.id}/generate-scene-images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batchGenerationPayload())
    });
    state.imageJobId = job.id;

    while (state.imageJobId === job.id) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const status = await jsonFetch(`/api/image-jobs/${job.id}`);
      imageBatchProgress.value = status.progress || 0;
      imageBatchMessage.textContent = describeImageJob(status);
      if (["complete", "complete-with-errors", "cancelled", "error"].includes(status.status)) {
        if (status.status === "error") throw new Error(status.error || "Scene image generation failed.");
        const failures = (status.scenes || []).filter(item => item.status === "error");
        imageBatchMessage.textContent = status.status === "cancelled"
          ? `Cancelled after ${status.completed}/${status.total} scenes.`
          : failures.length
            ? `Finished with ${failures.length} failed scene(s). Edit their prompts and run again.`
            : `Generated and assigned ${status.completed} scene image(s).`;
        await loadProjects(project.id);
        break;
      }
    }
  } catch (error) {
    imageBatchMessage.textContent = error.message;
  } finally {
    state.imageJobId = null;
    setBusy(generateAllImagesButton, false, "Generating scene images…");
    cancelImageBatchButton.hidden = true;
    setTimeout(() => { imageBatchProgress.hidden = true; }, 1500);
    checkHealth();
  }
}

async function cancelImageBatch() {
  if (!state.imageJobId) return;
  cancelImageBatchButton.disabled = true;
  imageBatchMessage.textContent = "Cancellation requested. The current ComfyUI image will finish first…";
  try {
    await jsonFetch(`/api/image-jobs/${state.imageJobId}/cancel`, { method: "POST" });
  } catch (error) {
    imageBatchMessage.textContent = error.message;
  } finally {
    cancelImageBatchButton.disabled = false;
  }
}

async function renderVideo() {
  const project = currentProject();
  if (!project) return;
  setBusy(renderVideoButton, true, "Rendering…");
  renderProgress.hidden = false;
  renderProgress.value = 0;
  renderMessage.textContent = "Starting cinematic render…";
  try {
    const job = await jsonFetch(`/api/projects/${project.id}/render-video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resolution: renderResolution.value,
        fps: Number(renderFps.value),
        transition: renderTransition.value,
        encoder: renderEncoder.value,
        transitionDuration: 0.6
      })
    });

    while (true) {
      await new Promise(resolve => setTimeout(resolve, 750));
      const status = await jsonFetch(`/api/render-jobs/${job.id}`);
      renderProgress.value = status.progress || 0;
      renderMessage.textContent = `${status.stage || "Rendering"} — ${status.progress || 0}%`;
      if (status.status === "complete") {
        renderMessage.textContent = `Finished ${status.video.filename}`;
        await loadProjects(project.id);
        break;
      }
      if (status.status === "error") throw new Error(status.error || "Video rendering failed.");
    }
  } catch (error) {
    renderMessage.textContent = error.message;
  } finally {
    setBusy(renderVideoButton, false, "Rendering…");
    setTimeout(() => { renderProgress.hidden = true; }, 1200);
  }
}

async function deleteVideo(video) {
  const project=currentProject();
  if(!project || !confirm(`Delete ${video.filename}?`)) return;
  await jsonFetch(`/api/projects/${project.id}/videos/${video.id}`,{method:"DELETE"});
  await loadProjects(project.id);
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
  renderScenes(project);
  renderVideos(project);
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

function populateSceneImageSelect(project, selectedId = null) {
  const select = byId("sceneImageId");
  select.innerHTML = '<option value="">No image selected</option>';
  for (const image of project.images) {
    const option = document.createElement("option");
    option.value = image.id;
    option.textContent = `${new Date(image.createdAt).toLocaleString()} · Seed ${image.seed}`;
    option.selected = image.id === selectedId;
    select.append(option);
  }
}

function showSceneDialog(scene = null) {
  const project = currentProject();
  if (!project) return;
  state.editingSceneId = scene?.id || null;
  sceneForm.reset();
  sceneError.textContent = "";
  byId("sceneDialogEyebrow").textContent = scene ? "EDIT SCENE" : "NEW SCENE";
  byId("sceneDialogTitle").textContent = scene ? "Edit scene" : "Add a scene";
  byId("saveSceneButton").textContent = scene ? "Save scene" : "Add scene";
  byId("sceneTitle").value = scene?.title || `Scene ${(project.scenes?.length || 0) + 1}`;
  byId("sceneDescription").value = scene?.description || "";
  byId("sceneImagePrompt").value = scene?.imagePrompt || scene?.description || "";
  byId("sceneNarration").value = scene?.narration || "";
  byId("sceneDuration").value = scene?.duration || 5;
  byId("sceneCameraMovement").value = scene?.cameraMovement || "zoom-in";
  populateSceneImageSelect(project, scene?.imageId || null);
  sceneDialog.showModal();
  setTimeout(() => byId("sceneTitle").focus(), 0);
}

async function saveScene(event) {
  event.preventDefault();
  const project = currentProject();
  if (!project) return;
  sceneError.textContent = "";
  const editing = Boolean(state.editingSceneId);
  const payload = {
    title: byId("sceneTitle").value,
    description: byId("sceneDescription").value,
    imagePrompt: byId("sceneImagePrompt").value,
    narration: byId("sceneNarration").value,
    duration: Number(byId("sceneDuration").value),
    cameraMovement: byId("sceneCameraMovement").value,
    imageId: byId("sceneImageId").value || null
  };

  try {
    await jsonFetch(
      editing
        ? `/api/projects/${project.id}/scenes/${state.editingSceneId}`
        : `/api/projects/${project.id}/scenes`,
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );
    sceneDialog.close();
    state.editingSceneId = null;
    await loadProjects(project.id);
  } catch (error) {
    sceneError.textContent = error.message;
  }
}

async function deleteScene(scene) {
  const project = currentProject();
  if (!project || !confirm(`Delete scene “${scene.title}”?`)) return;
  try {
    await jsonFetch(`/api/projects/${project.id}/scenes/${scene.id}`, { method: "DELETE" });
    await loadProjects(project.id);
  } catch (error) {
    alert(error.message);
  }
}

async function moveScene(scene, direction) {
  const project = currentProject();
  if (!project) return;
  try {
    await jsonFetch(`/api/projects/${project.id}/scenes/${scene.id}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction })
    });
    await loadProjects(project.id);
  } catch (error) {
    alert(error.message);
  }
}

function loadScenePrompt(scene) {
  const promptText = scene?.imagePrompt || scene?.description || "";
  if (!promptText) {
    storyboardMessage.textContent = "That scene does not have an image prompt yet.";
    return;
  }
  byId("prompt").value = promptText;
  message.textContent = `Loaded image prompt from “${scene.title}”.`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function checkOllama() {
  try {
    const status = await jsonFetch("/api/ollama/health");
    ollamaStatus.textContent = status.installed ? `${status.model} ready` : `${status.model} not pulled`;
    ollamaStatus.className = status.installed ? "status ok" : "status bad";
  } catch {
    ollamaStatus.textContent = "Ollama offline";
    ollamaStatus.className = "status bad";
  }
}

async function generateStoryboard(event) {
  event.preventDefault();
  const project = currentProject();
  if (!project) return;
  if (project.scenes?.length && byId("storyboardReplace").checked && !confirm("Replace all existing scenes with a new AI storyboard? Existing images will remain in the project gallery.")) return;
  setBusy(generateStoryboardButton, true, "Directing…");
  storyboardMessage.textContent = "The local model is writing the storyboard…";
  try {
    const result = await jsonFetch(`/api/projects/${project.id}/storyboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idea: byId("storyboardIdea").value,
        length: Number(byId("storyboardLength").value),
        style: byId("storyboardStyle").value,
        audience: byId("storyboardAudience").value,
        model: byId("storyboardModel").value,
        replaceExisting: byId("storyboardReplace").checked
      })
    });
    storyboardMessage.textContent = `Created ${result.scenes.length} scenes: ${result.storyboard.title}`;
    await loadProjects(project.id);
  } catch (error) {
    storyboardMessage.textContent = error.message;
  } finally {
    setBusy(generateStoryboardButton, false, "Directing…");
    checkOllama();
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
  if (!project || !confirm("Delete this image from the project? Scenes using it will become unassigned.")) return;
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
byId("newSceneButton").addEventListener("click", () => showSceneDialog());
renderVideoButton.addEventListener("click", renderVideo);
generateAllImagesButton.addEventListener("click", generateAllSceneImages);
cancelImageBatchButton.addEventListener("click", cancelImageBatch);
byId("cancelProject").addEventListener("click", () => projectDialog.close());
byId("cancelScene").addEventListener("click", () => sceneDialog.close());
byId("closeImageDialog").addEventListener("click", () => imageDialog.close());
byId("clearSeedButton").addEventListener("click", () => {
  byId("seed").value = "";
  message.textContent = "The next generation will use a random seed.";
});
byId("useImageSettingsButton").addEventListener("click", () => state.dialogImage && useImageSettings(state.dialogImage));
byId("regenerateImageButton").addEventListener("click", () => state.dialogImage && regenerateImage(state.dialogImage, false));
byId("regenerateRandomButton").addEventListener("click", () => state.dialogImage && regenerateImage(state.dialogImage, true));
byId("deleteDialogImageButton").addEventListener("click", () => state.dialogImage && deleteImage(state.dialogImage));
projectForm.addEventListener("submit", saveProject);
sceneForm.addEventListener("submit", saveScene);
form.addEventListener("submit", generateImage);
storyboardForm.addEventListener("submit", generateStoryboard);
byId("loadFirstPromptButton").addEventListener("click", () => {
  const first = [...(currentProject()?.scenes || [])].sort((a,b) => a.order-b.order)[0];
  if (first) loadScenePrompt(first);
  else storyboardMessage.textContent = "Generate or add a scene first.";
});

await Promise.all([loadProjects(), checkHealth(), checkOllama()]);

#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${1:-$HOME/AI-Studio/stinky-ai-studio}"
PUBLIC="$ROOT/public"
APP="$PUBLIC/app.js"
CSS="$PUBLIC/style.css"
MODULE_DIR="$PUBLIC/js"
MODULE="$MODULE_DIR/workspaces.js"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/workspace-navigation-$STAMP"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[[ -f "$APP" ]] || fail "Missing $APP"
[[ -f "$CSS" ]] || fail "Missing $CSS"
[[ -f "$PUBLIC/index.html" ]] || fail "Missing $PUBLIC/index.html"

mkdir -p "$BACKUP" "$MODULE_DIR"
cp -a "$APP" "$CSS" "$PUBLIC/index.html" "$BACKUP/"

cat > "$MODULE" <<'EOF'
const WORKSPACES = [
  { id: "project", label: "Project", icon: "📁" },
  { id: "storyboard", label: "Storyboard", icon: "🎬" },
  { id: "images", label: "Images", icon: "🖼" },
  { id: "voices", label: "Voices", icon: "🎤" },
  { id: "music", label: "Music", icon: "🎵" },
  { id: "timeline", label: "Timeline", icon: "🎞" },
  { id: "render", label: "Render", icon: "🎥" }
];

const storageKey = "stinky-ai-studio.workspace";

function element(selector) {
  return document.querySelector(selector);
}

function createPanel(id, className = "") {
  const panel = document.createElement("div");
  panel.id = `workspace-${id}`;
  panel.className = `studio-workspace ${className}`.trim();
  panel.dataset.workspacePanel = id;
  panel.hidden = true;
  return panel;
}

function moveIfPresent(target, selector) {
  const node = element(selector);
  if (node) target.append(node);
  return node;
}

function createOverview() {
  const panel = createPanel("project", "project-overview-workspace");
  panel.innerHTML = `
    <section class="panel project-overview-panel">
      <div class="section-title">
        <div>
          <p class="eyebrow">PRODUCTION DASHBOARD</p>
          <h3>Project overview</h3>
        </div>
      </div>
      <div class="project-overview-grid">
        <article>
          <span class="overview-label">Project</span>
          <strong id="workspaceProjectName">No project selected</strong>
          <p id="workspaceProjectDescription" class="muted">Choose or create a project.</p>
        </article>
        <article>
          <span class="overview-label">Images</span>
          <strong id="workspaceImageCount">0</strong>
        </article>
        <article>
          <span class="overview-label">Scenes</span>
          <strong id="workspaceSceneCount">0</strong>
        </article>
        <article>
          <span class="overview-label">Videos</span>
          <strong id="workspaceVideoCount">0</strong>
        </article>
      </div>
      <div class="workspace-quick-actions">
        <button type="button" class="primary" data-open-workspace="storyboard">Build storyboard</button>
        <button type="button" class="secondary" data-open-workspace="images">Generate images</button>
        <button type="button" class="secondary" data-open-workspace="timeline">Edit timeline</button>
        <button type="button" class="secondary" data-open-workspace="render">Render video</button>
      </div>
    </section>
  `;
  return panel;
}

function buildPanels(workspaceRoot) {
  const panels = new Map();

  const projectPanel = createOverview();
  workspaceRoot.prepend(projectPanel);
  panels.set("project", projectPanel);

  const storyboardPanel = createPanel("storyboard");
  moveIfPresent(storyboardPanel, ".storyboard-panel");
  workspaceRoot.append(storyboardPanel);
  panels.set("storyboard", storyboardPanel);

  const imagesPanel = createPanel("images");
  moveIfPresent(imagesPanel, ".generator-panel");
  moveIfPresent(imagesPanel, ".gallery-section");
  workspaceRoot.append(imagesPanel);
  panels.set("images", imagesPanel);

  const timelinePanel = createPanel("timeline");
  const sceneSection = element(".scene-section");
  if (sceneSection) {
    timelinePanel.append(sceneSection);
  }
  workspaceRoot.append(timelinePanel);
  panels.set("timeline", timelinePanel);

  const voicesPanel = createPanel("voices");
  const voiceSection = document.createElement("section");
  voiceSection.className = "panel workspace-feature-panel";
  voiceSection.innerHTML = `
    <div class="section-title">
      <div>
        <p class="eyebrow">LOCAL VOICE STUDIO</p>
        <h3>Voices</h3>
      </div>
    </div>
    <p class="muted">Generate and review narration for every scene.</p>
  `;
  const voiceBar = element(".voice-studio-bar");
  if (voiceBar) voiceSection.append(voiceBar);
  voicesPanel.append(voiceSection);
  workspaceRoot.append(voicesPanel);
  panels.set("voices", voicesPanel);

  const musicPanel = createPanel("music");
  const musicSection = document.createElement("section");
  musicSection.className = "panel workspace-feature-panel";
  musicSection.innerHTML = `
    <div class="section-title">
      <div>
        <p class="eyebrow">SOUNDTRACK</p>
        <h3>Music</h3>
      </div>
    </div>
    <p class="muted">Upload, select, and prepare background music for this production.</p>
  `;
  const musicBar = element(".music-studio-bar");
  const musicLibrary = element("#musicLibrary");
  if (musicBar) musicSection.append(musicBar);
  if (musicLibrary) musicSection.append(musicLibrary);
  musicPanel.append(musicSection);
  workspaceRoot.append(musicPanel);
  panels.set("music", musicPanel);

  const renderPanel = createPanel("render");
  const renderSection = document.createElement("section");
  renderSection.className = "panel workspace-feature-panel";
  renderSection.innerHTML = `
    <div class="section-title">
      <div>
        <p class="eyebrow">FINAL OUTPUT</p>
        <h3>Render</h3>
      </div>
    </div>
    <p class="muted">Choose output settings, render the production, and review completed videos.</p>
  `;
  const renderSettings = element(".render-settings");
  const renderBar = element(".video-render-bar");
  const videoSection = element(".video-section");
  if (renderSettings) renderSection.append(renderSettings);
  if (renderBar) renderSection.append(renderBar);
  renderPanel.append(renderSection);
  if (videoSection) renderPanel.append(videoSection);
  workspaceRoot.append(renderPanel);
  panels.set("render", renderPanel);

  return panels;
}

function buildNavigation(sidebar, panels, selectWorkspace) {
  const wrapper = document.createElement("div");
  wrapper.id = "studioWorkspaceNavigation";
  wrapper.className = "workspace-navigation";
  wrapper.innerHTML = `<div class="project-heading">Studio</div>`;

  const nav = document.createElement("nav");
  nav.className = "workspace-nav-list";

  for (const workspace of WORKSPACES) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.workspace = workspace.id;
    button.innerHTML = `<span aria-hidden="true">${workspace.icon}</span><span>${workspace.label}</span>`;
    button.addEventListener("click", () => selectWorkspace(workspace.id));
    nav.append(button);
  }

  const providers = document.createElement("button");
  providers.type = "button";
  providers.className = "workspace-provider-button";
  providers.innerHTML = `<span aria-hidden="true">⚙</span><span>Providers</span>`;
  providers.addEventListener("click", () => {
    const editButton = document.getElementById("editProjectButton");
    if (editButton && !editButton.hidden) editButton.click();
  });
  nav.append(providers);

  wrapper.append(nav);

  const projectHeading = sidebar.querySelector(".project-heading");
  if (projectHeading) sidebar.insertBefore(wrapper, projectHeading);
  else sidebar.append(wrapper);

  return wrapper;
}

function parseCount(text) {
  const match = String(text || "").match(/\d+/);
  return match ? match[0] : "0";
}

function updateOverview() {
  const title = document.getElementById("projectTitle");
  const description = document.getElementById("projectDescription");
  const imageCount = document.getElementById("imageCount");
  const videoCount = document.getElementById("videoCount");
  const sceneList = document.getElementById("sceneList");

  const nameOutput = document.getElementById("workspaceProjectName");
  const descriptionOutput = document.getElementById("workspaceProjectDescription");
  const imageOutput = document.getElementById("workspaceImageCount");
  const sceneOutput = document.getElementById("workspaceSceneCount");
  const videoOutput = document.getElementById("workspaceVideoCount");

  if (nameOutput) nameOutput.textContent = title?.textContent || "No project selected";
  if (descriptionOutput) descriptionOutput.textContent = description?.textContent || "";
  if (imageOutput) imageOutput.textContent = parseCount(imageCount?.textContent);
  if (videoOutput) videoOutput.textContent = parseCount(videoCount?.textContent);
  if (sceneOutput) sceneOutput.textContent = String(sceneList?.querySelectorAll(".scene-card").length || 0);
}

export function initWorkspaceNavigation() {
  const workspaceRoot = document.getElementById("workspace");
  const sidebar = element(".sidebar");

  if (!workspaceRoot || !sidebar || document.getElementById("studioWorkspaceNavigation")) {
    return;
  }

  const panels = buildPanels(workspaceRoot);
  let activeWorkspace = localStorage.getItem(storageKey) || "project";

  function selectWorkspace(id) {
    if (!panels.has(id)) id = "project";
    activeWorkspace = id;
    localStorage.setItem(storageKey, id);

    for (const [panelId, panel] of panels.entries()) {
      panel.hidden = panelId !== id;
    }

    document.querySelectorAll("[data-workspace]").forEach(button => {
      const active = button.dataset.workspace === id;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });

    updateOverview();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const navigation = buildNavigation(sidebar, panels, selectWorkspace);

  workspaceRoot.addEventListener("click", event => {
    const button = event.target.closest("[data-open-workspace]");
    if (button) selectWorkspace(button.dataset.openWorkspace);
  });

  const observer = new MutationObserver(() => {
    navigation.hidden = workspaceRoot.hidden;
    updateOverview();
  });

  observer.observe(workspaceRoot, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["hidden"]
  });

  navigation.hidden = workspaceRoot.hidden;
  selectWorkspace(activeWorkspace);
  updateOverview();
}
EOF

python3 - "$APP" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

import_line = 'import { initWorkspaceNavigation } from "./js/workspaces.js";\n'
if import_line not in text:
    lines = text.splitlines(keepends=True)
    insert_at = 0
    while insert_at < len(lines) and lines[insert_at].startswith("import "):
        insert_at += 1
    lines.insert(insert_at, import_line)
    text = "".join(lines)

call = "initWorkspaceNavigation();"
if call not in text:
    marker = """await Promise.all([
  loadProviders(),
  loadProjects(),
  checkHealth(),
  checkOllama(),
  checkPiper()
]);"""
    if marker not in text:
        raise SystemExit("Could not find application startup Promise.all block in public/app.js")
    text = text.replace(marker, marker + "\n\n" + call, 1)

path.write_text(text)
PY

if ! grep -q 'STINKY WORKSPACE NAVIGATION' "$CSS"; then
cat >> "$CSS" <<'EOF'

/* STINKY WORKSPACE NAVIGATION */
.workspace-navigation {
  margin-top: 1.25rem;
}

.workspace-nav-list {
  display: grid;
  gap: 0.35rem;
}

.workspace-nav-list button {
  align-items: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  color: inherit;
  cursor: pointer;
  display: flex;
  font: inherit;
  gap: 0.7rem;
  padding: 0.7rem 0.8rem;
  text-align: left;
  width: 100%;
}

.workspace-nav-list button:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.08);
}

.workspace-nav-list button.active {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.16);
  font-weight: 700;
}

.workspace-provider-button {
  margin-top: 0.5rem;
}

.studio-workspace[hidden] {
  display: none !important;
}

.studio-workspace {
  display: grid;
  gap: 1.25rem;
}

.project-overview-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(220px, 2fr) repeat(3, minmax(110px, 1fr));
  margin-top: 1rem;
}

.project-overview-grid article {
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  min-height: 110px;
  padding: 1rem;
}

.project-overview-grid strong {
  display: block;
  font-size: 1.35rem;
  margin-top: 0.35rem;
}

.overview-label {
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  opacity: 0.65;
  text-transform: uppercase;
}

.workspace-quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.25rem;
}

.workspace-feature-panel {
  display: grid;
  gap: 1rem;
}

@media (max-width: 1050px) {
  .project-overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .project-overview-grid {
    grid-template-columns: 1fr;
  }

  .workspace-nav-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
EOF
fi

echo
echo "Workspace navigation installed."
echo "Backup: $BACKUP"
echo
echo "Restart the app, then hard-refresh the browser:"
echo "  cd \"$ROOT\""
echo "  npm start"
echo
echo "If you use PM2 instead:"
echo "  pm2 restart stinky-ai-studio"

const WORKSPACE_IDS = new Set([
  "project",
  "script",
  "storyboard",
  "images",
  "voices",
  "music",
  "timeline",
  "render"
]);

const STORAGE_KEY = "stinky-ai-studio.active-workspace";

function selectWorkspace(workspace, requestedId) {
  const id = WORKSPACE_IDS.has(requestedId) ? requestedId : "project";

  workspace.dataset.activeWorkspace = id;
  localStorage.setItem(STORAGE_KEY, id);

  document.querySelectorAll("[data-workspace]").forEach(button => {
    const active = button.dataset.workspace === id;
    button.classList.toggle("active", active);

    if (active) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function initStudioNavigation() {
  const workspace = document.getElementById("workspace");
  const navigation = document.getElementById("studioWorkspaceNavigation");

  if (!workspace || !navigation) {
    console.warn("Studio navigation could not initialize.");
    return;
  }

  navigation.addEventListener("click", event => {
    const button = event.target.closest("[data-workspace]");

    if (button) {
      selectWorkspace(workspace, button.dataset.workspace);
    }
  });

  workspace.addEventListener("click", event => {
    const button = event.target.closest("[data-open-workspace]");

    if (button) {
      selectWorkspace(workspace, button.dataset.openWorkspace);
    }
  });

  document
    .getElementById("workspaceProvidersButton")
    ?.addEventListener("click", () => {
      document.getElementById("editProjectButton")?.click();
    });

  selectWorkspace(
    workspace,
    localStorage.getItem(STORAGE_KEY) || "project"
  );
}

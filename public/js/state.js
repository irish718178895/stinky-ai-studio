export const state = {
  projects: [],
  selectedId: null,
  editingProjectId: null,
  editingSceneId: null,
  dialogImage: null,
  imageJobId: null,
  playingAudio: null
};

export function currentProject() {
  return state.projects.find(project => project.id === state.selectedId) || null;
}

export function currentScene() {
  const project = currentProject();
  return project?.scenes?.find(scene => scene.id === state.editingSceneId) || null;
}

export function selectedSceneImage(scene, project) {
  return project.images.find(image => image.id === scene.imageId) || null;
}

import express from "express";

import {
  readProjects
} from "../services/project-store.js";

import {
  generateWanVideo
} from "../services/wan-video.js";


const router = express.Router();


router.post(
  "/api/projects/:projectId/images/:imageId/generate-wan-video",
  async (req, res) => {
    try {
      const projects =
        await readProjects();

      const project =
        projects.find(
          item =>
            item.id === req.params.projectId
        );

      if (!project) {
        return res.status(404).json({
          error: "Project not found."
        });
      }

      const sourceImage =
        (project.images || []).find(
          image =>
            image.id === req.params.imageId
        );

      if (!sourceImage) {
        return res.status(404).json({
          error: "Source image not found."
        });
      }

      const result =
        await generateWanVideo(
          projects,
          project,
          sourceImage,
          req.body || {}
        );

      res.json(result);
    } catch (error) {
      console.error(error);

      const status =
        [
          "A source image is required.",
          "A motion prompt is required."
        ].includes(error.message)
          ? 400
          : 500;

      res.status(status).json({
        error: error.message
      });
    }
  }
);


export default router;

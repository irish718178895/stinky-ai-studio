import express from "express";
import {
  providerManager
} from "../providers/manager.js";

const router = express.Router();

function groupProvidersByType(providers) {
  return Object.fromEntries(
    providerManager.types.map(type => [
      type,
      providers.filter(provider => provider.type === type)
    ])
  );
}

router.get("/api/providers", (_req, res) => {
  try {
    const providers = providerManager.list();

    res.json({
      defaults: {
        ...providerManager.defaults
      },
      types: [...providerManager.types],
      providers: groupProvidersByType(providers)
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});

router.get("/api/providers/health", async (_req, res) => {
  try {
    const health = await providerManager.health();

    res.json({
      providers: groupProvidersByType(health)
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});

export default router;

import express from "express";

const router = express.Router();

router.get("/", (_req, res) => {
    res.json({ status: "ok", mock: true });
});

export default router;

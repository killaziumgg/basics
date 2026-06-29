import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockFetch } from "./mockfetch.ts";
import indexRouter from "./routes/index.ts";
import checkRouter from "./routes/check.ts";
import congestionRouter from "./routes/congestion.ts";
import blockRouter from "./routes/block.ts";
import config from "../input/config.json" with { type: "json" };

globalThis.fetch = mockFetch as any;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Sert le front (new/public) à la même origine → le site tourne sur données mock.
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/config", (_req, res) => res.json(config));

app.use("/", indexRouter);
app.use("/check", checkRouter);
app.use("/congestion", congestionRouter);
app.use("/block", blockRouter);

app.use((_req, res) => {
    res.status(404).json({ success: false, error: "Route inconnue." });
});

export default app;

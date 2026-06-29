import app from "../app.ts";

const PORT = 3001;

const server = app.listen(PORT, () => {
    console.log(`Mock API démarrée sur http://localhost:${PORT}`);
});

server.requestTimeout = 0;

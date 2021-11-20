import express from 'express';
import cors from "cors";
import router from "./routes/index.js";
import BC from "./model/Blockchain.js";

const bc = BC.getBlockchain();

const app = express();
const PORT = 3001;

app.use(express.json());
app.use(cors());
app.use(router);

export default app;

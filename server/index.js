import express from "express";
import multer from "multer";
import fs from "fs-extra";
import cors from "cors";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// CONFIG
const PORT = process.env.PORT || 10000;
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;
const JWT_SECRET = process.env.JWT_SECRET || "secret";
let serviceAccount = {};

try {
  serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_JSON);
} catch (e) {
  console.error("Invalid SERVICE_ACCOUNT_JSON", e);
}

// Google Drive setup
const auth = new google.auth.GoogleAuth({
  credentials: serviceAccount,
  scopes: ["https://www.googleapis.com/auth/drive"],
});
const drive = google.drive({ version: "v3", auth });

// Multer upload config
const upload = multer({ dest: "tmp/" });

// Demo users
const USERS = [
  { username: "admin", password: "admin123", displayName: "Administrator", isAdmin: true },
  { username: "alice", password: "alice123", displayName: "Alice", isAdmin: false },
  { username: "bob", password: "bob123", displayName: "Bob", isAdmin: false }
];

// Local JSON DB
const DATA_FILE = "videos.json";
fs.ensureFileSync(DATA_FILE);
let videos = [];
try { videos = fs.readJSONSync(DATA_FILE); } catch { videos = []; }

// LOGIN
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = USERS.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ username: user.username, displayName: user.displayName, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user });
});

// AUTH MIDDLEWARE
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Missing token" });
  const token = header.split(" ")[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// UPLOAD
app.post("/api/upload", authMiddleware, upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const filePath = req.file.path;
  const title = req.body.title || req.file.originalname;
  try {
    const metadata = { name: title, parents: [DRIVE_FOLDER_ID] };
    const media = { mimeType: req.file.mimetype, body: fs.createReadStream(filePath) };

    const driveRes = await drive.files.create({ requestBody: metadata, media, fields: "id, name" });
    const fileId = driveRes.data.id;

    await drive.permissions.create({ fileId, requestBody: { role: "reader", type: "anyone" } });

    const viewUrl = `https://drive.google.com/uc?export=preview&id=${fileId}`;
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

    const videoMeta = {
      id: Date.now().toString(),
      title,
      driveFileId: fileId,
      uploader: req.user.username,
      uploadedByName: req.user.displayName,
      createdAt: Date.now(),
      viewUrl,
      downloadUrl
    };

    videos.unshift(videoMeta);
    fs.writeJSONSync(DATA_FILE, videos, { spaces: 2 });

    fs.unlinkSync(filePath);
    res.json({ success: true, video: videoMeta });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// LIST
app.get("/api/videos", (req, res) => {
  const q = (req.query.search || "").toLowerCase();
  const result = q ? videos.filter(v => v.title.toLowerCase().includes(q)) : videos;
  res.json({ videos: result });
});

// DELETE
app.post("/api/delete", authMiddleware, async (req, res) => {
  const { id } = req.body || {};
  const video = videos.find(v => v.id === id);
  if (!video) return res.status(404).json({ error: "Not found" });

  if (!(req.user.isAdmin || req.user.username === video.uploader)) {
    return res.status(403).json({ error: "Not authorized" });
  }

  try {
    await drive.files.delete({ fileId: video.driveFileId });
  } catch (e) {
    console.warn("Drive delete error:", e.message);
  }

  videos = videos.filter(v => v.id !== id);
  fs.writeJSONSync(DATA_FILE, videos, { spaces: 2 });
  res.json({ success: true });
});

// HEALTH
app.get("/api/health", (req, res) => res.json({ ok: true }));

// START SERVER
app.listen(PORT, () => console.log(`✅ PurpleStream backend live on port ${PORT}`));
/* Backend server code here (truncated for brevity) */

import multer from "multer";
import path from "path";
import fs from "fs";

const uploadDir = "uploads/media";
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.session.user.id}-${Date.now()}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (!file.mimetype.startsWith("image/") && !file.mimetype.startsWith("video/")) {
    cb(new Error("Seules les images et vidéos sont autorisées"));
  } else {
    cb(null, true);
  }
};


export const uploadMedia = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

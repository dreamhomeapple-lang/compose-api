import express from "express";
import multer from "multer";
import sharp from "sharp";

const app = express();

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

const upload = multer({ storage: multer.memoryStorage() });

app.get("/health", (req, res) => {
  res.send("ok");
});

app.post(
  "/compose",
  upload.fields([
    { name: "template", maxCount: 1 },
    { name: "input", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const templateBuf = req.files?.template?.[0]?.buffer;
      const inputBuf = req.files?.input?.[0]?.buffer;

      if (!templateBuf || !inputBuf) {
        return res.status(400).send("Missing template or input");
      }

      let config = {};
      if (typeof req.body?.config === "string" && req.body.config.trim()) {
        config = JSON.parse(req.body.config);
      } else if (req.body?.config && typeof req.body.config === "object") {
        config = req.body.config;
      }

      let areas = config.replace_area ?? config.replacements;
      if (!areas) {
        return res.status(400).send("Missing replace_area");
      }

      if (!Array.isArray(areas)) areas = [areas];

      const isValid = (a) =>
        a &&
        [a.x, a.y, a.width, a.height].every(v => typeof v === "number");

      if (areas.some(a => !isValid(a))) {
        console.log("Invalid areas:", areas);
        return res.status(400).send("Invalid replace_area config");
      }

      const fitMode = config.fit_mode || "contain";
      const padColor = config.pad_color || "#FFFFFF";

      const overlays = await Promise.all(
        areas.map(async (area) => {
          const processed =
            fitMode === "cover"
              ? await sharp(inputBuf)
                  .resize(area.width, area.height, { fit: "cover" })
                  .png()
                  .toBuffer()
              : await sharp(inputBuf)
                  .resize(area.width, area.height, {
                    fit: "contain",
                    background: padColor
                  })
                  .png()
                  .toBuffer();

          return {
            input: processed,
            left: area.x,
            top: area.y
          };
        })
      );

      const output = await sharp(templateBuf)
        .composite(overlays)
        .png()
        .toBuffer();

      res.set("Content-Type", "image/png");
      res.send(output);
    } catch (err) {
      console.error("SERVER ERROR:", err);
      res.status(500).send(String(err));
    }
  }
);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Compose API running on port ${PORT}`);
});

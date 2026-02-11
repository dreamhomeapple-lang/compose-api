import express from "express";
import multer from "multer";
import sharp from "sharp";

const app = express();

// ✅ 放在所有路由之前
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

const upload = multer({ storage: multer.memoryStorage() });

/**
 * Health check
 */
app.get("/health", (req, res) => res.send("ok"));

/**
 * POST /compose
 * 接收：
 *  - template (file)
 *  - input (file)
 *  - config (json string / object)
 *
 * config 支持：
 *  - replace_area: {x,y,width,height} 或 [{...},{...}]
 *  - replacements: [{...},{...}] （兼容用）
 *  - fit_mode: "cover" | "contain"
 *  - pad_color: "#FFFFFF"
 *
 * 返回：
 *  - image/png binary
 */
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
        console.log("❌ Missing files", {
          hasTemplate: !!templateBuf,
          hasInput: !!inputBuf,
          fields: req.files ? Object.keys(req.files) : null
        });
        return res.status(400).send("Missing template or input file");
      }

      // ✅ 解析 config（string / object / 不存在都兼容）
      let config = {};
      if (typeof req.body?.config === "string" && req.body.config.trim()) {
        try {
          config = JSON.parse(req.body.config);
        } catch (e) {
          console.log("❌ JSON.parse(config) failed. Raw config string:", req.body.config);
          return res.status(400).send("Invalid config JSON");
        }
      } else if (req.body?.config && typeof req.body.config === "object") {
        config = req.body.config;
      }

      // ✅ 支持 replace_area 或 replacements；支持单对象或数组
      let areas = config.replace_area ?? config.replacements;

      if (!areas) {
        console.log("❌ Missing replace_area/replacements. Config:", config);
        return res.status(400).send("Missing replace_area/replacements config");
      }

      // 统一成数组
      if (!Array.isArray(areas)) areas = [areas];

      // ✅ 校验每个区域
      const isValidArea = (a) =>
        a &&
        [a.x, a.y, a.width, a.height].every((v) => typeof v === "number");

      if (areas.length === 0 || areas.some((a) => !isValidArea(a))) {
        console.log("❌ Invalid replace_area config");
        console.log("areas (raw):", areas);
        console.log("areas isArray:", Array.isArray(areas));
        console.log("config:", config);
        return res.status(400).send("Invalid replace_area config");
      }

      const fitMode = config.fit_mode || config.fit || "contain"; // cover/contain
      const padColor = config.pad_color || "#FFFFFF";

      // ✅ 为每个区域生成 overlay（按区域尺寸分别处理 input）
      const overlays = await Promise.all(
        areas.map(async (area) => {
          const processedInput =
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
            input: processedInput,
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
      return res.send(output);
    } catch (err) {
      console.error("🔥 SERVER ERROR:", err);
      return res.status(500).send(String(err));
    }
  }
);

// Render / 云平台会注入 PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Compose API running on port ${PORT}`);
});

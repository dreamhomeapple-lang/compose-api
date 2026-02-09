import express from "express";
import multer from "multer";
import sharp from "sharp";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * Health check
 * 用于 Render / 浏览器测试服务是否存活
 */
app.get("/health", (req, res) => res.send("ok"));

/**
 * POST /compose
 * 接收：
 *  - template (binary)
 *  - input (binary)
 *  - config (json string)
 * 返回：
 *  - 合成后的 png
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
      const config = JSON.parse(req.body.config || "{}");

      if (!templateBuf || !inputBuf) {
        return res.status(400).send("Missing template or input file");
      }

      const area = config.replace_area;
      if (
        !area ||
        [area.x, area.y, area.width, area.height].some(v => typeof v !== "number")
      ) {
        return res.status(400).send("Invalid replace_area config");
      }

      const fitMode = config.fit_mode || "contain";
      const padColor = config.pad_color || "#FFFFFF";

      // 1️⃣ 将 input 图处理成目标区域尺寸
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

      // 2️⃣ 合成到 template 指定坐标
      const output = await sharp(templateBuf)
        .composite([
          {
            input: processedInput,
            left: area.x,
            top: area.y
          }
        ])
        .png()
        .toBuffer();

      res.set("Content-Type", "image/png");
      res.send(output);
    } catch (err) {
      console.error(err);
      res.status(500).send(String(err));
    }
  }
);

// Render / 云平台会注入 PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Compose API running on port ${PORT}`);
});

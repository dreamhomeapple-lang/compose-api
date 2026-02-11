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

      // ✅ 兼容 config 可能是 string/object/不存在
      let config = {};
      if (typeof req.body?.config === "string" && req.body.config.trim()) {
        config = JSON.parse(req.body.config);
      } else if (req.body?.config && typeof req.body.config === "object") {
        config = req.body.config;
      }

      if (!templateBuf || !inputBuf) {
        return res.status(400).send("Missing template or input file");
      }

      // ✅ 兼容两种字段名：replace_area（旧） 或 replacements（新）
      // - replace_area: object OR array
      // - replacements: array
      let areas = config.replace_area ?? config.replacements;

      // ✅ 统一转成数组
      if (!areas) {
        return res.status(400).send("Missing replace_area/replacements in config");
      }
      if (!Array.isArray(areas)) areas = [areas];

      // ✅ 校验每个区域
      const isValidArea = (a) =>
        a &&
        [a.x, a.y, a.width, a.height].every((v) => typeof v === "number");

      if (areas.length === 0 || areas.some((a) => !isValidArea(a))) {
        return res.status(400).send("Invalid replace_area/replacements config");
      }

      // ✅ 兼容两种命名：fit_mode（旧） 或 fit（新）
      const fitMode = config.fit_mode || config.fit || "contain";
      const padColor = config.pad_color || "#FFFFFF";

      // ✅ 生成每个区域对应的 overlay（按区域尺寸单独处理 input）
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

      // ✅ 一次 composite 多个 overlay
      const output = await sharp(templateBuf)
        .composite(overlays)
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

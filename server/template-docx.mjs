import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  ShadingType,
  ImageRun,
} from "docx";

const MARGIN_TWIPS = {
  narrow: { top: 720, bottom: 720, left: 720, right: 720 }, // 0.5 in
  standard: { top: 1080, bottom: 1080, left: 1080, right: 1080 }, // 0.75 in
  spacious: { top: 1440, bottom: 1440, left: 1440, right: 1440 }, // 1.0 in
};

const FONT_SIZES = {
  compact: { body: 19, heading: 24, title: 30, small: 16 }, // half-points: 9.5pt, 12pt, 15pt, 8pt
  standard: { body: 22, heading: 28, title: 36, small: 18 }, // half-points: 11pt, 14pt, 18pt, 9pt
  large: { body: 24, heading: 32, title: 40, small: 20 }, // half-points: 12pt, 16pt, 20pt, 10pt
};

function hexColor(hex, fallback = "000000") {
  if (!hex || typeof hex !== "string") return fallback;
  const clean = hex.replace("#", "").trim();
  return /^[0-9a-fA-F]{6}$/.test(clean) ? clean : fallback;
}

function renderBlockToDocxElements(block, style, font, sizes) {
  const elements = [];
  const accent = hexColor(style.accentColor, "2e7d32");

  switch (block.type) {
    case "header": {
      if (block.title) {
        elements.push(
          new Paragraph({
            heading: HeadingLevel.TITLE,
            spacing: { before: 0, after: 60 },
            children: [
              new TextRun({
                text: block.title,
                bold: true,
                font,
                size: sizes.title,
                color: accent,
              }),
            ],
          }),
        );
      }
      if (block.content) {
        elements.push(
          new Paragraph({
            spacing: { after: 140 },
            children: [
              new TextRun({
                text: block.content,
                font,
                size: sizes.small,
                color: "555555",
              }),
            ],
          }),
        );
      }
      break;
    }

    case "summary":
    case "custom_text": {
      if (block.title) {
        elements.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 120, after: 60 },
            children: [
              new TextRun({
                text: block.title.toUpperCase(),
                bold: true,
                font,
                size: sizes.heading,
                color: accent,
              }),
            ],
          }),
        );
      }
      if (block.content) {
        const lines = block.content.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          elements.push(
            new Paragraph({
              spacing: { after: 60 },
              children: [
                new TextRun({
                  text: line,
                  font,
                  size: sizes.body,
                  color: "222222",
                }),
              ],
            }),
          );
        }
      }
      break;
    }

    case "experience":
    case "education": {
      if (block.title) {
        elements.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 140, after: 60 },
            children: [
              new TextRun({
                text: block.title.toUpperCase(),
                bold: true,
                font,
                size: sizes.heading,
                color: accent,
              }),
            ],
          }),
        );
      }
      if (Array.isArray(block.items)) {
        for (const item of block.items) {
          elements.push(
            new Paragraph({
              spacing: { before: 60, after: 30 },
              children: [
                new TextRun({
                  text: item.title,
                  bold: true,
                  font,
                  size: sizes.body,
                  color: "111111",
                }),
                ...(item.subtitle
                  ? [
                      new TextRun({
                        text: ` | ${item.subtitle}`,
                        font,
                        size: sizes.body,
                        color: "555555",
                      }),
                    ]
                  : []),
                ...(item.date
                  ? [
                      new TextRun({
                        text: ` (${item.date})`,
                        font,
                        size: sizes.small,
                        color: "777777",
                        italics: true,
                      }),
                    ]
                  : []),
              ],
            }),
          );
          if (Array.isArray(item.bullets)) {
            for (const bullet of item.bullets) {
              if (!bullet.trim()) continue;
              elements.push(
                new Paragraph({
                  bullet: { level: 0 },
                  spacing: { after: 30 },
                  children: [
                    new TextRun({
                      text: bullet,
                      font,
                      size: sizes.body,
                      color: "333333",
                    }),
                  ],
                }),
              );
            }
          }
        }
      }
      break;
    }

    case "skills": {
      if (block.title) {
        elements.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 120, after: 60 },
            children: [
              new TextRun({
                text: block.title.toUpperCase(),
                bold: true,
                font,
                size: sizes.heading,
                color: accent,
              }),
            ],
          }),
        );
      }
      if (block.content) {
        const skills = block.content
          .split(/[,;\n]/)
          .map((s) => s.trim())
          .filter(Boolean);
        for (const skill of skills) {
          elements.push(
            new Paragraph({
              bullet: { level: 0 },
              spacing: { after: 30 },
              children: [
                new TextRun({
                  text: skill,
                  font,
                  size: sizes.body,
                  color: "333333",
                }),
              ],
            }),
          );
        }
      }
      break;
    }

    case "image": {
      if (block.imageUrl && block.imageUrl.startsWith("data:image/")) {
        try {
          const parts = block.imageUrl.split(",");
          if (parts.length === 2) {
            const buf = Buffer.from(parts[1], "base64");
            const width = Math.min(400, Math.max(50, block.imageWidth || 120));
            const height = width; // square or proportional
            elements.push(
              new Paragraph({
                alignment:
                  block.imageAlignment === "center"
                    ? AlignmentType.CENTER
                    : block.imageAlignment === "right"
                      ? AlignmentType.RIGHT
                      : AlignmentType.LEFT,
                spacing: { before: 60, after: 80 },
                children: [
                  new ImageRun({
                    data: buf,
                    transformation: { width, height },
                  }),
                ],
              }),
            );
          }
        } catch {}
      }
      break;
    }

    default:
      break;
  }

  return elements;
}

const NO_BORDER = {
  style: BorderStyle.NONE,
  size: 0,
  color: "auto",
};

export async function buildTemplateDocx(templateDef) {
  const marginKey = templateDef.margins || "standard";
  const margins = MARGIN_TWIPS[marginKey] || MARGIN_TWIPS.standard;
  const font = templateDef.fontFamily || "Calibri";
  const sizes = FONT_SIZES[templateDef.fontSize || "standard"] || FONT_SIZES.standard;
  const layout = templateDef.layout || "1-column";

  const blocks = Array.isArray(templateDef.blocks) ? templateDef.blocks : [];

  const noBorders = {
    top: NO_BORDER,
    bottom: NO_BORDER,
    left: NO_BORDER,
    right: NO_BORDER,
    insideHorizontal: NO_BORDER,
    insideVertical: NO_BORDER,
  };

  let sectionChildren = [];

  if (layout === "1-column") {
    for (const block of blocks) {
      const rendered = renderBlockToDocxElements(block, templateDef, font, sizes);
      sectionChildren.push(...rendered);
    }
  } else if (layout === "2-column-left-sidebar" || layout === "2-column-right-sidebar") {
    const isLeftSidebar = layout === "2-column-left-sidebar";
    const sidebarBlocks = blocks.filter((b) => b.column === (isLeftSidebar ? 0 : 1));
    const mainBlocks = blocks.filter((b) => b.column === (isLeftSidebar ? 1 : 0));

    const sidebarElements = [];
    for (const b of sidebarBlocks) {
      sidebarElements.push(...renderBlockToDocxElements(b, templateDef, font, sizes));
    }
    if (!sidebarElements.length) {
      sidebarElements.push(new Paragraph({ children: [new TextRun("")] }));
    }

    const mainElements = [];
    for (const b of mainBlocks) {
      mainElements.push(...renderBlockToDocxElements(b, templateDef, font, sizes));
    }
    if (!mainElements.length) {
      mainElements.push(new Paragraph({ children: [new TextRun("")] }));
    }

    const sidebarBg = hexColor(templateDef.sidebarBg, "f1f5f9");
    const sidebarShading = {
      type: ShadingType.CLEAR,
      fill: sidebarBg,
    };

    const sidebarCell = new TableCell({
      width: { size: 32, type: WidthType.PERCENTAGE },
      borders: noBorders,
      shading: sidebarShading,
      margins: { top: 180, bottom: 180, left: 180, right: 180 },
      children: sidebarElements,
    });

    const mainCell = new TableCell({
      width: { size: 68, type: WidthType.PERCENTAGE },
      borders: noBorders,
      margins: { top: 180, bottom: 180, left: 240, right: 180 },
      children: mainElements,
    });

    const row = new TableRow({
      children: isLeftSidebar ? [sidebarCell, mainCell] : [mainCell, sidebarCell],
    });

    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders,
      rows: [row],
    });

    sectionChildren.push(table);
  } else if (layout === "3-column") {
    const col0Blocks = blocks.filter((b) => b.column === 0);
    const col1Blocks = blocks.filter((b) => b.column === 1);
    const col2Blocks = blocks.filter((b) => b.column === 2);

    const makeCol = (colBlocks, pct = 33) => {
      const elems = [];
      for (const b of colBlocks) {
        elems.push(...renderBlockToDocxElements(b, templateDef, font, sizes));
      }
      if (!elems.length) elems.push(new Paragraph({ children: [new TextRun("")] }));
      return new TableCell({
        width: { size: pct, type: WidthType.PERCENTAGE },
        borders: noBorders,
        margins: { top: 140, bottom: 140, left: 140, right: 140 },
        children: elems,
      });
    };

    const row = new TableRow({
      children: [makeCol(col0Blocks, 33), makeCol(col1Blocks, 34), makeCol(col2Blocks, 33)],
    });

    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders,
      rows: [row],
    });

    sectionChildren.push(table);
  }

  if (!sectionChildren.length) {
    sectionChildren.push(
      new Paragraph({
        children: [new TextRun({ text: templateDef.title || "CV Template", font })],
      }),
    );
  }

  const doc = new Document({
    title: templateDef.title || "Custom Template",
    creator: "Opportunity Knox",
    sections: [
      {
        properties: {
          page: {
            margin: margins,
          },
        },
        children: sectionChildren,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

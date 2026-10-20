#!/usr/bin/env python3
"""Create a labeled, transparent-safe contact sheet for the built image layers."""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

TILE_WIDTH = 320
TILE_HEIGHT = 340
IMAGE_SIZE = 280
COLUMNS = 3


def checkerboard(size):
    image = Image.new("RGB", size, "#f1f1f1")
    draw = ImageDraw.Draw(image)
    cell = 12
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill="#d9d9d9")
    return image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project_dir", type=Path)
    args = parser.parse_args()
    project = args.project_dir.resolve()
    built = project / "built"
    manifest = json.loads((built / "layers.json").read_text(encoding="utf-8"))
    source = Image.open(project / "source.png").convert("RGBA")
    width, height = source.size
    tiles = [("Source", source)]
    tiles.append(("Base (inpainted)", Image.open(built / "base.png").convert("RGBA")))
    hair = Image.open(built / "hairmask.png").convert("RGBA")
    tiles.append(("Hair mask", hair))

    for name, rectangle in manifest.get("layers", {}).items():
        x, y, layer_width, layer_height = rectangle
        layer = Image.open(built / f"{name}.png").convert("RGBA")
        if layer.size != (layer_width, layer_height):
            raise ValueError(f"{name}: layer dimensions do not match layers.json")
        canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        canvas.alpha_composite(layer, (x, y))
        tiles.append((name, canvas))

    rows = (len(tiles) + COLUMNS - 1) // COLUMNS
    sheet = Image.new("RGB", (COLUMNS * TILE_WIDTH, rows * TILE_HEIGHT), "#fff")
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("arial.ttf", 15)
    except OSError:
        font = ImageFont.load_default()

    for index, (label, image) in enumerate(tiles):
        column, row = index % COLUMNS, index // COLUMNS
        left, top = column * TILE_WIDTH, row * TILE_HEIGHT
        tile = checkerboard((IMAGE_SIZE, IMAGE_SIZE)).convert("RGBA")
        image.thumbnail((IMAGE_SIZE, IMAGE_SIZE), Image.Resampling.LANCZOS)
        tile.alpha_composite(image, ((IMAGE_SIZE - image.width) // 2, (IMAGE_SIZE - image.height) // 2))
        sheet.paste(tile.convert("RGB"), (left + 20, top + 12))
        draw.text((left + 20, top + IMAGE_SIZE + 20), label, fill="#161616", font=font)

    output = built / "layer-contact-sheet.png"
    sheet.save(output)
    print(f"Layer contact sheet: {output}")


if __name__ == "__main__":
    main()

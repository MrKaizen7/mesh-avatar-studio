import argparse
import json
import sys
from pathlib import Path

import cv2


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    args = parser.parse_args()

    if sys.version_info < (3, 12):
        print(
            json.dumps(
                {
                    "available": False,
                    "reason": "The anime face detector requires Python 3.12 or newer.",
                }
            )
        )
        return 0
    try:
        from anime_face_detector import create_detector
    except ModuleNotFoundError as error:
        if error.name != "anime_face_detector":
            raise
        print(
            json.dumps(
                {
                    "available": False,
                    "reason": "Install anime-face-detector from backend/requirements.txt to enable anime face inference.",
                }
            )
        )
        return 0

    image = cv2.imread(str(args.image))
    if image is None:
        print(f"Could not read source image: {args.image}", file=sys.stderr)
        return 1

    detector = create_detector("yolov3", device="cpu")
    predictions = detector(image)
    faces = [
        {
            "bbox": [float(value) for value in prediction["bbox"]],
            "keypoints": [
                [float(value) for value in point]
                for point in prediction["keypoints"]
            ],
        }
        for prediction in predictions
    ]
    faces.sort(
        key=lambda face: (face["bbox"][2] - face["bbox"][0])
        * (face["bbox"][3] - face["bbox"][1]),
        reverse=True,
    )
    print(
        json.dumps(
            {
                "available": True,
                "image_width": int(image.shape[1]),
                "image_height": int(image.shape[0]),
                "faces": faces,
            },
            allow_nan=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

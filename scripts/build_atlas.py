#!/usr/bin/env python3
"""Measure preserved source images and build the browser's static atlas data."""

import argparse
import colorsys
import hashlib
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageCms
from skimage.color import deltaE_ciede2000, rgb2lab

ROOT = Path(__file__).resolve().parents[1]


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def dump(value):
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"


def color_metrics(rgb):
    rgb = np.asarray(rgb, dtype=np.uint8)
    unit = rgb.astype(float) / 255
    lab = rgb2lab(unit.reshape(1, 1, 3), illuminant="D65", observer="2")[0, 0]
    hue, _, saturation = colorsys.rgb_to_hls(*unit)
    return {
        "hex": "#" + "".join(f"{v:02X}" for v in rgb),
        "h": round(hue * 360, 2) if saturation > 0 else None,
        "l": round(float(lab[0]), 3),
        "c": round(float(np.hypot(lab[1], lab[2])), 3),
    }, lab


def measure_image(path):
    """Convert only the measurement buffer; never rewrite the source image."""
    with Image.open(path) as original:
        original.load()
        profile = original.info.get("icc_profile")
        if profile:
            source = ImageCms.ImageCmsProfile(io.BytesIO(profile))
            name = ImageCms.getProfileName(source).strip()
            measured = ImageCms.profileToProfile(
                original.convert("RGB"), source, ImageCms.createProfile("sRGB"),
                renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
                outputMode="RGB",
            )
            note = f"嵌入 ICC：{name}；仅测量缓冲区转换至 sRGB，图像文件未改写"
        else:
            measured = original.convert("RGB")
            note = "未嵌入 ICC；测量时假设为 sRGB（来源色域未独立确认）"
        return np.asarray(measured), note


def source_document(atlas, reference_data):
    lines = [
        "# 图像与证据来源", "",
        "本图谱用于电影色彩的学习、评论与比较。每部影片只选取一张画面，",
        "保存来源文件的原始字节；不裁切、不调色、不锐化、不做 AI 放大。",
        "这些图像不是本项目原创作品，也不包含在代码的 MIT 许可中。",
        "公开可访问不等于开放版权许可；来源信息与权利说明不构成额外授权。", "",
        "采集日期：2026-10-26。坐标、SHA-256、ICC 处理说明见 `data/atlas.json`。",
        "网页图像的显示色彩受发行版本、编码、浏览器与屏幕影响，不能据此恢复电影母版。", "",
        "## 参考色", "",
        f"[{reference_data['source']}]({reference_data['url']})，Table 2 的 Avg. of 20 charts / sRGB 数据。",
        "这组 sRGB 值源于该文档的 20 张色卡平均光谱与 D65 条件计算，不是本项目拍摄的色卡。",
        "保留原图谱使用的 24 色；四种比较用绿为 #11 黄绿、#4 叶绿、#14 绿、#6 蓝绿。",
        "HSL H 与 CIELAB D65 的 L*、C* 由所列 8-bit sRGB 值重新计算。参考色没有用于图像校正。", "",
        "## 逐片记录", "",
    ]
    for f in atlas["films"]:
        lines += [f"### {f['title']} · {f['originalTitle']} ({f['year']})", "",
                  f"- 导演：{f['director']}",
                  f"- [来源页面]({f['sourcePage']}) · [原图或原图包]({f['sourceImage'].replace(' ', '%20')})",
                  f"- 文件：`{f['image']}`；{f['width']} × {f['height']} px；{f['sourceKind']}",
                  f"- 来源内标识：{f['frameLabel']}", f"- 版本：{f['versionNote']}",
                  f"- 季节：{f['seasonLabel']}。{f['seasonEvidence']}",
                  f"- 权利说明：{f['rightsNote']}"]
        for s in f.get("seasonSources", []):
            lines += [f"- 剧情/季节依据：[{s['title']}]({s['url']})"]
        lines += [""]
    lines += ["## 使用与更正", "",
              "绿色的情绪、叙事含义属于本项目的画面解读，未声称获得导演或摄影师对该镜头意图的确认。",
              "吉卜力场面写真使用说明见各影片官方页面，FILMGRAB 的图像使用说明见各来源页面。",
              "若权利人希望移除图像，或发现帧标识、版本、导演信息有误，请通过本仓库 Issue 提供具体信息。", ""]
    return "\n".join(lines)


def build():
    atlas = read_json(ROOT / "data/catalog.json")
    reference_data = read_json(ROOT / "data/references.json")
    reference_labs = {}
    for ref in reference_data["references"]:
        rgb = [int(ref["hex"][i:i + 2], 16) for i in (1, 3, 5)]
        metrics, lab = color_metrics(rgb)
        ref.update(metrics)
        reference_labs[ref["id"]] = lab
    atlas["references"] = reference_data["references"]
    atlas["referenceSource"] = {k: reference_data[k] for k in ("source", "url", "featuredIds")}
    atlas["method"] = {
        "rgbStatistic": "per-channel median, rounded half up to 8-bit sRGB",
        "colorSpace": "sRGB; CIELAB D65, CIE 1931 2-degree observer",
        "distance": "CIEDE2000; minimum among four reference greens only",
        "roi": "[x, y, width, height], zero-based source-image pixels, half-open bounds",
        "iqr": "per-channel 75th minus 25th percentile, NumPy linear interpolation",
        "lowChromaThreshold": 5,
    }
    ids = set()
    season_ids = {s["id"] for s in atlas["seasons"]}
    theme_ids = {t["id"] for t in atlas["themes"]}
    for film in atlas["films"]:
        if film["id"] in ids:
            raise ValueError(f"Duplicate film id: {film['id']}")
        ids.add(film["id"])
        if film["season"] not in season_ids or not set(film["themes"]) <= theme_ids:
            raise ValueError(f"Unknown filter in {film['id']}")
        path = ROOT / film["image"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != film["sha256"]:
            raise ValueError(f"Original image hash changed: {film['id']}")
        pixels, profile_note = measure_image(path)
        if pixels.shape[:2] != (film["height"], film["width"]):
            raise ValueError(f"Wrong dimensions: {film['id']}")
        film["colorProfile"] = profile_note
        if len(film["samples"]) != 3:
            raise ValueError(f"Expected three regions: {film['id']}")
        for sample in film["samples"]:
            x, y, w, h = sample["rect"]
            if not all(type(v) is int for v in (x, y, w, h)) or not (
                x >= 0 and y >= 0 and w > 0 and h > 0 and
                x + w <= film["width"] and y + h <= film["height"]
            ):
                raise ValueError(f"Invalid ROI: {film['id']} {sample['rect']}")
            region = pixels[y:y + h, x:x + w].reshape(-1, 3)
            median = np.floor(np.median(region, axis=0) + 0.5).astype(np.uint8)
            metrics, lab = color_metrics(median)
            distances = {rid: float(deltaE_ciede2000(lab, reference_labs[rid]))
                         for rid in reference_data["featuredIds"]}
            nearest = min(distances, key=distances.get)
            sample.update(metrics, nearestId=nearest, deltaE=round(distances[nearest], 3),
                          iqr=np.round(np.diff(np.percentile(region, [25, 75], axis=0), axis=0)[0], 2).tolist(),
                          pixels=int(region.shape[0]))
    payload = dump(atlas)
    return {
        ROOT / "data/atlas.json": payload,
        ROOT / "data/atlas.js": "// Generated by scripts/build_atlas.py; edit data/catalog.json instead.\nwindow.CINEMA_ATLAS = " + payload.rstrip() + ";\n",
        ROOT / "SOURCES.md": source_document(atlas, reference_data),
    }, atlas


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify hashes, ROI bounds and reproducible outputs without writing.")
    args = parser.parse_args()
    outputs, atlas = build()
    stale = []
    for path, contents in outputs.items():
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != contents:
                stale.append(str(path.relative_to(ROOT)))
        else:
            path.write_text(contents, encoding="utf-8")
    if stale:
        raise SystemExit("Generated outputs differ: " + ", ".join(stale))
    count = sum(len(f["samples"]) for f in atlas["films"])
    print(f"{'Verified' if args.check else 'Built'} {len(atlas['films'])} films, {count} regions, {len(atlas['references'])} reference colors.")


if __name__ == "__main__":
    main()

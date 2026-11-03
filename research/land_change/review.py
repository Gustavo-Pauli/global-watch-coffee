"""Create prediction-blind spatial samples and chronological visual review cards."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import Window
from rasterio.warp import transform as reproject_xy

from .common import DEFAULT_OUTPUT, file_hash, rgb_image, write_json


def masked_block_average(bands, valid, factor=4):
    """Exclude clouds before aggregation, never sample one SCL for a mixed cell."""
    height, width = bands.shape[1]//factor, bands.shape[2]//factor
    cropped=np.where(valid[None,:height*factor,:width*factor],bands[:,:height*factor,:width*factor],np.nan)
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmean(cropped.reshape(bands.shape[0],height,factor,width,factor),axis=(2,4))


def median_composite(region, phase):
    images=[]
    for scene in region["scenes"]:
        if scene["phase"]!=phase:
            continue
        with rasterio.open(scene["image"]) as src, rasterio.open(scene["scl"]) as quality:
            bands=src.read()
            scl=quality.read(1)
        valid=np.isfinite(bands).all(axis=0)&np.isin(scl,(4,5,6))
        images.append(masked_block_average(bands,valid))
    if not images:
        return None
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmedian(np.stack(images),axis=0)


def overview(region, output):
    tiles=[]
    for phase in ("baseline","recent"):
        bands=median_composite(region,phase)
        if bands is None:
            continue
        for false in (False,True):
            image=rgb_image(bands,np.isfinite(bands).all(axis=0),false)
            image.thumbnail((780,780))
            tile=Image.new("RGB",(800,820),(245,245,240))
            tile.paste(image,(10,35))
            ImageDraw.Draw(tile).text((12,10),f'{region["id"]} | {phase} | {"false color" if false else "RGB"} | temporal median',fill="black")
            tiles.append(tile)
    canvas=Image.new("RGB",(1600,1640),"white")
    for index,tile in enumerate(tiles):
        canvas.paste(tile,((index%2)*800,(index//2)*820))
    path=output/f'{region["id"]}-overview.jpg'
    canvas.save(path,quality=92)
    return path


def blind_samples(region, seed, maximum=150):
    rng=np.random.default_rng(seed)
    width,height=region["width"],region["height"]
    # One center per 1 km cell, with at least 200 m from all cell boundaries.
    cells=[(row,col) for row in range(height//100) for col in range(width//100)]
    rng.shuffle(cells)
    result=[]
    transform=rasterio.Affine(*region["transform"])
    for row,col in cells[:maximum]:
        rr,cc=row*100+int(rng.integers(20,80)),col*100+int(rng.integers(20,80))
        # Freeze identical supports for the spectral RF and native model tokens.
        rr,cc=(rr//16)*16+8,(cc//16)*16+8
        x,y=transform*(cc+.5,rr+.5)
        lon,lat=reproject_xy(region["crs"],"EPSG:4326",[x],[y])
        if region["role"]=="geographic_holdout":
            split="transfer_test"
        else:
            # Position determines split, reused on all dates; neighbors have a
            # 400 m minimum center separation from the randomized cell margins.
            value=int(rng.integers(100))
            split="train" if value<60 else "validation" if value<80 else "test"
        selected=sample_scenes(region)
        target=selected[-1] if selected else None
        result.append(dict(id=f'{region["id"]}_{row:02d}_{col:02d}',region=region["id"],row=rr,col=cc,block=f'{row}_{col}',lon=lon[0],lat=lat[0],split=split,target_scene_id=target["id"] if target else None,target_date=target["date"] if target else None,label_support_m=160,label=None,certainty=None,reviewer=None,notes="",reference_kind="unreviewed"))
    return result


def sample_scenes(region):
    baseline=[s for s in region["scenes"] if s["phase"]=="baseline"]
    recent=[s for s in region["scenes"] if s["phase"]=="recent"]
    if not baseline or not recent:
        return []
    # Quality-selected, not prediction-selected. One baseline and two recent
    # dates provide context; annotation can still be marked unknown.
    baseline=sorted(baseline,key=lambda s:s["quality"]["full_resolution_clear_percent"],reverse=True)[:1]
    early=[s for s in recent if s["date"]<"2026-09-15"] or recent[:1]
    late=[s for s in recent if s["date"]>="2026-09-15"] or recent[-1:]
    selected=[*baseline,max(early,key=lambda s:s["quality"]["full_resolution_clear_percent"]),max(late,key=lambda s:s["quality"]["full_resolution_clear_percent"])]
    return sorted({s["id"]:s for s in selected}.values(),key=lambda s:s["date"])


def contact_sheets(region,samples,output):
    selected=sample_scenes(region)
    sources=[(scene,rasterio.open(scene["image"]),rasterio.open(scene["scl"])) for scene in selected]
    try:
        for offset in range(0,len(samples),12):
            canvas=Image.new("RGB",(1240,1260),(245,245,240))
            draw=ImageDraw.Draw(canvas)
            for i,sample in enumerate(samples[offset:offset+12]):
                x,y=(i%3)*410,(i//3)*310
                draw.text((x+5,y+3),f'{sample["id"]} | {sample["split"]}',fill="black")
                for j,(scene,image,quality) in enumerate(sources):
                    window=Window(sample["col"]-16,sample["row"]-16,32,32)
                    bands=image.read(window=window,boundless=True,fill_value=np.nan)
                    scl=quality.read(1,window=window,boundless=True,fill_value=0)
                    valid=np.isfinite(bands).all(axis=0)&np.isin(scl,(4,5,6))
                    rgb=rgb_image(bands,valid).resize((130,130),Image.Resampling.NEAREST)
                    false=rgb_image(bands,valid,True).resize((130,130),Image.Resampling.NEAREST)
                    # Orange box is the 160x160 m evaluation support. It is not
                    # a parcel boundary or a native10m model prediction.
                    for card in (rgb,false):
                        ImageDraw.Draw(card).rectangle((32,32,97,97),outline=(255,180,0),width=1)
                    canvas.paste(rgb,(x+5+j*132,y+32))
                    canvas.paste(false,(x+5+j*132,y+165))
                    ImageDraw.Draw(canvas).text((x+5+j*132,y+18),scene["date"][:10],fill="black")
            canvas.save(output/f'{region["id"]}-samples-{offset//12:02d}.jpg',quality=94)
    finally:
        for _,image,quality in sources:
            image.close();quality.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest",type=Path,default=DEFAULT_OUTPUT/"manifest.json")
    parser.add_argument("--output",type=Path,default=DEFAULT_OUTPUT/"review")
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    manifest=json.loads(args.manifest.read_text(encoding="utf-8"))
    freeze=args.output/"review_freeze.json"
    manifest_sha=file_hash(args.manifest)
    if freeze.exists():
        previous=json.loads(freeze.read_text(encoding="utf-8"))
        if previous["manifest_sha256"]!=manifest_sha:
            raise ValueError("Review evidence is frozen against another manifest; use another directory")
    all_samples=[]
    for index,region in enumerate(manifest["regions"]):
        all_samples.extend(blind_samples(region,20261102+index))
    target=args.output/"blind_samples.json"
    if target.exists() and json.loads(target.read_text(encoding="utf-8"))["samples"]!=all_samples:
        raise ValueError("Edited annotations exist; preserve their review cards and use another directory")
    write_json(freeze,{"manifest_sha256":manifest_sha,"annotation_target":"most recent quality-selected card date; orange160m support"})
    for index,region in enumerate(manifest["regions"]):
        overview(region,args.output)
        samples=blind_samples(region,20261102+index)
        contact_sheets(region,samples,args.output)
    if target.exists():
        old=json.loads(target.read_text(encoding="utf-8"))
        if old["samples"]!=all_samples:
            raise ValueError("Do not overwrite edited annotations; use another output directory")
    else:
        write_json(target,dict(study_id=manifest["study_id"],manifest_sha256=manifest_sha,sampling_revision=2,sampling_note="Centers aligned to global16pixelgrid+8 before reference annotation; RF/TerraMind supports match exactly.",classes={"1":"forest","2":"pasture","3":"cropland","4":"exposed_soil","5":"water"},samples=all_samples,model_predictions_shown=False))
    print(json.dumps({"review":str(args.output.resolve()),"samples":len(all_samples)}))


if __name__=="__main__":
    main()

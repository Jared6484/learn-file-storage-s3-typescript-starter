import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { buffer } from "stream/consumers";
import { randomBytes } from "crypto";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

//const videoThumbnails: Map<string, Thumbnail> = new Map();

export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  const thumbnail = videoThumbnails.get(videoId);
  if (!thumbnail) {
    throw new NotFoundError("Thumbnail not found");
  }

  return new Response(thumbnail.data, {
    headers: {
      "Content-Type": thumbnail.mediaType,
      "Cache-Control": "no-store",
    },
  });
}

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  // TODO: implement the upload here
  const formData = await req.formData();

  const thumbnail = formData.get("thumbnail"); // Had (await formData).get b/c I didn't await in ln 51
  if(!(thumbnail instanceof File)){
    throw new BadRequestError("Thumbnail is missing");
  }

  const MAX_UPLOAD_SIZE = 10 << 20;
  if(thumbnail.size > MAX_UPLOAD_SIZE){
    throw new BadRequestError("File is too large");
  }

  const mimetype =thumbnail.type;
  const file_ext = mimetype.split("/")[1];
  const filename = `${randomBytes(32).toString("base64url")}.${file_ext}`;

  const imgData = await thumbnail.arrayBuffer();

  //const buff = Buffer.from(imgData);
  //const base64 = buff.toString("base64");
  //const thumbnail_url = `data:${mimetype};base64,${base64}`;
  
  const thumbnail_url = `http://localhost:${cfg.port}/assets/${filename}`;
  await Bun.write(`${cfg.assetsRoot}/${filename}`, imgData);

  const vidData = getVideo(cfg.db, videoId);
  if(!vidData){
    throw new NotFoundError("video not found");
  }
  if(vidData?.userID != userID){
    throw new UserForbiddenError("User cannot access this video data");
  }

  //videoThumbnails.set(videoId, { data: imgData, mediaType: mimetype });

  //const url = `http://localhost:${cfg.port}/api/thumbnails/${videoId}`;

  vidData.thumbnailURL = thumbnail_url;
  updateVideo(cfg.db,vidData);

  return respondWithJSON(200, vidData);
}


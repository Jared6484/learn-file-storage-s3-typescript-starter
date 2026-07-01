import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import { S3Client, type BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo, type Video} from "../db/videos";
import { unlink } from "node:fs/promises";
import { ScriptElementKindModifier } from "typescript";
import { stdout } from "node:process"; 


export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const MAX_UPLOAD_SIZE = 1 << 30;

  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const dbVideo = getVideo(cfg.db, videoId);
  if (!dbVideo) {
    throw new NotFoundError("Couldn't find video");
  }
  if(dbVideo?.userID != userID){
    throw new UserForbiddenError("User does not own the video");
  }
  const vidData = await req.formData();
  const video = vidData.get("video");  
  if(!(video instanceof File)){
    throw new NotFoundError("Video not found");
  }
  if(video.size > MAX_UPLOAD_SIZE){
    throw new BadRequestError("File is too large");
  }
  if(video.type != "video/mp4"){
    throw new Error("Not an mp4 type");
  }

  const tempFilePath = "/tmp/tempfile.mp4";
  
  await Bun.write(tempFilePath, video);
  
  const processedVideoPath = await processVideoForFastStart(tempFilePath);

  const processedFile = Bun.file(processedVideoPath);
  //console.log("Processed file exists:", await processedFile.exists());
  //console.log("Processed file size:", processedFile.size);

  const aspectRatio = await handlerGetAspectRatio(processedVideoPath);

  //let signedVideo;

  try{

    const key = `${aspectRatio}/${videoId}.mp4`;
    const videoURL = `${cfg.s3CfDistribution}/${key}`;
    dbVideo.videoURL= videoURL;
    

    await cfg.s3Client
      .file(key, {bucket: cfg.s3Bucket})
      .write(Bun.file(processedVideoPath),{
        type: video.type,
      });

    //const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`;
    //  const presignedURL = generatePresignedURL(key);

    // const updatedVideo = {
    //   ...dbVideo,
    //   videoURL: key,
    // }
    updateVideo(cfg.db, dbVideo);

    //signedVideo = dbVideoToSignedVideo(cfg, updatedVideo);

  }finally{
    await unlink(tempFilePath);
    await unlink(processedVideoPath);
  }


  return respondWithJSON(200, dbVideo); //signedVideo);
}
// Update handlerUploadVideo to create a processed version of the video. 
// Upload the processed video to S3, and discard the original.
// Delete all your other videos from your Tubely account, we don't need them.
// Create a new video called "Boots Horizontal Fast Start" 
// with any old description and upload the horizontal video.
// Do the same thing as before: network tab -> disable cache -> refresh. 
// Now you should only see 1 request to the start of the file instead of 3! Yay, 
// small optimizations! (But more importantly, we understand what's going on now)

export async function handlerGetAspectRatio(filepath: string){
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-select_streams", "v:0","-show_entries", "stream=width,height",
    "-of","json", filepath],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text(); 

  const exitCode = await proc.exited;
  if(exitCode != 0){
    throw new Error("Program did not run correctly");
  }
  const dataJson = JSON.parse(stdoutText);

  const width = dataJson.streams[0].width;
  const height = dataJson.streams[0].height;

  const ratio = Math.floor((width / height) *100);
  if(ratio > 175 && ratio < 179){
    return "landscape";
  } else if(ratio > 54 && ratio < 58){
    return "portrait";
  }else{
    return "other";
  }

}

export async function processVideoForFastStart(inputFilePath: string){
  const outputFilePath = `${inputFilePath}.processed`;

  const proc = Bun.spawn(["ffmpeg", "-i", inputFilePath, "-movflags", "faststart", "-map_metadata",
    "0", "-codec", "copy", "-f", "mp4", outputFilePath
  ]);
  const errorText = await new Response(proc.stderr).text();

  const exitCode = await proc.exited;
  if(exitCode != 0){
    throw new Error(`Fast start function failed ${errorText}`);
  }

  return outputFilePath;
}


// export function generatePresignedURL(cfg: ApiConfig, key: string, expireTime: number){


//   const presignedURL = cfg.s3Client.presign(key, {
//     expiresIn: expireTime,
//     bucket: cfg.s3Bucket,
//     method: "GET",
//   });

//   return presignedURL;
// }

// export function dbVideoToSignedVideo(cfg: ApiConfig, video: Video){
//   const videoPresignedURL = generatePresignedURL(cfg, video.videoURL, 3600);
//   console.log("presigned URL:", videoPresignedURL);
//   video.videoURL = videoPresignedURL;
//   return video;

// }

// Create a new dbVideoToSignedVideo(cfg: ApiConfig, video: Video) function:
// It should take a video video as input and return a video with the VideoURL field set to a presigned URL.
// It should use the current video's VideoURLcontaining the key value.
// Then it should use generatePresignedURL to get a presigned URL for the video.
// Set the VideoURL field of the video to the presigned URL and return the updated video.
// Now whenever we return a video object over the wire, we need to first use the dbVideoToSignedVideo function to generate the presigned URL
// handlerUploadVideo should use it
// handlerVideoGet should use it
// handlerVideosRetrieve should use it
// Restart your server, and make sure you have a single video uploaded, it should be the vertical one. Make sure the video player works now
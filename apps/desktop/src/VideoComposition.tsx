import {AbsoluteFill} from "remotion";
import {Video} from "@remotion/media";

// Explicit width and height are required: without them a portrait clip is cropped to a zoomed strip.
export const VideoComposition: React.FC<{src: string}> = ({src}) => (
  <AbsoluteFill style={{backgroundColor: "black"}}>
    <Video src={src} objectFit="contain" style={{width: "100%", height: "100%"}} />
  </AbsoluteFill>
);

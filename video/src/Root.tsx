import React from "react";
import { Composition } from "remotion";
import { episodeFrames, makeEpisode } from "./components/makeEpisode";
import { makeThumbnail } from "./components/Thumbnail";
import { ManifestT } from "./components/types";
import ep1 from "./ep1.manifest.json";
import ep2 from "./ep2.manifest.json";
import ep3 from "./ep3.manifest.json";

// 新增一集：import manifest 後加進這張表即可，不碰任何元件程式碼
const EPISODES: Record<string, ManifestT> = {
  EP1: ep1 as unknown as ManifestT,
  EP2: ep2 as unknown as ManifestT,
  EP3: ep3 as unknown as ManifestT,
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {Object.entries(EPISODES).map(([id, m]) => (
        <React.Fragment key={id}>
          <Composition
            id={id}
            component={makeEpisode(m)}
            durationInFrames={episodeFrames(m)}
            fps={m.fps}
            width={m.width}
            height={m.height}
          />
          {/* 每集縮圖（YouTube 封面）：npx remotion still <EP>-thumb out/<ep>_thumb.png */}
          <Composition
            id={`${id}-thumb`}
            component={makeThumbnail(m)}
            durationInFrames={1}
            fps={m.fps}
            width={m.width}
            height={m.height}
          />
        </React.Fragment>
      ))}
    </>
  );
};
